import { KNOWN_PROVIDERS, KNOWN_REGIONS, getProviderMeta } from './providerMapping'

import type {
  AggregatedModel,
  ModelVariant,
  NumberRange,
  RawModelEntry,
} from '../types/model'

function isNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value)
}

function getNumber(entry: RawModelEntry, key: string): number | undefined {
  const value = entry[key]
  return isNumber(value) ? value : undefined
}

function getString(entry: RawModelEntry, key: string): string | undefined {
  const value = entry[key]
  return typeof value === 'string' ? value : undefined
}

function toRange(prev: NumberRange | undefined, next: number): NumberRange {
  if (!prev) return { min: next, max: next }
  return { min: Math.min(prev.min, next), max: Math.max(prev.max, next) }
}

export function getDisplayName(modelKey: string): string {
  const parts = modelKey.split('/')
  return parts[parts.length - 1] || modelKey
}

export function parseModelKey(modelKey: string): {
  provider: string | null
  region: string | null
  modelId: string
} {
  const parts = modelKey.split('/').filter(Boolean)
  const first = parts[0]
  if (!first || !KNOWN_PROVIDERS.has(first)) {
    return { provider: null, region: null, modelId: modelKey }
  }

  const second = parts[1]
  if (second && KNOWN_REGIONS.has(second)) {
    return {
      provider: first,
      region: second,
      modelId: parts.slice(2).join('/') || modelKey,
    }
  }

  return { provider: first, region: null, modelId: parts.slice(1).join('/') || modelKey }
}

export function extractAbilities(entry: RawModelEntry): string[] {
  const abilities: string[] = []
  for (const [key, value] of Object.entries(entry)) {
    if (key.startsWith('supports_') && value === true) {
      abilities.push(key)
    }
  }
  abilities.sort()
  return abilities
}

function extractVariantPricing(variant: RawModelEntry) {
  const inputPerToken = getNumber(variant, 'input_cost_per_token')
  const outputPerToken = getNumber(variant, 'output_cost_per_token')

  const tokenPrice =
    inputPerToken || outputPerToken
      ? {
          inputPerMTokens: inputPerToken ? inputPerToken * 1_000_000 : undefined,
          outputPerMTokens: outputPerToken
            ? outputPerToken * 1_000_000
            : undefined,
        }
      : undefined

  const outputPerImage = getNumber(variant, 'output_cost_per_image')
  const imagePrice = isNumber(outputPerImage) ? { outputPerImage } : undefined

  const inputPerPixel = getNumber(variant, 'input_cost_per_pixel')
  const outputPerPixel = getNumber(variant, 'output_cost_per_pixel')
  const pixelPrice =
    inputPerPixel || outputPerPixel
      ? {
          inputPerMPixels: inputPerPixel ? inputPerPixel * 1_000_000 : undefined,
          outputPerMPixels: outputPerPixel
            ? outputPerPixel * 1_000_000
            : undefined,
        }
      : undefined

  const inputPerChar = getNumber(variant, 'input_cost_per_character')
  const outputPerChar = getNumber(variant, 'output_cost_per_character')
  const characterPrice =
    inputPerChar || outputPerChar
      ? {
          inputPerMChars: inputPerChar ? inputPerChar * 1_000_000 : undefined,
          outputPerMChars: outputPerChar ? outputPerChar * 1_000_000 : undefined,
        }
      : undefined

  return { tokenPrice, imagePrice, pixelPrice, characterPrice }
}

