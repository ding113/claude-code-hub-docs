import { describe, expect, test } from 'vitest'

import {
  buildRequestCandidates,
  extractResponseText,
} from '@/lib/model-detection/providers'
import type { DetectionEndpointType } from '@/lib/model-detection/types'

const config = {
  baseUrl: 'https://relay.example.com',
  apiKey: 'sk-test',
  model: 'demo-model',
}

describe('buildRequestCandidates', () => {
  test('OpenAI 先走 responses，再回退 chat completions', () => {
    const candidates = buildRequestCandidates({
      ...config,
      endpointType: 'openai',
      probe: 'SolidGoldMagikarp',
    })

    expect(candidates).toHaveLength(2)
    expect(candidates[0].url).toBe('https://relay.example.com/v1/responses')
    expect(candidates[0].headers.Authorization).toBe('Bearer sk-test')
    expect(candidates[1].url).toBe(
      'https://relay.example.com/v1/chat/completions',
    )
  })

  test('Anthropic 同时兼容 Authorization 与 x-api-key 头', () => {
    const candidates = buildRequestCandidates({
      ...config,
      endpointType: 'anthropic',
      probe: '中文引号和英文引号',
    })

    expect(candidates).toHaveLength(2)
    expect(candidates[0].url).toBe('https://relay.example.com/v1/messages')
    expect(candidates[0].headers.Authorization).toBe('Bearer sk-test')
    expect((candidates[0].body as { system: string }).system).toBeTypeOf(
      'string',
    )
    expect(candidates[1].headers['x-api-key']).toBe('sk-test')
  })

  test('Gemini 同时生成 v1beta 与 v1 两个候选端点', () => {
    const candidates = buildRequestCandidates({
      ...config,
      endpointType: 'gemini',
      probe: '～和 ~',
    })

    expect(candidates).toHaveLength(2)
    expect(candidates[0].url).toBe(
      'https://relay.example.com/v1beta/models/demo-model:generateContent',
    )
    expect(candidates[1].url).toBe(
      'https://relay.example.com/v1/models/demo-model:generateContent',
    )
  })

  test('当 baseUrl 已经带有 /v1 时，不重复拼接版本前缀', () => {
    const candidates = buildRequestCandidates({
      baseUrl: 'https://relay.example.com/v1',
      apiKey: 'sk-test',
      model: 'demo-model',
      endpointType: 'openai',
      probe: 'SolidGoldMagikarp',
    })

    expect(candidates[0].url).toBe('https://relay.example.com/v1/responses')
    expect(candidates[1].url).toBe(
      'https://relay.example.com/v1/chat/completions',
    )
  })

  test('当 Gemini baseUrl 已经是完整 generateContent URL 时，不生成重复候选', () => {
    const candidates = buildRequestCandidates({
      baseUrl:
        'https://relay.example.com/v1beta/models/demo-model:generateContent',
      apiKey: 'sk-test',
      model: 'demo-model',
      endpointType: 'gemini',
      probe: '～和 ~',
    })

    expect(candidates).toHaveLength(1)
    expect(candidates[0].url).toBe(
      'https://relay.example.com/v1beta/models/demo-model:generateContent',
    )
  })

  test('当 Gemini baseUrl 已经指向具体模型时，直接补上 generateContent 后缀', () => {
    const candidates = buildRequestCandidates({
      baseUrl: 'https://relay.example.com/v1beta/models/demo-model',
      apiKey: 'sk-test',
      model: 'another-model',
      endpointType: 'gemini',
      probe: '～和 ~',
    })

    expect(candidates).toHaveLength(1)
    expect(candidates[0].url).toBe(
      'https://relay.example.com/v1beta/models/demo-model:generateContent',
    )
  })
})

describe('extractResponseText', () => {
  test.each<{
    endpointType: DetectionEndpointType
    payload: unknown
    expected: string
  }>([
    {
      endpointType: 'openai',
      payload: {
        output: [
          {
            content: [
              { type: 'output_text', text: 'SolidGoldMagikarp' },
              { type: 'output_text', text: ' twice' },
            ],
          },
        ],
      },
      expected: 'SolidGoldMagikarp twice',
    },
    {
      endpointType: 'openai',
      payload: {
        choices: [{ message: { content: 'SolidGoldMagikarp' } }],
      },
      expected: 'SolidGoldMagikarp',
    },
    {
      endpointType: 'anthropic',
      payload: {
        content: [{ type: 'text', text: '中文引号和英文引号' }],
      },
      expected: '中文引号和英文引号',
    },
    {
      endpointType: 'gemini',
      payload: {
        candidates: [
          {
            content: {
              parts: [{ text: '～和 ~' }],
            },
          },
        ],
      },
      expected: '～和 ~',
    },
  ])('兼容 $endpointType 的常见响应文本提取', ({
    endpointType,
    payload,
    expected,
  }) => {
    expect(extractResponseText(endpointType, payload)).toBe(expected)
  })
})
