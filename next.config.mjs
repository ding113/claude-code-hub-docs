import withMarkdoc from '@markdoc/next.js'
import withSearch from './src/markdoc/search.mjs'

/** @type {import('next').NextConfig} */
const nextConfig = {
  pageExtensions: ['js', 'jsx', 'md', 'ts', 'tsx'],

  // 图片优化配置
  images: {
    localPatterns: [
      {
        pathname: '/**',
      },
    ],
    // 使用现代图片格式以减小体积
    formats: ['image/webp', 'image/avif'],
    // 图片缓存时间（秒）
    minimumCacheTTL: 86400,
  },

  // 编译器优化
  compiler: {
    // 生产环境移除 console.log
    removeConsole: process.env.NODE_ENV === 'production',
  },

  // 实验性优化功能
  experimental: {
    // 优化常用包的导入（tree-shaking 友好）
    optimizePackageImports: [
      'clsx',
      'schema-dts',
      '@heroicons/react',
      '@headlessui/react',
    ],
  },

  // 不生成生产环境 source maps（减小构建体积）
  productionBrowserSourceMaps: false,

  // Next.js 16 默认使用 Turbopack，显式配置以避免警告
  turbopack: {},

  // 注意：不设置 compress: true
  // Cloudflare Workers 自动处理 gzip/brotli 压缩
  // 在 OpenNext/Cloudflare 环境下，Next.js 的 compress 选项是多余的
}

export default withSearch(
  withMarkdoc({ schemaPath: './src/markdoc' })(nextConfig),
)

// 启用开发模式下的 Cloudflare 上下文
import { initOpenNextCloudflareForDev } from '@opennextjs/cloudflare'
initOpenNextCloudflareForDev()
