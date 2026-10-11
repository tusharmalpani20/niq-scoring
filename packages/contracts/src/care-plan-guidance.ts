import { z } from "zod";
import { ruleIdSchema } from "./rule-definition";
import { oncologyGuidanceSchema, initialOncologyGuidance, nutritionalStatusSchema, type NutritionalStatus } from "./oncology-guidance-template";
import { productGuidanceSchema, initialProductGuidance } from "./product-guidance-template";

export { nutritionalStatusSchema };
export type { NutritionalStatus };

/** Every rule version owns its own clinical mapping and editable workbook guidance. */
export const carePlanGuidanceSchema = z.object({
  riskStatusMapping: z.array(z.object({
    riskCategoryId: ruleIdSchema,
    nutritionalStatus: nutritionalStatusSchema,
  }).strict()).max(20),
  surgicalOverlapPolicy: z.enum(["surgical_priority", "clinician_choice"]),
  oncology: oncologyGuidanceSchema,
  products: productGuidanceSchema,
}).strict();

export type CarePlanGuidance = z.infer<typeof carePlanGuidanceSchema>;

/** Defaults refer to stable risk IDs; renaming a category does not change its mapping. */
export function initialCarePlanGuidance(): CarePlanGuidance {
  return carePlanGuidanceSchema.parse({
    riskStatusMapping: [
      { riskCategoryId: "low", nutritionalStatus: "well_nourished" },
      { riskCategoryId: "moderate", nutritionalStatus: "moderately_nourished" },
      { riskCategoryId: "high", nutritionalStatus: "severely_malnourished" },
    ],
    surgicalOverlapPolicy: "surgical_priority",
    oncology: initialOncologyGuidance(),
    products: initialProductGuidance(),
  });
}
