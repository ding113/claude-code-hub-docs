/**
 * LiteLLM Price Table to TOML Converter
 *
 * Fetches model pricing data from LiteLLM and models.dev, normalizes model
 * names, merges same-name models across providers, and converts to TOML.
 *
 * Features:
 * - Preserves custom models (source = "custom") during updates
 * - Merges provider variants into nested pricing tables
 * - Keeps top-level litellm_provider + price fields for backward compatibility
 * - Generates checksum for integrity verification
 * - Supports incremental updates
 *
 * Usage: bun run update:prices
 */

import { createHash } from 'node:crypto'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const LITELLM_PRICES_URL =
  'https://raw.githubusercontent.com/BerriAI/litellm/main/model_prices_and_context_window.json'
const MODELSDEV_URL = 'https://models.dev/api.json'

const __dirname = dirname(fileURLToPath(import.meta.url))
const OUTPUT_PATH = join(__dirname, '../public/config/prices-base.toml')

interface LiteLLMModelInfo extends Record<string, unknown> {
  source?: string
  litellm_provider?: string
  mode?: string
  max_input_tokens?: number
  max_output_tokens?: number
  max_tokens?: number
  deprecation_date?: string
}

interface PricesData {
  [modelName: string]: LiteLLMModelInfo
}

interface ModelPricing extends Record<string, number | undefined> {
  input_cost_per_token?: number
  output_cost_per_token?: number
  cache_read_input_token_cost?: number
  cache_creation_input_token_cost?: number
  reasoning_cost_per_token?: number
  output_cost_per_image?: number
}

interface NormalizedModel extends Record<string, unknown> {
  display_name?: string
  model_family?: string
  mode: string
  max_input_tokens?: number
  max_output_tokens?: number
  max_tokens?: number

  supports_function_calling?: boolean
  supports_vision?: boolean
  supports_reasoning?: boolean
  supports_prompt_caching?: boolean
  supports_pdf_input?: boolean

  open_weights?: boolean
  knowledge_cutoff?: string
  release_date?: string
  deprecation_date?: string
  supported_modalities?: string[]
  supported_output_modalities?: string[]

  providers: string[]
  litellm_provider: string

  pricing: Record<string, ModelPricing>
  source?: string
}

interface ModelsDevProvider {
  id: string
  name: string
  models?: Record<string, ModelsDevModel>
}

interface ModelsDevModel {
  id: string
  name?: string
  family?: string
  modalities?: { input: string[]; output: string[] }
  reasoning?: boolean
  tool_call?: boolean
  open_weights?: boolean
  knowledge?: string
  release_date?: string
  cost?: {
    input?: number
    output?: number
    cache_read?: number
    reasoning?: number
  }
  limit?: { context?: number; output?: number }
}

interface ModelInfo extends Record<string, unknown> {
  source?: string
  litellm_provider?: string
  mode?: string
  pricing?: Record<string, unknown>
}

const KNOWN_PROVIDERS = new Set([
  'openai',
  'azure',
  'anthropic',
  'google',
  'gemini',
  'vertex_ai',
  'bedrock',
  'bedrock_converse',
  'cohere',
  'mistral',
  'groq',
  'together',
  'anyscale',
  'aiml',
  'deepinfra',
  'replicate',
  'huggingface',
  'fireworks_ai',
  'ollama',
  'perplexity',
  'amazon-nova',
  'amazon_nova',
  'nvidia_nim',
  'databricks',
  'friendliai',
  'voyage',
  'xinference',
  'cloudflare',
  'aleph_alpha',
  'nlp_cloud',
  'petals',
  'openrouter',
  'palm',
  'ai21',
  'sagemaker',
  'amazon',
  'aws_polly',
  'assemblyai',
  'cerebras',
])

const KNOWN_REGIONS = new Set([
  'eu',
  'us',
  'global',
  'global-standard',
  'apac',
  'us-east-1',
  'us-west-2',
  'eu-west-1',
])

interface ParsedModelName {
  provider: string | null
  region: string | null
  modelId: string
  originalName: string
}

