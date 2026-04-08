import type {
  DetectionEndpointType,
  RequestCandidate,
  RequestCandidateInput,
} from '@/lib/model-detection/types'

const OPENAI_INSTRUCTIONS =
  'Repeat the exact target text one time. Return only the original text without quotes or extra words.'

const SIMPLE_COPY_INSTRUCTIONS =
  'Copy the target text exactly once. Return only the original text.'

function buildProbePrompt(probe: string) {
  return `Repeat the text inside <target> exactly once. Return only the text.\n<target>${probe}</target>`
}

function trimTrailingSlash(value: string) {
  return value.replace(/\/+$/, '')
}

function ensurePath(baseUrl: string, path: string) {
  const normalizedBaseUrl = trimTrailingSlash(baseUrl)
  if (normalizedBaseUrl.endsWith(path)) {
    return normalizedBaseUrl
  }

  const url = new URL(normalizedBaseUrl)
  const baseSegments = url.pathname.split('/').filter(Boolean)
  const targetSegments = path.split('/').filter(Boolean)

  let overlap = 0
  for (
    let size = Math.min(baseSegments.length, targetSegments.length);
    size > 0;
    size -= 1
  ) {
    const baseTail = baseSegments.slice(-size).join('/')
    const targetHead = targetSegments.slice(0, size).join('/')
    if (baseTail === targetHead) {
      overlap = size
      break
    }
  }

  url.pathname = `/${[...baseSegments, ...targetSegments.slice(overlap)].join('/')}`
  return trimTrailingSlash(url.toString())
}

function normalizeGeminiModel(model: string) {
  return model.replace(/^models\//, '')
}

function resolveGeminiUrl(
  baseUrl: string,
  version: 'v1beta' | 'v1',
  model: string,
) {
  const normalizedBaseUrl = trimTrailingSlash(baseUrl)
  const versionMarker = `/${version}/`

  if (normalizedBaseUrl.includes('/models/')) {
    if (!normalizedBaseUrl.includes(versionMarker)) {
      return null
    }

    return normalizedBaseUrl.includes(':generateContent')
      ? normalizedBaseUrl
      : `${normalizedBaseUrl}:generateContent`
  }

  if (normalizedBaseUrl.includes(':generateContent')) {
    const versionMarker = `/${version}/`
    return normalizedBaseUrl.includes(versionMarker) ? normalizedBaseUrl : null
  }

  const normalizedModel = normalizeGeminiModel(model)
  if (normalizedBaseUrl.endsWith(`/${version}`)) {
    return `${normalizedBaseUrl}/models/${normalizedModel}:generateContent`
  }

  return `${normalizedBaseUrl}/${version}/models/${normalizedModel}:generateContent`
}

function buildOpenAiCandidates({
  baseUrl,
  apiKey,
  model,
  probe,
}: RequestCandidateInput): RequestCandidate[] {
  const prompt = buildProbePrompt(probe)

  return [
    {
      label: 'responses',
      url: ensurePath(baseUrl, '/v1/responses'),
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
        'openai-beta': 'responses=experimental',
      },
      body: {
        model,
        instructions: OPENAI_INSTRUCTIONS,
        input: [
          {
            type: 'message',
            role: 'user',
            content: [{ type: 'input_text', text: prompt }],
          },
        ],
        store: false,
        stream: false,
      },
    },
    {
      label: 'chat-completions',
      url: ensurePath(baseUrl, '/v1/chat/completions'),
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: {
        model,
        temperature: 0,
        max_tokens: 128,
        stream: false,
        messages: [
          { role: 'system', content: OPENAI_INSTRUCTIONS },
          { role: 'user', content: prompt },
        ],
      },
    },
  ]
}

function buildAnthropicCandidates({
  baseUrl,
  apiKey,
  model,
  probe,
}: RequestCandidateInput): RequestCandidate[] {
  const prompt = buildProbePrompt(probe)

  return [
    {
      label: 'authorization-header',
      url: ensurePath(baseUrl, '/v1/messages'),
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
        'Anthropic-Version': '2023-06-01',
      },
      body: {
        model,
        max_tokens: 128,
        stream: false,
        system: SIMPLE_COPY_INSTRUCTIONS,
        messages: [
          {
            role: 'user',
            content: [{ type: 'text', text: prompt }],
          },
        ],
      },
    },
    {
      label: 'x-api-key-header',
      url: ensurePath(baseUrl, '/v1/messages'),
      headers: {
        'x-api-key': apiKey,
        'Content-Type': 'application/json',
        'Anthropic-Version': '2023-06-01',
      },
      body: {
        model,
        max_tokens: 128,
        stream: false,
        system: SIMPLE_COPY_INSTRUCTIONS,
        messages: [{ role: 'user', content: prompt }],
      },
    },
  ]
}

