import { describe, expect, test } from "bun:test";
import { initialOncologyGuidance, oncologyGuidanceSchema } from "./oncology-guidance-template";

describe("oncology workbook guidance defaults", () => {
  test("seeds treatment guidance for all three nutrition statuses", () => {
    const defaults = initialOncologyGuidance();
    expect(oncologyGuidanceSchema.parse(defaults)).toEqual(defaults);
    expect(defaults).not.toHaveProperty("statusModifiers");
    expect(defaults.radiotherapy.map(row => row.nutritionalStatus).sort()).toEqual([
      "moderately_nourished", "severely_malnourished", "well_nourished",
    ]);
    expect(defaults.radiotherapy.every(row => row.treatmentTypeId === "current_cancer_treatment_radiation")).toBe(true);
    expect(new Set(defaults.radiotherapy.map(row => row.id)).size).toBe(3);
  });

  test("reads older definitions and drops only the retired rows", () => {
    const current = initialOncologyGuidance();
    const saved = { ...current, statusModifiers: [{ id: "status_taxanes_well_nourished" }] };
    expect(oncologyGuidanceSchema.parse(saved)).toEqual(current);
    expect(saved.statusModifiers).toHaveLength(1);
    expect(oncologyGuidanceSchema.safeParse({ ...saved, unexpected: [] }).success).toBe(false);
  });

  test("returns editable independent copies", () => {
    const first = initialOncologyGuidance();
    first.radiotherapy[0].guidance = "Changed";
    expect(initialOncologyGuidance().radiotherapy[0].guidance).not.toBe("Changed");
  });
});
