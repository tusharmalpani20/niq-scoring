import { z } from "zod";

/** Identifier for the original client-confirmed mapping. */
export const FACE_SCAN_SCORING_VERSION = "NIQ_FACE_SCAN_2026_09" as const;
const percent = z.number().finite().min(0).max(100);
const points = z.number().int().min(0).max(Number.MAX_SAFE_INTEGER);
const legacyFaceScanScoringConfigSchema = z.object({
  lowerThreshold: percent,
  upperThreshold: percent,
  belowPoints: points,
  middlePoints: points,
  abovePoints: points,
}).strict().refine(config => config.lowerThreshold < config.upperThreshold, {
  message: "The second threshold must be greater than the first.", path: ["upperThreshold"],
});

export const faceScanRangeConfigSchema = z.object({
  ranges: z.array(z.object({
    id: z.string().trim().min(1).max(100),
    min: percent,
    max: percent,
    minInclusive: z.boolean(),
    maxInclusive: z.boolean(),
    points,
  }).strict()).min(1).max(20),
}).strict().superRefine((config, context) => {
  const fail = (index: number, field: string, message: string) => context.addIssue({ code: z.ZodIssueCode.custom, path: ["ranges", index, field], message });
  const ids = new Set<string>();
  const sorted = config.ranges.map((range, index) => ({ ...range, index })).sort((a, b) => a.min - b.min || a.max - b.max);
  for (const range of sorted) {
    if (ids.has(range.id)) fail(range.index, "id", "Range identifiers must be unique.");
    ids.add(range.id);
    if (range.min > range.max || (range.min === range.max && !(range.minInclusive && range.maxInclusive))) {
      fail(range.index, "max", "The range must contain at least one score.");
    }
  }
  const first = sorted[0];
  const last = sorted.at(-1);
  if (first && (first.min !== 0 || !first.minInclusive)) fail(first.index, "min", "Ranges must include 0%.");
  if (last && (last.max !== 100 || !last.maxInclusive)) fail(last.index, "max", "Ranges must include 100%.");
  for (let index = 1; index < sorted.length; index++) {
    const previous = sorted[index - 1]!;
    const current = sorted[index]!;
    if (previous.max !== current.min) {
      fail(current.index, "min", previous.max < current.min ? "There is a gap between ranges." : "Ranges must not overlap.");
    } else if (previous.maxInclusive === current.minInclusive) {
      fail(current.index, "minInclusive", previous.maxInclusive ? "The shared score belongs to both ranges." : "The shared score must belong to one range.");
    }
  }
});
export type FaceScanRangeConfig = z.infer<typeof faceScanRangeConfigSchema>;
export const faceScanScoringConfigSchema = z.union([faceScanRangeConfigSchema, legacyFaceScanScoringConfigSchema]);
export type FaceScanScoringConfig = z.infer<typeof faceScanScoringConfigSchema>;
export const DEFAULT_FACE_SCAN_SCORING_CONFIG: FaceScanRangeConfig = {
  ranges: [
    { id: "below", min: 0, max: 70, minInclusive: true, maxInclusive: false, points: 3 },
    { id: "middle", min: 70, max: 80, minInclusive: true, maxInclusive: true, points: 2 },
    { id: "above", min: 80, max: 100, minInclusive: false, maxInclusive: true, points: 1 },
  ],
};

/** Return a detached normalized view; never rewrite historical persisted definitions. */
export function normalizeFaceScanScoringConfig(config: FaceScanScoringConfig): FaceScanRangeConfig {
  if ("ranges" in config) return structuredClone(config);
  const ranges: FaceScanRangeConfig["ranges"] = [];
  // Legacy endpoint thresholds can make an outer range empty; omit those ranges.
  if (config.lowerThreshold > 0) ranges.push({ id: "below", min: 0, max: config.lowerThreshold, minInclusive: true, maxInclusive: false, points: config.belowPoints });
  ranges.push({ id: "middle", min: config.lowerThreshold, max: config.upperThreshold, minInclusive: true, maxInclusive: true, points: config.middlePoints });
  if (config.upperThreshold < 100) ranges.push({ id: "above", min: config.upperThreshold, max: 100, minInclusive: false, maxInclusive: true, points: config.abovePoints });
  return { ranges };
}

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
  configuration: FaceScanRangeConfig;
  status: "SCORED" | "UNAVAILABLE";
  wellnessScore: number | null;
  points: number | null;
};
