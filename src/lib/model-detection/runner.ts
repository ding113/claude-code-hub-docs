import { MODEL_PROBE_FAMILIES } from '@/lib/model-detection/families'
import {
  buildRequestCandidates,
  extractResponseText,
} from '@/lib/model-detection/providers'
import { summarizeDetectionFamilies } from '@/lib/model-detection/scoring'
import type {
  ModelDetectionInput,
  ModelDetectionResult,
  ProbeObservation,
  RequestCandidate,
} from '@/lib/model-detection/types'

const REQUEST_TIMEOUT_MS = 15_000

function buildProbeEntries() {
  return MODEL_PROBE_FAMILIES.flatMap((family) =>
    family.probes.map((probe) => ({
      familyId: family.id,
      probe,
    })),
  )
}

async function readPayload(response: Response) {
  const contentType = response.headers.get('content-type') ?? ''
  if (contentType.includes('application/json')) {
    return response.json()
  }

  const text = await response.text()
  if (!text) {
    return text
  }

  try {
    return JSON.parse(text)
  } catch {
    return text
  }
}

function extractErrorMessage(payload: unknown) {
  if (typeof payload === 'string') {
    return payload
  }

  if (!payload || typeof payload !== 'object') {
    return 'Unknown error'
  }

  const record = payload as Record<string, unknown>

  if (typeof record.message === 'string') {
    return record.message
  }

  if (
    record.error &&
    typeof record.error === 'object' &&
    typeof (record.error as Record<string, unknown>).message === 'string'
  ) {
    return String((record.error as Record<string, unknown>).message)
  }

  return JSON.stringify(payload)
}

// 逐个候选请求格式重试，尽量兼容被供应商裁剪过的兼容层实现。
async function runCandidateRequest(
  candidate: RequestCandidate,
  probe: string,
): Promise<{ repeatedExactly: boolean; rawText: string }> {
  const controller = new AbortController()
  const timeoutId = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS)

  try {
    const response = await fetch(candidate.url, {
      method: 'POST',
      headers: candidate.headers,
      body: JSON.stringify(candidate.body),
      signal: controller.signal,
    })

    const payload = await readPayload(response)
    if (!response.ok) {
      throw new Error(
        `HTTP ${response.status}: ${extractErrorMessage(payload)}`,
      )
    }

    // 需求要求“响应中包含原样探针”即可视为复述成功，不要求整段输出完全等于探针。
    const rawText = extractResponseTextFromAny(payload)
    return {
      repeatedExactly: rawText.includes(probe),
      rawText,
    }
  } catch (error) {
    if (controller.signal.aborted) {
      throw new Error(`Request timed out after ${REQUEST_TIMEOUT_MS}ms`)
    }

    throw error instanceof Error ? error : new Error(String(error))
  } finally {
    clearTimeout(timeoutId)
  }
}

function extractResponseTextFromAny(payload: unknown) {
  return (
    [
      extractResponseText('openai', payload),
      extractResponseText('anthropic', payload),
      extractResponseText('gemini', payload),
      typeof payload === 'string' ? payload : '',
    ].find((value) => value.length > 0) ?? ''
  )
}

async function runProbe(
  input: ModelDetectionInput,
  familyId: string,
  probe: string,
): Promise<ProbeObservation> {
  let candidates: RequestCandidate[]
  try {
    candidates = buildRequestCandidates({ ...input, probe })
  } catch (error) {
    return {
      familyId,
      probe,
      repeatedExactly: null,
      error: error instanceof Error ? error.message : String(error),
    }
  }

  const errors: string[] = []

  for (const candidate of candidates) {
    try {
      const result = await runCandidateRequest(candidate, probe)
      if (!result.rawText) {
        errors.push(`${candidate.label}: empty response text`)
        continue
      }

      return {
        familyId,
        probe,
        repeatedExactly: result.repeatedExactly,
        rawText: result.rawText,
      }
    } catch (error) {
      errors.push(
        `${candidate.label}: ${error instanceof Error ? error.message : String(error)}`,
      )
    }
  }

  return {
    familyId,
    probe,
    repeatedExactly: null,
    error: errors.join(' | '),
  }
}

async function mapWithConcurrency<T, R>(
  items: T[],
  concurrency: number,
  mapper: (item: T) => Promise<R>,
) {
  const results = new Array<R>(items.length)
  let cursor = 0

  async function worker() {
    while (cursor < items.length) {
      // 必须在 await 之前预留索引，避免多个 worker 处理到同一项。
      const currentIndex = cursor
      cursor += 1
      results[currentIndex] = await mapper(items[currentIndex])
    }
  }

  await Promise.all(
    Array.from({ length: Math.min(concurrency, items.length) }, () => worker()),
  )

  return results
}

export async function runModelDetection(
  input: ModelDetectionInput,
): Promise<ModelDetectionResult> {
  const probeEntries = buildProbeEntries()
  const observations = await mapWithConcurrency(probeEntries, 4, (entry) =>
    runProbe(input, entry.familyId, entry.probe),
  )

  const attemptedProbes = observations.filter(
    (observation) => observation.repeatedExactly !== null,
  ).length

  if (attemptedProbes === 0) {
    const firstError = observations.find(
      (observation) => observation.error,
    )?.error
    throw new Error(
      firstError ??
        '所有请求都未得到有效响应，请检查端点类型、认证头格式或浏览器 CORS 限制。',
    )
  }

  return {
    rankings: summarizeDetectionFamilies(MODEL_PROBE_FAMILIES, observations),
    summary: {
      totalFamilies: MODEL_PROBE_FAMILIES.length,
      totalProbes: probeEntries.length,
      attemptedProbes,
      failedProbes: observations.length - attemptedProbes,
    },
    observations,
  }
}
