import withMarkdoc from '@markdoc/next.js'
import withSearch from './src/markdoc/search.mjs'

/** @type {import('next').NextConfig} */
const nextConfig = {
  pageExtensions: ['js', 'jsx', 'md', 'ts', 'tsx'],
  images: {
    localPatterns: [
      {
        pathname: '/**',
      },
    ],
  },
  // Next.js 16 默认使用 Turbopack，显式配置以避免警告
  turbopack: {},
}

export default withSearch(
  withMarkdoc({ schemaPath: './src/markdoc' })(nextConfig),
)

// 启用开发模式下的 Cloudflare 上下文
import { initOpenNextCloudflareForDev } from '@opennextjs/cloudflare'
initOpenNextCloudflareForDev()
