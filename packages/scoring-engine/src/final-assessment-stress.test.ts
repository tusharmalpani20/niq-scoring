import { expect, test } from "bun:test";
import { createFinalAssessmentTemplate, createLegacyFinalAssessmentTemplate } from "@niq-scoring/contracts/final-assessment-template";
import { evaluateFinalAssessment } from "./final-assessment-evaluator";

test("new versions have no stress points and coverage follows the bound version", () => {
  const current = createFinalAssessmentTemplate("Current");
  const result = evaluateFinalAssessment(current, { stage: "stage_localized" });
  expect(result.answerCoverage).toMatchObject({ totalEntries: 18, answeredEntries: 1, unansweredEntries: 17 });
  expect(result.components.some(component => component.id === "stress_level")).toBe(false);
  expect(evaluateFinalAssessment(current, { stress_level: "stress_level_high" }).issues.map(issue => issue.code)).toContain("UNKNOWN_ANSWER");

  const previous = createFinalAssessmentTemplate("Previous");
  const oldDiet = createLegacyFinalAssessmentTemplate("Previous").sections.find(section => section.id === "dietary_details")!;
  const previousDiet = previous.sections.find(section => section.id === "dietary_details")!;
  previousDiet.description = oldDiet.description;
  previousDiet.fields.splice(3, 0, structuredClone(oldDiet.fields.find(field => field.id === "stress_level")!));
  const oldResult = evaluateFinalAssessment(previous, { stress_level: "stress_level_high" });
  expect(oldResult.answerCoverage.totalEntries).toBe(19);
  expect(oldResult.components.find(component => component.id === "stress_level")?.points).toBe(2);
});
