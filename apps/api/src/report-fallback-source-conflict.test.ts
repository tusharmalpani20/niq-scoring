import { expect, test } from "bun:test";
import { createFinalAssessmentTemplate } from "@niq-scoring/contracts/final-assessment-template";
import { matchedReportPacket, reportEvidence } from "./report-content";
import { buildDeterministicReportFallback } from "./report-fallback";

function fixture(instructions: string, renal = true) {
  const definition = createFinalAssessmentTemplate("Fallback source conflicts");
  const facts = { reviewedScore: 12, treatmentTypeIds: [], drugClassIds: [], confirmedToxicityIds: [], assessmentDate: "2026-10-26", observations: [] };
  const classification = { id: "low", label: "Low Risk" };
  const guidance = matchedReportPacket(definition, facts, classification.id, facts.assessmentDate);
  guidance.nutritionInterventions = [{ ...guidance.nutritionInterventions[0]!, id: "nutrition_audit", coreStrategy: "Maintain nutrition.", clinicalActions: instructions }];
  guidance.carePlan.coMorbidities = renal ? [{ id: "renal_audit", conditionId: "kidney", label: "Kidney disease", guidance: "Individualise nutrition targets and fluid needs with your care team." }] : [];
  const evidence = reportEvidence(definition, facts, classification, guidance);
  return { facts, classification, guidance, evidence };
}

test.each([
  ["energy", "Energy 25 kcal/kg/day."],
  ["protein", "Protein 1.2 g/kg/day."],
  ["fluid", "Drink 2 L/day."],
])("renal fallback rejects fixed %s targets before patient-language expansion hides units", (_kind, instructions) => {
  expect(() => buildDeterministicReportFallback(fixture(instructions))).toThrow("FALLBACK_SOURCE_CONFLICT");
});

test("renal fallback accepts guidance with no conflicting fixed targets", () => {
  const output = buildDeterministicReportFallback(fixture("Ask your care team to individualise your energy, protein and fluid targets."));
  expect(output.narrative.conditionAdvice.text).toContain("Individualise");
});

test("nonrenal fallback retains fixed targets in patient-friendly units", () => {
  const output = buildDeterministicReportFallback(fixture("Energy 25 kcal/kg/day; protein 1.2 g/kg/day.", false));
  expect(output.narrative.nutritionAdvice.text).toContain("25 kilocalories per kilogram of body weight per day");
  expect(output.narrative.nutritionAdvice.text).toContain("1.2 grams per kilogram of body weight per day");
});
