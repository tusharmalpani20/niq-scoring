import { expect, test } from "bun:test";
import { assessNarrativeHighlights, completeNarrativeHighlights, plainNarrative, highlightSectionPoints, assessSectionHighlights, completeSectionHighlights, markFallbackHighlight } from "./report-highlights";
import { narrativeFieldNames, type CompleteReportNarrative } from "./report-content";

const narrative = Object.fromEntries(narrativeFieldNames.map(field => [field, {
  text: field === "effectsAdvice" ? "" : "If intake falls, discuss an oral supplement with your care team.",
  evidenceIds: ["supported"],
}])) as CompleteReportNarrative;
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
  prose.overview.text = "The diagnosis is pancreatic cancer.";
  prose.keyFindings.text = "Weight is stable. Preventing a decline in food intake is the main priority.";
  const incomplete = assessNarrativeHighlights(prose, { ...selections, overview: [], keyFindings: [] });
  expect(incomplete.accepted).toBe(false);
  const repaired = completeNarrativeHighlights(prose, incomplete.valid);
  expect(repaired.accepted).toBe(true);
  expect(repaired.marked.keyFindings.text).toContain("**Preventing a decline in food intake is the main priority**");
  expect(plainNarrative(repaired.marked)).toEqual(prose);
});

test("fallback cannot turn a bare fact into a highlighted takeaway", () => {
  const prose = structuredClone(narrative);
  prose.overview.text = "The diagnosis is pancreatic cancer.";
  prose.keyFindings.text = "The recorded diagnosis is pancreatic cancer.";
  const incomplete = assessNarrativeHighlights(prose, { ...selections, overview: [], keyFindings: [] });
  expect(completeNarrativeHighlights(prose, incomplete.valid).accepted).toBe(false);
});

test("one interpretation highlight covers the card when its other passage is factual", () => {
  const prose = structuredClone(narrative);
  prose.overview.text = "Early support can help prevent nutrition decline.";
  prose.keyFindings.text = "Weight increased from 62 kg to 63 kg.";
  const result = assessNarrativeHighlights(prose, { ...selections,
    overview: [{ phrase: "Early support can help prevent nutrition decline", kind: "finding" }], keyFindings: [] });
  expect(result.accepted).toBe(true);
  expect(result.marked.keyFindings.text).toBe(prose.keyFindings.text);
});

test("section points preserve newlines, exclude headings, and keep measurement units together", () => {
  const points = highlightSectionPoints("### Red flags\nFever is at least 38.5 °C or breathlessness develops.\nGlucose is above 180 mg/dL.");
  expect(points).toHaveLength(2);
  expect(points[0]!.text).toContain("or breathlessness develops.");
  expect(points[1]!.text).toContain("180 mg/dL");
});

