import { z } from "zod";
import { answerValueSchema, answersSchema, optionSchema, rangeSchema, ruleIdSchema, sourceSchema } from "./rule-definition";

export const FINAL_ASSESSMENT_PROFILE = "NIQ_FINAL_ASSESSMENT" as const;
export const FINAL_ASSESSMENT_FORMAT_VERSION = 2 as const;
export const FINAL_ASSESSMENT_PROVISIONAL_STATUS = "DEVELOPMENT_PLACEHOLDER" as const;

const label = z.string().trim().min(1).max(200);
const finiteNonNegative = z.number().finite().nonnegative();
const scoreMappingSchema = z.object({ optionId: ruleIdSchema, points: finiteNonNegative }).strict();
const sourceList = z.array(sourceSchema).max(30).default([]);

export const finalAssessmentOptionSchema = optionSchema;

const commonField = {
  id: ruleIdSchema,
  label,
  help: z.string().max(4000).default(""),
  unit: z.string().max(40).default(""),
  sources: sourceList,
};

const optionsScoringSchema = z.object({
  kind: z.literal("options"),
  aggregation: z.literal("sum"),
  points: z.array(scoreMappingSchema).max(200),
}).strict();

const conditionalPathSchema = z.object({
  id: ruleIdSchema,
  label,
  points: finiteNonNegative,
  children: z.array(z.object({ id: ruleIdSchema, label, points: finiteNonNegative }).strict()).max(20),
}).strict();

const conditionalScoringSchema = z.object({
  kind: z.literal("conditional"),
  normalPoints: z.array(scoreMappingSchema).max(20),
  palliative: z.object({
    optionId: z.literal("treatment_status_palliative_care"),
    paths: z.array(conditionalPathSchema).max(10),
  }).strict(),
}).strict();

const countScoringSchema = z.object({
  kind: z.literal("count"),
  pointsPerCount: finiteNonNegative,
}).strict();

const rangeScoringSchema = z.object({
  kind: z.literal("ranges"),
  bands: z.array(rangeSchema.extend({ id: ruleIdSchema, points: finiteNonNegative })).max(20),
}).strict();

const derivedScoringSchema = z.object({
  kind: z.literal("derived"),
  outcomes: z.array(z.object({ id: ruleIdSchema, label, points: finiteNonNegative }).strict()).min(1).max(10),
  mapping: z.array(z.object({ inputOptionId: ruleIdSchema, outcomeId: ruleIdSchema }).strict()).max(20),
}).strict();

const selectFieldSchema = z.object({ ...commonField, kind: z.literal("select"), options: z.array(finalAssessmentOptionSchema).min(1).max(50), scoring: optionsScoringSchema }).strict();
const multiSelectFieldSchema = z.object({ ...commonField, kind: z.literal("multi_select"), options: z.array(finalAssessmentOptionSchema).min(1).max(200), scoring: optionsScoringSchema }).strict();
const yesNoFieldSchema = z.object({ ...commonField, kind: z.literal("yes_no"), options: z.array(finalAssessmentOptionSchema).length(2), scoring: optionsScoringSchema }).strict();
const conditionalFieldSchema = z.object({ ...commonField, kind: z.literal("conditional"), options: z.array(finalAssessmentOptionSchema).min(1).max(20), scoring: conditionalScoringSchema }).strict();
const countFieldSchema = z.object({ ...commonField, kind: z.literal("count"), options: z.array(finalAssessmentOptionSchema).length(2), countInputId: z.literal("previous_surgery_count"), scoring: countScoringSchema }).strict();
const calculatedFieldSchema = z.object({ ...commonField, kind: z.literal("calculated"), inputIds: z.tuple([z.literal("previous_weight_kg"), z.literal("current_weight_kg")]), formula: z.literal("(previousWeightKg - currentWeightKg) / previousWeightKg * 100"), scoring: rangeScoringSchema }).strict();
const derivedFieldSchema = z.object({ ...commonField, kind: z.literal("derived"), sourceInputId: z.literal("dietary_intake"), scoring: derivedScoringSchema }).strict();

