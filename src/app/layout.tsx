import { type Metadata } from 'next'
import { Inter } from 'next/font/google'
import localFont from 'next/font/local'
import clsx from 'clsx'
import type { Organization, WebSite, WithContext } from 'schema-dts'

import { Providers } from '@/app/providers'
import { Layout } from '@/components/Layout'
import { JsonLd } from '@/components/JsonLd'
import { SITE_CONFIG } from '@/lib/constants'

import '@/styles/tailwind.css'

const inter = Inter({
  subsets: ['latin'],
  display: 'swap',
  variable: '--font-inter',
})

// Use local version of Lexend so that we can use OpenType features
const lexend = localFont({
  src: '../fonts/lexend.woff2',
  display: 'swap',
  variable: '--font-lexend',
})

export const metadata: Metadata = {
  metadataBase: new URL(SITE_CONFIG.url),
  title: {
    template: '%s - Claude Code Hub',
    default: 'Claude Code Hub - 智能 AI API 代理平台',
  },
  description: SITE_CONFIG.description,
  keywords: SITE_CONFIG.keywords,
  authors: [{ name: 'Claude Code Hub Team' }],
  creator: 'Claude Code Hub',
  publisher: 'Claude Code Hub',
  robots: {
    index: true,
    follow: true,
    googleBot: 'index, follow',
  },
  openGraph: {
    type: 'website',
    locale: 'zh_CN',
    siteName: SITE_CONFIG.name,
    title: 'Claude Code Hub - 智能 AI API 代理平台',
    description: SITE_CONFIG.shortDescription,
  },
  twitter: {
    card: 'summary_large_image',
    title: 'Claude Code Hub - 智能 AI API 代理平台',
    description: SITE_CONFIG.shortDescription,
  },
  alternates: {
    canonical: '/',
  },
}

const organizationJsonLd: WithContext<Organization> = {
  '@context': 'https://schema.org',
  '@type': 'Organization',
  name: SITE_CONFIG.name,
  url: SITE_CONFIG.url,
  description: SITE_CONFIG.description,
}

const websiteJsonLd: WithContext<WebSite> = {
  '@context': 'https://schema.org',
  '@type': 'WebSite',
  name: SITE_CONFIG.name,
  url: SITE_CONFIG.url,
  inLanguage: SITE_CONFIG.locale,
  description: SITE_CONFIG.description,
}

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <html
      lang="zh-CN"
      className={clsx('h-full antialiased', inter.variable, lexend.variable)}
      suppressHydrationWarning
    >
      <head>
        <JsonLd data={organizationJsonLd} />
        <JsonLd data={websiteJsonLd} />
      </head>
      <body className="flex min-h-full bg-[var(--claude-paper)] dark:bg-[var(--claude-paper)]">
        <Providers>
          <Layout>{children}</Layout>
        </Providers>
      </body>
    </html>
  )
}
