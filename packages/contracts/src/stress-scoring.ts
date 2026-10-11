import { z } from "zod";

const points = z.number().int().min(0).max(Number.MAX_SAFE_INTEGER);
const cutoff = z.number().finite().min(0);

/** CarePlix Stress Level (Stress Index), Parameter Reference v2.0, page 8. */
export const stressScoringConfigSchema = z.object({
  cutoffs: z.object({ excellent: cutoff, good: cutoff, average: cutoff, fair: cutoff }).strict(),
  points: z.object({ excellent: points, good: points, average: points, fair: points, poor: points }).strict(),
}).strict().refine(config =>
  config.cutoffs.excellent < config.cutoffs.good &&
  config.cutoffs.good < config.cutoffs.average &&
  config.cutoffs.average < config.cutoffs.fair,
  { path: ["cutoffs"], message: "Stress cutoffs must increase from Excellent through Poor." });

export type StressScoringConfig = z.infer<typeof stressScoringConfigSchema>;
export type StressBand = keyof StressScoringConfig["points"];

// Point defaults are provisional until the client confirms the stress mapping.
export const DEFAULT_STRESS_SCORING_CONFIG: StressScoringConfig = {
  cutoffs: { excellent: 0.5, good: 1.5, average: 5, fair: 9 },
  points: { excellent: 0, good: 0, average: 1, fair: 2, poor: 2 },
};

export function stressBand(index: number, config: StressScoringConfig): StressBand {
  if (index < config.cutoffs.excellent) return "excellent";
  if (index < config.cutoffs.good) return "good";
  if (index < config.cutoffs.average) return "average";
  if (index < config.cutoffs.fair) return "fair";
  return "poor";
}
