import { z } from "zod";
import { ruleIdSchema, sourceSchema } from "./rule-definition";

export const nutritionalStatusSchema = z.enum([
  "well_nourished",
  "moderately_nourished",
  "severely_malnourished",
]);
export type NutritionalStatus = z.infer<typeof nutritionalStatusSchema>;

export const productStageSchema = z.enum([
  "pre_conditioning",
  "during_treatment",
  "post_treatment",
  "surgical",
]);
export type ProductStage = z.infer<typeof productStageSchema>;

export const productNoteKindSchema = z.enum([
  "pancreatic_nourish_exclusion",
  "liver_nourish_once_daily",
  "surgery_done_liss",
  "surgery_planned_liss",
  "vegetarian_liss_substitution",
]);

const editableText = z.string().trim().min(1).max(12000);

/** Workbook-derived plans and guidance are versioned and editable with a rule. */
export const productGuidanceSchema = z.object({
  plans: z.array(z.object({
    id: ruleIdSchema,
    stage: productStageSchema,
    nutritionalStatus: nutritionalStatusSchema,
    products: editableText,
    dose: editableText,
    duration: editableText,
    enabled: z.boolean(),
    source: sourceSchema,
  }).strict()).max(100),
  comorbidities: z.array(z.object({
    id: ruleIdSchema,
    conditionId: ruleIdSchema,
    label: z.string().trim().min(1).max(200),
    guidance: editableText,
    // Exact source text stays available for audit. Only guidance is report-ready.
    sourceText: editableText,
    enabled: z.boolean(),
    source: sourceSchema,
  }).strict()).max(100),
  notes: z.array(z.object({
    id: ruleIdSchema,
    kind: productNoteKindSchema,
    label: z.string().trim().min(1).max(200),
    guidance: editableText,
    sourceText: editableText,
    enabled: z.boolean(),
    source: sourceSchema,
  }).strict()).max(100),
}).strict();

export type ProductGuidance = z.infer<typeof productGuidanceSchema>;
