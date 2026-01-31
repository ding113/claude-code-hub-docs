'use client'

import clsx from 'clsx'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { useEffect, useState } from 'react'

import { AdBanner } from '@/components/AdBanner'
import { Hero } from '@/components/Hero'
import { Logo, Logomark } from '@/components/Logo'
import { MobileNavigation } from '@/components/MobileNavigation'
import { Navigation } from '@/components/Navigation'
import { Search } from '@/components/Search'
import { ThemeSelector } from '@/components/ThemeSelector'

function GitHubIcon(props: React.ComponentPropsWithoutRef<'svg'>) {
  return (
    <svg aria-hidden="true" viewBox="0 0 16 16" {...props}>
      <path d="M8 0C3.58 0 0 3.58 0 8C0 11.54 2.29 14.53 5.47 15.59C5.87 15.66 6.02 15.42 6.02 15.21C6.02 15.02 6.01 14.39 6.01 13.72C4 14.09 3.48 13.23 3.32 12.78C3.23 12.55 2.84 11.84 2.5 11.65C2.22 11.5 1.82 11.13 2.49 11.12C3.12 11.11 3.57 11.7 3.72 11.94C4.44 13.15 5.59 12.81 6.05 12.6C6.12 12.08 6.33 11.73 6.56 11.53C4.78 11.33 2.92 10.64 2.92 7.58C2.92 6.71 3.23 5.99 3.74 5.43C3.66 5.23 3.38 4.41 3.82 3.31C3.82 3.31 4.49 3.1 6.02 4.13C6.66 3.95 7.34 3.86 8.02 3.86C8.7 3.86 9.38 3.95 10.02 4.13C11.55 3.09 12.22 3.31 12.22 3.31C12.66 4.41 12.38 5.23 12.3 5.43C12.81 5.99 13.12 6.7 13.12 7.58C13.12 10.65 11.25 11.33 9.47 11.53C9.76 11.78 10.01 12.26 10.01 13.01C10.01 14.08 10 14.94 10 15.21C10 15.42 10.15 15.67 10.55 15.59C13.71 14.53 16 11.53 16 8C16 3.58 12.42 0 8 0Z" />
    </svg>
  )
}

function TelegramIcon(props: React.ComponentPropsWithoutRef<'svg'>) {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" {...props}>
      <path d="M11.944 0A12 12 0 0 0 0 12a12 12 0 0 0 12 12 12 12 0 0 0 12-12A12 12 0 0 0 12 0a12 12 0 0 0-.056 0zm4.962 7.224c.1-.002.321.023.465.14a.506.506 0 0 1 .171.325c.016.093.036.306.02.472-.18 1.898-.962 6.502-1.36 8.627-.168.9-.499 1.201-.82 1.23-.696.065-1.225-.46-1.9-.902-1.056-.693-1.653-1.124-2.678-1.8-1.185-.78-.417-1.21.258-1.91.177-.184 3.247-2.977 3.307-3.23.007-.032.014-.15-.056-.212s-.174-.041-.249-.024c-.106.024-1.793 1.14-5.061 3.345-.48.33-.913.49-1.302.48-.428-.008-1.252-.241-1.865-.44-.752-.245-1.349-.374-1.297-.789.027-.216.325-.437.893-.663 3.498-1.524 5.83-2.529 6.998-3.014 3.332-1.386 4.025-1.627 4.476-1.635z" />
    </svg>
  )
}

function Header() {
  const [isScrolled, setIsScrolled] = useState(false)

  useEffect(() => {
    function onScroll() {
      setIsScrolled(window.scrollY > 0)
    }
    onScroll()
    window.addEventListener('scroll', onScroll, { passive: true })
    return () => {
      window.removeEventListener('scroll', onScroll)
    }
  }, [])

  return (
    <header
      className={clsx(
        'sticky top-0 z-50 flex flex-none flex-wrap items-center justify-between bg-[var(--claude-paper)] px-4 py-5 shadow-[var(--claude-walnut)]/5 shadow-md transition duration-500 sm:px-6 lg:px-8 dark:shadow-none',
        isScrolled
          ? 'dark:bg-[var(--claude-paper)]/95 dark:backdrop-blur-sm dark:[@supports(backdrop-filter:blur(0))]:bg-[var(--claude-paper)]/75'
          : 'dark:bg-transparent',
      )}
    >
      <div className="mr-6 flex lg:hidden">
        <MobileNavigation />
      </div>
      <div className="relative flex grow basis-0 items-center">
        <Link href="/" aria-label="Home page">
          <Logomark className="lg:hidden" />
          <Logo className="hidden lg:flex" />
        </Link>
      </div>
      <div className="-my-5 mr-6 sm:mr-8 md:mr-0">
        <Search />
      </div>
      <div className="relative flex basis-0 justify-end gap-6 sm:gap-8 md:grow">
        <ThemeSelector className="relative z-10" />
        <Link
          href="https://github.com/ding113/claude-code-hub"
          className="group"
          aria-label="GitHub"
          target="_blank"
          rel="noopener noreferrer"
        >
          <GitHubIcon className="h-6 w-6 fill-[var(--claude-walnut)]/60 group-hover:fill-[var(--claude-walnut)] dark:group-hover:fill-[var(--claude-ink)]" />
        </Link>
        <Link
          href="https://t.me/ygxz_group"
          className="group"
          aria-label="Telegram"
          target="_blank"
          rel="noopener noreferrer"
        >
          <TelegramIcon className="h-6 w-6 fill-[var(--claude-walnut)]/60 group-hover:fill-[var(--claude-walnut)] dark:group-hover:fill-[var(--claude-ink)]" />
        </Link>
      </div>
    </header>
  )
}

