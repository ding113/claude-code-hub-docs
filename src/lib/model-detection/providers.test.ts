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
