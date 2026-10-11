import { expect, test } from "bun:test";
import { createFinalAssessmentTemplate, createLegacyFinalAssessmentTemplate, removeDietaryStress } from "./final-assessment-template";
import { isFixedFinalAssessmentDefinition } from "./final-assessment-validation";

test("new final assessment versions omit Dietary Stress while historical versions remain valid", () => {
  const current = createFinalAssessmentTemplate("Current");
  expect(current.sections.find(section => section.id === "dietary_details")?.fields.map(field => field.id)).not.toContain("stress_level");
  expect(current.sections.flatMap(section => section.fields)).toHaveLength(18);
  expect(isFixedFinalAssessmentDefinition(current)).toBe(true);

  // A version saved before this change must still be readable and score its pinned answers.
  const previous = createFinalAssessmentTemplate("Previous");
  const oldDiet = createLegacyFinalAssessmentTemplate("Previous").sections.find(section => section.id === "dietary_details")!;
  const previousDiet = previous.sections.find(section => section.id === "dietary_details")!;
  previousDiet.description = oldDiet.description;
  previousDiet.fields.splice(3, 0, structuredClone(oldDiet.fields.find(field => field.id === "stress_level")!));
  expect(isFixedFinalAssessmentDefinition(previous)).toBe(true);

  const migrated = removeDietaryStress(previous);
  expect(isFixedFinalAssessmentDefinition(migrated)).toBe(true);
  expect(migrated.sections.flatMap(section => section.fields).some(field => field.id === "stress_level")).toBe(false);
  expect(previous.sections.flatMap(section => section.fields).some(field => field.id === "stress_level")).toBe(true);
});