function buildGeminiCandidates({
  baseUrl,
  apiKey,
  model,
  probe,
}: RequestCandidateInput): RequestCandidate[] {
  const prompt = `${SIMPLE_COPY_INSTRUCTIONS}\n\n${buildProbePrompt(probe)}`
  const v1BetaUrl = resolveGeminiUrl(baseUrl, 'v1beta', model)
  const v1Url = resolveGeminiUrl(baseUrl, 'v1', model)

  const candidates: RequestCandidate[] = []

  if (v1BetaUrl) {
    candidates.push({
      label: 'v1beta-thinking-config',
      url: v1BetaUrl,
      headers: {
        'Content-Type': 'application/json',
        'x-goog-api-key': apiKey,
      },
      body: {
        contents: [
          {
            role: 'user',
            parts: [{ text: prompt }],
          },
        ],
        generationConfig: {
          temperature: 0,
          maxOutputTokens: 128,
          thinkingConfig: { thinkingBudget: 0 },
        },
      },
    })
  }

  if (v1Url) {
    candidates.push({
      label: 'v1-generate-content',
      url: v1Url,
      headers: {
        'Content-Type': 'application/json',
        'x-goog-api-key': apiKey,
      },
      body: {
        contents: [
          {
            role: 'user',
            parts: [{ text: prompt }],
          },
        ],
        generationConfig: {
          temperature: 0,
          maxOutputTokens: 128,
        },
      },
    })
  }

  return candidates
}

export function buildRequestCandidates(
  input: RequestCandidateInput,
): RequestCandidate[] {
  switch (input.endpointType) {
    case 'anthropic':
      return buildAnthropicCandidates(input)
    case 'gemini':
      return buildGeminiCandidates(input)
    default:
      return buildOpenAiCandidates(input)
  }
}

function collectTextFragments(value: unknown): string[] {
  if (!value) {
    return []
  }

  if (typeof value === 'string') {
    return [value]
  }

  if (Array.isArray(value)) {
    return value.flatMap((item) => collectTextFragments(item))
  }

  if (typeof value !== 'object') {
    return []
  }

  const record = value as Record<string, unknown>

  if (typeof record.text === 'string') {
    return [record.text]
  }

  if (typeof record.output_text === 'string') {
    return [record.output_text]
  }

  return []
}

export function extractResponseText(
  endpointType: DetectionEndpointType,
  payload: unknown,
) {
  if (typeof payload === 'string') {
    return payload
  }

  if (!payload || typeof payload !== 'object') {
    return ''
  }

  const record = payload as Record<string, unknown>

  switch (endpointType) {
    case 'openai': {
      if (typeof record.output_text === 'string') {
        return record.output_text
      }

      if (Array.isArray(record.output)) {
        return record.output
          .flatMap((item) => {
            if (!item || typeof item !== 'object') {
              return []
            }

            return collectTextFragments(
              (item as Record<string, unknown>).content,
            )
          })
          .join('')
      }

      if (Array.isArray(record.choices)) {
        return record.choices
          .flatMap((choice) => {
            if (!choice || typeof choice !== 'object') {
              return []
            }

            const message = (choice as Record<string, unknown>).message
            if (!message || typeof message !== 'object') {
              return []
            }

            return collectTextFragments(
              (message as Record<string, unknown>).content,
            )
          })
          .join('')
      }

      return ''
    }
    case 'anthropic': {
      if (Array.isArray(record.content)) {
        return collectTextFragments(record.content).join('')
      }

      if (typeof record.completion === 'string') {
        return record.completion
      }

      return ''
    }
    case 'gemini': {
      if (Array.isArray(record.candidates)) {
        return record.candidates
          .flatMap((candidate) => {
            if (!candidate || typeof candidate !== 'object') {
              return []
            }

            const content = (candidate as Record<string, unknown>).content
            if (!content || typeof content !== 'object') {
              return []
            }

            return collectTextFragments(
              (content as Record<string, unknown>).parts,
            )
          })
          .join('')
      }

      return ''
    }
    default:
      return ''
  }
}
