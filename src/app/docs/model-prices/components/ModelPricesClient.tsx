'use client'

import { useEffect, useMemo, useState } from 'react'

import { FilterBar } from './FilterBar'
import { ModelDrawer } from './ModelDrawer'
import { ModelTable } from './ModelTable'
import { SearchBar } from './SearchBar'

import { useModelData } from '../hooks/useModelData'
import { useModelFilter, useModelFilterState } from '../hooks/useModelFilter'
import { useModelSearch } from '../hooks/useModelSearch'

import type { AggregatedModel } from '../types/model'

function isEditableElement(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false
  const tag = target.tagName.toLowerCase()
  return tag === 'input' || tag === 'textarea' || target.isContentEditable
}

export function ModelPricesClient() {
  const { state, options } = useModelData()
  const { filters, setFilters, actions } = useModelFilterState()

  const models = state.status === 'success' ? state.models : []
  const searched = useModelSearch(models, filters.query)
  const filtered = useModelFilter(searched, filters)

  const [selectedId, setSelectedId] = useState<string | null>(null)

  const selectedModel = useMemo(() => {
    if (!selectedId) return null
    return models.find((m) => m.id === selectedId) ?? null
  }, [models, selectedId])

  useEffect(() => {
    if (!selectedId) return

    function onKeyDown(e: KeyboardEvent) {
      if (isEditableElement(e.target)) return

      if (e.key === 'Escape') {
        setSelectedId(null)
        return
      }

      if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return

      const idx = filtered.findIndex((m) => m.id === selectedId)
      if (idx < 0) return
      const nextIdx = e.key === 'ArrowDown' ? idx + 1 : idx - 1
      if (nextIdx < 0 || nextIdx >= filtered.length) return

      e.preventDefault()
      setSelectedId(filtered[nextIdx].id)
    }

    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [filtered, selectedId])

  return (
    <div className="flex min-w-0 flex-auto flex-col px-4 py-16 lg:pl-8 xl:px-16">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="font-display text-3xl tracking-tight text-[var(--claude-ink)]">
            模型价格表
          </h1>
          <p className="mt-2 text-sm text-[var(--claude-walnut)]/70">
            支持搜索、筛选与供应商价格对比（虚拟滚动）
          </p>
        </div>
        {state.status === 'success' && (
          <div className="text-sm text-[var(--claude-walnut)]/70">
            <div>
              最后更新：
              <span className="ml-1 font-medium">{state.metadata.version}</span>
            </div>
            <div>
              原始模型：{state.modelCount} · 聚合后：{state.aggregatedCount}
            </div>
          </div>
        )}
      </div>

      {state.status === 'error' && (
        <div className="mt-6 rounded-2xl border border-red-500/20 bg-red-500/10 p-4 text-sm text-red-700 dark:text-red-300">
          {state.error}
        </div>
      )}

      {state.status === 'loading' && (
        <div className="mt-6 rounded-2xl border border-[var(--claude-smoke)]/30 bg-[var(--claude-paper)] p-4 text-sm text-[var(--claude-walnut)]/70 dark:bg-[var(--claude-sand)]">
          正在加载价格表...
        </div>
      )}

      {state.status === 'success' && options && (
        <>
          <div className="mt-6 space-y-3">
            <SearchBar value={filters.query} onChange={actions.setQuery} />
            <FilterBar
              options={options}
              filters={filters}
              onChange={setFilters}
              onReset={actions.reset}
              resultCount={filtered.length}
              totalCount={models.length}
            />
          </div>

          <div className="mt-6 flex min-h-0 flex-1 gap-6">
            <div className="min-h-0 min-w-0 flex-1">
              <ModelTable
                models={filtered}
                selectedId={selectedId}
                onSelect={(m: AggregatedModel) => setSelectedId(m.id)}
              />
            </div>

            <ModelDrawer
              model={selectedModel}
              open={Boolean(selectedModel)}
              onClose={() => setSelectedId(null)}
            />
          </div>
        </>
      )}
    </div>
  )
}

