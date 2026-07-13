import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'

vi.mock('@/lib/model-detection/families', () => ({
  MODEL_PROBE_FAMILIES: [
    {
      id: 'demo',
      label: 'Demo',
      probes: ['SolidGoldMagikarp'],
    },
  ],
}))

import { runModelDetection } from '@/lib/model-detection/runner'

describe('runModelDetection', () => {
  const originalFetch = global.fetch

  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    global.fetch = originalFetch
    vi.useRealTimers()
    vi.restoreAllMocks()
  })

  test('请求超时会被收敛为可读错误，而不是一直卡住', async () => {
    global.fetch = vi.fn((_url, init) => {
      const signal = init?.signal as AbortSignal | undefined

      return new Promise((_resolve, reject) => {
        signal?.addEventListener('abort', () => {
          reject(new DOMException('The operation was aborted.', 'AbortError'))
        })
      }) as ReturnType<typeof fetch>
    }) as typeof fetch

    const promise = runModelDetection({
      baseUrl: 'https://relay.example.com',
      apiKey: 'sk-test',
      model: 'demo-model',
      endpointType: 'openai',
    })
    const rejection = expect(promise).rejects.toThrow(/timed out/i)

    await vi.runAllTimersAsync()
    await rejection
  })

  test('非法 URL 会被收敛为 probe 失败，而不是直接抛出未处理异常', async () => {
    global.fetch = vi.fn() as typeof fetch

    await expect(
      runModelDetection({
        baseUrl: 'not-a-url',
        apiKey: 'sk-test',
        model: 'demo-model',
        endpointType: 'openai',
      }),
    ).rejects.toThrow(/invalid url/i)

    expect(global.fetch).not.toHaveBeenCalled()
  })
})
