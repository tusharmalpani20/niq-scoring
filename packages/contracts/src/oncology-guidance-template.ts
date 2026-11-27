import { z } from "zod";
import workbookDefaults from "./oncology-guidance-defaults.json" with { type: "json" };
import { ruleIdSchema, sourceSchema } from "./rule-definition";

export const nutritionalStatusSchema = z.enum([
  "well_nourished",
  "moderately_nourished",
  "severely_malnourished",
]);

const treatmentGuidanceSchema = z.object({
  // Historical storage key; rows can now target any configured treatment.
  radiotherapy: z.array(z.object({
    id: ruleIdSchema,
    // Older saved versions lack this field and continue to mean radiotherapy.
    treatmentTypeId: ruleIdSchema.optional(),
    nutritionalStatus: nutritionalStatusSchema,
    guidance: z.string().trim().min(1).max(12000),
    enabled: z.boolean(),
    source: sourceSchema,
  }).strict()).max(20),
}).strict();

// Pinned definitions may still contain the retired rows. Ignore that field
// when reading them or saving a new draft, while checking the rest strictly.
export const oncologyGuidanceSchema = z.preprocess(value => {
  if (typeof value !== "object" || value === null || Array.isArray(value) || !("statusModifiers" in value)) return value;
  const { statusModifiers: _retired, ...guidance } = value;
  return guidance;
}, treatmentGuidanceSchema);

export type OncologyGuidance = z.infer<typeof oncologyGuidanceSchema>;
export type NutritionalStatus = z.infer<typeof nutritionalStatusSchema>;

// Transcribed from Sheet1 rows 2, 4 and 6 in Oncology Drug Class & Nutrition Guide (NIQ).ods.
const defaults: OncologyGuidance = oncologyGuidanceSchema.parse(workbookDefaults);

/** Return independent editable guidance for a new rule version. */
export function initialOncologyGuidance(): OncologyGuidance {
  return structuredClone(defaults);
}
