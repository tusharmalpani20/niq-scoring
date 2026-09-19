import { DEFAULT_FACE_SCAN_SCORING_CONFIG, FACE_SCAN_SCORING_VERSION, faceScanScoringConfigSchema, faceScanScoringInputSchema, type FaceScanScoringConfig, type FaceScanScoringResult } from "@niq-scoring/contracts/face-scan-scoring";

/** Receives trusted normalized provider data and the selected rule version's configuration. */
export function calculateFaceScanScore(
  input: unknown,
  config: FaceScanScoringConfig = DEFAULT_FACE_SCAN_SCORING_CONFIG,
  ruleVersionId?: string,
): FaceScanScoringResult {
  const configuration = faceScanScoringConfigSchema.parse(config);
  const { wellnessScore } = faceScanScoringInputSchema.parse(input);
  // A custom mapping must not claim the original fixed mapping's identifier.
  const usesOriginalMapping = (Object.keys(DEFAULT_FACE_SCAN_SCORING_CONFIG) as Array<keyof FaceScanScoringConfig>)
    .every(key => configuration[key] === DEFAULT_FACE_SCAN_SCORING_CONFIG[key]);
  const evidence = { scoringVersion: usesOriginalMapping ? FACE_SCAN_SCORING_VERSION : null, ruleVersionId: ruleVersionId ?? null, configuration };
  if (wellnessScore === null || wellnessScore === undefined) {
    return { ...evidence, status: "UNAVAILABLE", wellnessScore: null, points: null };
  }
  return {
    ...evidence,
    status: "SCORED",
    wellnessScore,
    points: wellnessScore < configuration.lowerThreshold ? configuration.belowPoints
      : wellnessScore <= configuration.upperThreshold ? configuration.middlePoints : configuration.abovePoints,
  };
}
