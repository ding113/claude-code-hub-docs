'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import type { ReadonlyURLSearchParams } from 'next/navigation'

import type { AggregatedModel } from '../types/model'

export type PriceRangeState = {
  inputMin: string
  inputMax: string
  outputMin: string
  outputMax: string
}

export type ModelFilterState = {
  query: string
  providers: string[]
  modes: string[]
  abilities: string[]
  price: PriceRangeState
}

export const DEFAULT_FILTERS: ModelFilterState = {
  query: '',
  providers: [],
  modes: [],
  abilities: [],
  price: { inputMin: '', inputMax: '', outputMin: '', outputMax: '' },
}

function decodeList(value: string | null): string[] {
  if (!value) return []
  const list = value
    .split(',')
    .map((v) => v.trim())
    .filter(Boolean)
  return Array.from(new Set(list)).sort()
}

function parseNumber(value: string): number | undefined {
  const trimmed = value.trim()
  if (!trimmed) return undefined
  const n = Number(trimmed)
  return Number.isFinite(n) ? n : undefined
}

function parseFromSearchParams(params: ReadonlyURLSearchParams): ModelFilterState {
  return {
    query: params.get('q') ?? '',
    providers: decodeList(params.get('p')),
    modes: decodeList(params.get('m')),
    abilities: decodeList(params.get('a')),
    price: {
      inputMin: (params.get('imin') ?? '').trim(),
      inputMax: (params.get('imax') ?? '').trim(),
      outputMin: (params.get('omin') ?? '').trim(),
      outputMax: (params.get('omax') ?? '').trim(),
    },
  }
}

function buildSearchParams(filters: ModelFilterState): URLSearchParams {
  const params = new URLSearchParams()

  const q = filters.query.trim()
  if (q) params.set('q', q)

  if (filters.providers.length > 0) params.set('p', filters.providers.join(','))
  if (filters.modes.length > 0) params.set('m', filters.modes.join(','))
  if (filters.abilities.length > 0) params.set('a', filters.abilities.join(','))

  if (filters.price.inputMin.trim()) params.set('imin', filters.price.inputMin.trim())
  if (filters.price.inputMax.trim()) params.set('imax', filters.price.inputMax.trim())
  if (filters.price.outputMin.trim()) params.set('omin', filters.price.outputMin.trim())
  if (filters.price.outputMax.trim()) params.set('omax', filters.price.outputMax.trim())

  return params
}

function stableSerialize(filters: ModelFilterState): string {
  const params = buildSearchParams(filters)
  const s = params.toString()
  return s
}

function toggleInList(list: string[], value: string): string[] {
  return list.includes(value) ? list.filter((v) => v !== value) : [...list, value]
}

export function useModelFilterState() {
  const searchParams = useSearchParams()
  const pathname = usePathname()
  const router = useRouter()

  const [filters, setFilters] = useState<ModelFilterState>(() =>
    parseFromSearchParams(searchParams),
  )

  const serialized = useMemo(() => stableSerialize(filters), [filters])
  const serializedRef = useRef(serialized)
  serializedRef.current = serialized

  useEffect(() => {
    const fromUrl = parseFromSearchParams(searchParams)
    const fromUrlSerialized = stableSerialize(fromUrl)
    if (fromUrlSerialized !== serializedRef.current) {
      setFilters(fromUrl)
    }
  }, [searchParams])

  const lastPushedRef = useRef<string>('')
  useEffect(() => {
    const currentUrlSerialized = stableSerialize(parseFromSearchParams(searchParams))
    if (serialized === currentUrlSerialized) return

    const timer = window.setTimeout(() => {
      if (serialized === lastPushedRef.current) return
      const params = buildSearchParams(filters)
      const qs = params.toString()
      const next = qs ? `${pathname}?${qs}` : pathname
      lastPushedRef.current = serialized
      router.replace(next, { scroll: false })
    }, 200)

    return () => window.clearTimeout(timer)
  }, [filters, pathname, router, searchParams, serialized])

  const actions = useMemo(() => {
    return {
      setQuery: (query: string) =>
        setFilters((prev) => ({
          ...prev,
          query,
        })),
      toggleProvider: (provider: string) =>
        setFilters((prev) => ({
          ...prev,
          providers: toggleInList(prev.providers, provider).sort(),
        })),
      toggleMode: (mode: string) =>
        setFilters((prev) => ({
          ...prev,
          modes: toggleInList(prev.modes, mode).sort(),
        })),
      toggleAbility: (ability: string) =>
        setFilters((prev) => ({
          ...prev,
          abilities: toggleInList(prev.abilities, ability).sort(),
        })),
      setPrice: (patch: Partial<PriceRangeState>) =>
        setFilters((prev) => ({
          ...prev,
          price: { ...prev.price, ...patch },
        })),
      reset: () => setFilters(DEFAULT_FILTERS),
      setProviders: (providers: string[]) =>
        setFilters((prev) => ({ ...prev, providers: providers.slice().sort() })),
    }
  }, [])

  return { filters, setFilters, actions }
}

export function useModelFilter(models: AggregatedModel[], filters: ModelFilterState) {
  return useMemo(() => {
    const hasProvider = filters.providers.length > 0
    const hasMode = filters.modes.length > 0
    const hasAbility = filters.abilities.length > 0

    const inputMin = parseNumber(filters.price.inputMin)
    const inputMax = parseNumber(filters.price.inputMax)
    const outputMin = parseNumber(filters.price.outputMin)
    const outputMax = parseNumber(filters.price.outputMax)
    const hasPrice =
      inputMin !== undefined ||
      inputMax !== undefined ||
      outputMin !== undefined ||
      outputMax !== undefined

    return models.filter((model) => {
      if (hasProvider) {
        const providerIds = model.providers.map((p) => p.provider)
        if (!providerIds.some((id) => filters.providers.includes(id))) return false
      }

      if (hasMode && !filters.modes.includes(model.mode)) return false

      if (hasAbility) {
        if (!filters.abilities.every((a) => model.abilities.includes(a)))
          return false
      }

      if (hasPrice) {
        const input = model.tokenInput?.min
        const output = model.tokenOutput?.min

        if (inputMin !== undefined && (input === undefined || input < inputMin))
          return false
        if (inputMax !== undefined && (input === undefined || input > inputMax))
          return false
        if (outputMin !== undefined && (output === undefined || output < outputMin))
          return false
        if (outputMax !== undefined && (output === undefined || output > outputMax))
          return false
      }

      return true
    })
  }, [filters, models])
}
