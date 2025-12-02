'use client'

import { usePathname } from 'next/navigation'

interface LastModifiedProps {
  timestamps: Record<string, string>
}

export function LastModified({ timestamps }: LastModifiedProps) {
  const pathname = usePathname()
  const timestamp = timestamps[pathname]

  if (!timestamp) return null

  const date = new Date(timestamp)
  const formatted = date.toLocaleDateString('zh-CN', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  })

  return (
    <div className="mt-12 flex items-center gap-2 text-sm text-gray-500 dark:text-gray-400">
      <svg
        className="h-4 w-4"
        fill="none"
        viewBox="0 0 24 24"
        stroke="currentColor"
      >
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth={1.5}
          d="M12 6v6l4 2m6-2a10 10 0 11-20 0 10 10 0 0120 0z"
        />
      </svg>
      <time dateTime={timestamp}>最后更新于 {formatted}</time>
    </div>
  )
}
