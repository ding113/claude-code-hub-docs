'use client'

import { Dialog, DialogPanel } from '@headlessui/react'
import { Check, Copy, X } from 'lucide-react'
import clsx from 'clsx'
import { useEffect, useMemo, useState } from 'react'

import { AbilityIcons, ABILITY_DEFS } from './AbilityIcons'
import { ProviderIcon } from './ProviderIcons'

import type { AggregatedModel, NumberRange, ProviderSummary } from '../types/model'

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
    return false
  }
}

function ProviderPriceRow({ provider }: { provider: ProviderSummary }) {
  const hasToken = Boolean(provider.tokenInput || provider.tokenOutput)
  return (
    <tr className="border-b border-[var(--claude-smoke)]/20 last:border-b-0">
      <td className="py-2 pr-3 text-sm">
        <span className="flex items-center gap-2">
          <ProviderIcon provider={provider.provider} className="h-5 w-5" />
          <span className="truncate text-[var(--claude-ink)]">{provider.label}</span>
        </span>
      </td>
      <td className="py-2 pr-3 text-sm text-[var(--claude-walnut)]/80">
        {hasToken ? `${formatRange(provider.tokenInput)}/M` : '—'}
      </td>
      <td className="py-2 pr-3 text-sm text-[var(--claude-walnut)]/80">
        {hasToken ? `${formatRange(provider.tokenOutput)}/M` : '—'}
      </td>
      <td className="py-2 text-sm text-[var(--claude-walnut)]/80">
        {!hasToken ? `${formatRange(provider.imageOutput)}/图` : '—'}
      </td>
    </tr>
  )
}

function DrawerContent({ model }: { model: AggregatedModel }) {
  const [copied, setCopied] = useState(false)

  useEffect(() => {
    if (!copied) return
    const t = window.setTimeout(() => setCopied(false), 900)
    return () => window.clearTimeout(t)
  }, [copied])

  const abilityLabels = useMemo(() => {
    const map = new Map<string, string>()
    for (const def of ABILITY_DEFS) map.set(def.key, def.label)
    return map
  }, [])

  const abilities = model.abilities
    .map((k) => ({ key: k, label: abilityLabels.get(k) ?? k }))
    .slice()
    .sort((a, b) => a.label.localeCompare(b.label))

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex items-start justify-between gap-3 border-b border-[var(--claude-smoke)]/30 px-4 py-4">
        <div className="min-w-0">
          <h2 className="truncate text-lg font-semibold text-[var(--claude-ink)]">
            {model.displayName}
          </h2>
          <p className="mt-1 text-sm text-[var(--claude-walnut)]/70">
            mode: <span className="font-medium">{model.mode}</span>
          </p>
        </div>
        <button
          type="button"
          onClick={async () => {
            const ok = await copyToClipboard(model.displayName)
            setCopied(ok)
          }}
          className={clsx(
            'inline-flex h-9 items-center gap-2 rounded-xl border px-3 text-sm',
            copied
              ? 'border-[var(--claude-terracotta)]/40 bg-[var(--claude-terracotta)]/10 text-[var(--claude-terracotta)]'
              : 'border-[var(--claude-smoke)]/40 text-[var(--claude-walnut)] hover:bg-[var(--claude-cloud)]',
          )}
        >
          {copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
          <span>{copied ? '已复制' : '复制模型名'}</span>
        </button>
      </div>

      <div className="min-h-0 flex-1 overflow-auto px-4 py-4">
        <section>
          <h3 className="text-sm font-semibold text-[var(--claude-ink)]">
            基本信息
          </h3>
          <dl className="mt-2 grid grid-cols-2 gap-3 text-sm">
            <div>
              <dt className="text-[var(--claude-walnut)]/70">最大输入</dt>
              <dd className="mt-1 font-medium text-[var(--claude-ink)]">
                {model.maxInputTokens ?? '—'}
              </dd>
            </div>
            <div>
              <dt className="text-[var(--claude-walnut)]/70">最大输出</dt>
              <dd className="mt-1 font-medium text-[var(--claude-ink)]">
                {model.maxOutputTokens ?? '—'}
              </dd>
            </div>
            <div>
              <dt className="text-[var(--claude-walnut)]/70">最大 tokens</dt>
              <dd className="mt-1 font-medium text-[var(--claude-ink)]">
                {model.maxTokens ?? '—'}
              </dd>
            </div>
            <div>
              <dt className="text-[var(--claude-walnut)]/70">变体数</dt>
              <dd className="mt-1 font-medium text-[var(--claude-ink)]">
                {model.variants.length}
              </dd>
            </div>
          </dl>
        </section>

        <section className="mt-6">
          <h3 className="text-sm font-semibold text-[var(--claude-ink)]">能力</h3>
          {abilities.length === 0 ? (
            <p className="mt-2 text-sm text-[var(--claude-walnut)]/70">—</p>
          ) : (
            <div className="mt-2 flex flex-wrap gap-2">
              {abilities.map(({ key, label }) => (
                <span
                  key={key}
                  className="inline-flex items-center gap-2 rounded-xl border border-[var(--claude-smoke)]/30 bg-[var(--claude-paper)] px-3 py-2 text-sm text-[var(--claude-walnut)] dark:bg-[var(--claude-sand)]"
                  title={key}
                >
                  <AbilityIcons abilities={[key]} max={1} size={14} />
                  <span>{label}</span>
                </span>
              ))}
            </div>
          )}
        </section>

        <section className="mt-6">
          <h3 className="text-sm font-semibold text-[var(--claude-ink)]">
            供应商价格对比
          </h3>
          <div className="mt-2 overflow-hidden rounded-xl border border-[var(--claude-smoke)]/30">
            <table className="w-full table-fixed">
              <thead className="bg-[var(--claude-cloud)]/40">
                <tr className="text-left text-xs font-semibold text-[var(--claude-walnut)]/80">
                  <th className="py-2 pr-3 pl-3">供应商</th>
                  <th className="py-2 pr-3">输入</th>
                  <th className="py-2 pr-3">输出</th>
                  <th className="py-2 pr-3">图像</th>
                </tr>
              </thead>
              <tbody className="bg-[var(--claude-paper)] dark:bg-[var(--claude-sand)]">
                {model.providers.map((p) => (
                  <ProviderPriceRow key={p.provider} provider={p} />
                ))}
              </tbody>
            </table>
          </div>
        </section>

        <section className="mt-6">
          <h3 className="text-sm font-semibold text-[var(--claude-ink)]">
            变体明细
          </h3>
          <div className="mt-2 space-y-2">
            {model.providers.map((p) => (
              <details
                key={p.provider}
                className="rounded-xl border border-[var(--claude-smoke)]/30 bg-[var(--claude-paper)] px-3 py-2 text-sm dark:bg-[var(--claude-sand)]"
              >
                <summary className="cursor-pointer list-none">
                  <div className="flex items-center justify-between gap-3">
                    <span className="flex items-center gap-2">
                      <ProviderIcon provider={p.provider} className="h-5 w-5" />
                      <span className="font-medium text-[var(--claude-ink)]">
                        {p.label}
                      </span>
                    </span>
                    <span className="text-xs text-[var(--claude-walnut)]/70">
                      {p.variantCount} 条
                    </span>
                  </div>
                </summary>
                <ul className="mt-2 space-y-1">
                  {p.modelKeys.slice(0, 30).map((key) => (
                    <li key={key} className="truncate text-xs text-[var(--claude-walnut)]/80">
                      {key}
                    </li>
                  ))}
                  {p.modelKeys.length > 30 && (
                    <li className="text-xs text-[var(--claude-walnut)]/60">
                      还有 {p.modelKeys.length - 30} 条未展示
                    </li>
                  )}
                </ul>
              </details>
            ))}
          </div>
        </section>
      </div>
    </div>
  )
}

