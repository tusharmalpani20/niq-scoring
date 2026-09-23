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
    label: z.string().trim().max(80).optional(),
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
  // Coverage follows the furthest endpoint, not the final row sorted by its start.
  // A nested overlap can otherwise falsely report that 100% is missing.
  const valid = sorted.filter(range => range.min < range.max || range.min === range.max && range.minInclusive && range.maxInclusive);
  if (valid.length !== sorted.length) return;
  const first = valid[0];
  if (!first) return;
  if (!valid.some(range => range.min === 0 && range.minInclusive)) fail(first.index, "min", "Include 0 in a range so every health score can be scored.");
  const furthest = valid.reduce((a, b) => b.max > a.max || b.max === a.max && b.maxInclusive ? b : a);
  if (!valid.some(range => range.max === 100 && range.maxInclusive)) fail(furthest.index, "max", "Extend a range to include 100 so every health score can be scored.");
  for (let i = 0; i < valid.length; i++) {
    const a = valid[i]!;
    for (const b of valid.slice(i + 1)) {
      const from = Math.max(a.min, b.min);
      const to = Math.min(a.max, b.max);
      const contains = (r: typeof a, value: number) => (value > r.min || value === r.min && r.minInclusive) && (value < r.max || value === r.max && r.maxInclusive);
      if (from < to || from === to && contains(a, from) && contains(b, from)) {
        const rows = [a.index + 1, b.index + 1].sort((x, y) => x - y);
        fail(b.index, "min", from === to
          ? `Rows ${rows[0]} and ${rows[1]} both include score ${from}. In Edit score boundaries, include this value in only one row.`
          : `Rows ${rows[0]} and ${rows[1]} overlap between scores ${from} and ${to}. Adjust their From or To values so each score belongs to only one row.`);
      }
    }
  }
  let covered = first;
  for (const current of valid.slice(1)) {
    if (current.min > covered.max) fail(current.index, "min", `There is a gap between scores ${covered.max} and ${current.min}. Make row ${covered.index + 1}'s To value meet row ${current.index + 1}'s From value.`);
    else if (current.min === covered.max && !covered.maxInclusive && !current.minInclusive) fail(current.index, "minInclusive", `Score ${current.min} is not included in any row. In Edit score boundaries, include it in row ${covered.index + 1} or row ${current.index + 1}.`);
    if (current.max > covered.max || current.max === covered.max && current.maxInclusive) covered = current;
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
