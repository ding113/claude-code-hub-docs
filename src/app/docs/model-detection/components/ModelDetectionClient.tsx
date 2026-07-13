'use client'

import { Loader2, Radar, ShieldCheck } from 'lucide-react'
import { useState } from 'react'

import { runModelDetection } from '@/lib/model-detection/runner'
import type {
  DetectionEndpointType,
  ModelDetectionInput,
  ModelDetectionResult,
} from '@/lib/model-detection/types'

interface ModelDetectionClientProps {
  runDetection?: (input: ModelDetectionInput) => Promise<ModelDetectionResult>
}

const ENDPOINT_TYPES = ['openai', 'anthropic', 'gemini'] as const

function formatPercent(value: number) {
  return `${(value * 100).toFixed(1)}%`
}

function isDetectionEndpointType(
  value: string,
): value is DetectionEndpointType {
  return ENDPOINT_TYPES.includes(value as DetectionEndpointType)
}

function endpointLabel(value: DetectionEndpointType) {
  switch (value) {
    case 'anthropic':
      return 'Anthropic'
    case 'gemini':
      return 'Gemini'
    default:
      return 'OpenAI'
  }
}

export function ModelDetectionClient({
  runDetection = runModelDetection,
}: ModelDetectionClientProps) {
  const [baseUrl, setBaseUrl] = useState('')
  const [apiKey, setApiKey] = useState('')
  const [model, setModel] = useState('')
  const [endpointType, setEndpointType] =
    useState<DetectionEndpointType>('openai')
  const [isRunning, setIsRunning] = useState(false)
  const [result, setResult] = useState<ModelDetectionResult | null>(null)
  const [error, setError] = useState('')

  const isReady =
    baseUrl.trim().length > 0 &&
    apiKey.trim().length > 0 &&
    model.trim().length > 0

  async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!isReady || isRunning) {
      return
    }

    setIsRunning(true)
    setError('')

    try {
      const nextResult = await runDetection({
        baseUrl: baseUrl.trim(),
        apiKey: apiKey.trim(),
        model: model.trim(),
        endpointType,
      })

      setResult(nextResult)
    } catch (nextError) {
      setResult(null)
      setError(
        nextError instanceof Error
          ? nextError.message
          : '检测失败，请稍后重试。',
      )
    } finally {
      setIsRunning(false)
    }
  }

  return (
    <div className="flex min-w-0 flex-auto flex-col px-4 py-16 lg:pl-8 xl:px-16">
      <section className="relative overflow-hidden rounded-[2rem] border border-[var(--claude-smoke)]/40 bg-[linear-gradient(145deg,color-mix(in_oklab,var(--claude-paper)_86%,white),color-mix(in_oklab,var(--claude-sand)_92%,var(--claude-ember)_8%))] p-8 shadow-[0_28px_80px_-48px_color-mix(in_oklab,var(--claude-walnut)_35%,transparent)] dark:bg-[linear-gradient(160deg,color-mix(in_oklab,var(--claude-sand)_92%,black),color-mix(in_oklab,var(--claude-cloud)_82%,var(--claude-terracotta)_18%))]">
        <div className="absolute -top-16 right-0 h-44 w-44 rounded-full bg-[color-mix(in_oklab,var(--claude-ember)_55%,transparent)] blur-3xl" />
        <div className="absolute bottom-0 left-8 h-px w-40 bg-[linear-gradient(90deg,var(--claude-terracotta),transparent)]" />

        <div className="relative grid gap-8 lg:grid-cols-[minmax(0,1.2fr)_18rem]">
          <div>
            <div className="inline-flex items-center gap-2 rounded-full border border-[var(--claude-smoke)]/50 bg-[var(--claude-paper)]/70 px-3 py-1 text-xs font-medium tracking-[0.24em] text-[var(--claude-ember-dark)] uppercase dark:bg-black/10">
              <Radar className="h-3.5 w-3.5" />
              Response Signature
            </div>
            <h1 className="mt-5 font-display text-4xl tracking-tight text-[var(--claude-ink)] sm:text-5xl">
              响应模型检测
            </h1>
            <p className="mt-4 max-w-2xl text-base leading-8 text-[var(--claude-walnut)]/78">
              直接从浏览器向目标 API 发起实测请求，汇总本次样本响应特征，
              输出所有出现有效信号的模型家族，并按概率从高到低排序。
            </p>
          </div>

          <div className="rounded-[1.75rem] border border-[var(--claude-smoke)]/40 bg-[var(--claude-paper)]/75 p-5 backdrop-blur-sm dark:bg-black/10">
            <div className="flex items-start gap-3">
              <ShieldCheck className="mt-0.5 h-5 w-5 text-[var(--claude-ember-dark)]" />
              <div>
                <p className="text-sm font-semibold text-[var(--claude-ink)]">
                  本地执行
                </p>
                <p className="mt-2 text-sm leading-7 text-[var(--claude-walnut)]/72">
                  所有输入与统计都在前端完成，页面不会代管你的 API Key。
                  如果目标服务禁用浏览器跨域访问，页面会直接提示失败原因。
                </p>
              </div>
            </div>
          </div>
        </div>
      </section>

      <div className="mt-8 grid gap-6 xl:grid-cols-[minmax(0,1fr)_18rem]">
        <form
          onSubmit={onSubmit}
          className="rounded-[2rem] border border-[var(--claude-smoke)]/35 bg-[var(--claude-paper)] p-6 shadow-[0_20px_60px_-40px_color-mix(in_oklab,var(--claude-walnut)_35%,transparent)] dark:bg-[var(--claude-sand)]"
        >
          <div className="grid gap-5 md:grid-cols-2">
            <label className="block md:col-span-2">
              <span className="text-sm font-medium text-[var(--claude-ink)]">
                API Base URL
              </span>
              <input
                aria-label="API Base URL"
                value={baseUrl}
                onChange={(event) => setBaseUrl(event.target.value)}
                placeholder="https://your-relay.example.com"
                className="mt-2 w-full rounded-2xl border border-[var(--claude-smoke)]/55 bg-[var(--claude-sand)] px-4 py-3 text-sm text-[var(--claude-ink)] outline-none transition focus:border-[var(--claude-terracotta)] focus:ring-2 focus:ring-[color-mix(in_oklab,var(--claude-terracotta)_22%,transparent)] dark:bg-[var(--claude-cloud)]"
              />
            </label>

            <label className="block">
              <span className="text-sm font-medium text-[var(--claude-ink)]">
                API Key
              </span>
              <input
                aria-label="API Key"
                type="password"
                value={apiKey}
                onChange={(event) => setApiKey(event.target.value)}
                placeholder="sk-..."
                className="mt-2 w-full rounded-2xl border border-[var(--claude-smoke)]/55 bg-[var(--claude-sand)] px-4 py-3 text-sm text-[var(--claude-ink)] outline-none transition focus:border-[var(--claude-terracotta)] focus:ring-2 focus:ring-[color-mix(in_oklab,var(--claude-terracotta)_22%,transparent)] dark:bg-[var(--claude-cloud)]"
              />
            </label>

            <label className="block">
              <span className="text-sm font-medium text-[var(--claude-ink)]">
                Model Name
              </span>
              <input
                aria-label="Model Name"
                value={model}
                onChange={(event) => setModel(event.target.value)}
                placeholder="gpt-4o-mini"
                className="mt-2 w-full rounded-2xl border border-[var(--claude-smoke)]/55 bg-[var(--claude-sand)] px-4 py-3 text-sm text-[var(--claude-ink)] outline-none transition focus:border-[var(--claude-terracotta)] focus:ring-2 focus:ring-[color-mix(in_oklab,var(--claude-terracotta)_22%,transparent)] dark:bg-[var(--claude-cloud)]"
              />
            </label>

            <label className="block md:col-span-2">
              <span className="text-sm font-medium text-[var(--claude-ink)]">
                Endpoint Type
              </span>
              <select
                aria-label="Endpoint Type"
                value={endpointType}
                onChange={(event) => {
                  const nextValue = event.target.value
                  if (isDetectionEndpointType(nextValue)) {
                    setEndpointType(nextValue)
                  }
                }}
                className="mt-2 w-full rounded-2xl border border-[var(--claude-smoke)]/55 bg-[var(--claude-sand)] px-4 py-3 text-sm text-[var(--claude-ink)] outline-none transition focus:border-[var(--claude-terracotta)] focus:ring-2 focus:ring-[color-mix(in_oklab,var(--claude-terracotta)_22%,transparent)] dark:bg-[var(--claude-cloud)]"
              >
                <option value="openai">OpenAI</option>
                <option value="anthropic">Anthropic</option>
                <option value="gemini">Gemini</option>
              </select>
            </label>
          </div>

          <div className="mt-6 flex flex-wrap items-center justify-between gap-4">
            <p className="text-sm leading-7 text-[var(--claude-walnut)]/72">
              当前将按{' '}
              <span className="font-medium">{endpointLabel(endpointType)}</span>{' '}
              请求格式运行，并自动尝试兼容回退。
            </p>
            <button
              type="submit"
              disabled={!isReady || isRunning}
              className="inline-flex items-center justify-center gap-2 rounded-full bg-[var(--claude-ink)] px-5 py-3 text-sm font-semibold text-[var(--claude-paper)] transition hover:bg-[var(--claude-walnut)] disabled:cursor-not-allowed disabled:opacity-50"
            >
              {isRunning ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" />
                  检测中...
                </>
              ) : (
                '开始检测'
              )}
            </button>
          </div>

          {error && (
            <div className="mt-5 rounded-2xl border border-red-500/20 bg-red-500/8 p-4 text-sm leading-7 text-red-700 dark:text-red-300">
              {error}
            </div>
          )}
        </form>

        <aside className="rounded-[2rem] border border-[var(--claude-smoke)]/35 bg-[var(--claude-sand)]/75 p-6 dark:bg-[var(--claude-sand)]">
          <p className="text-xs font-semibold tracking-[0.22em] text-[var(--claude-ember-dark)] uppercase">
            Quick Notes
          </p>
          <div className="mt-4 space-y-4 text-sm leading-7 text-[var(--claude-walnut)]/75">
            <p>
              建议优先使用代理根地址，不要直接把 `/v1/messages`
              之类的完整路径手填进去。
            </p>
            <p>
              如果目标供应商只开放服务器端访问，这个页面会在浏览器里直接拿到跨域或鉴权错误。
            </p>
            <p>检测结果只展示本次样本统计命中的模型家族，未命中的不会出现。</p>
          </div>
        </aside>
      </div>

      <section className="mt-8 rounded-[2rem] border border-[var(--claude-smoke)]/35 bg-[var(--claude-paper)] p-6 dark:bg-[var(--claude-sand)]">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <h2 className="font-display text-2xl tracking-tight text-[var(--claude-ink)]">
              检测结果
            </h2>
            <p className="mt-2 text-sm text-[var(--claude-walnut)]/72">
              仅展示概率大于 0 的模型家族。
            </p>
          </div>
          {result && (
            <div className="rounded-full border border-[var(--claude-smoke)]/45 bg-[var(--claude-sand)] px-4 py-2 text-sm text-[var(--claude-walnut)]/78 dark:bg-[var(--claude-cloud)]">
              已完成 {result.summary.attemptedProbes} /{' '}
              {result.summary.totalProbes} 个样本请求
            </div>
          )}
        </div>

        {!result && !error && (
          <div className="mt-6 rounded-[1.75rem] border border-dashed border-[var(--claude-smoke)]/55 bg-[var(--claude-sand)]/50 px-6 py-10 text-sm leading-7 text-[var(--claude-walnut)]/70 dark:bg-[var(--claude-cloud)]/35">
            填写连接信息后启动检测，结果会在这里按概率排序展示。
          </div>
        )}

        {result && result.rankings.length === 0 && (
          <div className="mt-6 rounded-[1.75rem] border border-[var(--claude-smoke)]/40 bg-[var(--claude-sand)]/60 px-6 py-10 text-sm leading-7 text-[var(--claude-walnut)]/72 dark:bg-[var(--claude-cloud)]/35">
            本次测试没有观察到可判定信号。你可以检查模型名、端点类型，或者换一个更接近真实上游的入口再试一次。
          </div>
        )}

        {result && result.rankings.length > 0 && (
          <div className="mt-6 grid gap-4 md:grid-cols-2">
            {result.rankings.map((ranking) => (
              <article
                key={ranking.familyId}
                className="overflow-hidden rounded-[1.75rem] border border-[var(--claude-smoke)]/40 bg-[linear-gradient(140deg,color-mix(in_oklab,var(--claude-paper)_85%,white),color-mix(in_oklab,var(--claude-sand)_78%,var(--claude-ember)_22%))] p-5 dark:bg-[linear-gradient(140deg,color-mix(in_oklab,var(--claude-sand)_88%,black),color-mix(in_oklab,var(--claude-cloud)_72%,var(--claude-terracotta)_28%))]"
              >
                <div className="flex items-start justify-between gap-4">
                  <div>
                    <h3 className="text-lg font-semibold text-[var(--claude-ink)]">
                      {ranking.familyLabel}
                    </h3>
                    <p className="mt-1 text-sm text-[var(--claude-walnut)]/72">
                      命中 {ranking.hits} / 有效样本 {ranking.tested} / 全量样本{' '}
                      {ranking.total}
                    </p>
                  </div>
                  <div className="text-right">
                    <div className="font-display text-3xl tracking-tight text-[var(--claude-ink)]">
                      {formatPercent(ranking.probability)}
                    </div>
                    <div className="text-xs uppercase tracking-[0.18em] text-[var(--claude-ember-dark)]">
                      probability
                    </div>
                  </div>
                </div>

                <div className="mt-5 h-2.5 overflow-hidden rounded-full bg-[color-mix(in_oklab,var(--claude-smoke)_50%,transparent)]">
                  <div
                    className="h-full rounded-full bg-[linear-gradient(90deg,var(--claude-terracotta),var(--claude-ember))]"
                    style={{ width: formatPercent(ranking.probability) }}
                  />
                </div>
              </article>
            ))}
          </div>
        )}
      </section>
    </div>
  )
}
