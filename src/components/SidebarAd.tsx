'use client'

import Image from 'next/image'
import Link from 'next/link'

function SparkleIcon(props: React.ComponentPropsWithoutRef<'svg'>) {
  return (
    <svg viewBox="0 0 20 20" fill="currentColor" {...props}>
      <path d="M10 1l2.39 5.75L18 7.26l-4.5 3.99L14.78 17 10 14.27 5.22 17l1.28-5.75L2 7.26l5.61-.51L10 1z" />
    </svg>
  )
}

function ArrowRightIcon(props: React.ComponentPropsWithoutRef<'svg'>) {
  return (
    <svg
      fill="none"
      viewBox="0 0 24 24"
      stroke="currentColor"
      strokeWidth={2.5}
      {...props}
    >
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M13.5 4.5L21 12m0 0l-7.5 7.5M21 12H3"
      />
    </svg>
  )
}

/**
 * 侧边栏广告 - 带海报图片的紧凑版本
 */
export function SidebarAd() {
  return (
    <div className="mt-8">
      {/* 装饰性顶部光线 */}
      <div className="relative">
        <div className="absolute inset-x-4 -top-px h-px bg-gradient-to-r from-transparent via-[var(--claude-terracotta)]/50 to-transparent" />
      </div>

      <Link
        href="https://cubence.com?source=cch"
        target="_blank"
        rel="noopener noreferrer"
        className="group block overflow-hidden rounded-xl bg-gradient-to-br from-[var(--claude-sand)] to-[var(--claude-cloud)] ring-1 ring-[var(--claude-smoke)]/30 transition-all hover:shadow-lg hover:ring-[var(--claude-terracotta)]/50 dark:from-[var(--claude-cloud)] dark:to-[var(--claude-sand)]"
      >
        {/* 海报图片 */}
        <div className="relative overflow-hidden">
          <Image
            src="/cubence.jpg"
            alt="Cubence - AI 中转平台"
            width={374}
            height={125}
            sizes="224px"
            quality={80}
            className="w-full object-cover transition-transform duration-300 group-hover:scale-105"
          />
          {/* 图片上的渐变遮罩 */}
          <div className="absolute inset-0 bg-gradient-to-t from-black/20 to-transparent" />
        </div>

        {/* 文字信息 */}
        <div className="p-3">
          <div className="mb-2 flex items-center gap-1.5">
            <SparkleIcon className="h-3 w-3 text-[var(--claude-terracotta)]" />
            <span className="text-[10px] font-bold tracking-wider text-[var(--claude-terracotta)]">
              独家合作
            </span>
          </div>

          <p className="text-xs leading-relaxed text-[var(--claude-walnut)]/80">
            稳定高效的 AI 中转，支持 Claude Code、Codex、Gemini
          </p>

          <div className="mt-2.5 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <code className="rounded bg-[var(--claude-terracotta)]/10 px-1.5 py-0.5 text-[10px] font-bold text-[var(--claude-terracotta)]">
                DING113CCH
              </code>
              <span className="text-[10px] font-bold text-[var(--claude-rust)]">
                -10%
              </span>
            </div>
            <ArrowRightIcon className="h-3 w-3 text-[var(--claude-walnut)]/50 transition-transform group-hover:translate-x-0.5 group-hover:text-[var(--claude-terracotta)]" />
          </div>
        </div>
      </Link>
    </div>
  )
}

/**
 * 文章末尾广告 - 带海报的完整版本
 */