export function ModelDrawer({
  model,
  open,
  onClose,
  className,
}: {
  model: AggregatedModel | null
  open: boolean
  onClose: () => void
  className?: string
}) {
  if (!model) return null

  return (
    <>
      <aside
        className={clsx(
          'hidden min-h-0 w-[420px] flex-none flex-col overflow-hidden rounded-2xl border border-[var(--claude-smoke)]/40 bg-[var(--claude-paper)] shadow-sm dark:bg-[var(--claude-sand)] lg:flex',
          className,
        )}
      >
        <div className="flex items-center justify-end border-b border-[var(--claude-smoke)]/30 px-4 py-3">
          <button
            type="button"
            onClick={onClose}
            className="inline-flex h-8 w-8 items-center justify-center rounded-lg text-[var(--claude-walnut)]/70 hover:bg-[var(--claude-cloud)] hover:text-[var(--claude-ink)]"
            aria-label="关闭"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
        <DrawerContent model={model} />
      </aside>

      <Dialog open={open} onClose={onClose} className="relative z-50 lg:hidden">
        <div className="fixed inset-0 bg-black/30" aria-hidden="true" />
        <div className="fixed inset-0 flex justify-end">
          <DialogPanel className="h-full w-full max-w-md bg-[var(--claude-paper)] shadow-2xl dark:bg-[var(--claude-sand)]">
            <div className="flex items-center justify-end border-b border-[var(--claude-smoke)]/30 px-4 py-3">
              <button
                type="button"
                onClick={onClose}
                className="inline-flex h-9 w-9 items-center justify-center rounded-xl text-[var(--claude-walnut)]/70 hover:bg-[var(--claude-cloud)] hover:text-[var(--claude-ink)]"
                aria-label="关闭"
              >
                <X className="h-5 w-5" />
              </button>
            </div>
            <DrawerContent model={model} />
          </DialogPanel>
        </div>
      </Dialog>
    </>
  )
}
