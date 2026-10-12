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
  "jain_liss_substitution",
  "custom",
]);
export const productNoteMatchSchema = z.object({
  fieldId: z.enum(["cancer_type", "cancer_surgical_status", "diet_preference"]),
  optionId: ruleIdSchema,
  withinDays: z.number().int().nonnegative().max(3650).optional(),
}).strict();
export type ProductNoteKind = z.infer<typeof productNoteKindSchema>;
export type ProductNoteMatch = z.infer<typeof productNoteMatchSchema>;

/** Matches used by saved rules that predate editable assessment conditions. */
export function defaultProductNoteMatch(kind: ProductNoteKind): ProductNoteMatch {
  switch (kind) {
    case "pancreatic_nourish_exclusion": return { fieldId: "cancer_type", optionId: "cancer_6" };
    case "liver_nourish_once_daily": return { fieldId: "cancer_type", optionId: "cancer_5" };
    case "surgery_done_liss": return { fieldId: "cancer_surgical_status", optionId: "cancer_surgical_status_done", withinDays: 7 };
    case "surgery_planned_liss": return { fieldId: "cancer_surgical_status", optionId: "cancer_surgical_status_planned", withinDays: 7 };
    case "vegetarian_liss_substitution": return { fieldId: "diet_preference", optionId: "vegetarian" };
    case "jain_liss_substitution": return { fieldId: "diet_preference", optionId: "jain" };
    case "custom": throw new Error("Custom product exceptions require an explicit assessment match");
  }
}

const editableText = z.string().trim().min(1).max(12000);
const productNameSchema = z.string().trim().min(1).max(120);
const dailyQuantitySchema = z.number().int().min(1).max(100);
const productDescriptionSchema = z.string().trim().min(1).max(500);

/** The exact product change made when an exception matches an assessment. */
export const productExceptionActionSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("recommend"),
    productName: productNameSchema,
    quantityPerDay: dailyQuantitySchema,
    description: productDescriptionSchema.optional(),
  }).strict(),
  z.object({
    type: z.literal("remove"),
    productName: productNameSchema,
  }).strict(),
  z.object({
    type: z.literal("limit"),
    productName: productNameSchema,
    maxQuantityPerDay: dailyQuantitySchema,
  }).strict(),
  z.object({
    type: z.literal("replace"),
    productName: productNameSchema,
    replacementProductName: productNameSchema,
    /** Copy the replaced product's known daily quantity into the replacement. */
    matchSourceQuantity: z.boolean().optional(),
    replacementQuantityPerDay: dailyQuantitySchema.optional(),
    description: productDescriptionSchema.optional(),
  }).strict().refine(action => !action.matchSourceQuantity || action.replacementQuantityPerDay === undefined, {
    message: "Choose a matching or fixed replacement quantity",
  }),
  z.object({
    type: z.literal("delay"),
    productName: productNameSchema,
    until: z.literal("planned_surgery"),
  }).strict(),
  z.object({
    type: z.literal("use_plan"),
    stage: productStageSchema,
  }).strict(),
]);
export type ProductExceptionAction = z.infer<typeof productExceptionActionSchema>;

/** Report wording is derived from saved action fields, never from a model guess. */
export function productExceptionActionText(action: ProductExceptionAction): string {
  switch (action.type) {
    case "recommend": return `Recommend ${action.productName} at ${action.quantityPerDay} per day${action.description ? ` (${action.description})` : ""}.`;
    case "remove": return `Remove ${action.productName} from the product plan.`;
    case "limit": return `Limit ${action.productName} to at most ${action.maxQuantityPerDay} per day.`;
    case "replace": return `Replace ${action.productName} with ${action.replacementProductName}${action.matchSourceQuantity ? ` at the same daily quantity as ${action.productName}` : action.replacementQuantityPerDay === undefined ? "; replacement daily quantity requires clinician review" : ` at ${action.replacementQuantityPerDay} per day`}${action.description ? ` (${action.description})` : ""}.`;
    case "delay": return `Withhold ${action.productName} until the planned surgery date.`;
    case "use_plan": return `Use the ${action.stage.replaceAll("_", " ")} product plan when it is eligible.`;
  }
}

