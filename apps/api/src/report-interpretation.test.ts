import { expect, test } from "bun:test";
import { createFinalAssessmentTemplate } from "@niq-scoring/contracts/final-assessment-template";
import { matchedReportPacket, reportContentRequestSchema, reportEvidence } from "./report-content";

test("interpretation receives the recorded activity and appetite labels alongside risk and weight evidence", () => {
  const definition = createFinalAssessmentTemplate("Interpretation test");
  const fields = definition.sections.flatMap(section => section.fields);
  const activity = fields.find(field => field.id === "functional_capacity")!;
  const appetite = fields.find(field => field.id === "appetite_status")!;
  if (!("options" in activity) || !("options" in appetite)) throw new Error("Expected option fields");
  const activityOption = activity.options.find(option => /Reduced Activity/i.test(option.label))!;
  const appetiteOption = appetite.options.find(option => /^Normal$/i.test(option.label))!;
  const facts = reportContentRequestSchema.parse({ assessmentReference: "test-assessment", resultReference: "test-result", idempotencyKey: "test-request", facts: {
    reviewedScore: 23, treatmentTypeIds: [], drugClassIds: [], confirmedToxicityIds: [], assessmentDate: "2026-10-15",
    assessmentAnswers: { functional_capacity: activityOption.id, appetite_status: appetiteOption.id, previous_weight_kg: 62, current_weight_kg: 64 },
  } }).facts;
  const packet = matchedReportPacket(definition, facts, "moderate", facts.assessmentDate);
  const evidence = reportEvidence(definition, facts, { id: "moderate", label: "Moderate Risk" }, packet);
  expect(evidence.find(row => row.id === `fact:assessment_functional_capacity_${activityOption.id}`)?.text).toContain(activityOption.label);
  expect(evidence.find(row => row.id === `fact:assessment_appetite_status_${appetiteOption.id}`)?.text).toContain(appetiteOption.label);
  expect(evidence.find(row => row.id === "fact:niq_risk")?.text).toContain("23");
  expect(evidence.find(row => row.id === "fact:weight_direction")?.text).toContain("3.2%");
});
