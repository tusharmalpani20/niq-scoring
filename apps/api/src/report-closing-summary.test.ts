import { expect, test } from "bun:test";
import { closingReportSummary } from "./report-closing-summary";

const risk = { id: "fact:niq_risk", text: "Reviewed NIQ risk category: Moderate Risk." };
test("closing fallback connects actual concerns, plan and all relevant monitoring in one paragraph", () => {
  const summary = closingReportSummary({ riskLabel: "Moderate Risk", evidence: [risk,
    { id: "fact:assessment_appetite_status_normal", text: "Assessment records Appetite: Normal. This does not establish a treatment cause." },
    { id: "fact:assessment_functional_capacity_reduced", text: "Assessment records Functional capacity: Reduced Activity. This does not establish a treatment cause." },
    { id: "fact:assessment_dietary_symptoms_mouth", text: "Assessment records Dietary symptoms: Mouth Ulcers / Mucositis. This does not establish a treatment cause." },
  ], nutrition: [{ id: "rule:nutrition:moderate", text: "Meet energy and protein needs, maintain muscle and adapt nutrition for symptoms." }],
  products: [{ id: "rule:product:before", text: "Es-Invigour" }], monitoring: [
    { id: "rule:nutrition:moderate", text: "Track weight, intake and symptoms." },
    { id: "rule:comorbidity:pressure", text: "Record blood pressure." },
    { id: "rule:comorbidity:thyroid", text: "Check TSH." },
  ] });
  expect(summary.text).not.toContain("\n");
  expect(summary.text).toContain("Although your appetite is normal, reduced activity and mouth ulcers remain priorities");
  expect(summary.text).toContain("with Es-Invigour as the selected nutrition support");
  expect(summary.text).toContain("weight trends, food intake, symptoms, blood pressure and thyroid monitoring");
  expect(summary.text).not.toMatch(/severe malnutrition|deficiency|caused|sachet/);
  expect(summary.evidenceIds).toContain("rule:comorbidity:thyroid");
});

test("low-risk report without symptoms or product does not invent concerns, supplements or monitoring", () => {
  const summary = closingReportSummary({ riskLabel: "Low Risk", evidence: [risk,
    { id: "fact:assessment_dietary_symptoms_none", text: "Assessment records Dietary symptoms: None. This does not establish a treatment cause." }],
    nutrition: [{ id: "rule:nutrition:low", text: "Maintain adequate energy and protein." }], products: [], monitoring: [] });
  expect(summary.text).toBe("Your assessment indicates low risk. The plan focuses on meeting your nutritional needs.");
  expect(summary.evidenceIds).toEqual(["fact:niq_risk", "rule:nutrition:low"]);
});

test("different high-risk symptom and blood-count monitoring stay specific without a fabricated product benefit", () => {
  const summary = closingReportSummary({ riskLabel: "High Risk", evidence: [risk,
    { id: "fact:assessment_gastrointestinal_symptoms_diarrhea", text: "Assessment records GUT symptoms: Diarrhea. This does not establish a treatment cause." }],
    nutrition: [{ id: "rule:nutrition:high", text: "Adapt food choices to symptoms and meet protein requirements." }],
    products: [], monitoring: [{ id: "rule:toxicity:blood", text: "Check CBC before each cycle." }] });
  expect(summary.text).toContain("Recorded concerns include diarrhea.");
  expect(summary.text).toContain("Follow-up should review blood counts.");
  expect(summary.text).not.toMatch(/mouth|thyroid|blood pressure|severe malnutrition|Es-Invigour/);
});


test("one concern uses singular grammar and appetite labels are not doubled", () => {
  const base = { riskLabel: "Moderate Risk", nutrition: [], monitoring: [], products: [] };
  const oneConcern = closingReportSummary({ ...base, evidence: [risk,
    { id: "fact:assessment_appetite_status_normal", text: "Assessment records Appetite: Normal. This does not establish a treatment cause." },
    { id: "fact:assessment_dietary_symptoms_mouth", text: "Assessment records Dietary symptoms: Mouth Ulcers / Mucositis. This does not establish a treatment cause." },
  ] });
  expect(oneConcern.text).toContain("mouth ulcers remain a priority");
  const appetite = closingReportSummary({ ...base, evidence: [risk,
    { id: "fact:assessment_appetite_status_loss", text: "Assessment records Appetite: Loss of appetite. This does not establish a treatment cause." },
  ] });
  expect(appetite.text).toContain("Your reported loss of appetite is an important consideration");
  expect(appetite.text).not.toContain("appetite appetite");
});


test("closing captures recorded weight loss without converting a gain into improvement", () => {
  const base = { riskLabel: "High Risk", nutrition: [], monitoring: [], products: [] };
  const loss = closingReportSummary({ ...base, evidence: [risk,
    { id: "fact:weight_direction", text: "Recorded weight loss: 64 kg previously and 60 kg currently (6.3%)." },
  ] });
  expect(loss.text).toContain("Recorded concerns include recorded weight loss.");
  expect(loss.evidenceIds).toContain("fact:weight_direction");
  for (const direction of ["gain", "no change"]) {
    const other = closingReportSummary({ ...base, evidence: [risk,
      { id: "fact:weight_direction", text: `Recorded weight ${direction}: 63 kg previously and 64 kg currently (1.6%).` },
    ] });
    expect(other.text).not.toMatch(/weight loss|improv/);
  }
});
