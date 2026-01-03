'use client'

import { Popover, PopoverButton, PopoverPanel } from '@headlessui/react'
import { Check, ChevronDown, RotateCcw } from 'lucide-react'
import clsx from 'clsx'

import { AbilityIcons, ABILITY_DEFS } from './AbilityIcons'
import { PriceRangeFilter } from './PriceRangeFilter'
import { ProviderFilter } from './ProviderFilter'

import type { ModelFilterState } from '../hooks/useModelFilter'

type Options = {
  providers: string[]
  modes: string[]
  abilities: string[]
}

function toggle(list: string[], value: string): string[] {
  return list.includes(value) ? list.filter((v) => v !== value) : [...list, value]
}

export function FilterBar({
  options,
  filters,
  onChange,
  onReset,
  resultCount,
  totalCount,
  className,
}: {
  options: Options
  filters: ModelFilterState
  onChange: (next: ModelFilterState) => void
  onReset: () => void
  resultCount: number
  totalCount: number
  className?: string
}) {
  const hasActive =
    filters.providers.length > 0 ||
    filters.modes.length > 0 ||
    filters.abilities.length > 0 ||
    filters.price.inputMin.trim() ||
    filters.price.inputMax.trim() ||
    filters.price.outputMin.trim() ||
    filters.price.outputMax.trim()

  return (
    <div className={clsx('flex flex-wrap items-center gap-2', className)}>
      <ProviderFilter
        providers={options.providers}
        selected={filters.providers}
        onChange={(providers) => onChange({ ...filters, providers })}
      />

      <Popover className="relative">
        <PopoverButton className="inline-flex h-9 items-center gap-2 rounded-xl border border-[var(--claude-smoke)]/40 bg-[var(--claude-paper)] px-3 text-sm text-[var(--claude-walnut)] shadow-sm hover:bg-[var(--claude-cloud)] dark:bg-[var(--claude-sand)]">
          <span>Mode</span>
          {filters.modes.length > 0 && (
            <span className="rounded-md bg-[var(--claude-cloud)] px-1.5 py-0.5 text-xs text-[var(--claude-walnut)] dark:bg-[var(--claude-cloud)]">
              {filters.modes.length}
            </span>
          )}
          <ChevronDown className="h-4 w-4 text-[var(--claude-walnut)]/70" />
        </PopoverButton>
        <PopoverPanel className="absolute z-20 mt-2 w-72 rounded-2xl border border-[var(--claude-smoke)]/40 bg-[var(--claude-paper)] p-3 shadow-xl dark:bg-[var(--claude-sand)]">
          <div className="flex items-center justify-between gap-2">
            <p className="text-sm font-medium text-[var(--claude-ink)]">
              Mode 筛选
            </p>
            <button
              type="button"
              onClick={() => onChange({ ...filters, modes: [] })}
              className="rounded-md px-2 py-1 text-xs text-[var(--claude-walnut)]/80 hover:bg-[var(--claude-cloud)] hover:text-[var(--claude-ink)]"
            >
              清空
            </button>
          </div>
          <div className="mt-2 max-h-64 overflow-auto pr-1">
            <ul className="space-y-1">
              {options.modes.map((mode) => {
                const checked = filters.modes.includes(mode)
                return (
                  <li key={mode}>
                    <button
                      type="button"
                      onClick={() =>
                        onChange({
                          ...filters,
                          modes: toggle(filters.modes, mode).sort(),
                        })
                      }
                      className={clsx(
                        'flex w-full items-center justify-between rounded-xl px-2 py-2 text-left text-sm',
                        checked
                          ? 'bg-[var(--claude-cloud)] text-[var(--claude-ink)]'
                          : 'hover:bg-[var(--claude-cloud)]/70 text-[var(--claude-walnut)]',
                      )}
                    >
                      <span className="min-w-0 truncate">{mode}</span>
                      {checked && (
                        <Check
                          className="h-4 w-4 text-[var(--claude-terracotta)]"
                          aria-hidden="true"
                        />
                      )}
                    </button>
                  </li>
                )
              })}
            </ul>
          </div>
        </PopoverPanel>
      </Popover>

      <Popover className="relative">
        <PopoverButton className="inline-flex h-9 items-center gap-2 rounded-xl border border-[var(--claude-smoke)]/40 bg-[var(--claude-paper)] px-3 text-sm text-[var(--claude-walnut)] shadow-sm hover:bg-[var(--claude-cloud)] dark:bg-[var(--claude-sand)]">
          <span>能力</span>
          {filters.abilities.length > 0 && (
            <span className="rounded-md bg-[var(--claude-cloud)] px-1.5 py-0.5 text-xs text-[var(--claude-walnut)] dark:bg-[var(--claude-cloud)]">
              {filters.abilities.length}
            </span>
          )}
          <ChevronDown className="h-4 w-4 text-[var(--claude-walnut)]/70" />
        </PopoverButton>
        <PopoverPanel className="absolute z-20 mt-2 w-80 rounded-2xl border border-[var(--claude-smoke)]/40 bg-[var(--claude-paper)] p-3 shadow-xl dark:bg-[var(--claude-sand)]">
          <div className="flex items-center justify-between gap-2">
            <p className="text-sm font-medium text-[var(--claude-ink)]">
              能力筛选（需全部满足）
            </p>
            <button
              type="button"
              onClick={() => onChange({ ...filters, abilities: [] })}
              className="rounded-md px-2 py-1 text-xs text-[var(--claude-walnut)]/80 hover:bg-[var(--claude-cloud)] hover:text-[var(--claude-ink)]"
            >
              清空
            </button>
          </div>

          <div className="mt-2 max-h-72 overflow-auto pr-1">
            <ul className="space-y-1">
              {ABILITY_DEFS.filter((a) => options.abilities.includes(a.key)).map(
                (ability) => {
                  const checked = filters.abilities.includes(ability.key)
                  return (
                    <li key={ability.key}>
                      <button
                        type="button"
                        onClick={() =>
                          onChange({
                            ...filters,
                            abilities: toggle(filters.abilities, ability.key).sort(),
                          })
                        }
                        className={clsx(
                          'flex w-full items-center justify-between gap-3 rounded-xl px-2 py-2 text-left text-sm',
                          checked
                            ? 'bg-[var(--claude-cloud)] text-[var(--claude-ink)]'
                            : 'hover:bg-[var(--claude-cloud)]/70 text-[var(--claude-walnut)]',
                        )}
                      >
                        <span className="flex min-w-0 items-center gap-2">
                          <AbilityIcons
                            abilities={[ability.key]}
                            className="shrink-0"
                            max={1}
                            size={14}
                          />
                          <span className="min-w-0 truncate">{ability.label}</span>
                        </span>
                        {checked && (
                          <Check
                            className="h-4 w-4 text-[var(--claude-terracotta)]"
                            aria-hidden="true"
                          />
                        )}
                      </button>
                    </li>
                  )
                },
              )}
              {options.abilities.filter(
                (k) => !ABILITY_DEFS.some((d) => d.key === k),
              ).length > 0 && (
                <li className="pt-2">
                  <p className="px-2 text-xs font-medium text-[var(--claude-walnut)]/70">
                    其他 supports_*
                  </p>
                </li>
              )}
              {options.abilities
                .filter((k) => !ABILITY_DEFS.some((d) => d.key === k))
                .map((abilityKey) => {
                  const checked = filters.abilities.includes(abilityKey)
                  return (
                    <li key={abilityKey}>
                      <button
                        type="button"
                        onClick={() =>
                          onChange({
                            ...filters,
                            abilities: toggle(filters.abilities, abilityKey).sort(),
                          })
                        }
                        className={clsx(
                          'flex w-full items-center justify-between gap-3 rounded-xl px-2 py-2 text-left text-sm',
                          checked
                            ? 'bg-[var(--claude-cloud)] text-[var(--claude-ink)]'
                            : 'hover:bg-[var(--claude-cloud)]/70 text-[var(--claude-walnut)]',
                        )}
                      >
                        <span className="min-w-0 truncate">{abilityKey}</span>
                        {checked && (
                          <Check
                            className="h-4 w-4 text-[var(--claude-terracotta)]"
                            aria-hidden="true"
                          />
                        )}
                      </button>
                    </li>
                  )
                })}
            </ul>
          </div>
        </PopoverPanel>
      </Popover>

      <PriceRangeFilter
        value={filters.price}
        onChange={(patch) => onChange({ ...filters, price: { ...filters.price, ...patch } })}
        onReset={() =>
          onChange({
            ...filters,
            price: { inputMin: '', inputMax: '', outputMin: '', outputMax: '' },
          })
        }
      />

      <button
        type="button"
        onClick={onReset}
        disabled={!hasActive && !filters.query.trim()}
        className={clsx(
          'inline-flex h-9 items-center gap-2 rounded-xl border px-3 text-sm shadow-sm',
          !hasActive && !filters.query.trim()
            ? 'cursor-not-allowed border-[var(--claude-smoke)]/30 bg-[var(--claude-paper)] text-[var(--claude-walnut)]/50 dark:bg-[var(--claude-sand)]'
            : 'border-[var(--claude-smoke)]/40 bg-[var(--claude-paper)] text-[var(--claude-walnut)] hover:bg-[var(--claude-cloud)] dark:bg-[var(--claude-sand)]',
        )}
        aria-label="重置筛选"
      >
        <RotateCcw className="h-4 w-4" />
        <span>重置</span>
      </button>

      <div className="ml-auto flex items-center gap-2 text-sm text-[var(--claude-walnut)]/80">
        <span className="hidden sm:inline">筛选结果</span>
        <span className="font-semibold text-[var(--claude-ink)]">
          {resultCount}
        </span>
        <span className="text-[var(--claude-walnut)]/60">/ {totalCount}</span>
      </div>
    </div>
  )
}
