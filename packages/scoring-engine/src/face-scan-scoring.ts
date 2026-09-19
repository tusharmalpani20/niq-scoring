import { FACE_SCAN_SCORING_VERSION, faceScanScoringInputSchema, type FaceScanScoringResult } from "@niq-scoring/contracts/face-scan-scoring";

/** Receives normalized provider data; does not authenticate or start a scan. */
export function calculateFaceScanScore(input: unknown): FaceScanScoringResult {
  const { wellnessScore } = faceScanScoringInputSchema.parse(input);
  if (wellnessScore === null || wellnessScore === undefined) {
    return { scoringVersion: FACE_SCAN_SCORING_VERSION, status: "UNAVAILABLE", wellnessScore: null, points: null };
  }
  return {
    scoringVersion: FACE_SCAN_SCORING_VERSION,
    status: "SCORED",
    wellnessScore,
    points: wellnessScore < 70 ? 3 : wellnessScore <= 80 ? 2 : 1,
  };
}
