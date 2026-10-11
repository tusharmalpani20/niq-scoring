import { expect, test } from "bun:test";
import { createFinalAssessmentTemplate } from "./final-assessment-template";
import { DEFAULT_STRESS_SCORING_CONFIG, stressScoringConfigSchema } from "./stress-scoring";

test("new rules include editable CarePlix stress bands separate from wellness scoring", () => {
  const rule = createFinalAssessmentTemplate("New rule");
  expect(rule.stressScoring).toEqual(DEFAULT_STRESS_SCORING_CONFIG);
  expect(rule.faceScanScoring).toBeDefined();
  expect(stressScoringConfigSchema.safeParse({ ...DEFAULT_STRESS_SCORING_CONFIG,
    cutoffs: { ...DEFAULT_STRESS_SCORING_CONFIG.cutoffs, average: 1 },
  }).success).toBe(false);
});