function Footer() {
  return (
    <footer className="border-t border-[var(--claude-smoke)]/30 bg-[var(--claude-sand)] py-10 dark:border-[var(--claude-smoke)]/30 dark:bg-[var(--claude-sand)]">
      <div className="mx-auto max-w-8xl px-4 sm:px-6 lg:px-8">
        <div className="flex flex-col items-center justify-between gap-6 sm:flex-row">
          <div className="flex items-center gap-2 text-sm text-[var(--claude-walnut)] dark:text-[var(--claude-walnut)]">
            <span>Claude Code Hub</span>
            <span>-</span>
            <span>智能 AI API 代理平台</span>
          </div>
          <div className="flex items-center gap-6">
            <Link
              href="https://github.com/ding113/claude-code-hub"
              className="group flex items-center gap-2 text-sm text-[var(--claude-walnut)]/80 hover:text-[var(--claude-walnut)] dark:text-[var(--claude-walnut)]/80 dark:hover:text-[var(--claude-ink)]"
              target="_blank"
              rel="noopener noreferrer"
            >
              <GitHubIcon className="h-5 w-5 fill-[var(--claude-walnut)]/60 group-hover:fill-[var(--claude-walnut)] dark:fill-[var(--claude-walnut)]/60 dark:group-hover:fill-[var(--claude-ink)]" />
              <span>GitHub</span>
            </Link>
            <Link
              href="https://t.me/ygxz_group"
              className="group flex items-center gap-2 text-sm text-[var(--claude-walnut)]/80 hover:text-[var(--claude-walnut)] dark:text-[var(--claude-walnut)]/80 dark:hover:text-[var(--claude-ink)]"
              target="_blank"
              rel="noopener noreferrer"
            >
              <TelegramIcon className="h-5 w-5 fill-[var(--claude-walnut)]/60 group-hover:fill-[var(--claude-walnut)] dark:fill-[var(--claude-walnut)]/60 dark:group-hover:fill-[var(--claude-ink)]" />
              <span>Telegram</span>
            </Link>
            <Link
              href="/site-map"
              className="text-sm text-[var(--claude-walnut)]/80 hover:text-[var(--claude-walnut)] dark:text-[var(--claude-walnut)]/80 dark:hover:text-[var(--claude-ink)]"
            >
              网站地图
            </Link>
          </div>
        </div>
        <div className="mt-6 text-center text-xs text-[var(--claude-walnut)]/60 dark:text-[var(--claude-walnut)]/60">
          &copy; {new Date().getFullYear()} Claude Code Hub. All rights
          reserved.
        </div>
      </div>
    </footer>
  )
}

export function Layout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname()
  const isHomePage = pathname === '/'

  return (
    <div className="flex min-h-screen w-full flex-col">
      <AdBanner />
      <Header />

      {isHomePage && <Hero />}

      <div className="relative mx-auto flex w-full max-w-8xl flex-auto justify-center sm:px-2 lg:px-8 xl:px-12">
        <div className="hidden lg:relative lg:block lg:flex-none">
          <div className="absolute inset-y-0 right-0 w-[50vw] bg-[var(--claude-sand)] dark:hidden" />
          <div className="absolute top-16 right-0 bottom-0 hidden h-12 w-px bg-linear-to-t from-[var(--claude-smoke)] dark:block" />
          <div className="absolute top-28 right-0 bottom-0 hidden w-px bg-[var(--claude-smoke)] dark:block" />
          <div className="sticky top-19 -ml-0.5 h-[calc(100vh-4.75rem)] w-64 overflow-x-hidden overflow-y-auto py-16 pr-8 pl-0.5 xl:w-72 xl:pr-16">
            <Navigation />
          </div>
        </div>
        {children}
      </div>

      <Footer />
    </div>
  )
}
