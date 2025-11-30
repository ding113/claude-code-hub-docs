import Link from 'next/link'

import { Icon } from '@/components/Icon'

export function QuickLinks({ children }: { children: React.ReactNode }) {
  return (
    <div className="not-prose my-12 grid grid-cols-1 gap-6 sm:grid-cols-2">
      {children}
    </div>
  )
}

export function QuickLink({
  title,
  description,
  href,
  icon,
}: {
  title: string
  description: string
  href: string
  icon?: React.ComponentProps<typeof Icon>['icon']
}) {
  return (
    <div className="group relative rounded-xl border border-[var(--claude-smoke)]/30 dark:border-[var(--claude-smoke)]/20">
      <div className="absolute -inset-px rounded-xl border-2 border-transparent opacity-0 [background:linear-gradient(var(--quick-links-hover-bg,var(--claude-cloud)),var(--quick-links-hover-bg,var(--claude-cloud)))_padding-box,linear-gradient(to_top,var(--claude-rust),var(--claude-terracotta),var(--claude-ember))_border-box] group-hover:opacity-100 dark:[--quick-links-hover-bg:var(--claude-cloud)]" />
      <div className="relative overflow-hidden rounded-xl p-6">
        {icon && <Icon icon={icon} className="h-8 w-8" />}
        <h2 className={`${icon ? 'mt-4' : ''} font-display text-base text-[var(--claude-ink)]`}>
          <Link href={href}>
            <span className="absolute -inset-px rounded-xl" />
            {title}
          </Link>
        </h2>
        <p className="mt-1 text-sm text-[var(--claude-walnut)]/80">
          {description}
        </p>
      </div>
    </div>
  )
}
