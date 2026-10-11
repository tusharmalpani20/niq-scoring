import { DEFAULT_FACE_SCAN_SCORING_CONFIG, FACE_SCAN_SCORING_VERSION, faceScanScoringConfigSchema, faceScanScoringInputSchema, normalizeFaceScanScoringConfig, type FaceScanScoringConfig, type FaceScanScoringResult } from "@niq-scoring/contracts/face-scan-scoring";
import { stressBand, stressScoringConfigSchema, type StressScoringConfig } from "@niq-scoring/contracts/stress-scoring";

/** Receives trusted normalized provider data and the selected rule version's configuration. */
export function calculateFaceScanScore(
  input: unknown,
  config: FaceScanScoringConfig = DEFAULT_FACE_SCAN_SCORING_CONFIG,
  ruleVersionId?: string,
  stressConfig?: StressScoringConfig,
): FaceScanScoringResult {
  const configuration = normalizeFaceScanScoringConfig(faceScanScoringConfigSchema.parse(config));
  const stressConfiguration = stressConfig === undefined ? null : stressScoringConfigSchema.parse(stressConfig);
  const { wellnessScore, stressIndex } = faceScanScoringInputSchema.parse(input);
  // A custom mapping must not claim the original fixed mapping's identifier.
  const canonical = (value: typeof configuration) => JSON.stringify(value.ranges
    .map(({ id: _id, label: _label, ...range }) => range).sort((a, b) => a.min - b.min || a.max - b.max));
  const usesOriginalMapping = canonical(configuration) === canonical(DEFAULT_FACE_SCAN_SCORING_CONFIG) && !stressConfiguration;
  const evidence = { scoringVersion: usesOriginalMapping ? FACE_SCAN_SCORING_VERSION : null, ruleVersionId: ruleVersionId ?? null, configuration, stressConfiguration };
  if (wellnessScore === null || wellnessScore === undefined || stressConfiguration && (stressIndex === null || stressIndex === undefined)) {
    return { ...evidence, status: "UNAVAILABLE", wellnessScore: wellnessScore ?? null, wellnessPoints: null,
      stressIndex: stressIndex ?? null, stressBand: null, stressPoints: null, points: null };
  }
  const wellnessPoints = configuration.ranges.find(range =>
    (wellnessScore > range.min || (range.minInclusive && wellnessScore === range.min)) &&
    (wellnessScore < range.max || (range.maxInclusive && wellnessScore === range.max)))!.points;
  const band = stressConfiguration && stressIndex !== null && stressIndex !== undefined ? stressBand(stressIndex, stressConfiguration) : null;
  const stressPoints = band ? stressConfiguration!.points[band] : null;
  return {
    ...evidence,
    status: "SCORED",
    wellnessScore,
    wellnessPoints,
    stressIndex: stressIndex ?? null,
    stressBand: band,
    stressPoints,
    points: wellnessPoints + (stressPoints ?? 0),
  };
}
