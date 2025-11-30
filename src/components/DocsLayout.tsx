import { type Node } from '@markdoc/markdoc'

import { DocsHeader } from '@/components/DocsHeader'
import { PrevNextLinks } from '@/components/PrevNextLinks'
import { Prose } from '@/components/Prose'
import { ArticleEndAd } from '@/components/SidebarAd'
import { TableOfContents } from '@/components/TableOfContents'
import { collectSections } from '@/lib/sections'

export function DocsLayout({
  children,
  frontmatter: { title, standard_title },
  nodes,
}: {
  children: React.ReactNode
  frontmatter: { title?: string; standard_title?: string }
  nodes: Array<Node>
}) {
  let tableOfContents = collectSections(nodes)
  // 首页已有独立的 sponsor-ad，不再显示文章末尾广告
  const isHomePage = standard_title === '首页'

  return (
    <>
      <div className="max-w-2xl min-w-0 flex-auto px-4 py-16 lg:max-w-none lg:pr-0 lg:pl-8 xl:px-16">
        <article>
          <DocsHeader title={title} />
          <Prose>{children}</Prose>
          {!isHomePage && <ArticleEndAd />}
        </article>
        <PrevNextLinks />
      </div>
      <TableOfContents tableOfContents={tableOfContents} />
    </>
  )
}
