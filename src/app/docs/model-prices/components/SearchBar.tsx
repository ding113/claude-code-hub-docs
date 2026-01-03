'use client'

import { Search, X } from 'lucide-react'
import clsx from 'clsx'

export function SearchBar({
  value,
  onChange,
  className,
}: {
  value: string
  onChange: (value: string) => void
  className?: string
}) {
  const hasValue = value.trim().length > 0

  return (
    <div className={clsx('relative', className)}>
      <Search
        className="pointer-events-none absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2 text-[var(--claude-walnut)]/60"
        aria-hidden="true"
      />
      <input
        type="search"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder="搜索模型名 / 供应商 / mode..."
        className="h-10 w-full rounded-xl border border-[var(--claude-smoke)]/40 bg-[var(--claude-paper)] pr-10 pl-10 text-sm text-[var(--claude-ink)] shadow-sm outline-none placeholder:text-[var(--claude-walnut)]/50 focus:border-[var(--claude-terracotta)]/60 focus:ring-2 focus:ring-[var(--claude-terracotta)]/15 dark:bg-[var(--claude-sand)]"
      />
      {hasValue && (
        <button
          type="button"
          onClick={() => onChange('')}
          className="absolute top-1/2 right-2 inline-flex h-7 w-7 -translate-y-1/2 items-center justify-center rounded-lg text-[var(--claude-walnut)]/70 hover:bg-[var(--claude-cloud)] hover:text-[var(--claude-ink)]"
          aria-label="清空搜索"
        >
          <X className="h-4 w-4" />
        </button>
      )}
    </div>
  )
}

