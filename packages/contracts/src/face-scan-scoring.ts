import { z } from "zod";

/** Client-confirmed face-scan points; independent of assessment rule versions. */
export const FACE_SCAN_SCORING_VERSION = "NIQ_FACE_SCAN_2026_09" as const;
export const faceScanScoringInputSchema = z.object({
  wellnessScore: z.number().finite().min(0).max(100).nullable().optional(),
}).strict();

export const FACE_SCAN_SCORE_RANGES = [
  { label: "Below 70%", points: 3 },
  { label: "70–80%", points: 2 },
  { label: "Above 80%", points: 1 },
] as const;

export type FaceScanScoringResult = {
  scoringVersion: typeof FACE_SCAN_SCORING_VERSION;
  status: "SCORED" | "UNAVAILABLE";
  wellnessScore: number | null;
  points: 1 | 2 | 3 | null;
};
