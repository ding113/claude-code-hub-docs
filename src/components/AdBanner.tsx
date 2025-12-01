'use client'

import Link from 'next/link'
import { useState } from 'react'

function SparkleIcon(props: React.ComponentPropsWithoutRef<'svg'>) {
  return (
    <svg viewBox="0 0 20 20" fill="currentColor" {...props}>
      <path d="M10 1l2.39 5.75L18 7.26l-4.5 3.99L14.78 17 10 14.27 5.22 17l1.28-5.75L2 7.26l5.61-.51L10 1z" />
    </svg>
  )
}

export function AdBanner() {
  const [isVisible, setIsVisible] = useState(true)

  if (!isVisible) return null

  return (
    <div className="relative overflow-hidden bg-gradient-to-r from-[var(--claude-rust)] via-[var(--claude-terracotta)] to-[var(--claude-ember-dark)]">
      {/* 装饰性顶部光线 */}
      <div className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-white/30 to-transparent" />

      <div className="mx-auto max-w-8xl px-4 py-2.5 sm:px-6 lg:px-8">
        <div className="flex items-center justify-center gap-x-4 text-sm text-white">
          <SparkleIcon className="hidden h-4 w-4 animate-pulse sm:block" />

          <p className="flex flex-wrap items-center justify-center gap-x-1.5 gap-y-1">
            <span className="rounded bg-white/15 px-2 py-0.5 text-xs font-bold tracking-wide">
              独家合作
            </span>
            <Link
              href="https://cubence.com?source=cch"
              target="_blank"
              rel="noopener noreferrer"
              className="font-semibold underline decoration-white/50 underline-offset-2 transition hover:decoration-white"
            >
              Cubence
            </Link>
            <span className="text-white/90">AI 中转平台</span>
            <span className="hidden text-white/70 sm:inline">·</span>
            <span className="hidden sm:inline">
              优惠码
              <code className="mx-1.5 rounded bg-white/20 px-1.5 py-0.5 font-mono text-xs font-bold">
                DING113CCH
              </code>
            </span>
            <span className="font-bold text-[var(--claude-sunrise)]">
              立减 20%
            </span>
            <Link
              href="https://cubence.com?source=cch"
              target="_blank"
              rel="noopener noreferrer"
              className="ml-1 inline-flex items-center rounded-full bg-white px-3 py-1 text-xs font-semibold text-[var(--claude-rust)] shadow-sm transition hover:bg-[var(--claude-sunrise)]"
            >
              访问
              <svg
                className="ml-1 h-3 w-3"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
                strokeWidth={2.5}
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M13.5 4.5L21 12m0 0l-7.5 7.5M21 12H3"
                />
              </svg>
            </Link>
          </p>

          <button
            type="button"
            className="absolute top-1/2 right-2 -translate-y-1/2 rounded-full p-1.5 text-white/70 transition hover:bg-white/10 hover:text-white sm:right-4"
            onClick={() => setIsVisible(false)}
            aria-label="关闭"
          >
            <svg
              className="h-4 w-4"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              strokeWidth={2}
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M6 18L18 6M6 6l12 12"
              />
            </svg>
          </button>
        </div>
      </div>

      {/* 装饰性底部光线 */}
      <div className="absolute inset-x-0 bottom-0 h-px bg-gradient-to-r from-transparent via-white/20 to-transparent" />
    </div>
  )
}
