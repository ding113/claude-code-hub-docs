'use client'

import { useEffect, useMemo, useState } from 'react'

import { aggregateModels } from '../utils/aggregateModels'
import { parsePricesBaseToml } from '../utils/parseToml'

import type { AggregatedModel, PricesBaseMetadata } from '../types/model'

type ModelDataState =
  | { status: 'loading' }
  | {
      status: 'success'
      metadata: PricesBaseMetadata
      models: AggregatedModel[]
      modelCount: number
      aggregatedCount: number
    }
  | { status: 'error'; error: string }

export function useModelData() {
  const [state, setState] = useState<ModelDataState>({ status: 'loading' })

  useEffect(() => {
    const controller = new AbortController()

    async function run() {
      try {
        setState({ status: 'loading' })

        const res = await fetch('/config/prices-base.toml', {
          signal: controller.signal,
          cache: 'force-cache',
        })
        if (!res.ok) {
          throw new Error(`获取价格表失败：${res.status} ${res.statusText}`)
        }

        const text = await res.text()
        const parsed = parsePricesBaseToml(text)
        const aggregated = aggregateModels(parsed.models)

        setState({
          status: 'success',
          metadata: parsed.metadata,
          models: aggregated,
          modelCount: Object.keys(parsed.models).length,
          aggregatedCount: aggregated.length,
        })
      } catch (error) {
        if (controller.signal.aborted) return
        setState({
          status: 'error',
          error: error instanceof Error ? error.message : String(error),
        })
      }
    }

    void run()
    return () => controller.abort()
  }, [])

  const data = useMemo(() => {
    if (state.status !== 'success') return null

    const providerSet = new Set<string>()
    const modeSet = new Set<string>()
    const abilitySet = new Set<string>()

    for (const model of state.models) {
      modeSet.add(model.mode)
      for (const provider of model.providers) providerSet.add(provider.provider)
      for (const ability of model.abilities) abilitySet.add(ability)
    }

    return {
      providers: Array.from(providerSet).sort(),
      modes: Array.from(modeSet).sort(),
      abilities: Array.from(abilitySet).sort(),
    }
  }, [state])

  return { state, options: data }
}