export function aggregateModels(
  models: Record<string, RawModelEntry>,
): AggregatedModel[] {
  const groups = new Map<
    string,
    {
      id: string
      displayName: string
      mode: string
      abilities: Set<string>
      variants: ModelVariant[]
      providers: Map<
        string,
        {
          provider: string
          label: string
          variantCount: number
          modelKeys: string[]
          tokenInput?: NumberRange
          tokenOutput?: NumberRange
          imageOutput?: NumberRange
        }
      >
      maxInputTokens?: number
      maxOutputTokens?: number
      maxTokens?: number
      tokenInput?: NumberRange
      tokenOutput?: NumberRange
      imageOutput?: NumberRange
    }
  >()

  for (const [modelKey, entry] of Object.entries(models)) {
    const mode = getString(entry, 'mode') ?? 'unknown'
    const displayName = getDisplayName(modelKey)
    const groupId = `${displayName}::${mode}`

    const parsedKey = parseModelKey(modelKey)
    const provider =
      getString(entry, 'litellm_provider') ?? parsedKey.provider ?? 'unknown'
    const providerMeta = getProviderMeta(provider)

    const abilities = extractAbilities(entry)
    const { tokenPrice, imagePrice, pixelPrice, characterPrice } =
      extractVariantPricing(entry)

    const variant: ModelVariant = {
      modelKey,
      displayName,
      provider,
      region: parsedKey.region ?? undefined,
      mode,
      abilities,
      raw: entry,
      tokenPrice,
      imagePrice,
      pixelPrice,
      characterPrice,
    }

    let group = groups.get(groupId)
    if (!group) {
      group = {
        id: groupId,
        displayName,
        mode,
        abilities: new Set<string>(),
        variants: [],
        providers: new Map(),
      }
      groups.set(groupId, group)
    }

    group.variants.push(variant)
    for (const ability of abilities) group.abilities.add(ability)

    const maxInputTokens = getNumber(entry, 'max_input_tokens')
    if (isNumber(maxInputTokens)) {
      group.maxInputTokens = Math.max(group.maxInputTokens ?? 0, maxInputTokens)
    }

    const maxOutputTokens = getNumber(entry, 'max_output_tokens')
    if (isNumber(maxOutputTokens)) {
      group.maxOutputTokens = Math.max(
        group.maxOutputTokens ?? 0,
        maxOutputTokens,
      )
    }

    const maxTokens = getNumber(entry, 'max_tokens')
    if (isNumber(maxTokens)) {
      group.maxTokens = Math.max(group.maxTokens ?? 0, maxTokens)
    }

    if (tokenPrice?.inputPerMTokens !== undefined) {
      group.tokenInput = toRange(group.tokenInput, tokenPrice.inputPerMTokens)
    }
    if (tokenPrice?.outputPerMTokens !== undefined) {
      group.tokenOutput = toRange(group.tokenOutput, tokenPrice.outputPerMTokens)
    }
    if (imagePrice?.outputPerImage !== undefined) {
      group.imageOutput = toRange(group.imageOutput, imagePrice.outputPerImage)
    }

    const providerEntry =
      group.providers.get(provider) ??
      (() => {
        const next = {
          provider,
          label: providerMeta.label,
          variantCount: 0,
          modelKeys: [],
          tokenInput: undefined as NumberRange | undefined,
          tokenOutput: undefined as NumberRange | undefined,
          imageOutput: undefined as NumberRange | undefined,
        }
        group.providers.set(provider, next)
        return next
      })()

    providerEntry.variantCount += 1
    providerEntry.modelKeys.push(modelKey)

    if (tokenPrice?.inputPerMTokens !== undefined) {
      providerEntry.tokenInput = toRange(
        providerEntry.tokenInput,
        tokenPrice.inputPerMTokens,
      )
    }
    if (tokenPrice?.outputPerMTokens !== undefined) {
      providerEntry.tokenOutput = toRange(
        providerEntry.tokenOutput,
        tokenPrice.outputPerMTokens,
      )
    }
    if (imagePrice?.outputPerImage !== undefined) {
      providerEntry.imageOutput = toRange(
        providerEntry.imageOutput,
        imagePrice.outputPerImage,
      )
    }
  }

  const aggregated: AggregatedModel[] = []
  for (const group of groups.values()) {
    aggregated.push({
      id: group.id,
      displayName: group.displayName,
      mode: group.mode,
      abilities: Array.from(group.abilities).sort(),
      variants: group.variants,
      providers: Array.from(group.providers.values()).sort((a, b) =>
        a.label.localeCompare(b.label),
      ),
      maxInputTokens: group.maxInputTokens,
      maxOutputTokens: group.maxOutputTokens,
      maxTokens: group.maxTokens,
      tokenInput: group.tokenInput,
      tokenOutput: group.tokenOutput,
      imageOutput: group.imageOutput,
    })
  }

  aggregated.sort((a, b) => {
    const nameCmp = a.displayName.localeCompare(b.displayName)
    if (nameCmp !== 0) return nameCmp
    return a.mode.localeCompare(b.mode)
  })

  return aggregated
}

