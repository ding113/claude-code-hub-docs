'use client'

import { Popover, PopoverButton, PopoverPanel } from '@headlessui/react'
import { ChevronDown } from 'lucide-react'
import clsx from 'clsx'

import type { PriceRangeState } from '../hooks/useModelFilter'

function hasAny(value: PriceRangeState) {
  return (
    value.inputMin.trim() ||
    value.inputMax.trim() ||
    value.outputMin.trim() ||
    value.outputMax.trim()
  )
}

export function PriceRangeFilter({
  value,
  onChange,
  onReset,
  className,
}: {
  value: PriceRangeState
  onChange: (patch: Partial<PriceRangeState>) => void
  onReset: () => void
  className?: string
}) {
  const active = hasAny(value)

  return (
    <Popover className={clsx('relative', className)}>
      <PopoverButton className="inline-flex h-9 items-center gap-2 rounded-xl border border-[var(--claude-smoke)]/40 bg-[var(--claude-paper)] px-3 text-sm text-[var(--claude-walnut)] shadow-sm hover:bg-[var(--claude-cloud)] dark:bg-[var(--claude-sand)]">
        <span>价格</span>
        {active && (
          <span className="rounded-md bg-[var(--claude-cloud)] px-1.5 py-0.5 text-xs text-[var(--claude-walnut)] dark:bg-[var(--claude-cloud)]">
            已设置
          </span>
        )}
        <ChevronDown className="h-4 w-4 text-[var(--claude-walnut)]/70" />
      </PopoverButton>
      <PopoverPanel className="absolute z-20 mt-2 w-96 rounded-2xl border border-[var(--claude-smoke)]/40 bg-[var(--claude-paper)] p-3 shadow-xl dark:bg-[var(--claude-sand)]">
        <div className="flex items-center justify-between gap-2">
          <p className="text-sm font-medium text-[var(--claude-ink)]">
            价格区间（$/百万 tokens）
          </p>
          <button
            type="button"
            onClick={onReset}
            className="rounded-md px-2 py-1 text-xs text-[var(--claude-walnut)]/80 hover:bg-[var(--claude-cloud)] hover:text-[var(--claude-ink)]"
          >
            重置
          </button>
        </div>

        <div className="mt-3 space-y-3">
          <div>
            <p className="text-xs font-medium text-[var(--claude-walnut)]/80">
              输入
            </p>
            <div className="mt-1 grid grid-cols-2 gap-2">
              <input
                inputMode="decimal"
                value={value.inputMin}
                onChange={(e) => onChange({ inputMin: e.target.value })}
                placeholder="最低"
                className="h-9 w-full rounded-xl border border-[var(--claude-smoke)]/40 bg-[var(--claude-paper)] px-3 text-sm outline-none focus:border-[var(--claude-terracotta)]/60 focus:ring-2 focus:ring-[var(--claude-terracotta)]/15 dark:bg-[var(--claude-sand)]"
              />
              <input
                inputMode="decimal"
                value={value.inputMax}
                onChange={(e) => onChange({ inputMax: e.target.value })}
                placeholder="最高"
                className="h-9 w-full rounded-xl border border-[var(--claude-smoke)]/40 bg-[var(--claude-paper)] px-3 text-sm outline-none focus:border-[var(--claude-terracotta)]/60 focus:ring-2 focus:ring-[var(--claude-terracotta)]/15 dark:bg-[var(--claude-sand)]"
              />
            </div>
          </div>

          <div>
            <p className="text-xs font-medium text-[var(--claude-walnut)]/80">
              输出
            </p>
            <div className="mt-1 grid grid-cols-2 gap-2">
              <input
                inputMode="decimal"
                value={value.outputMin}
                onChange={(e) => onChange({ outputMin: e.target.value })}
                placeholder="最低"
                className="h-9 w-full rounded-xl border border-[var(--claude-smoke)]/40 bg-[var(--claude-paper)] px-3 text-sm outline-none focus:border-[var(--claude-terracotta)]/60 focus:ring-2 focus:ring-[var(--claude-terracotta)]/15 dark:bg-[var(--claude-sand)]"
              />
              <input
                inputMode="decimal"
                value={value.outputMax}
                onChange={(e) => onChange({ outputMax: e.target.value })}
                placeholder="最高"
                className="h-9 w-full rounded-xl border border-[var(--claude-smoke)]/40 bg-[var(--claude-paper)] px-3 text-sm outline-none focus:border-[var(--claude-terracotta)]/60 focus:ring-2 focus:ring-[var(--claude-terracotta)]/15 dark:bg-[var(--claude-sand)]"
              />
            </div>
          </div>
        </div>
      </PopoverPanel>
    </Popover>
  )
}

