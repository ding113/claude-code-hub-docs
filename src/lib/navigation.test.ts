import { describe, expect, test } from 'vitest'

import { navigation } from '@/lib/navigation'

describe('navigation', () => {
  test('包含响应模型检测入口', () => {
    expect(
      navigation.some((section) =>
        section.links.some(
          (link) =>
            link.title === '响应模型检测' &&
            link.href === '/docs/model-detection',
        ),
      ),
    ).toBe(true)
  })
})