const words = (text: string) => text.match(/[\p{L}\p{N}]+(?:[’'-][\p{L}\p{N}]+)*/gu)?.length ?? 0;
function expectSelective(marked: string, source: string) {
  expect(marked.replaceAll("**", "")).toBe(source);
  const emphasized = Array.from(marked.matchAll(/\*\*(.+?)\*\*/gs), match => match[1]!).join(" ");
  expect(words(emphasized)).toBeLessThanOrEqual(Math.floor(words(source) * 0.35));
}

test("section selections require every exact point ID while zero emphasis is valid", () => {
  const text = "Check blood pressure daily. Contact your care team for a fever.";
  const points = highlightSectionPoints(text);
  expect(assessSectionHighlights(text, { points: points.map(point => ({ id: point.id, phrases: [] })) }).accepted).toBe(true);
  for (const rows of [[], [{ id: "p1", phrases: [] }], [{ id: "p1", phrases: [] }, { id: "p1", phrases: [] }]]) {
    expect(assessSectionHighlights(text, { points: rows }).accepted).toBe(false);
  }
});

test("selective emphasis accepts meaningful clauses without hiding unselected conditions", () => {
  const text = "Contact your doctor if your blood pressure is 160/100 mmHg or higher, or below 90 with dizziness.";
  const result = assessSectionHighlights(text, { points: [{ id: "p1", phrases: [{ phrase: "Contact your doctor", kind: "action" }] }] });
  expect(result.accepted).toBe(true);
  expect(result.marked).toContain("**Contact your doctor** if your blood pressure");
  expectSelective(result.marked, text);
});

test("ordinary full sentences and blanket warning emphasis are rejected", () => {
  for (const text of ["Check blood pressure daily.", "If fever reaches 38.5 °C or higher, or you develop breathlessness, contact your care team immediately for urgent advice."]) {
    expect(assessSectionHighlights(text, { points: [{ id: "p1", phrases: [{ phrase: text, kind: "warning" }] }] }).accepted).toBe(false);
    expectSelective(completeSectionHighlights(text).marked, text);
  }
});

test("a genuinely short standalone warning may be fully emphasized", () => {
  const text = "Seek urgent care for breathlessness.";
  const result = assessSectionHighlights(text, { points: [{ id: "p1", phrases: [{ phrase: text, kind: "warning" }] }] });
  expect(result.accepted).toBe(true);
  expect(result.marked).toBe(`**${text}**`);
});

test("fallback preserves every warning and threshold without blanket highlighting", () => {
  const text = "### Red flags\nFever is at least 38.5 °C.\nBlood pressure is above 160/100 mmHg.\nGlucose is above 180 mg/dL.\nCall your care team for chest pain.\nSeek urgent care for breathlessness.\nContact your clinician if confusion develops.";
  expectSelective(markFallbackHighlight("redFlagsAdvice", text), text);
  const completed = completeSectionHighlights(text);
  expect(completed.accepted).toBe(true);
  expectSelective(completed.marked, text);
});

test("long warnings survive deterministic repair with concise exact emphasis", () => {
  const text = `If fever reaches 38.5 °C or higher, or you develop breathlessness, contact your care team immediately and follow the written plan ${"while monitoring symptoms and seeking urgent advice, ".repeat(4)}today.`;
  expect(text.length).toBeGreaterThan(180);
  const result = completeSectionHighlights(text, { points: [{ id: "p1", phrases: [{ phrase: "unsupported medicine", kind: "warning" }] }] });
  expect(result.accepted).toBe(true);
  expect(result.marked).not.toContain(`**${text}**`);
  expectSelective(result.marked, text);
});

test("fallback repairs partial existing bold and stays idempotent", () => {
  const source = "Check blood pressure daily. Contact your care team for a fever.";
  const completed = markFallbackHighlight("conditionAdvice", source.replace("blood pressure", "**blood pressure**"));
  expectSelective(completed, source);
  expect(markFallbackHighlight("conditionAdvice", completed)).toBe(completed);
});

test("partial words, numeric ranges and measurement units are rejected", () => {
  for (const [text, phrase] of [
    ["Monitor blood glucose below 80 mg/dL with your doctor.", "Monitor blood glucose below 80 mg"],
    ["Monitor blood glucose below 80 mg/dL with your doctor.", "onitor blood glucose"],
    ["Maintain an intake of 25–30 kcal/kg/day with the care team advising on your individual target.", "30 kcal/kg/day"],
    ["Maintain an intake of 25–30 kcal/kg/day with the care team advising on your individual target.", "intake of 25"],
  ]) expect(assessSectionHighlights(text!, { points: [{ id: "p1", phrases: [{ phrase, kind: "action" }] }] }).accepted).toBe(false);
});

test("fallback retains complete medication separation and monitoring text", () => {
  const text = "Leave four hours between it and calcium supplements. Weigh yourself daily. Repeat liver-function tests as scheduled.";
  const result = completeSectionHighlights(text);
  expect(result.accepted).toBe(true);
  expectSelective(result.marked, text);
});

test("highlight spans cannot reverse a prohibition, regardless of assigned kind", () => {
  const text = "Do not restrict fluids unless your care team advises you to, based on your individual care plan.";
  for (const kind of ["action", "finding", "warning"]) expect(assessSectionHighlights(text, {
    points: [{ id: "p1", phrases: [{ phrase: "restrict fluids", kind }] }],
  }).accepted).toBe(false);
  const allowed = assessSectionHighlights(text, { points: [{ id: "p1", phrases: [{ phrase: "Do not restrict fluids", kind: "action" }] }] });
  expect(allowed.accepted).toBe(true);
  expectSelective(allowed.marked, text);
});

test("long approved warnings retain all alternatives and other monitoring instructions", () => {
  const warning = `Contact your care team if ${"persistent symptoms and ".repeat(24)}breathlessness occur.`;
  const text = `Track your intake. ${warning}`;
  const result = completeSectionHighlights(text);
  expect(result.accepted).toBe(true);
  expectSelective(result.marked, text);
});

test("section budget and maximum two phrases prevent blanket highlighting", () => {
  const text = "Track your intake and check blood pressure, then record your weight each day while keeping the care team informed about any changes.";
  const phrase = (value: string) => ({ phrase: value, kind: "action" });
  const result = assessSectionHighlights(text, { points: [{ id: "p1", phrases: [phrase("Track your intake"), phrase("check blood pressure"), phrase("record your weight")] }] });
  expect(result.accepted).toBe(false);
  expect(result.issues).toContain("TOO_MANY_PHRASES_PER_POINT");
  expectSelective(result.marked, text);
  expect(assessSectionHighlights(text, { points: [{ id: "p1", phrases: [phrase("Track your intake and check blood pressure, then record your weight")] }] }).accepted).toBe(false);
});

test("generic words and isolated numbers do not satisfy an actionable highlight", () => {
  for (const phrase of ["your", "your intake", "80"]) expect(assessSectionHighlights("Track your intake every day and discuss changes with the care team when needed, with an energy target of 80.", {
    points: [{ id: "p1", phrases: [{ phrase, kind: "finding" }] }],
  }).accepted).toBe(false);
});