/** Action equivalents for older exception rows that only saved a fixed kind. */
export function defaultProductExceptionAction(kind: ProductNoteKind): ProductExceptionAction | null {
  switch (kind) {
    case "pancreatic_nourish_exclusion": return { type: "remove", productName: "Nourish" };
    case "liver_nourish_once_daily": return { type: "limit", productName: "Nourish", maxQuantityPerDay: 1 };
    case "surgery_done_liss": return { type: "use_plan", stage: "surgical" };
    case "surgery_planned_liss": return { type: "delay", productName: "Liss WH", until: "planned_surgery" };
    case "vegetarian_liss_substitution":
    case "jain_liss_substitution": return { type: "replace", productName: "Liss WH", replacementProductName: "Invigour", matchSourceQuantity: true };
    case "custom": return null;
  }
}

/** A product's saved quantity and optional dosage/preparation in a plan. */
export const productPlanItemSchema = z.object({
  productName: productNameSchema,
  quantityPerDay: dailyQuantitySchema.optional(),
  /** Preparation or serving detail for this plan, not a shared product attribute. */
  description: productDescriptionSchema.optional(),
}).strict().refine(item => item.quantityPerDay !== undefined || item.description !== undefined, {
  message: "Provide a daily quantity or dosage/preparation description",
});
export type ProductPlanItem = z.infer<typeof productPlanItemSchema>;

/** Workbook-derived plans and guidance are versioned and editable with a rule. */
export const productGuidanceSchema = z.object({
  plans: z.array(z.object({
    id: ruleIdSchema,
    stage: productStageSchema,
    nutritionalStatus: nutritionalStatusSchema,
    products: editableText,
    /** Names selected from the shared catalogue, copied into this rule version. */
    productNames: z.array(productNameSchema).min(1).max(20).optional(),
    /** Cart entries copied into the rule version. Older rules only have text snapshots. */
    items: z.array(productPlanItemSchema).min(1).max(20).optional(),
    dose: editableText,
    duration: editableText,
    /** Recommended duration in days. The stage supplies its reference event. */
    durationAmount: z.number().int().positive().max(3650).optional(),
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
    match: productNoteMatchSchema.optional(),
    action: productExceptionActionSchema.optional(),
    label: z.string().trim().min(1).max(200),
    guidance: z.string().trim().max(12000),
    sourceText: editableText,
    enabled: z.boolean(),
    source: sourceSchema,
  }).strict().superRefine((note, context) => {
    if (!note.guidance && !(note.kind === "custom" && note.action)) {
      context.addIssue({ code: "custom", path: ["guidance"], message: "Guidance is required for legacy exceptions" });
    }
    if (note.kind === "custom" && !note.match) {
      context.addIssue({ code: "custom", path: ["match"], message: "Custom exceptions require an assessment match" });
    }
  })).max(100),
}).strict();

export type ProductGuidance = z.infer<typeof productGuidanceSchema>;

export type ProductPlan = ProductGuidance["plans"][number];

const lissPreparation = "leveled scoops in 150ml water";

