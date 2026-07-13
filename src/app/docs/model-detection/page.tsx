import { Suspense } from 'react'

import { ModelDetectionClient } from '@/app/docs/model-detection/components/ModelDetectionClient'

export default function ModelDetectionPage() {
  return (
    <Suspense
      fallback={
        <div className="flex min-w-0 flex-auto flex-col px-4 py-16 lg:pl-8 xl:px-16">
          <div className="rounded-2xl border border-[var(--claude-smoke)]/30 bg-[var(--claude-paper)] p-4 text-sm text-[var(--claude-walnut)]/70 dark:bg-[var(--claude-sand)]">
            正在加载检测页面...
          </div>
        </div>
      }
    >
      <ModelDetectionClient />
    </Suspense>
  )
}
