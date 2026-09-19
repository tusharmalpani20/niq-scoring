import { z } from "zod";

/** Identifier for the original client-confirmed mapping. */
export const FACE_SCAN_SCORING_VERSION = "NIQ_FACE_SCAN_2026_09" as const;
export const faceScanScoringConfigSchema = z.object({
  lowerThreshold: z.number().finite().min(0).max(100),
  upperThreshold: z.number().finite().min(0).max(100),
  belowPoints: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER),
  middlePoints: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER),
  abovePoints: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER),
}).strict().refine(config => config.lowerThreshold < config.upperThreshold, {
  message: "The second threshold must be greater than the first.", path: ["upperThreshold"],
});
export type FaceScanScoringConfig = z.infer<typeof faceScanScoringConfigSchema>;
export const DEFAULT_FACE_SCAN_SCORING_CONFIG: Readonly<FaceScanScoringConfig> = Object.freeze({
  lowerThreshold: 70, upperThreshold: 80, belowPoints: 3, middlePoints: 2, abovePoints: 1,
});

export const faceScanScoringInputSchema = z.object({
  wellnessScore: z.number().finite().min(0).max(100).nullable().optional(),
}).strict();

export const FACE_SCAN_SCORE_RANGES = [
  { label: "Below 70%", points: 3 },
  { label: "70–80%", points: 2 },
  { label: "Above 80%", points: 1 },
] as const;

export type FaceScanScoringResult = {
  scoringVersion: typeof FACE_SCAN_SCORING_VERSION | null;
  ruleVersionId: string | null;
  configuration: FaceScanScoringConfig;
  status: "SCORED" | "UNAVAILABLE";
  wellnessScore: number | null;
  points: number | null;
};
