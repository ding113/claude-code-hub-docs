export type DetectionEndpointType = 'openai' | 'anthropic' | 'gemini'

export interface ModelProbeFamily {
  id: string
  label: string
  probes: string[]
}

export interface ProbeObservation {
  familyId: string
  probe: string
  repeatedExactly: boolean | null
  rawText?: string
  error?: string
}

export interface DetectionFamilyRanking {
  familyId: string
  familyLabel: string
  hits: number
  tested: number
  total: number
  probability: number
}

export interface DetectionSummary {
  totalFamilies: number
  totalProbes: number
  attemptedProbes: number
  failedProbes: number
}

export interface ModelDetectionInput {
  baseUrl: string
  apiKey: string
  model: string
  endpointType: DetectionEndpointType
}

export interface ModelDetectionResult {
  rankings: DetectionFamilyRanking[]
  summary: DetectionSummary
  observations: ProbeObservation[]
}

export interface RequestCandidate {
  label: string
  url: string
  headers: Record<string, string>
  body: unknown
}

export interface RequestCandidateInput extends ModelDetectionInput {
  probe: string
}
