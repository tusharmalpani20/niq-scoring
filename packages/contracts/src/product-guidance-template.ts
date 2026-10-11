import workbookDefaults from "./product-guidance-defaults.json" with { type: "json" };
import { productGuidanceSchema, type ProductGuidance } from "./product-guidance";

export { productGuidanceSchema } from "./product-guidance";
export type { ProductGuidance, ProductStage, NutritionalStatus } from "./product-guidance";

// Workbook rows are a starting point. Each version receives independent editable data.
const defaults: ProductGuidance = productGuidanceSchema.parse(workbookDefaults);

export function initialProductGuidance(): ProductGuidance {
  return structuredClone(defaults);
}
