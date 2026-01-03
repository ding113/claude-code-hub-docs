'use client'

import { Popover, PopoverButton, PopoverPanel } from '@headlessui/react'
import { Check, ChevronDown } from 'lucide-react'
import clsx from 'clsx'

import { ProviderIcon } from './ProviderIcons'
import { getProviderMeta } from '../utils/providerMapping'

const POPULAR_PROVIDERS = [
  'openai',
  'anthropic',
  'google',
  'gemini',
  'azure',
  'bedrock',
  'openrouter',
]

function sortProviders(providers: string[]): string[] {
  const set = new Set(providers)
  const popular = POPULAR_PROVIDERS.filter((p) => set.has(p))
  const rest = providers
    .filter((p) => !POPULAR_PROVIDERS.includes(p))
    .slice()
    .sort()
  return [...popular, ...rest]
}

export function ProviderFilter({
  providers,
  selected,
  onChange,
  className,
}: {
  providers: string[]
  selected: string[]
  onChange: (next: string[]) => void
  className?: string
}) {
  const sorted = sortProviders(providers)
  const selectedSet = new Set(selected)

  return (
    <Popover className={clsx('relative', className)}>
      <PopoverButton className="inline-flex h-9 items-center gap-2 rounded-xl border border-[var(--claude-smoke)]/40 bg-[var(--claude-paper)] px-3 text-sm text-[var(--claude-walnut)] shadow-sm hover:bg-[var(--claude-cloud)] dark:bg-[var(--claude-sand)]">
        <span>供应商</span>
        {selected.length > 0 && (
          <span className="rounded-md bg-[var(--claude-cloud)] px-1.5 py-0.5 text-xs text-[var(--claude-walnut)] dark:bg-[var(--claude-cloud)]">
            {selected.length}
          </span>
        )}
        <ChevronDown className="h-4 w-4 text-[var(--claude-walnut)]/70" />
      </PopoverButton>
      <PopoverPanel className="absolute z-20 mt-2 w-80 rounded-2xl border border-[var(--claude-smoke)]/40 bg-[var(--claude-paper)] p-3 shadow-xl dark:bg-[var(--claude-sand)]">
        <div className="flex items-center justify-between gap-2">
          <p className="text-sm font-medium text-[var(--claude-ink)]">
            供应商筛选
          </p>
          <div className="flex items-center gap-2 text-xs">
            <button
              type="button"
              onClick={() => onChange([])}
              className="rounded-md px-2 py-1 text-[var(--claude-walnut)]/80 hover:bg-[var(--claude-cloud)] hover:text-[var(--claude-ink)]"
            >
              清空
            </button>
            <button
              type="button"
              onClick={() => onChange(sorted)}
              className="rounded-md px-2 py-1 text-[var(--claude-walnut)]/80 hover:bg-[var(--claude-cloud)] hover:text-[var(--claude-ink)]"
            >
              全选
            </button>
          </div>
        </div>

        <div className="mt-2 max-h-72 overflow-auto pr-1">
          <ul className="space-y-1">
            {sorted.map((provider) => {
              const meta = getProviderMeta(provider)
              const checked = selectedSet.has(provider)
              return (
                <li key={provider}>
                  <button
                    type="button"
                    onClick={() =>
                      onChange(
                        checked
                          ? selected.filter((p) => p !== provider)
                          : [...selected, provider].sort(),
                      )
                    }
                    className={clsx(
                      'flex w-full items-center justify-between gap-3 rounded-xl px-2 py-2 text-left text-sm',
                      checked
                        ? 'bg-[var(--claude-cloud)] text-[var(--claude-ink)]'
                        : 'hover:bg-[var(--claude-cloud)]/70 text-[var(--claude-walnut)]',
                    )}
                  >
                    <span className="flex min-w-0 items-center gap-2">
                      <ProviderIcon provider={provider} className="h-5 w-5" />
                      <span className="min-w-0 truncate">{meta.label}</span>
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
            })}
          </ul>
        </div>
      </PopoverPanel>
    </Popover>
  )
}

