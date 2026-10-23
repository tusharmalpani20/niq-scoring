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

test("fallback interpretation is a paragraph and every possible-effect card carries its care", async () => {
  const { buildDeterministicReportFallback } = await import("./report-fallback");
  const definition = createFinalAssessmentTemplate("Complete care test");
  const fields = definition.sections.flatMap(section => section.fields);
  const optionId = (fieldId: string, label: RegExp) => {
    const field = fields.find(row => row.id === fieldId)!;
    if (!("options" in field)) throw new Error("Expected option field");
    return field.options.find(row => label.test(row.label))!.id;
  };
  const facts = reportContentRequestSchema.parse({ assessmentReference: "a", resultReference: "r", idempotencyKey: "complete-care", facts: {
    reviewedScore: 23, treatmentTypeIds: ["current_cancer_treatment_chemotherapy"], drugClassIds: ["antimetabolites"], confirmedToxicityIds: [], assessmentDate: "2026-10-15",
    observations: [{ id: "bmi", label: "BMI", value: "24.4", unit: "kg/m²" }],
    assessmentAnswers: { dietary_symptoms: ["dietary_symptoms_mouth_sores"], previous_weight_kg: 62, current_weight_kg: 64,
      appetite_status: optionId("appetite_status", /^Normal$/i), functional_capacity: optionId("functional_capacity", /Reduced Activity/i) },
  } }).facts;
  const packet = matchedReportPacket(definition, facts, "moderate", facts.assessmentDate);
  const evidence = reportEvidence(definition, facts, { id: "moderate", label: "Moderate Risk" }, packet);
  const result = buildDeterministicReportFallback({ facts, classification: { id: "moderate", label: "Moderate Risk" }, guidance: packet, evidence });
  expect(result.narrative.keyFindings.text).not.toContain("\n");
  const paragraph = result.narrative.keyFindings.text.replace(/\*\*/g, "");
  expect(paragraph).toStartWith("Your NIQ score of 23 indicates moderate risk.");
  expect(paragraph).toContain("Your weight has changed from 62 kg one month ago to 64 kg, a 3.2% gain.");
  expect(paragraph).toContain("Your BMI is 24.4 kg/m².");
  expect(paragraph).toContain("You report a normal appetite.");
  expect(paragraph).toContain("Your functional activity is reduced.");
  expect(paragraph).not.toContain("Assessment records");
  expect(paragraph).not.toContain("kg/m² Mouth");
  expect(result.guidance.possibleToxicities.length).toBeGreaterThan(0);
  const mouth = result.guidance.possibleToxicities.find(row => /mouth|mucositis/i.test(row.expectedToxicity));
  expect(mouth?.summary).toMatch(/soft|moist/i);
  expect(mouth?.summary).not.toMatch(/reported separately|refer to|see reported/i);
  const summaries = result.guidance.possibleToxicities.map(row => row.summary).join(" ");
  expect(summaries).not.toContain("Adequate protein and energy.");
  const readableSummaries = summaries.replace(/\*\*/g, "");
  expect(readableSummaries).toContain("Replace fluid losses with oral rehydration solution and other fluids.");
  expect(readableSummaries).toContain("Choose low-residue soft foods (rice, banana, boiled potato, curd/buttermilk if tolerated).");
  expect(readableSummaries).toContain("Eat small, frequent meals.");
  expect(readableSummaries).toContain("Take your prescribed anti-nausea medicines on schedule.");
  expect(readableSummaries).toContain("If vomiting occurs, take small sips of oral rehydration solution.");
  expect(readableSummaries).toContain("unable to keep fluids down for 24");
});

test("report packet applies only the approved legacy Invigour preparation correction", () => {
  const definition = createFinalAssessmentTemplate("Preparation correction test");
  const plan = definition.carePlanGuidance!.products.plans.find(row => row.id === "product_pre_conditioning_moderately_nourished")!;
  definition.carePlanGuidance!.products.notes = [];
  const legacyPreparation = "Mix in 150 mL water and consume immediately after preparation.";
  plan.items = [{ productName: "Es-Invigour", quantityPerDay: 1, timesPerDay: 1, mealTiming: "After breakfast", preparation: legacyPreparation }];
  plan.productNames = ["Es-Invigour"];
  const facts = reportContentRequestSchema.parse({ assessmentReference: "a", resultReference: "r", idempotencyKey: "prep-test", facts: {
    reviewedScore: 23, treatmentTypeIds: [], drugClassIds: [], confirmedToxicityIds: [], assessmentDate: "2026-10-15",
    treatmentStatusId: "treatment_status_newly_diagnosed", plannedTreatmentStartDate: "2026-10-20",
  } }).facts;
  const corrected = matchedReportPacket(definition, facts, "moderate", facts.assessmentDate);
  expect(corrected.carePlan.products.plans[0]?.items?.[0]).toEqual({ ...plan.items[0]!, preparation: "Mix 1 sachet in 150 mL water and consume immediately after preparation." });
  expect(plan.items[0]!.preparation).toBe(legacyPreparation);
  expect(corrected.carePlan.products.plans[0]?.items?.[0]).not.toHaveProperty("unit");
  plan.items[0]!.productName = "Nourish";
  plan.productNames = ["Nourish"];
  expect(matchedReportPacket(definition, facts, "moderate", facts.assessmentDate).carePlan.products.plans[0]?.items?.[0]?.preparation).toBe(legacyPreparation);
  plan.items[0]!.productName = "Invigour";
  plan.productNames = ["Invigour"];
  plan.items[0]!.preparation = "Mix 2 sachets in 200 mL water.";
  expect(matchedReportPacket(definition, facts, "moderate", facts.assessmentDate).carePlan.products.plans[0]?.items?.[0]?.preparation).toBe("Mix 2 sachets in 200 mL water.");
});

