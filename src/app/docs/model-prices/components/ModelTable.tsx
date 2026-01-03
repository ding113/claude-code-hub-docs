'use client'

import { useVirtualizer } from '@tanstack/react-virtual'
import clsx from 'clsx'
import { useEffect, useMemo, useRef } from 'react'

import { ModelRow } from './ModelRow'

import type { AggregatedModel } from '../types/model'

const ROW_HEIGHT = 56

export function ModelTable({
  models,
  selectedId,
  onSelect,
  className,
}: {
  models: AggregatedModel[]
  selectedId: string | null
  onSelect: (model: AggregatedModel) => void
  className?: string
}) {
  const parentRef = useRef<HTMLDivElement | null>(null)

  const rowVirtualizer = useVirtualizer({
    count: models.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => ROW_HEIGHT,
    overscan: 10,
  })

  const items = rowVirtualizer.getVirtualItems()
  const totalSize = rowVirtualizer.getTotalSize()

  const selectedIndex = useMemo(() => {
    if (!selectedId) return -1
    return models.findIndex((m) => m.id === selectedId)
  }, [models, selectedId])

  useEffect(() => {
    if (selectedIndex < 0) return
    rowVirtualizer.scrollToIndex(selectedIndex, { align: 'auto' })
  }, [rowVirtualizer, selectedIndex])

  return (
    <div
      className={clsx(
        'flex min-h-0 flex-1 flex-col overflow-hidden rounded-2xl border border-[var(--claude-smoke)]/40 bg-[var(--claude-paper)] shadow-sm dark:bg-[var(--claude-sand)]',
        className,
      )}
    >
      <div className="grid h-11 items-center gap-3 border-b border-[var(--claude-smoke)]/30 px-3 text-xs font-semibold text-[var(--claude-walnut)]/80 grid-cols-[minmax(0,1.4fr)_minmax(0,0.9fr)_minmax(0,0.9fr)] md:grid-cols-[minmax(0,1.4fr)_minmax(0,0.9fr)_minmax(0,0.6fr)_minmax(0,1.1fr)_minmax(0,0.9fr)]">
        <div className="min-w-0">模型名</div>
        <div className="min-w-0">供应商</div>
        <div className="hidden min-w-0 md:block">Mode</div>
        <div className="hidden min-w-0 md:block">能力</div>
        <div className="hidden min-w-0 md:block">价格</div>
        <div className="min-w-0 md:hidden text-right">价格</div>
      </div>

      <div ref={parentRef} className="min-h-0 flex-1 overflow-auto p-2">
        <div
          style={{ height: totalSize }}
          className="relative w-full overflow-x-hidden"
        >
          {items.map((virtualRow) => {
            const model = models[virtualRow.index]
            const isSelected = selectedId === model.id
            return (
              <div
                key={model.id}
                className="absolute top-0 left-0 w-full"
                style={{
                  height: virtualRow.size,
                  transform: `translateY(${virtualRow.start}px)`,
                }}
              >
                <ModelRow model={model} isSelected={isSelected} onSelect={onSelect} />
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}
