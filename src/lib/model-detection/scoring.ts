import type {
  DetectionFamilyRanking,
  ModelProbeFamily,
  ProbeObservation,
} from '@/lib/model-detection/types'

export function summarizeDetectionFamilies(
  families: ModelProbeFamily[],
  observations: ProbeObservation[],
): DetectionFamilyRanking[] {
  return families
    .map((family) => {
      const familyObservations = observations.filter(
        (observation) => observation.familyId === family.id,
      )

      const tested = familyObservations.filter(
        (observation) => observation.repeatedExactly !== null,
      ).length

      const hits = familyObservations.filter(
        (observation) => observation.repeatedExactly === false,
      ).length

      const probability = tested > 0 ? hits / tested : 0

      return {
        familyId: family.id,
        familyLabel: family.label,
        hits,
        tested,
        total: family.probes.length,
        probability,
      }
    })
    .filter((family) => family.probability > 0)
    .sort((left, right) => {
      if (right.probability !== left.probability) {
        return right.probability - left.probability
      }

      if (right.hits !== left.hits) {
        return right.hits - left.hits
      }

      return left.familyLabel.localeCompare(right.familyLabel, 'zh-CN')
    })
}