test("interpretation uses chart-aligned recorded history before the reported previous-month answer", async () => {
  const { buildDeterministicReportFallback } = await import("./report-fallback");
  const definition = createFinalAssessmentTemplate("Recorded weight comparison");
  const facts = reportContentRequestSchema.parse({ assessmentReference: "a", resultReference: "r", idempotencyKey: "history-comparison", facts: {
    observations: [{ id: "weight_loss_percent", value: "3.2" }],
    reviewedScore: 23, treatmentTypeIds: [], drugClassIds: [], confirmedToxicityIds: [], assessmentDate: "2026-10-15",
    assessmentAnswers: { previous_weight_kg: 62, current_weight_kg: 64 },
    weightComparison: { source: "assessment_history", previousWeightKg: 63, currentWeightKg: 64,
      previousDate: "2026-10-13", currentDate: "2026-10-15", changePercent: 100 / 63 },
  } }).facts;
  const guidance = matchedReportPacket(definition, facts, "moderate", facts.assessmentDate);
  const evidence = reportEvidence(definition, facts, { id: "moderate", label: "Moderate Risk" }, guidance);
  const weight = evidence.find(row => row.id === "fact:weight_direction")!.text;
  expect(weight).toContain("63 kg previously and 64 kg currently (1.6%)");
  expect(weight).not.toContain("1 month ago");
  expect(evidence.some(row => row.id === "fact:weight_loss_percent")).toBe(false);
  const result = buildDeterministicReportFallback({ facts, classification: { id: "moderate", label: "Moderate Risk" }, guidance, evidence });
  const paragraph = result.narrative.keyFindings.text.replace(/\*\*/g, "");
  expect(paragraph).toContain("from 63 kg on 2026-10-13 to 64 kg on 2026-10-15, a 1.6% gain");
  expect(paragraph).not.toContain("62 kg");
  expect(paragraph).not.toMatch(/improved|one month ago/);
  expect(result.narrative.overallSummary.text).not.toContain("\n");
  expect(result.narrative.overallSummary.text).not.toMatch(/severe malnutrition|Your selected nutrition support is|Your nutritional status is/);
});

test("recorded weight history requires a real prior date, while reported previous-month comparison stays undated", () => {
  const input = { assessmentReference: "a", resultReference: "r", idempotencyKey: "date-check", facts: {
    reviewedScore: 23, treatmentTypeIds: [], drugClassIds: [], confirmedToxicityIds: [], assessmentDate: "2026-10-15",
    weightComparison: { source: "assessment_history", previousWeightKg: 63, currentWeightKg: 64, currentDate: "2026-10-15", changePercent: 1.6 },
  } };
  expect(reportContentRequestSchema.safeParse(input).success).toBe(false);
  expect(reportContentRequestSchema.safeParse({ ...input, facts: { ...input.facts,
    weightComparison: { ...input.facts.weightComparison, source: "reported_previous_weight", previousLabel: "Weight 1 Month Ago" } } }).success).toBe(true);
});

test("reused Vital IQ measurements retain their capture date and are explicitly historical in model evidence", () => {
  const definition = createFinalAssessmentTemplate("Historical measurement test");
  const facts = reportContentRequestSchema.parse({ assessmentReference: "copy", resultReference: "result", idempotencyKey: "historical", facts: {
    reviewedScore: 23, treatmentTypeIds: [], drugClassIds: [], confirmedToxicityIds: [], assessmentDate: "2026-10-23",
    observations: [{ id: "heart_rate", value: "75", measuredAt: "2026-10-01", measurementSource: "historical", sourceAssessmentReference: "ASM-003545" }],
  } }).facts;
  const evidence = reportEvidence(definition, facts, { id: "moderate", label: "Moderate Risk" }, matchedReportPacket(definition, facts, "moderate", facts.assessmentDate));
  const observation = evidence.find(row => row.id === "fact:heart_rate")!;
  expect(observation.text).toContain("2026-10-01");
  expect(observation.text).toContain("Historical measurement reused");
  expect(observation.text).toContain("not a new scan or a current measurement");
  expect(observation.text).not.toContain("ASM-003545");
});