export const finalAssessmentFieldSchema = z.discriminatedUnion("kind", [
  selectFieldSchema,
  multiSelectFieldSchema,
  yesNoFieldSchema,
  conditionalFieldSchema,
  countFieldSchema,
  calculatedFieldSchema,
  derivedFieldSchema,
]);

export const finalAssessmentSupportingInputSchema = z.discriminatedUnion("id", [
  z.object({ id: z.literal("palliative_status"), label, kind: z.literal("select"), options: z.array(finalAssessmentOptionSchema).length(2), required: z.literal(false), sources: sourceList }).strict(),
  z.object({ id: z.literal("palliative_timing"), label, kind: z.literal("select"), options: z.array(finalAssessmentOptionSchema).length(3), required: z.literal(false), sources: sourceList }).strict(),
  z.object({ id: z.literal("previous_surgery_count"), label, kind: z.literal("number"), unit: z.literal("surgeries"), required: z.literal(false), sources: sourceList }).strict(),
  z.object({ id: z.literal("previous_weight_kg"), label, kind: z.literal("number"), unit: z.literal("kg"), required: z.literal(false), sources: sourceList }).strict(),
  z.object({ id: z.literal("current_weight_kg"), label, kind: z.literal("number"), unit: z.literal("kg"), required: z.literal(false), sources: sourceList }).strict(),
  z.object({ id: z.literal("dietary_intake"), label, kind: z.literal("select"), options: z.array(finalAssessmentOptionSchema).length(6), required: z.literal(false), sources: sourceList }).strict(),
]);

export const finalAssessmentSectionSchema = z.object({
  id: ruleIdSchema,
  title: label,
  description: z.string().max(2000),
  accent: z.enum(["orange", "green", "grey", "purple", "beige"]),
  fields: z.array(finalAssessmentFieldSchema).min(1).max(20),
}).strict();

export const finalRiskCategorySchema = rangeSchema.extend({
  id: ruleIdSchema,
  label,
  interpretation: z.string().max(4000),
  sources: sourceList,
}).strict();

export const finalAssessmentSampleSchema = z.object({
  id: ruleIdSchema,
  name: label,
  answers: answersSchema,
  expected: z.object({
    complete: z.boolean(),
    score: finiteNonNegative.nullable(),
    classificationId: ruleIdSchema.nullable().optional(),
  }).strict(),
}).strict();

export const finalAssessmentDefinitionSchema = z.object({
  formatVersion: z.literal(FINAL_ASSESSMENT_FORMAT_VERSION),
  profile: z.literal(FINAL_ASSESSMENT_PROFILE),
  name: label,
  description: z.string().max(5000),
  sections: z.array(finalAssessmentSectionSchema).length(5),
  supportingInputs: z.array(finalAssessmentSupportingInputSchema).length(6),
  riskCategories: z.array(finalRiskCategorySchema).min(1).max(20),
  provisional: z.union([z.object({
    status: z.literal(FINAL_ASSESSMENT_PROVISIONAL_STATUS),
    clinicalUsePermitted: z.literal(false),
    notice: label,
  }).strict(), z.object({ status: z.literal("CLIENT_CONFIRMED"), clinicalUsePermitted: z.literal(true), notice: label }).strict()]),
  interventions: z.object({ status: z.literal("NOT_APPLICABLE"), note: label }).strict(),
  samples: z.array(finalAssessmentSampleSchema).max(100),
}).strict();

export type FinalAssessmentDefinition = z.infer<typeof finalAssessmentDefinitionSchema>;
export type FinalAssessmentSection = FinalAssessmentDefinition["sections"][number];
export type FinalAssessmentField = FinalAssessmentSection["fields"][number];
export type FinalAssessmentOption = z.infer<typeof finalAssessmentOptionSchema>;
export type FinalAssessmentSupportingInput = FinalAssessmentDefinition["supportingInputs"][number];
export type FinalAssessmentAnswers = z.infer<typeof answersSchema>;
export type FinalAssessmentAnswerValue = z.infer<typeof answerValueSchema>;
export type FinalAssessmentRiskCategory = FinalAssessmentDefinition["riskCategories"][number];
