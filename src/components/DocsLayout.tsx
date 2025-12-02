'use client'

import type { Node } from '@markdoc/markdoc'
import { usePathname } from 'next/navigation'
import type { TechArticle, WithContext } from 'schema-dts'

import { DocsHeader } from '@/components/DocsHeader'
import { JsonLd } from '@/components/JsonLd'
import { LastModified } from '@/components/LastModified'
import { PrevNextLinks } from '@/components/PrevNextLinks'
import { Prose } from '@/components/Prose'
import { ArticleEndAd } from '@/components/SidebarAd'
import { TableOfContents } from '@/components/TableOfContents'
import { SITE_CONFIG } from '@/lib/constants'
import { collectSections } from '@/lib/sections'

export function DocsLayout({
  children,
  frontmatter: { title, standard_title, description },
  nodes,
  gitTimestamps,
}: {
  children: React.ReactNode
  frontmatter: { title?: string; standard_title?: string; description?: string }
  nodes: Array<Node>
  gitTimestamps: Record<string, string>
}) {
  const pathname = usePathname()
  const tableOfContents = collectSections(nodes)
  // 首页已有独立的 sponsor-ad，不再显示文章末尾广告
  const isHomePage = standard_title === '首页'

  const articleJsonLd: WithContext<TechArticle> = {
    '@context': 'https://schema.org',
    '@type': 'TechArticle',
    headline: title || standard_title || 'Claude Code Hub',
    description: description || SITE_CONFIG.description,
    author: {
      '@type': 'Organization',
      name: SITE_CONFIG.name,
    },
    publisher: {
      '@type': 'Organization',
      name: SITE_CONFIG.name,
    },
    mainEntityOfPage: {
      '@type': 'WebPage',
      '@id': `${SITE_CONFIG.url}${pathname}`,
    },
    inLanguage: SITE_CONFIG.locale,
  }

  return (
    <>
      <JsonLd data={articleJsonLd} />
      <div className="max-w-2xl min-w-0 flex-auto px-4 py-16 lg:max-w-none lg:pr-0 lg:pl-8 xl:px-16">
        <article>
          <DocsHeader title={title} />
          <Prose>{children}</Prose>
          {!isHomePage && <LastModified timestamps={gitTimestamps} />}
          {!isHomePage && <ArticleEndAd />}
        </article>
        <PrevNextLinks />
      </div>
      <TableOfContents tableOfContents={tableOfContents} />
    </>
  )
}
