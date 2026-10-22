'use client'

import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, test, vi } from 'vitest'

import { ModelDetectionClient } from '@/app/docs/model-detection/components/ModelDetectionClient'

describe('ModelDetectionClient', () => {
  test('表单完整后可以运行，并按概率展示非 0 结果', async () => {
    const user = userEvent.setup()
    const runDetection = vi.fn().mockResolvedValue({
      rankings: [
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
      ],
      summary: {
        totalFamilies: 7,
        totalProbes: 42,
        attemptedProbes: 42,
        failedProbes: 0,
      },
    })

    render(<ModelDetectionClient runDetection={runDetection} />)

    const submit = screen.getByRole('button', { name: '开始检测' })
    expect(submit).toBeDisabled()

    await user.type(
      screen.getByLabelText('API Base URL'),
      'https://relay.example.com',
    )
    await user.type(screen.getByLabelText('API Key'), 'sk-test')
    await user.type(screen.getByLabelText('Model Name'), 'demo-model')

    expect(submit).toBeEnabled()

    await user.click(submit)

    expect(runDetection).toHaveBeenCalledWith({
      apiKey: 'sk-test',
      baseUrl: 'https://relay.example.com',
      endpointType: 'openai',
      model: 'demo-model',
    })

    expect(await screen.findByText('GLM')).toBeInTheDocument()
    expect(screen.getByText('100.0%')).toBeInTheDocument()
    expect(screen.getByText('OpenAI（GPT-4o 后）')).toBeInTheDocument()
    expect(screen.queryByText('Qwen')).not.toBeInTheDocument()
  })
})
