import { DEFAULT_FACE_SCAN_SCORING_CONFIG, FACE_SCAN_SCORING_VERSION, faceScanScoringConfigSchema, faceScanScoringInputSchema, normalizeFaceScanScoringConfig, type FaceScanScoringConfig, type FaceScanScoringResult } from "@niq-scoring/contracts/face-scan-scoring";

/** Receives trusted normalized provider data and the selected rule version's configuration. */
export function calculateFaceScanScore(
  input: unknown,
  config: FaceScanScoringConfig = DEFAULT_FACE_SCAN_SCORING_CONFIG,
  ruleVersionId?: string,
): FaceScanScoringResult {
  const configuration = normalizeFaceScanScoringConfig(faceScanScoringConfigSchema.parse(config));
  const { wellnessScore } = faceScanScoringInputSchema.parse(input);
  // A custom mapping must not claim the original fixed mapping's identifier.
  const canonical = (value: typeof configuration) => JSON.stringify(value.ranges
    .map(({ id: _id, label: _label, ...range }) => range).sort((a, b) => a.min - b.min || a.max - b.max));
  const usesOriginalMapping = canonical(configuration) === canonical(DEFAULT_FACE_SCAN_SCORING_CONFIG);
  const evidence = { scoringVersion: usesOriginalMapping ? FACE_SCAN_SCORING_VERSION : null, ruleVersionId: ruleVersionId ?? null, configuration };
  if (wellnessScore === null || wellnessScore === undefined) {
    return { ...evidence, status: "UNAVAILABLE", wellnessScore: null, points: null };
  }
  return {
    ...evidence,
    status: "SCORED",
    wellnessScore,
    points: configuration.ranges.find(range =>
      (wellnessScore > range.min || (range.minInclusive && wellnessScore === range.min)) &&
      (wellnessScore < range.max || (range.maxInclusive && wellnessScore === range.max)))!.points,
  };
}
