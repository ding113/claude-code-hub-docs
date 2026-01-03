import { TomlError, parse } from 'smol-toml'

import type { PricesBaseToml, RawModelEntry } from '../types/model'

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

export function parsePricesBaseToml(text: string): PricesBaseToml {
  let parsed: unknown
  try {
    parsed = parse(text)
  } catch (error) {
    if (error instanceof TomlError) {
      throw new Error(`TOML 解析失败：${error.message}`)
    }
    throw error instanceof Error ? error : new Error(String(error))
  }

  if (!isRecord(parsed)) {
    throw new Error('TOML 顶层结构不合法')
  }

  const metadataRaw = parsed.metadata
  const modelsRaw = parsed.models

  if (!isRecord(metadataRaw)) {
    throw new Error('TOML 缺少 metadata')
  }
  if (!isRecord(modelsRaw)) {
    throw new Error('TOML 缺少 models')
  }

  const version =
    typeof metadataRaw.version === 'string' ? metadataRaw.version : 'unknown'

  const checksum =
    typeof metadataRaw.checksum === 'string' ? metadataRaw.checksum : undefined

  const models: Record<string, RawModelEntry> = {}
  for (const [key, value] of Object.entries(modelsRaw)) {
    if (isRecord(value)) {
      models[key] = value as unknown as RawModelEntry
    }
  }

  return { metadata: { version, checksum }, models }
}

