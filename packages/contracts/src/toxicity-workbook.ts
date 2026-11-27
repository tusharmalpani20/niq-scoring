import { z } from "zod";
import { nutritionalStatusSchema } from "./product-guidance";
import { ruleIdSchema } from "./rule-definition";

export type ToxicityWorkbookStatus = z.infer<typeof nutritionalStatusSchema>;
export const TOXICITY_WORKBOOK_STATUSES = nutritionalStatusSchema.options;
export const TOXICITY_WORKBOOK_STATUS_LABELS: Record<ToxicityWorkbookStatus, string> = {
  well_nourished: "Well nourished",
  moderately_nourished: "Moderately malnourished",
  severely_malnourished: "Severely malnourished",
};

export const TOXICITY_GUIDANCE_TREATMENTS = [
  "current_cancer_treatment_chemotherapy",
  "current_cancer_treatment_immunotherapy",
  "current_cancer_treatment_targeted",
  "current_cancer_treatment_hormonal",
] as const;

const referenceId = z.string().regex(/^(?:[1-9][0-9]{0,2}|P)$/);
const cellText = z.string().max(12000).refine(text => text.trim().length > 0, "Enter text.");
const points = z.number().int().min(1).max(3);
const nutritionPoints = z.number().int().min(0).max(2);
const dotThreshold = z.number().int().min(2).max(8);
const riskMatrixSchema = z.object({
  statusPoints: z.record(nutritionalStatusSchema, nutritionPoints),
  twoDotsMinimum: dotThreshold,
  threeDotsMinimum: dotThreshold,
}).strict().refine(matrix => matrix.twoDotsMinimum < matrix.threeDotsMinimum, {
  path: ["threeDotsMinimum"],
  message: "The three-dot threshold must exceed the two-dot threshold.",
});
const riskSchema = z.object({ frequencyPoints: points, intakeImpactPoints: points }).strict().nullable();
const variantSchema = z.object({
  intervention: cellText,
  escalation: cellText,
  actionOwner: cellText,
  rationale: cellText,
  frequencyBasis: z.string().max(12000).optional(),
  referenceIds: z.array(referenceId).max(100),
}).strict();
const workbookRuleSchema = z.object({
  row: z.number().int().positive(),
  classId: ruleIdSchema.nullable(),
  classLabel: z.string().min(1).max(200),
  treatmentTypeId: z.enum(TOXICITY_GUIDANCE_TREATMENTS),
  effect: cellText,
  // Older drafts stored one frequency basis for every nutrition status.
  frequencyBasis: z.string().max(12000).optional(),
  risk: riskSchema,
  variants: z.record(nutritionalStatusSchema, variantSchema),
}).strict().refine(rule => rule.classId !== null || rule.treatmentTypeId === "current_cancer_treatment_chemotherapy", {
  path: ["classId"],
  message: "Only chemotherapy guidance can be shared across classes.",
});

export const toxicityWorkbookReferenceSchema = z.object({
  id: referenceId,
  text: cellText,
  url: z.string().trim().max(2048)
    .regex(/^https?:\/\//i, "Enter a URL beginning with http:// or https://.")
    .pipe(z.url({ error: "Enter a valid source URL." })).optional(),
}).strict();

export const toxicityWorkbookSchema = z.object({
  document: z.string().min(1).max(300).optional(),
  references: z.array(toxicityWorkbookReferenceSchema).max(100),
  riskMatrix: riskMatrixSchema,
  rules: z.array(workbookRuleSchema).max(500),
}).strict().superRefine((workbook, context) => {
  const referenceIds = new Set<string>();
  workbook.references.forEach(({ id }, index) => {
    if (referenceIds.has(id)) context.addIssue({
      code: "custom", path: ["references", index, "id"], message: `Duplicate reference ${id}.`,
    });
    referenceIds.add(id);
  });

  const sourceRows = new Set<number>();
  workbook.rules.forEach((rule, index) => {
    if (sourceRows.has(rule.row)) context.addIssue({
      code: "custom", path: ["rules", index, "row"], message: `Duplicate source row ${rule.row}.`,
    });
    sourceRows.add(rule.row);
    for (const status of TOXICITY_WORKBOOK_STATUSES) {
      const entryIds = rule.variants[status].referenceIds;
      const path = ["rules", index, "variants", status, "referenceIds"];
      if (new Set(entryIds).size !== entryIds.length) context.addIssue({
        code: "custom", path, message: "A reference is listed twice for this rule.",
      });
      entryIds.forEach((id, referenceIndex) => {
        if (!referenceIds.has(id)) context.addIssue({
          code: "custom", path: [...path, referenceIndex], message: `Reference ${id} is missing from the list.`,
        });
      });
    }
  });
});

export type ToxicityWorkbook = z.infer<typeof toxicityWorkbookSchema>;

export function emptyToxicityGuidance(): ToxicityWorkbook {
  return {
    references: [],
    rules: [],
    riskMatrix: {
      statusPoints: { well_nourished: 0, moderately_nourished: 1, severely_malnourished: 2 },
      twoDotsMinimum: 5,
      threeDotsMinimum: 7,
    },
  };
}

export function toxicityWorkbookRiskDots(
  matrix: ToxicityWorkbook["riskMatrix"],
  risk: ToxicityWorkbook["rules"][number]["risk"],
  status: ToxicityWorkbookStatus,
): 1 | 2 | 3 | null {
  if (risk === null) return null;
  const score = risk.frequencyPoints + risk.intakeImpactPoints + matrix.statusPoints[status];
  if (score >= matrix.threeDotsMinimum) return 3;
  if (score >= matrix.twoDotsMinimum) return 2;
  return 1;
}
