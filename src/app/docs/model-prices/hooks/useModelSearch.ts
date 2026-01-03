'use client'

import { useMemo } from 'react'

import type { AggregatedModel } from '../types/model'

function normalizeQuery(query: string): string[] {
  return query
    .trim()
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean)
}

export function useModelSearch(models: AggregatedModel[], query: string) {
  const terms = useMemo(() => normalizeQuery(query), [query])

  const index = useMemo(() => {
    return models.map((model) => {
      const providers = model.providers
        .map((p) => `${p.provider} ${p.label}`)
        .join(' ')
      const variants = model.variants.map((v) => v.modelKey).join(' ')
      const haystack = `${model.displayName} ${model.mode} ${providers} ${variants}`
        .toLowerCase()
        .trim()
      return { model, haystack }
    })
  }, [models])

  return useMemo(() => {
    if (terms.length === 0) return models
    return index
      .filter(({ haystack }) => terms.every((term) => haystack.includes(term)))
      .map(({ model }) => model)
  }, [index, models, terms])
}

