import clsx from 'clsx'
import Link from 'next/link'

interface BadgeProps {
  version?: string
  href?: string
  label?: string
}

export function Badge({ version = 'v0.5', href, label = 'Latest Release' }: BadgeProps) {
  const content = (
    <div
      className={clsx(
        'inline-flex items-center gap-2 rounded-full px-4 py-1.5 text-sm font-medium transition-all',
        'bg-white/80 backdrop-blur-sm',
        'ring-1 ring-[var(--claude-sage)]/30',
        'dark:bg-[var(--claude-sand)]/80',
        'dark:ring-[var(--claude-sage)]/40',
        'shadow-sm shadow-[var(--claude-sage)]/10',
        href && 'cursor-pointer hover:ring-[var(--claude-sage)]/50 hover:shadow-md hover:shadow-[var(--claude-sage)]/20',
      )}
    >
      <span className="flex items-center gap-1.5">
        <svg
          className="h-4 w-4 text-[var(--claude-sage)]"
          fill="currentColor"
          viewBox="0 0 20 20"
        >
          <path
            fillRule="evenodd"
            d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.857-9.809a.75.75 0 00-1.214-.882l-3.483 4.79-1.88-1.88a.75.75 0 10-1.06 1.061l2.5 2.5a.75.75 0 001.137-.089l4-5.5z"
            clipRule="evenodd"
          />
        </svg>
        <span className="text-[var(--claude-sage)] font-semibold">{label}</span>
      </span>
      <span className="h-4 w-px bg-[var(--claude-sage)]/30" />
      <span className="font-mono font-bold text-[var(--claude-ink)] dark:text-[var(--claude-parchment)]">
        {version}
      </span>
      {href && (
        <svg
          className="h-3.5 w-3.5 text-[var(--claude-sage)]/70"
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={2}
            d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14"
          />
        </svg>
      )}
    </div>
  )

  if (href) {
    return (
      <Link href={href} target="_blank" rel="noopener noreferrer" className="inline-block no-underline">
        {content}
      </Link>
    )
  }

  return content
}
