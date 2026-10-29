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
  ["energy", "Energy 25 kcal/kg/day.", "25 kilocalories per kilogram of body weight per day"],
  ["protein", "Protein 1.2 g/kg/day.", "1.2 grams per kilogram of body weight per day"],
  ["fluid", "Drink 2 L/day.", "2 liters per day"],
  ["food", "Include banana and coconut water.", "banana and coconut water"],
])("renal fallback retains supplied %s advice together with kidney-specific qualification", (_kind, instructions, expected) => {
  const input=fixture(instructions);
  const output=buildDeterministicReportFallback(input);
  const text=output.narrative.nutritionAdvice.text.replaceAll("**", "");
  expect(text).toContain(expected);
  expect(text).toContain("Discuss these nutrition recommendations with your treating team:");
  expect(text).toContain("Individualise nutrition targets and fluid needs with your care team.");
  expect(output.narrative.nutritionAdvice.evidenceIds).toContain("rule:comorbidity:renal_audit");
  expect(output.narrative.conditionAdvice.text).toContain("Individualise");
  expect(input.guidance.nutritionInterventions[0]!.clinicalActions).toBe(instructions);
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

test("renal fallback still rejects missing source evidence",()=>{
 const input=fixture("Energy 25 kcal/kg/day.");
 input.evidence=input.evidence.filter(row=>row.id!=="rule:comorbidity:renal_audit");
 expect(()=>buildDeterministicReportFallback(input)).toThrow("FALLBACK_SOURCE_INCOMPLETE");
});

test("fallback does not veto a topic explicitly present in matched rule text",()=>{
 const output=buildDeterministicReportFallback(fixture("Review HbA1c and lipids with your care team.",false));
 expect(JSON.stringify(output.narrative)).toContain("HbA1c");
});

test("fallback keeps generation metadata out of patient-facing narrative",()=>{
 const output=buildDeterministicReportFallback(fixture("Energy 25 kcal/kg/day."));
 const text=Object.values(output.narrative).map(part=>part?.text ?? "").join(" ");
 expect(text).not.toMatch(/fallback|rule[- ]based|general rule guidance|source conflict/i);
});

test("a conditional kidney mention in another condition does not add a kidney qualification", () => {
  const input = fixture("Energy 25 kcal/kg/day.", false);
  input.guidance.carePlan.coMorbidities = [{ id: "hypertension_audit", conditionId: "hypertension", label: "Hypertension",
    guidance: "Individualise sodium advice if kidney disease is present." }];
  input.evidence = reportEvidence(createFinalAssessmentTemplate("Audit"), input.facts, input.classification, input.guidance);
  const output = buildDeterministicReportFallback(input);
  expect(output.narrative.nutritionAdvice.text).not.toContain("Discuss these nutrition recommendations");
  expect(output.narrative.nutritionAdvice.evidenceIds).not.toContain("rule:comorbidity:hypertension_audit");
});

test("an explicitly matched CKD rule qualifies general nutrition guidance", () => {
  const input = fixture("Protein 1.2 g/kg/day.");
  input.guidance.carePlan.coMorbidities = [{ id: "condition_audit", conditionId: "kidney", label: "CKD",
    guidance: "Individualise protein targets with your care team." }];
  input.evidence = reportEvidence(createFinalAssessmentTemplate("Audit"), input.facts, input.classification, input.guidance);
  const output = buildDeterministicReportFallback(input);
  expect(output.narrative.nutritionAdvice.text).toContain("Individualise protein targets with your care team.");
  expect(output.narrative.nutritionAdvice.evidenceIds).toContain("rule:comorbidity:condition_audit");
});
