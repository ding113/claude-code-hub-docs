export type PricesBaseMetadata = {
  version: string
  checksum?: string
}

export type RawModelEntry = {
  litellm_provider?: string
  mode?: string
  max_input_tokens?: number
  max_output_tokens?: number
  max_tokens?: number
  deprecation_date?: string
  source?: string
  metadata?: Record<string, unknown>
  supported_endpoints?: string[]
  supported_regions?: string[]
  supported_resolutions?: string[]
  supported_modalities?: string[]
  supported_output_modalities?: string[]
  [key: string]: unknown
}

export type PricesBaseToml = {
  metadata: PricesBaseMetadata
  models: Record<string, RawModelEntry>
}

export type NumberRange = {
  min: number
  max: number
}

export type ModelVariant = {
  modelKey: string
  displayName: string
  provider: string
  region?: string
  mode: string
  abilities: string[]
  raw: RawModelEntry
  tokenPrice?: {
    inputPerMTokens?: number
    outputPerMTokens?: number
  }
  imagePrice?: {
    outputPerImage?: number
  }
  pixelPrice?: {
    inputPerMPixels?: number
    outputPerMPixels?: number
  }
  characterPrice?: {
    inputPerMChars?: number
    outputPerMChars?: number
  }
}

export type ProviderSummary = {
  provider: string
  label: string
  variantCount: number
  modelKeys: string[]
  tokenInput?: NumberRange
  tokenOutput?: NumberRange
  imageOutput?: NumberRange
}

export type AggregatedModel = {
  id: string
  displayName: string
  mode: string
  providers: ProviderSummary[]
  abilities: string[]
  maxInputTokens?: number
  maxOutputTokens?: number
  maxTokens?: number
  variants: ModelVariant[]
  tokenInput?: NumberRange
  tokenOutput?: NumberRange
  imageOutput?: NumberRange
}

