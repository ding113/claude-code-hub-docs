'use client'

import type { IconType } from '@lobehub/icons'
import {
  Anyscale,
  Anthropic,
  Azure,
  Bedrock,
  Cloudflare,
  Cohere,
  DeepInfra,
  DeepSeek,
  Fireworks,
  Gemini,
  GithubCopilot,
  Google,
  GoogleCloud,
  Groq,
  HuggingFace,
  Mistral,
  Ollama,
  OpenAI,
  OpenRouter,
  Perplexity,
  Replicate,
  Together,
  Voyage,
} from '@lobehub/icons'
import clsx from 'clsx'

import { getProviderMeta } from '../utils/providerMapping'

const ICONS: Record<string, IconType> = {
  OpenAI,
  Azure,
  Anthropic,
  Bedrock,
  Google,
  Gemini,
  GoogleCloud,
  Cohere,
  Mistral,
  Groq,
  Together,
  DeepInfra,
  Replicate,
  HuggingFace,
  Fireworks,
  Ollama,
  Perplexity,
  OpenRouter,
  Cloudflare,
  Voyage,
  Anyscale,
  DeepSeek,
  GithubCopilot,
}

export function ProviderIcon({
  provider,
  size = 18,
  className,
}: {
  provider: string
  size?: number
  className?: string
}) {
  const meta = getProviderMeta(provider)
  const Icon = meta.iconKey ? ICONS[meta.iconKey] : undefined

  if (!Icon) {
    const letter = (meta.label || provider).slice(0, 1).toUpperCase()
    return (
      <span
        title={meta.label}
        className={clsx(
          'inline-flex h-5 w-5 items-center justify-center rounded-full bg-[var(--claude-cloud)] text-[10px] font-semibold text-[var(--claude-walnut)] dark:bg-[var(--claude-cloud)]',
          className,
        )}
      >
        {letter}
      </span>
    )
  }

  return (
    <Icon
      size={size}
      className={clsx('text-[var(--claude-walnut)]', className)}
      title={meta.label}
      aria-label={meta.label}
    />
  )
}

export function ProviderIcons({
  providers,
  max = 8,
  className,
}: {
  providers: string[]
  max?: number
  className?: string
}) {
  const visible = providers.slice(0, max)
  const rest = providers.length - visible.length

  return (
    <div className={clsx('flex items-center gap-1', className)}>
      {visible.map((provider) => (
        <ProviderIcon
          key={provider}
          provider={provider}
          className="h-5 w-5"
          size={18}
        />
      ))}
      {rest > 0 && (
        <span className="ml-1 text-xs text-[var(--claude-walnut)]/70">
          +{rest}
        </span>
      )}
    </div>
  )
}

