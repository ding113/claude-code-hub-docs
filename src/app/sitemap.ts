import type { MetadataRoute } from 'next'
import { SITE_CONFIG } from '@/lib/constants'
import { navigation } from '@/lib/navigation'

export default function sitemap(): MetadataRoute.Sitemap {
  const lastModified = new Date()

  // 从 navigation 提取所有页面 URL
  const docPages = navigation.flatMap((section) =>
    section.links.map((link) => ({
      url: `${SITE_CONFIG.url}${link.href}`,
      lastModified,
      changeFrequency: 'weekly' as const,
      priority: link.href === '/' ? 1.0 : 0.8,
    })),
  )

  return docPages
}
