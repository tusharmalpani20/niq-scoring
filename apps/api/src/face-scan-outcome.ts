import type { FaceScanResult } from "@niq-scoring/contracts/face-scan-session";
import type { calculateFaceScanScore } from "@niq-scoring/scoring-engine/face-scan-scoring";

export class FaceScanError extends Error { constructor(public code: string, public status: 400 | 403 | 404 | 408 | 409 | 413 | 503 = 409) { super(code); } }
// Keep the pinned scoring bands in the durable record, but expose only the outcome to consumers.
export function publicFaceScanScore(score: ReturnType<typeof calculateFaceScanScore> | null) {
 if (!score) return null;
 return { status: score.status, points: score.points, ruleVersionId: score.ruleVersionId,
   wellnessScore: score.wellnessScore, wellnessPoints: score.wellnessPoints ?? null,
   stressIndex: score.stressIndex ?? null, stressBand: score.stressBand ?? null,
   stressPoints: score.stressPoints ?? null, scoringVersion: score.scoringVersion };
}
export function scoringInput(result: FaceScanResult) {
  const value = result.additionalMetrics?.stressIndex;
  const numeric = typeof value === "number" ? value : typeof value === "string" && value.trim() ? Number(value) : null;
  return { wellnessScore: result.wellnessScore,
    stressIndex: numeric !== null && Number.isFinite(numeric) && numeric >= 0 ? numeric : null };
}
