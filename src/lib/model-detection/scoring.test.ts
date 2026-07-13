import { describe, expect, test } from 'vitest'

import { summarizeDetectionFamilies } from '@/lib/model-detection/scoring'
import type {
  ModelProbeFamily,
  ProbeObservation,
} from '@/lib/model-detection/types'

const families: ModelProbeFamily[] = [
  {
    id: 'openai-post-4o',
    label: 'OpenAI（GPT-4o 后）',
    probes: ['a', 'b'],
  },
  {
    id: 'glm',
    label: 'GLM',
    probes: ['c'],
  },
  {
    id: 'qwen',
    label: 'Qwen',
    probes: ['d'],
  },
]

describe('summarizeDetectionFamilies', () => {
  test('按命中率倒序返回所有非 0 的模型家族', () => {
    const observations: ProbeObservation[] = [
      { familyId: 'openai-post-4o', probe: 'a', repeatedExactly: false },
      { familyId: 'openai-post-4o', probe: 'b', repeatedExactly: true },
      { familyId: 'glm', probe: 'c', repeatedExactly: false },
      { familyId: 'qwen', probe: 'd', repeatedExactly: true },
    ]

    expect(summarizeDetectionFamilies(families, observations)).toEqual([
      {
        familyId: 'glm',
        familyLabel: 'GLM',
        hits: 1,
        tested: 1,
        total: 1,
        probability: 1,
      },
      {
        familyId: 'openai-post-4o',
        familyLabel: 'OpenAI（GPT-4o 后）',
        hits: 1,
        tested: 2,
        total: 2,
        probability: 0.5,
      },
    ])
  })

  test('请求失败不计入 tested 分母', () => {
    const observations: ProbeObservation[] = [
      {
        familyId: 'openai-post-4o',
        probe: 'a',
        repeatedExactly: false,
      },
      {
        familyId: 'openai-post-4o',
        probe: 'b',
        repeatedExactly: null,
        error: 'network failed',
      },
    ]

    expect(summarizeDetectionFamilies(families, observations)).toEqual([
      {
        familyId: 'openai-post-4o',
        familyLabel: 'OpenAI（GPT-4o 后）',
        hits: 1,
        tested: 1,
        total: 2,
        probability: 1,
      },
    ])
  })
})
