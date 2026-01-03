'use client'

import { Check, Copy } from 'lucide-react'
import clsx from 'clsx'
import { memo, useEffect, useState } from 'react'

import { AbilityIcons } from './AbilityIcons'
import { ProviderIcons } from './ProviderIcons'

import type { AggregatedModel, NumberRange } from '../types/model'

const nf = new Intl.NumberFormat('en-US', { maximumFractionDigits: 4 })

function formatUsd(value: number): string {
  return `$${nf.format(value)}`
}

function formatRange(range: NumberRange | undefined): string {
  if (!range) return '—'
  if (range.min === range.max) return formatUsd(range.min)
  return `${formatUsd(range.min)}–${formatUsd(range.max)}`
}

async function copyToClipboard(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text)
    return true
  } catch {
    try {
      const el = document.createElement('textarea')
      el.value = text
      el.setAttribute('readonly', '')
      el.style.position = 'fixed'
      el.style.top = '0'
      el.style.left = '0'
      el.style.opacity = '0'
      document.body.appendChild(el)
      el.select()
      const ok = document.execCommand('copy')
      document.body.removeChild(el)
      return ok
    } catch {
      return false
    }
  }
}

export const ModelRow = memo(function ModelRow({
  model,
  isSelected,
  onSelect,
}: {
  model: AggregatedModel
  isSelected: boolean
  onSelect: (model: AggregatedModel) => void
}) {
  const [copied, setCopied] = useState(false)

  useEffect(() => {
    if (!copied) return
    const t = window.setTimeout(() => setCopied(false), 900)
    return () => window.clearTimeout(t)
  }, [copied])

  const providerIds = model.providers.map((p) => p.provider)
  const hasToken = Boolean(model.tokenInput || model.tokenOutput)

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={() => onSelect(model)}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault()
          onSelect(model)
        }
      }}
      className={clsx(
        'grid h-14 w-full items-center gap-3 rounded-xl px-3 text-left transition',
        'grid-cols-[minmax(0,1.4fr)_minmax(0,0.9fr)_minmax(0,0.9fr)] md:grid-cols-[minmax(0,1.4fr)_minmax(0,0.9fr)_minmax(0,0.6fr)_minmax(0,1.1fr)_minmax(0,0.9fr)]',
        isSelected
          ? 'bg-[var(--claude-cloud)]/80'
          : 'hover:bg-[var(--claude-cloud)]/60',
      )}
    >
      <div className="min-w-0">
        <div className="flex min-w-0 items-center gap-2">
          <span className="min-w-0 truncate font-medium text-[var(--claude-ink)]">
            {model.displayName}
          </span>
          <button
            type="button"
            onClick={async (e) => {
              e.stopPropagation()
              const ok = await copyToClipboard(model.displayName)
              setCopied(ok)
            }}
            className={clsx(
              'inline-flex h-7 w-7 items-center justify-center rounded-lg border text-[var(--claude-walnut)]/70',
              copied
                ? 'border-[var(--claude-terracotta)]/40 bg-[var(--claude-terracotta)]/10 text-[var(--claude-terracotta)]'
                : 'border-[var(--claude-smoke)]/40 hover:bg-[var(--claude-cloud)] hover:text-[var(--claude-ink)]',
            )}
            aria-label="复制模型名"
            title={copied ? '已复制' : '复制'}
          >
            {copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
          </button>
        </div>
        <p className="mt-0.5 truncate text-xs text-[var(--claude-walnut)]/60">
          {model.variants.length} 个变体 · {providerIds.length} 个供应商
        </p>
      </div>

      <div className="min-w-0">
        <ProviderIcons providers={providerIds} />
      </div>

      <div className="min-w-0 md:hidden">
        <div className="text-right text-xs text-[var(--claude-walnut)]/70">
          {hasToken ? (
            <>
              <div>入 {formatRange(model.tokenInput)}/M</div>
              <div>出 {formatRange(model.tokenOutput)}/M</div>
            </>
          ) : (
            <div>图 {formatRange(model.imageOutput)}/图</div>
          )}
        </div>
      </div>

      <div className="hidden min-w-0 md:block">
        <span className="inline-flex rounded-lg bg-[var(--claude-cloud)] px-2 py-1 text-xs text-[var(--claude-walnut)] dark:bg-[var(--claude-cloud)]">
          {model.mode}
        </span>
      </div>

      <div className="hidden min-w-0 md:block">
        <AbilityIcons abilities={model.abilities} max={7} />
      </div>

      <div className="hidden min-w-0 md:block">
        <div className="text-xs text-[var(--claude-walnut)]/70">
          {hasToken ? (
            <>
              <div>入 {formatRange(model.tokenInput)}/M</div>
              <div>出 {formatRange(model.tokenOutput)}/M</div>
            </>
          ) : (
            <div>图 {formatRange(model.imageOutput)}/图</div>
          )}
        </div>
      </div>
    </div>
  )
})
