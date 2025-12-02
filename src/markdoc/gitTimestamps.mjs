import { execSync } from 'node:child_process'
import * as path from 'node:path'
import * as url from 'node:url'
import glob from 'fast-glob'
import { createLoader } from 'simple-functional-loader'

const __filename = url.fileURLToPath(import.meta.url)

export default function withGitTimestamps(nextConfig = {}) {
  return Object.assign({}, nextConfig, {
    webpack(config, options) {
      config.module.rules.push({
        test: __filename,
        use: [
          createLoader(function () {
            const pagesDir = path.resolve('./src/app')
            this.addContextDependency(pagesDir)

            const files = glob.sync('**/page.md', { cwd: pagesDir })
            const timestamps = {}

            for (const file of files) {
              const filePath = path.join(pagesDir, file)
              const docUrl =
                file === 'page.md' ? '/' : `/${file.replace(/\/page\.md$/, '')}`

              try {
                const timestamp = execSync(
                  `git log -1 --format="%aI" -- "${filePath}"`,
                  { encoding: 'utf8' },
                ).trim()

                if (timestamp) {
                  timestamps[docUrl] = timestamp
                }
              } catch {
                // Git 错误时静默跳过（如 CI 浅克隆或未提交文件）
              }
            }

            return `export const gitTimestamps = ${JSON.stringify(timestamps)}`
          }),
        ],
      })

      if (typeof nextConfig.webpack === 'function') {
        return nextConfig.webpack(config, options)
      }
      return config
    },
  })
}