export function ArticleEndAd() {
  return (
    <div className="relative mt-16">
      {/* 装饰性分隔线 */}
      <div className="absolute inset-x-0 top-0 flex items-center justify-center">
        <div className="h-px w-full bg-gradient-to-r from-transparent via-[var(--claude-smoke)]/50 to-transparent" />
      </div>

      <div className="pt-10">
        <Link
          href="https://cubence.com?source=cch"
          target="_blank"
          rel="noopener noreferrer"
          className="group block overflow-hidden rounded-2xl bg-gradient-to-br from-[var(--claude-sand)] via-[var(--claude-paper)] to-[var(--claude-sand)] ring-1 ring-[var(--claude-smoke)]/30 transition-all hover:shadow-xl hover:ring-[var(--claude-terracotta)]/50 dark:from-[var(--claude-cloud)] dark:via-[var(--claude-sand)] dark:to-[var(--claude-cloud)]"
        >
          {/* 海报图片 */}
          <div className="relative overflow-hidden">
            <Image
              src="/cubence.jpg"
              alt="Cubence - AI 中转平台"
              width={748}
              height={250}
              sizes="(max-width: 768px) 100vw, 672px"
              quality={80}
              className="w-full object-cover transition-transform duration-500 group-hover:scale-[1.02]"
            />
            <div className="absolute inset-0 bg-gradient-to-t from-black/30 via-transparent to-transparent" />

            {/* 图片上的标签 */}
            <div className="absolute top-4 left-4 flex items-center gap-1.5 rounded-full bg-white/90 px-3 py-1 shadow-sm backdrop-blur-sm">
              <SparkleIcon className="h-3.5 w-3.5 text-[var(--claude-terracotta)]" />
              <span className="text-xs font-semibold text-[var(--claude-rust)]">
                独家合作
              </span>
            </div>
          </div>

          {/* 信息区域 */}
          <div className="p-5 sm:p-6">
            <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <h4 className="text-base font-semibold text-[var(--claude-ink)]">
                  Cubence · AI 服务中转平台
                </h4>
                <p className="mt-1 text-sm text-[var(--claude-walnut)]/70">
                  为 Claude Code、Codex、Gemini 等 AI 工具提供稳定高效的中转服务
                </p>
              </div>

              <div className="flex items-center gap-4">
                <div className="text-center sm:text-right">
                  <div className="text-xs text-[var(--claude-walnut)]/60">
                    专属优惠码
                  </div>
                  <code className="mt-0.5 inline-block rounded-md bg-[var(--claude-terracotta)]/10 px-3 py-1 font-mono text-sm font-bold text-[var(--claude-terracotta)]">
                    DING113CCH
                  </code>
                </div>

                <div className="flex h-12 w-12 items-center justify-center rounded-full bg-[var(--claude-terracotta)] text-white shadow-lg transition-transform group-hover:scale-110">
                  <span className="text-sm font-bold">-10%</span>
                </div>
              </div>
            </div>

            <div className="mt-4 flex items-center justify-end text-sm font-medium text-[var(--claude-terracotta)]">
              立即访问
              <ArrowRightIcon className="ml-1.5 h-4 w-4 transition-transform group-hover:translate-x-1" />
            </div>
          </div>
        </Link>
      </div>
    </div>
  )
}

/**
 * 首页大幅广告 - 上下分区布局，图片独立展示
 */
export function HomePageAd() {
  return (
    <div className="relative my-12">
      <Link
        href="https://cubence.com?source=cch"
        target="_blank"
        rel="noopener noreferrer"
        className="group block overflow-hidden rounded-2xl bg-[var(--claude-sand)] ring-1 ring-[var(--claude-smoke)]/30 transition-all hover:shadow-2xl hover:ring-[var(--claude-terracotta)]/50 dark:bg-[var(--claude-cloud)]"
      >
        {/* 顶部：完整展示海报图片 */}
        <div className="relative overflow-hidden">
          <Image
            src="/cubence.jpg"
            alt="Cubence - AI 中转平台"
            width={1496}
            height={500}
            sizes="(max-width: 768px) 100vw, (max-width: 1200px) 80vw, 900px"
            quality={85}
            priority
            className="w-full object-cover transition-transform duration-500 group-hover:scale-[1.02]"
          />
          {/* 角标 */}
          <div className="absolute top-4 left-4 flex items-center gap-1.5 rounded-full bg-[var(--claude-terracotta)] px-3 py-1.5 shadow-lg">
            <SparkleIcon className="h-3.5 w-3.5 text-white" />
            <span className="text-xs font-bold text-white">独家合作</span>
          </div>
        </div>

        {/* 底部：优惠信息区域 */}
        <div className="relative px-6 py-5 sm:px-8">
          {/* 装饰性顶部渐变线 */}
          <div className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-[var(--claude-terracotta)]/30 to-transparent" />

          <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <p className="text-sm text-[var(--claude-walnut)]/70 sm:text-base">
                为 Claude Code、Codex、Gemini 等 AI 工具提供稳定高效的中转服务
              </p>
            </div>

            <div className="flex flex-wrap items-center gap-3 sm:gap-4">
              <div className="flex items-center gap-2">
                <span className="text-sm text-[var(--claude-walnut)]/60">
                  优惠码
                </span>
                <code className="rounded-lg bg-[var(--claude-terracotta)]/10 px-3 py-1.5 font-mono text-sm font-bold text-[var(--claude-terracotta)]">
                  DING113CCH
                </code>
              </div>

              <div className="flex items-center gap-2 rounded-full bg-[var(--claude-terracotta)] px-4 py-2 font-bold text-white shadow-md transition-transform group-hover:scale-105">
                <span>立减 10%</span>
                <ArrowRightIcon className="h-4 w-4 transition-transform group-hover:translate-x-1" />
              </div>
            </div>
          </div>
        </div>
      </Link>
    </div>
  )
}
