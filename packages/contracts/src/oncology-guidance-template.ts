import { z } from "zod";
import workbookDefaults from "./oncology-guidance-defaults.json";
import { ruleIdSchema, sourceSchema } from "./rule-definition";

export const nutritionalStatusSchema = z.enum([
  "well_nourished",
  "moderately_nourished",
  "severely_malnourished",
]);

export const oncologyGuidanceSchema = z.object({
  statusModifiers: z.array(z.object({
    id: ruleIdSchema,
    classId: ruleIdSchema,
    treatmentTypeId: ruleIdSchema,
    nutritionalStatus: nutritionalStatusSchema,
    // General class and nutrition-status context, not a patient diagnosis.
    riskEmphasis: z.string().trim().min(1).max(2000),
    actions: z.string().trim().min(1).max(12000),
    enabled: z.boolean(),
    source: sourceSchema,
  }).strict()).max(200),
  radiotherapy: z.array(z.object({
    id: ruleIdSchema,
    nutritionalStatus: nutritionalStatusSchema,
    guidance: z.string().trim().min(1).max(12000),
    enabled: z.boolean(),
    source: sourceSchema,
  }).strict()).max(20),
}).strict();

export type OncologyGuidance = z.infer<typeof oncologyGuidanceSchema>;
export type NutritionalStatus = z.infer<typeof nutritionalStatusSchema>;

// Transcribed from Status_modifier rows 2–49 and Sheet1 rows 2, 4 and 6 in
// Oncology Drug Class & Nutrition Guide (NIQ).ods. Source status spelling is
// normalized. Named-drug, drug–food timing and product-dosage clauses are
// omitted from report-ready actions because assessments select classes only.
const defaults: OncologyGuidance = oncologyGuidanceSchema.parse(workbookDefaults);

/** Return independent editable guidance for a new rule version. */
export function initialOncologyGuidance(): OncologyGuidance {
  return structuredClone(defaults);
}
