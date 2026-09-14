import { z } from "zod";

export const ruleIdSchema = z.string().regex(/^[a-z][a-z0-9_]{0,79}$/, "Use a stable lowercase identifier.");
const label = z.string().trim().min(1).max(200);
const finite = z.number().finite();
export const sourceSchema = z.object({ document: label, location: z.string().trim().min(1).max(300), note: z.string().max(2000).default("") }).strict();
export const referenceSchema = z.object({ kind: z.enum(["question", "calculation", "domain", "total", "classification"]), id: ruleIdSchema }).strict();
export const scalarSchema = z.union([z.string().max(5000), finite, z.boolean()]);
export const conditionSchema = z.object({
  match: z.enum(["all", "any"]),
  tests: z.array(z.object({
    ref: referenceSchema,
    operator: z.enum(["eq", "neq", "gt", "gte", "lt", "lte", "includes", "answered", "unanswered"]),
    value: scalarSchema.optional(),
  }).strict()).min(1).max(50),
}).strict();
export const rangeSchema = z.object({
  min: finite.nullable(), max: finite.nullable(), minInclusive: z.boolean(), maxInclusive: z.boolean(),
}).strict();
export const optionSchema = z.object({ id: ruleIdSchema, label, help: z.string().max(2000).default("") }).strict();
export const questionSchema = z.object({
  id: ruleIdSchema, label,
  type: z.enum(["text", "long_text", "number", "date", "boolean", "single_select", "multi_select"]),
  purpose: z.enum(["assessment", "scoring", "clinician"]),
  help: z.string().max(4000).default(""), unit: z.string().max(40).default(""), required: z.boolean(),
  options: z.array(optionSchema).max(200).default([]),
  validation: z.object({ min: finite.optional(), max: finite.optional(), integer: z.boolean().optional(), maxLength: z.number().int().min(1).max(20000).optional(), minDate: z.iso.date().optional(), maxDate: z.iso.date().optional() }).strict().default({}),
  visibleWhen: conditionSchema.nullable().default(null),
  sources: z.array(sourceSchema).max(30).default([]),
}).strict();
export const calculationSchema = z.object({
  id: ruleIdSchema, label, unit: z.string().max(40).default(""),
  operation: z.enum(["sum", "subtract", "multiply", "divide", "bmi", "percentage_change"]),
  operands: z.array(z.discriminatedUnion("kind", [
    z.object({ kind: z.literal("constant"), value: finite }).strict(),
    z.object({ kind: z.enum(["question", "calculation"]), id: ruleIdSchema }).strict(),
  ])).min(1).max(30),
  precision: z.number().int().min(0).max(6),
  sources: z.array(sourceSchema).max(30).default([]),
}).strict();
const scoringBase = { id: ruleIdSchema, label, domainId: ruleIdSchema, sources: z.array(sourceSchema).max(30).default([]) };
export const scoringRuleSchema = z.discriminatedUnion("kind", [
  z.object({ ...scoringBase, kind: z.literal("options"), questionId: ruleIdSchema, points: z.array(z.object({ optionId: ruleIdSchema, points: finite }).strict()).max(200), aggregation: z.enum(["sum", "max"]), cap: finite.nonnegative().nullable() }).strict(),
  z.object({ ...scoringBase, kind: z.literal("ranges"), input: z.object({ kind: z.enum(["question", "calculation"]), id: ruleIdSchema }).strict(), bands: z.array(rangeSchema.extend({ id: ruleIdSchema, points: finite })).min(1).max(100) }).strict(),
  z.object({ ...scoringBase, kind: z.literal("condition"), when: conditionSchema, points: finite, otherwise: finite }).strict(),
]);
export const answerValueSchema = z.union([scalarSchema, z.array(z.string().max(80)).max(200), z.null()]);
export const answersSchema = z.record(ruleIdSchema, answerValueSchema).refine(value => Object.keys(value).length <= 500, "Too many answers.");
export const ruleDefinitionSchema = z.object({
  formatVersion: z.literal(1),
  name: label, description: z.string().max(5000),
  sections: z.array(z.object({ id: ruleIdSchema, title: label, description: z.string().max(2000), questions: z.array(questionSchema).max(200) }).strict()).max(50),
  calculations: z.array(calculationSchema).max(200),
  domains: z.array(z.object({ id: ruleIdSchema, label, cap: finite.nonnegative().nullable(), sources: z.array(sourceSchema).max(30).default([]) }).strict()).max(50),
  scoring: z.array(scoringRuleSchema).max(500),
  total: z.object({ aggregation: z.enum(["sum", "max"]), cap: finite.nonnegative().nullable(), precision: z.number().int().min(0).max(6) }).strict(),
  classifications: z.array(rangeSchema.extend({ id: ruleIdSchema, label, interpretation: z.string().max(4000), sources: z.array(sourceSchema).max(30).default([]) })).max(100),
  interventions: z.array(z.object({
    id: ruleIdSchema, label, kind: z.enum(["goal", "recommendation", "care_tier", "monitoring", "note"]),
    when: conditionSchema, text: z.string().trim().min(1).max(5000),
    priority: z.number().int().min(0).max(10000), exclusiveGroup: ruleIdSchema.nullable(),
    sources: z.array(sourceSchema).max(30).default([]),
  }).strict()).max(300),
  issues: z.array(z.object({ id: ruleIdSchema, path: z.string().max(300), message: z.string().trim().min(1).max(4000), blocking: z.boolean(), resolved: z.boolean(), resolution: z.string().max(4000), sources: z.array(sourceSchema).max(30).default([]) }).strict()).max(300),
  samples: z.array(z.object({
    id: ruleIdSchema, name: label, answers: answersSchema,
    expected: z.object({ complete: z.boolean(), score: finite.nullable(), classificationId: ruleIdSchema.nullable(), interventionIds: z.array(ruleIdSchema).max(300), domains: z.record(ruleIdSchema, finite).default({}), calculations: z.record(ruleIdSchema, finite).default({}) }).strict(),
  }).strict()).max(100),
}).strict();
export type RuleDefinition = z.infer<typeof ruleDefinitionSchema>;
export type RuleQuestion = z.infer<typeof questionSchema>;
export type RuleCondition = z.infer<typeof conditionSchema>;
export type RuleReference = z.infer<typeof referenceSchema>;
export type RuleRange = z.infer<typeof rangeSchema>;
export type RuleAnswers = z.infer<typeof answersSchema>;
export type DefinitionIssue = { path: string; code: string; message: string; severity: "error" | "blocking" };
export function blankRuleDefinition(name: string): RuleDefinition {
  return { formatVersion: 1, name, description: "", sections: [], calculations: [], domains: [], scoring: [], total: { aggregation: "sum", cap: null, precision: 0 }, classifications: [], interventions: [], issues: [], samples: [] };
}
