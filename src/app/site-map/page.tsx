import Link from 'next/link'
import { navigation } from '@/lib/navigation'

export const metadata = {
  title: '网站地图',
  description: 'Claude Code Hub 文档网站地图',
}

export default function SitemapPage() {
  return (
    <div className="max-w-2xl min-w-0 flex-auto px-4 py-16 lg:max-w-none lg:pr-0 lg:pl-8 xl:px-16">
      <article>
        <header className="mb-9">
          <h1 className="font-display text-3xl tracking-tight text-[var(--claude-ink)]">
            网站地图
          </h1>
        </header>

        <div className="grid gap-8 sm:grid-cols-2 lg:grid-cols-3">
          {navigation.map((section) => (
            <div
              key={section.title}
              className="rounded-lg border border-[var(--claude-smoke)]/30 bg-[var(--claude-paper)] p-6 dark:border-[var(--claude-smoke)]/20"
            >
              <h2 className="font-display text-lg font-semibold text-[var(--claude-ink)]">
                {section.title}
              </h2>
              <ul className="mt-4 space-y-2">
                {section.links.map((link) => (
                  <li key={link.href}>
                    <Link
                      href={link.href}
                      className="text-sm text-[var(--claude-walnut)] hover:text-[var(--claude-terracotta)] dark:hover:text-[var(--claude-ember)]"
                    >
                      {link.title}
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      </article>
    </div>
  )
}
