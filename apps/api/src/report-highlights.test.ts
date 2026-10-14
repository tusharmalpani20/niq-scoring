import { expect, test } from "bun:test";
import { assessNarrativeHighlights, completeNarrativeHighlights, plainNarrative } from "./report-highlights";
import { narrativeFieldNames, type ReportNarrative } from "./report-content";

const narrative = Object.fromEntries(narrativeFieldNames.map(field => [field, {
  text: field === "effectsAdvice" ? "" : "If intake falls, discuss an oral supplement with your care team.",
  evidenceIds: ["supported"],
}])) as ReportNarrative;
const selections = Object.fromEntries(narrativeFieldNames.map(field => [field,
  field === "effectsAdvice" ? [] : [{ phrase: "discuss an oral supplement with your care team", kind: "action" }],
]));

test("highlight pass marks reviewed phrases without changing any words or evidence", () => {
  const result = assessNarrativeHighlights(narrative, selections);
  expect(result.accepted).toBe(true);
  expect(result.marked.nutritionAdvice.text).toBe("If intake falls, **discuss an oral supplement with your care team**.");
  expect(plainNarrative(result.marked)).toEqual(narrative);
});

test("highlight pass rejects rewritten, overlapping, incomplete and empty selections", () => {
  for (const invalid of [
    { ...selections, nutritionAdvice: [{ phrase: "start an oral supplement", kind: "action" }] },
    { ...selections, nutritionAdvice: [
      { phrase: "discuss an oral supplement with your care team", kind: "action" },
      { phrase: "an oral supplement with your care team", kind: "action" },
    ] },
    { ...selections, nutritionAdvice: [{ phrase: "If intake falls", kind: "action" }] },
    { ...selections, nutritionAdvice: [{ phrase: "oral supplement with your care team", kind: "action" }] },
    { ...selections, nutritionAdvice: [] },
    { ...selections, effectsAdvice: [{ phrase: "discuss an oral supplement with your care team", kind: "action" }] },
  ]) expect(assessNarrativeHighlights(narrative, invalid).accepted).toBe(false);
});

test("quality assessment keeps valid choices available for targeted repair", () => {
  const result = assessNarrativeHighlights(narrative, { ...selections, nutritionAdvice: [
    { phrase: "start an oral supplement", kind: "action" },
    { phrase: "discuss an oral supplement with your care team", kind: "action" },
  ] });
  expect(result.accepted).toBe(false);
  expect(result.issues.nutritionAdvice).toContain("INVALID_SPAN_OR_ACTION");
  expect(result.valid.nutritionAdvice).toEqual([{ phrase: "discuss an oral supplement with your care team", kind: "action" }]);
  expect(plainNarrative(result.marked)).toEqual(narrative);
});

test("long clinical sections need several distinct takeaways", () => {
  const lengthy = structuredClone(narrative);
  lengthy.conditionAdvice.text = "For diabetes, contact your doctor for persistent high glucose. For hypertension, record blood pressure at home. For thyroid medicine, check your TSH after a dose change. ".repeat(4);
  const result = assessNarrativeHighlights(lengthy, selections);
  expect(result.accepted).toBe(false);
  expect(result.issues.conditionAdvice).toContain("INSUFFICIENT_COVERAGE");
});

test("a factual overview stays unbolded while the interpretation carries the takeaway", () => {
  const factual = structuredClone(narrative);
  factual.overview.text = "The documented diagnosis is pancreatic cancer. Nutrition risk is moderate.";
  expect(assessNarrativeHighlights(factual, { ...selections, overview: [] }).accepted).toBe(true);
  const result = assessNarrativeHighlights(factual, { ...selections, overview: [
    { phrase: "The documented diagnosis is pancreatic cancer", kind: "finding" },
  ] });
  expect(result.accepted).toBe(false);
  expect(result.issues.overview).toContain("INVALID_SPAN_OR_ACTION");
});

test("complete interpretive sentences can recover a failed model selection", () => {
  const prose = structuredClone(narrative);
  prose.keyFindings.text = "Weight is stable. Preventing a decline in food intake is the main priority.";
  const incomplete = assessNarrativeHighlights(prose, { ...selections, keyFindings: [] });
  expect(incomplete.accepted).toBe(false);
  const repaired = completeNarrativeHighlights(prose, incomplete.valid);
  expect(repaired.accepted).toBe(true);
  expect(repaired.marked.keyFindings.text).toContain("**Preventing a decline in food intake is the main priority**");
  expect(plainNarrative(repaired.marked)).toEqual(prose);
});

test("fallback cannot turn a bare fact into a highlighted takeaway", () => {
  const prose = structuredClone(narrative);
  prose.keyFindings.text = "The recorded diagnosis is pancreatic cancer.";
  const incomplete = assessNarrativeHighlights(prose, { ...selections, keyFindings: [] });
  expect(completeNarrativeHighlights(prose, incomplete.valid).accepted).toBe(false);
});
