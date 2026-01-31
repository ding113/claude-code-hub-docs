import clsx from 'clsx'
import Image from 'next/image'
import { Highlight } from 'prism-react-renderer'
import { Fragment } from 'react'

import { Badge } from '@/components/Badge'
import { Button } from '@/components/Button'
import { HeroBackground } from '@/components/HeroBackground'
import blurCyanImage from '@/images/blur-cyan.png'
import blurIndigoImage from '@/images/blur-indigo.png'

const codeLanguage = 'javascript'
const code = `// 🚀 Claude Code Hub
provider  → anthropic | openai | google
routing   → smart-load-balance
failover  → auto-retry × 3
monitor   → realtime-dashboard
`

const tabs = [
  { name: 'hub-overview', isActive: true },
  { name: 'features', isActive: false },
]

function TrafficLightsIcon(props: React.ComponentPropsWithoutRef<'svg'>) {
  return (
    <svg aria-hidden="true" viewBox="0 0 42 10" fill="none" {...props}>
      <circle cx="5" cy="5" r="4.5" />
      <circle cx="21" cy="5" r="4.5" />
      <circle cx="37" cy="5" r="4.5" />
    </svg>
  )
}

export function Hero() {
  return (
    <div className="overflow-hidden bg-[var(--claude-sand)] dark:-mt-19 dark:-mb-32 dark:bg-[var(--claude-paper)] dark:pt-19 dark:pb-32">
      <div className="py-16 sm:px-2 lg:relative lg:px-0 lg:py-20">
        <div className="mx-auto grid max-w-2xl grid-cols-1 items-center gap-x-8 gap-y-16 px-4 lg:max-w-8xl lg:grid-cols-2 lg:px-8 xl:gap-x-16 xl:px-12">
          <div className="relative z-10 md:text-center lg:text-left">
            <Image
              className="absolute right-full bottom-full -mr-72 -mb-56 opacity-30"
              src={blurCyanImage}
              alt=""
              width={530}
              height={530}
              unoptimized
              priority
            />
            <div className="relative">
              <p className="inline bg-gradient-to-r from-[var(--claude-rust)] via-[var(--claude-terracotta)] to-[var(--claude-ember)] bg-clip-text font-display text-5xl tracking-tight text-transparent">
                智能 AI API 代理平台
              </p>
              <div className="mt-4 md:flex md:justify-center lg:justify-start">
                <Badge
                  version="v0.5"
                  href="https://github.com/ding113/claude-code-hub/releases/latest"
                  label="最新版本"
                />
              </div>
              <p className="mt-6 text-2xl tracking-tight text-[var(--claude-walnut)]">
                面向团队的多供应商 AI Coding 代理调度平台，
                <br className="hidden sm:inline" />
                提供智能负载均衡、熔断器、限流和完整监控。
              </p>
              <div className="mt-8 flex gap-4 md:justify-center lg:justify-start">
                <Button href="/docs/deployment/script">快速开始</Button>
                <Button
                  href="https://github.com/ding113/claude-code-hub"
                  variant="secondary"
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  GitHub
                </Button>
              </div>
            </div>
          </div>
          <div className="relative lg:static xl:pl-10">
            <div className="absolute inset-x-[-50vw] -top-32 -bottom-48 mask-[linear-gradient(transparent,white,white)] lg:-top-32 lg:right-0 lg:-bottom-32 lg:left-[calc(50%+14rem)] lg:mask-none dark:mask-[linear-gradient(transparent,white,transparent)] lg:dark:mask-[linear-gradient(white,white,transparent)]">
              <HeroBackground className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 lg:left-0 lg:translate-x-0 lg:translate-y-[-60%]" />
            </div>
            <div className="relative">
              <Image
                className="absolute -top-64 -right-64 opacity-50"
                src={blurCyanImage}
                alt=""
                width={530}
                height={530}
                unoptimized
                priority
              />
              <Image
                className="absolute -right-44 -bottom-40 opacity-50"
                src={blurIndigoImage}
                alt=""
                width={567}
                height={567}
                unoptimized
                priority
              />
              <div className="absolute inset-0 rounded-2xl bg-gradient-to-tr from-[var(--claude-terracotta)] via-[var(--claude-ember)] to-[var(--claude-amber)] opacity-10 blur-lg" />
              <div className="absolute inset-0 rounded-2xl bg-gradient-to-tr from-[var(--claude-terracotta)] via-[var(--claude-ember)] to-[var(--claude-amber)] opacity-10" />
              <div className="relative rounded-2xl bg-[var(--claude-cloud)]/80 ring-1 ring-[var(--claude-smoke)]/20 backdrop-blur-sm dark:bg-[var(--claude-sand)]/80 dark:ring-white/10">
                <div className="absolute -top-px right-11 left-20 h-px bg-gradient-to-r from-[var(--claude-terracotta)]/0 via-[var(--claude-terracotta)]/70 to-[var(--claude-terracotta)]/0" />
                <div className="absolute right-20 -bottom-px left-11 h-px bg-gradient-to-r from-[var(--claude-ember)]/0 via-[var(--claude-ember)] to-[var(--claude-ember)]/0" />
                <div className="pt-4 pl-4">
                  <TrafficLightsIcon className="h-2.5 w-auto stroke-[var(--claude-smoke)]/50" />
                  <div className="mt-4 flex space-x-2 text-xs">
                    {tabs.map((tab) => (
                      <div
                        key={tab.name}
                        className={clsx(
                          'flex h-6 rounded-full',
                          tab.isActive
                            ? 'bg-gradient-to-r from-[var(--claude-terracotta)]/30 via-[var(--claude-terracotta)] to-[var(--claude-terracotta)]/30 p-px font-medium text-[var(--claude-rust)] dark:text-[var(--claude-ember)]'
                            : 'text-[var(--claude-walnut)]/50',
                        )}
                      >
                        <div
                          className={clsx(
                            'flex items-center rounded-full px-2.5',
                            tab.isActive &&
                              'bg-[var(--claude-paper)] dark:bg-[var(--claude-sand)]',
                          )}
                        >
                          {tab.name}
                        </div>
                      </div>
                    ))}
                  </div>
                  <div className="mt-6 flex items-start px-1 text-sm">
                    <div
                      aria-hidden="true"
                      className="border-r border-[var(--claude-smoke)]/20 pr-4 font-mono text-[var(--claude-walnut)]/50 select-none"
                    >
                      {Array.from({
                        length: code.split('\n').length,
                      }).map((_, index) => (
                        <Fragment key={index}>
                          {(index + 1).toString().padStart(2, '0')}
                          <br />
                        </Fragment>
                      ))}
                    </div>
                    <Highlight
                      code={code}
                      language={codeLanguage}
                      theme={{ plain: {}, styles: [] }}
                    >
                      {({
                        className,
                        style,
                        tokens,
                        getLineProps,
                        getTokenProps,
                      }) => (
                        <pre
                          className={clsx(
                            className,
                            'flex overflow-x-auto pb-6',
                          )}
                          style={style}
                        >
                          <code className="px-4 text-[var(--claude-ink)]">
                            {tokens.map((line, lineIndex) => (
                              <div key={lineIndex} {...getLineProps({ line })}>
                                {line.map((token, tokenIndex) => (
                                  <span
                                    key={tokenIndex}
                                    {...getTokenProps({ token })}
                                  />
                                ))}
                              </div>
                            ))}
                          </code>
                        </pre>
                      )}
                    </Highlight>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