/** Read simple legacy doses and the three workbook Surgical preparations. */
export function productPlanItems(plan: ProductPlan): ProductPlanItem[] {
  if (plan.items) return plan.items.map(item => ({ ...item }));
  const names = plan.productNames ?? plan.products.split(" + ").map(name => name.trim());
  if (plan.stage === "surgical") {
    const lissOnly = plan.dose.match(/^([1-9]\d*) leveled scoops in 150ml water$/);
    if (names.length === 1 && names[0] === "Liss WH" && lissOnly && Number(lissOnly[1]) <= 100) {
      return [{ productName: "Liss WH", quantityPerDay: Number(lissOnly[1]), description: lissPreparation }];
    }
    const withInvigour = plan.dose.match(/^([1-9]\d*) Invigour \+ ([1-9]\d*) leveled scoops in 150ml water$/);
    if (names.length === 2 && names[0] === "Invigour" && names[1] === "Liss WH" && withInvigour
      && Number(withInvigour[1]) <= 100 && Number(withInvigour[2]) <= 100) {
      return [
        { productName: "Invigour", quantityPerDay: Number(withInvigour[1]) },
        { productName: "Liss WH", quantityPerDay: Number(withInvigour[2]), description: lissPreparation },
      ];
    }
  }
  const parts = plan.dose.split(" + ").map(part => part.trim());
  if (names.length !== parts.length || names.length === 0) return [];
  const items: ProductPlanItem[] = [];
  for (let index = 0; index < names.length; index++) {
    const match = parts[index]?.match(/^([1-9]\d*)\s+(.+)$/);
    const name = names[index];
    if (!match || !name || match[2]?.toLocaleLowerCase() !== name.toLocaleLowerCase()) return [];
    const quantityPerDay = Number(match[1]);
    if (!Number.isSafeInteger(quantityPerDay) || quantityPerDay > 100) return [];
    items.push({ productName: name, quantityPerDay });
  }
  return items;
}

/** Keep the historical display fields together with the structured cart. */
export function productPlanSnapshot(items: ProductPlanItem[]): Pick<ProductPlan, "items" | "productNames" | "products" | "dose"> {
  return {
    items: items.map(item => ({ ...item })),
    productNames: items.map(item => item.productName),
    products: items.map(item => item.productName).join(" + "),
    dose: items.map(item => item.quantityPerDay === undefined
      ? item.description ?? ""
      : item.productName === "Liss WH" && item.description === lissPreparation
        ? `${item.quantityPerDay} ${lissPreparation}`
        : `${item.quantityPerDay} ${item.productName}${item.description ? ` (${item.description})` : ""}`).join(" + "),
  };
}

/** Upgrade only recognized workbook Surgical doses in editable versions. */
export function normalizeProductPlan(plan: ProductPlan): ProductPlan {
  const normalized = normalizeProductDuration(plan);
  if (normalized.stage !== "surgical") return normalized;
  const items = productPlanItems({ ...normalized, items: undefined });
  if (!items.length) return normalized;
  const snapshot = productPlanSnapshot(items);
  if (snapshot.dose !== normalized.dose) return normalized;
  return normalized.items?.every(item => item.quantityPerDay !== undefined) ? normalized : { ...normalized, ...snapshot };
}

export function productDurationText(stage: ProductPlan["stage"], days: number): string {
  switch (stage) {
    case "pre_conditioning": return `${days} days before treatment`;
    case "during_treatment": return `Minimum ${days} days during treatment`;
    case "post_treatment": return `${days} days or more after treatment`;
    case "surgical": return `${days} days after surgery`;
  }
}

/** Convert only the two owner-confirmed workbook durations in legacy drafts. */
export function productDurationDays(plan: ProductPlan): number | null {
  if (/\bmonths?\b/i.test(plan.duration)) {
    const months = Number(plan.duration.match(/(\d+)\s*months?\b/i)?.[1]);
    if (plan.stage === "during_treatment" && months === 3) return 90;
    if (plan.stage === "post_treatment" && months === 12) return 365;
    return null;
  }
  if (plan.durationAmount) return plan.durationAmount;
  const match = plan.duration.match(/(\d+)\s*days?\b/i);
  return match ? Number(match[1]) : null;
}

export function normalizeProductDuration(plan: ProductPlan): ProductPlan {
  const days = productDurationDays(plan);
  return days === null ? plan : { ...plan, durationAmount: days, duration: productDurationText(plan.stage, days) };
}
