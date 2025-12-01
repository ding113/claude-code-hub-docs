import clsx from 'clsx'
import Link from 'next/link'
import { usePathname } from 'next/navigation'

import { navigation } from '@/lib/navigation'

export function Navigation({
  className,
  onLinkClick,
}: {
  className?: string
  onLinkClick?: React.MouseEventHandler<HTMLAnchorElement>
}) {
  const pathname = usePathname()

  return (
    <nav className={clsx('text-base lg:text-sm', className)}>
      <ul className="space-y-9">
        {navigation.map((section) => (
          <li key={section.title}>
            <h2 className="font-display font-medium text-[var(--claude-ink)]">
              {section.title}
            </h2>
            <ul className="mt-2 space-y-2 border-l-2 border-[var(--claude-smoke)]/30 lg:mt-4 lg:space-y-4 lg:border-[var(--claude-smoke)]/50">
              {section.links.map((link) => (
                <li key={link.href} className="relative">
                  <Link
                    href={link.href}
                    onClick={onLinkClick}
                    className={clsx(
                      'block w-full pl-3.5 before:pointer-events-none before:absolute before:top-1/2 before:-left-1 before:h-1.5 before:w-1.5 before:-translate-y-1/2 before:rounded-full',
                      link.href === pathname
                        ? 'font-semibold text-[var(--claude-terracotta)] before:bg-[var(--claude-terracotta)]'
                        : 'text-[var(--claude-walnut)]/70 before:hidden before:bg-[var(--claude-smoke)] hover:text-[var(--claude-walnut)] hover:before:block dark:text-[var(--claude-walnut)]/70 dark:before:bg-[var(--claude-smoke)] dark:hover:text-[var(--claude-walnut)]',
                    )}
                  >
                    {link.title}
                  </Link>
                </li>
              ))}
            </ul>
          </li>
        ))}
      </ul>
    </nav>
  )
}