function escapeTomlString(str: string): string {
  return str.replace(/\\/g, '\\\\').replace(/"/g, '\\"')
}

function toTomlValue(value: unknown): string {
  if (value === null || value === undefined) {
    return '""'
  }

  if (typeof value === 'string') {
    return `"${escapeTomlString(value)}"`
  }

  if (typeof value === 'number') {
    return String(value)
  }

  if (typeof value === 'boolean') {
    return value ? 'true' : 'false'
  }

  if (Array.isArray(value)) {
    if (value.length === 0) return '[]'
    const items = value.map((v) => toTomlValue(v))
    return `[${items.join(', ')}]`
  }

  if (typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>)
    if (entries.length === 0) return '{}'
    const items = entries.map(([k, v]) => `${k} = ${toTomlValue(v)}`)
    return `{ ${items.join(', ')} }`
  }

  return String(value)
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function normalizedModelToToml(
  modelName: string,
  model: NormalizedModel,
): string {
  const lines: string[] = []
  const nestedSections: { key: string; value: Record<string, unknown> }[] = []
  const pricingSections: string[] = []

  lines.push(`[models."${escapeTomlString(modelName)}"]`)

  const topLevelKeys = [
    'display_name',
    'model_family',
    'mode',
    'max_input_tokens',
    'max_output_tokens',
    'max_tokens',
    'input_cost_per_token',
    'output_cost_per_token',
    'cache_read_input_token_cost',
    'cache_creation_input_token_cost',
    'litellm_provider',
    'providers',
    'supports_function_calling',
    'supports_vision',
    'supports_reasoning',
    'supports_prompt_caching',
    'supports_pdf_input',
    'open_weights',
    'knowledge_cutoff',
    'release_date',
    'deprecation_date',
    'supported_modalities',
    'supported_output_modalities',
    'source',
  ]

  const extraKeys = Object.keys(model)
    .filter((key) => !topLevelKeys.includes(key) && key !== 'pricing')
    .sort()

  const sortedKeys = [...topLevelKeys, ...extraKeys]

  for (const key of sortedKeys) {
    const value = model[key]
    if (value === undefined || key === 'pricing') {
      continue
    }

    if (isPlainObject(value)) {
      nestedSections.push({ key, value: value as Record<string, unknown> })
    } else {
      lines.push(`${key} = ${toTomlValue(value)}`)
    }
  }

  for (const { key, value } of nestedSections) {
    lines.push('')
    lines.push(`[models."${escapeTomlString(modelName)}".${key}]`)
    const nestedKeys = Object.keys(value).sort()
    for (const nestedKey of nestedKeys) {
      lines.push(`${nestedKey} = ${toTomlValue(value[nestedKey])}`)
    }
  }

  const pricingKeys = Object.keys(model.pricing || {}).sort()
  for (const providerKey of pricingKeys) {
    const pricing = model.pricing[providerKey]
    if (!pricing || !isPlainObject(pricing)) continue

    const pricingLines: string[] = []
    pricingLines.push(
      `[models."${escapeTomlString(modelName)}".pricing."${escapeTomlString(providerKey)}"]`,
    )

    const keys = Object.keys(pricing).sort()
    for (const key of keys) {
      const value = pricing[key]
      if (value !== undefined) {
        pricingLines.push(`${key} = ${toTomlValue(value)}`)
      }
    }

    if (pricingLines.length > 1) {
      pricingSections.push(pricingLines.join('\n'))
    }
  }

  if (pricingSections.length > 0) {
    lines.push('')
    lines.push(...pricingSections)
  }

  return lines.join('\n')
}

function parseTomlValue(raw: string): unknown {
  const trimmedValue = raw.trim()
  if (trimmedValue === 'true') return true
  if (trimmedValue === 'false') return false

  if (trimmedValue.startsWith('"') && trimmedValue.endsWith('"')) {
    return trimmedValue.slice(1, -1).replace(/\\"/g, '"').replace(/\\\\/g, '\\')
  }

  if (trimmedValue.startsWith('[')) {
    try {
      return JSON.parse(trimmedValue)
    } catch {
      try {
        return JSON.parse(trimmedValue.replace(/'/g, '"'))
      } catch {
        return trimmedValue
      }
    }
  }

  if (!Number.isNaN(Number(trimmedValue))) {
    return Number(trimmedValue)
  }

  return trimmedValue
}

function parseTomlDottedPath(path: string): string[] {
  const parts: string[] = []
  let i = 0
  let current = ''
  let inQuotes = false

  while (i < path.length) {
    const ch = path[i]
    if (ch === '"') {
      inQuotes = !inQuotes
      i += 1
      continue
    }

    if (ch === '.' && !inQuotes) {
      if (current.length > 0) {
        parts.push(current)
        current = ''
      }
      i += 1
      continue
    }

    current += ch
    i += 1
  }

  if (current.length > 0) {
    parts.push(current)
  }

  return parts.filter(Boolean)
}

function getOrCreateNestedObject(
  root: Record<string, unknown>,
  path: string[],
): Record<string, unknown> {
  let current: Record<string, unknown> = root
  for (const key of path) {
    const existing = current[key]
    if (isPlainObject(existing)) {
      current = existing
    } else {
      const next: Record<string, unknown> = {}
      current[key] = next
      current = next
    }
  }
  return current
}

function parseCustomModelBlock(
  modelName: string,
  modelSection: string,
): ModelInfo {
  const info: ModelInfo = {}
  let currentTarget: Record<string, unknown> = info

  const lines = modelSection.split(/\r?\n/)
  const topHeader = `[models."${modelName}"]`

  for (const rawLine of lines) {
    const line = rawLine.trim()
    if (line.length === 0 || line.startsWith('#')) continue

    if (line === topHeader) {
      currentTarget = info
      continue
    }

    const nestedHeaderPrefix = `[models."${modelName}".`
    if (line.startsWith(nestedHeaderPrefix) && line.endsWith(']')) {
      const pathRaw = line.slice(nestedHeaderPrefix.length, -1)
      const segments = parseTomlDottedPath(pathRaw).map((s) => s.trim())
      currentTarget = getOrCreateNestedObject(info, segments)
      continue
    }

    const kvMatch = /^([a-z0-9_]+)\s*=\s*(.+)$/i.exec(line)
    if (!kvMatch) continue
    const [, key, rawValue] = kvMatch
    currentTarget[key] = parseTomlValue(rawValue)
  }

  return info
}

function loadExistingCustomModels(): Map<string, ModelInfo> {
  const customModels = new Map<string, ModelInfo>()

  if (!existsSync(OUTPUT_PATH)) {
    return customModels
  }

  const content = readFileSync(OUTPUT_PATH, 'utf-8')
  const modelRegex = /^\[models\."([^"]+)"\]\s*$/gm

  // Collect all matches first to avoid O(n^2) regex scanning
  const matches: { name: string; index: number }[] = []
  let match: RegExpExecArray | null = modelRegex.exec(content)
  while (match !== null) {
    matches.push({ name: match[1], index: match.index })
    match = modelRegex.exec(content)
  }

  // Linear scan through collected matches
  for (let i = 0; i < matches.length; i++) {
    const { name: modelName, index: startIndex } = matches[i]
    const endIndex =
      i + 1 < matches.length ? matches[i + 1].index : content.length
    const modelSection = content.slice(startIndex, endIndex)

    if (!modelSection.includes('source = "custom"')) {
      continue
    }

    const info = parseCustomModelBlock(modelName, modelSection)
    if (info.source === 'custom') {
      customModels.set(modelName, info)
    }
  }

  return customModels
}

function generateChecksum(data: string): string {
  return createHash('sha256').update(data).digest('hex')
}

async function fetchJsonWithRetry<T>(url: string, label: string): Promise<T> {
  let lastError: unknown

  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const response = await fetch(url)
      if (!response.ok) {
        throw new Error(
          `${label} fetch failed: ${response.status} ${response.statusText}`,
        )
      }
      return (await response.json()) as T
    } catch (error) {
      lastError = error
      if (attempt === 0) {
        console.warn(`${label} fetch failed, retrying once...`)
      }
    }
  }

  throw lastError instanceof Error ? lastError : new Error(String(lastError))
}

async function fetchLiteLLMPrices(): Promise<PricesData> {
  console.log(`Fetching prices from: ${LITELLM_PRICES_URL}`)

  return fetchJsonWithRetry<PricesData>(LITELLM_PRICES_URL, 'LiteLLM')
}

async function fetchModelsDevData(): Promise<
  Record<string, ModelsDevProvider>
> {
  try {
    return await fetchJsonWithRetry<Record<string, ModelsDevProvider>>(
      MODELSDEV_URL,
      'models.dev',
    )
  } catch (error) {
    console.warn(
      `models.dev fetch failed, continuing without it: ${String(error)}`,
    )
    return {}
  }
}

function countModelsDevModels(
  modelsdevData: Record<string, ModelsDevProvider>,
): number {
  let total = 0
  for (const provider of Object.values(modelsdevData)) {
    total += Object.keys(provider.models || {}).length
  }
  return total
}

function normalizeProviderId(
  provider: string | null | undefined,
): string | null {
  if (!provider) return null
  const trimmed = provider.trim()
  if (!trimmed) return null
  return trimmed.toLowerCase()
}

function parseModelName(
  fullName: string,
  litellmProvider?: string,
): ParsedModelName {
  const parts = fullName.split('/')
  const litellmProviderId = normalizeProviderId(litellmProvider)

  if (parts.length === 1) {
    return {
      provider: litellmProviderId,
      region: null,
      modelId: fullName,
      originalName: fullName,
    }
  }

  const first = parts[0]?.toLowerCase()
  const isProviderPrefix =
    (first && KNOWN_PROVIDERS.has(first)) ||
    (first && litellmProviderId && first === litellmProviderId)

  if (isProviderPrefix) {
    const provider = first ?? null
    const second = parts[1]?.toLowerCase()
    if (parts.length > 2 && second && KNOWN_REGIONS.has(second)) {
      return {
        provider,
        region: second,
        modelId: normalizeLeadingProviderPrefix(parts.slice(2).join('/')),
        originalName: fullName,
      }
    }

    return {
      provider,
      region: null,
      modelId: normalizeLeadingProviderPrefix(parts.slice(1).join('/')),
      originalName: fullName,
    }
  }

  return {
    provider: litellmProviderId,
    region: null,
    modelId: fullName,
    originalName: fullName,
  }
}

function normalizeLeadingProviderPrefix(modelId: string): string {
  let parts = modelId.split('/')
  while (parts.length > 1) {
    const first = parts[0]?.toLowerCase()
    if (!first || !KNOWN_PROVIDERS.has(first)) break

    parts = parts.slice(1)
    const maybeRegion = parts[0]?.toLowerCase()
    if (parts.length > 1 && maybeRegion && KNOWN_REGIONS.has(maybeRegion)) {
      parts = parts.slice(1)
    }
  }
  return parts.join('/')
}

function applyAliasNormalization(modelId: string): string {
  return modelId.replace(/(\d)\.(\d)/g, '$1-$2')
}

function findFirstMatchKey(
  byLowerId: Map<string, string>,
  candidates: string[],
): string | null {
  for (const candidate of candidates) {
    const key = byLowerId.get(candidate.toLowerCase())
    if (key) return key
  }
  return null
}

function extractPricingFromRecord(
  record: Record<string, unknown>,
): ModelPricing {
  const pricing: ModelPricing = {}

  for (const [key, value] of Object.entries(record)) {
    if (typeof value === 'number' && key.toLowerCase().includes('cost')) {
      pricing[key] = value
    }
  }

  return pricing
}

function extractPricing(info: LiteLLMModelInfo): ModelPricing {
  return extractPricingFromRecord(info)
}

function mergeStringArrayUnique(
  target: Record<string, unknown>,
  key: string,
  value: unknown,
): void {
  if (!Array.isArray(value)) return
  const items = value.filter((v): v is string => typeof v === 'string')
  if (items.length === 0) return

  const existing = target[key]
  const set = new Set<string>()

  if (Array.isArray(existing)) {
    for (const v of existing) {
      if (typeof v === 'string') set.add(v)
    }
  }

  for (const v of items) set.add(v)
  target[key] = [...set]
}

function mergeModelsWithSameName(
  models: Map<string, NormalizedModel>,
  parsed: ParsedModelName,
  info: LiteLLMModelInfo,
): void {
  const providerId =
    normalizeProviderId(parsed.provider ?? info.litellm_provider) ?? 'default'
  const pricingKey = parsed.region
    ? `${providerId}/${parsed.region}`
    : providerId
  const modelId = parsed.modelId

  const existing = models.get(modelId)
  if (!existing) {
    const providers = providerId !== 'default' ? [providerId] : []
    models.set(modelId, {
      ...info,
      mode: typeof info.mode === 'string' ? info.mode : 'chat',
      providers,
      litellm_provider: providerId,
      pricing: {
        [pricingKey]: extractPricing(info),
      },
    })
    return
  }

  existing.pricing[pricingKey] = extractPricing(info)

  if (providerId !== 'default' && !existing.providers.includes(providerId)) {
    existing.providers.push(providerId)
  }

  for (const [key, value] of Object.entries(info)) {
    if (typeof value === 'boolean' && key.startsWith('supports_')) {
      if (!existing[key] && value) {
        existing[key] = true
      }
    }
  }

  if (typeof info.max_input_tokens === 'number') {
    if (
      typeof existing.max_input_tokens !== 'number' ||
      info.max_input_tokens > existing.max_input_tokens
    ) {
      existing.max_input_tokens = info.max_input_tokens
    }
  }
  if (typeof info.max_output_tokens === 'number') {
    if (
      typeof existing.max_output_tokens !== 'number' ||
      info.max_output_tokens > existing.max_output_tokens
    ) {
      existing.max_output_tokens = info.max_output_tokens
    }
  }
  if (typeof info.max_tokens === 'number') {
    if (
      typeof existing.max_tokens !== 'number' ||
      info.max_tokens > existing.max_tokens
    ) {
      existing.max_tokens = info.max_tokens
    }
  }

  mergeStringArrayUnique(
    existing,
    'supported_modalities',
    info.supported_modalities,
  )
  mergeStringArrayUnique(
    existing,
    'supported_output_modalities',
    info.supported_output_modalities,
  )
  mergeStringArrayUnique(
    existing,
    'supported_endpoints',
    info.supported_endpoints,
  )

  if (!existing.litellm_provider || existing.litellm_provider === 'default') {
    existing.litellm_provider = providerId
  }
}

function modelsDevCostToPricing(cost: ModelsDevModel['cost']): ModelPricing {
  return {
    input_cost_per_token: cost?.input ? cost.input / 1_000_000 : undefined,
    output_cost_per_token: cost?.output ? cost.output / 1_000_000 : undefined,
    cache_read_input_token_cost: cost?.cache_read
      ? cost.cache_read / 1_000_000
      : undefined,
    reasoning_cost_per_token: cost?.reasoning
      ? cost.reasoning / 1_000_000
      : undefined,
  }
}

function mergePricingDeep(
  base: Record<string, ModelPricing>,
  overlay: Record<string, unknown>,
): Record<string, ModelPricing> {
  const result: Record<string, ModelPricing> = { ...base }
  for (const [providerKey, maybePricing] of Object.entries(overlay)) {
    if (!isPlainObject(maybePricing)) continue
    const existing = result[providerKey] ?? {}
    // Only copy numeric cost fields from overlay
    const pricingOverlay: ModelPricing = {}
    for (const [k, v] of Object.entries(maybePricing)) {
      if (typeof v === 'number' && k.toLowerCase().includes('cost')) {
        pricingOverlay[k] = v
      }
    }
    result[providerKey] = { ...existing, ...pricingOverlay }
  }
  return result
}

function enrichWithModelsDevData(
  models: Map<string, NormalizedModel>,
  modelsdevData: Record<string, ModelsDevProvider>,
): void {
  const byLowerId = new Map<string, string>()
  for (const id of models.keys()) {
    byLowerId.set(id.toLowerCase(), id)
  }

  for (const [providerIdRaw, provider] of Object.entries(modelsdevData)) {
    const providerId = providerIdRaw.toLowerCase()
    for (const [modelId, mdModel] of Object.entries(provider.models || {})) {
      const normalizedId = normalizeLeadingProviderPrefix(modelId)
      const canonicalId = applyAliasNormalization(normalizedId)
      const candidates = [
        canonicalId,
        normalizedId,
        modelId,
        `${providerId}/${canonicalId}`,
        `${providerId}/${normalizedId}`,
        `${providerId}/${modelId}`,
      ].filter(Boolean)

      const key = findFirstMatchKey(byLowerId, candidates)
      const costPricing = mdModel.cost
        ? modelsDevCostToPricing(mdModel.cost)
        : undefined

      if (key) {
        const existing = models.get(key)
        if (!existing) continue

        existing.display_name ??= mdModel.name
        existing.model_family ??= mdModel.family
        existing.open_weights ??= mdModel.open_weights
        existing.knowledge_cutoff ??= mdModel.knowledge
        existing.release_date ??= mdModel.release_date
        existing.supported_modalities ??= mdModel.modalities?.input
        existing.supported_output_modalities ??= mdModel.modalities?.output

        existing.supports_reasoning ||= mdModel.reasoning
        existing.supports_function_calling ||= mdModel.tool_call

        if (
          typeof existing.max_input_tokens !== 'number' &&
          typeof mdModel.limit?.context === 'number'
        ) {
          existing.max_input_tokens = mdModel.limit.context
        }
        if (
          typeof existing.max_output_tokens !== 'number' &&
          typeof mdModel.limit?.output === 'number'
        ) {
          existing.max_output_tokens = mdModel.limit.output
        }

        if (
          typeof existing.reasoning_cost_per_token !== 'number' &&
          costPricing?.reasoning_cost_per_token
        ) {
          existing.reasoning_cost_per_token =
            costPricing.reasoning_cost_per_token
        }

        if (costPricing && !existing.pricing[providerId]) {
          existing.pricing[providerId] = costPricing
          if (!existing.providers.includes(providerId)) {
            existing.providers.push(providerId)
          }
        }

        continue
      }

      if (!costPricing) continue

      const newKey = canonicalId
      if (byLowerId.has(newKey.toLowerCase())) {
        continue
      }

      const model: NormalizedModel = {
        display_name: mdModel.name,
        model_family: mdModel.family,
        mode: 'chat',
        max_input_tokens: mdModel.limit?.context,
        max_output_tokens: mdModel.limit?.output,
        supports_reasoning: mdModel.reasoning,
        supports_function_calling: mdModel.tool_call,
        open_weights: mdModel.open_weights,
        knowledge_cutoff: mdModel.knowledge,
        release_date: mdModel.release_date,
        supported_modalities: mdModel.modalities?.input,
        supported_output_modalities: mdModel.modalities?.output,
        providers: [providerId],
        litellm_provider: providerId,
        input_cost_per_token: costPricing.input_cost_per_token,
        output_cost_per_token: costPricing.output_cost_per_token,
        cache_read_input_token_cost: costPricing.cache_read_input_token_cost,
        reasoning_cost_per_token: costPricing.reasoning_cost_per_token,
        pricing: { [providerId]: costPricing },
        source: 'modelsdev',
      }

      models.set(newKey, model)
      byLowerId.set(newKey.toLowerCase(), newKey)
    }
  }
}

function normalizeProvidersAndPricing(model: NormalizedModel): void {
  if (!Array.isArray(model.providers)) {
    model.providers = []
  }

  if (!isPlainObject(model.pricing)) {
    model.pricing = {}
  }

  for (const pricingKey of Object.keys(model.pricing)) {
    const baseProvider = pricingKey.split('/')[0]
    if (baseProvider && !model.providers.includes(baseProvider)) {
      model.providers.push(baseProvider)
    }
  }

  const preferred = normalizeProviderId(model.litellm_provider)
  const unique = [...new Set(model.providers.map((p) => p.toLowerCase()))]
  unique.sort((a, b) => {
    if (preferred && a === preferred) return -1
    if (preferred && b === preferred) return 1
    return a.localeCompare(b)
  })
  model.providers = unique
}

async function main() {
  try {
    console.log('Loading existing custom models...')
    const customModels = loadExistingCustomModels()
    console.log(`Found ${customModels.size} custom models to preserve`)

    console.log('Fetching data sources in parallel...')
    const [litellmData, modelsdevData] = await Promise.all([
      fetchLiteLLMPrices(),
      fetchModelsDevData(),
    ])

    const litellmRawCount = Object.keys(litellmData).length
    const modelsdevRawCount = countModelsDevModels(modelsdevData)

    console.log(`Loaded ${litellmRawCount} models from LiteLLM`)
    console.log(`Loaded ${modelsdevRawCount} models from models.dev`)

    console.log('Normalizing and merging LiteLLM models...')
    const normalizedModels = new Map<string, NormalizedModel>()
    for (const [fullName, info] of Object.entries(litellmData)) {
      const parsed = parseModelName(fullName, info.litellm_provider)
      mergeModelsWithSameName(normalizedModels, parsed, info)
    }
    console.log(`Normalized to ${normalizedModels.size} unique models`)

    if (modelsdevRawCount > 0) {
      console.log('Enriching with models.dev data...')
      enrichWithModelsDevData(normalizedModels, modelsdevData)
      console.log(
        `After models.dev enrichment: ${normalizedModels.size} models`,
      )
    }

    console.log('Preserving custom models...')
    for (const [name, info] of customModels) {
      const existing = normalizedModels.get(name)
      if (existing) {
        const basePricing = existing.pricing
        const overlayPricing = isPlainObject(info.pricing)
          ? info.pricing
          : undefined
        Object.assign(existing, info)
        existing.source = 'custom'
        if (overlayPricing) {
          existing.pricing = mergePricingDeep(basePricing, overlayPricing)
        } else {
          existing.pricing = basePricing
        }
      } else {
        const litellmProvider =
          normalizeProviderId(
            typeof info.litellm_provider === 'string'
              ? info.litellm_provider
              : undefined,
          ) ?? 'custom'

        const model: NormalizedModel = {
          ...info,
          mode: typeof info.mode === 'string' ? info.mode : 'chat',
          providers: litellmProvider !== 'custom' ? [litellmProvider] : [],
          litellm_provider: litellmProvider,
          pricing: {},
          source: 'custom',
        }

        if (isPlainObject(info.pricing)) {
          model.pricing = mergePricingDeep(model.pricing, info.pricing)
        } else {
          const pricing = extractPricingFromRecord(model)
          if (Object.keys(pricing).length > 0) {
            model.pricing[litellmProvider] = pricing
          }
        }

        normalizedModels.set(name, model)
      }
    }

    for (const model of normalizedModels.values()) {
      normalizeProvidersAndPricing(model)
    }

    const sortedModelNames = [...normalizedModels.keys()].sort()

    const tomlSections: string[] = []

    tomlSections.push('# Generated by scripts/convert-litellm-to-toml.ts')
    tomlSections.push(
      modelsdevRawCount > 0
        ? '# Sources: LiteLLM + models.dev'
        : '# Source: LiteLLM',
    )
    tomlSections.push('')

    const modelsToml = sortedModelNames
      .map((name) => normalizedModelToToml(name, normalizedModels.get(name)!))
      .join('\n\n')

    const checksum = generateChecksum(modelsToml)
    const today = new Date()
    const version = `${today.getFullYear()}.${String(today.getMonth() + 1).padStart(2, '0')}.${String(today.getDate()).padStart(2, '0')}`

    tomlSections.push('[metadata]')
    tomlSections.push(`version = "${version}"`)
    tomlSections.push(`checksum = "${checksum}"`)
    const sources =
      modelsdevRawCount > 0 ? ['litellm', 'modelsdev'] : ['litellm']
    tomlSections.push(`sources = ${toTomlValue(sources)}`)
    tomlSections.push(`total_models = ${sortedModelNames.length}`)
    tomlSections.push(`litellm_raw_models = ${litellmRawCount}`)
    tomlSections.push(`modelsdev_raw_models = ${modelsdevRawCount}`)
    tomlSections.push(`custom_models = ${customModels.size}`)
    tomlSections.push('')
    tomlSections.push(modelsToml)
    tomlSections.push('')

    const finalToml = tomlSections.join('\n')

    writeFileSync(OUTPUT_PATH, finalToml, 'utf-8')

    console.log(`\nSuccess! Written to: ${OUTPUT_PATH}`)
    console.log(`  Version: ${version}`)
    console.log(`  Models: ${sortedModelNames.length}`)
    console.log(`  Checksum: ${checksum.slice(0, 16)}...`)
  } catch (error) {
    console.error('Error:', error)
    process.exit(1)
  }
}

main()
