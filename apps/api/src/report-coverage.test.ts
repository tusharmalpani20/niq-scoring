import { expect, test } from "bun:test";
import { assessCoverage, assessInterventionSummaries, assessInterventionSummaryCoverage, requiredCoverageSources } from "./report-coverage";
import { narrativeFieldNames, type ReportNarrative } from "./report-content";

const evidence = [
  { id: "rule:nutrition:moderate", text: "Work toward nutrition targets and discuss support if intake falls." },
  { id: "possible:toxicity:mouth", text: "Possible mouth sores. Choose soft food and seek help if unable to eat." },
  { id: "rule:class:taxanes", text: "Follow the class food safety protocol." },
  { id: "fact:diagnosis", text: "Recorded diagnosis." },
];
const sources = requiredCoverageSources(evidence);
const empty = { text: "", evidenceIds: [] };
const narrative = {
  overview: empty, actionSummary: empty, monitoringSummary: empty,
  overallSummary: empty, conditionAdvice: empty, effectsAdvice: empty, foodSafetyAdvice: empty, redFlagsAdvice: empty, treatmentAdvice: empty,
  nutritionAdvice: { text: "Work toward nutrition targets and discuss support if intake falls.", evidenceIds: [sources[0]!.id] },
  keyFindings: { text: "Mouth sores may occur. Choose soft food and seek help if eating becomes difficult. Follow food safety advice.",
    evidenceIds: [evidence[1]!.id, sources[1]!.id] },
} as ReportNarrative;
const covered = sources.map(source => ({ evidenceId: source.id, covered: true, missing: [] }));

test("coverage requires every applicable nutrition and class-treatment source", () => {
  expect(sources.map(source => source.id)).toEqual([evidence[0]!.id, evidence[2]!.id]);
  expect(assessCoverage({ rows: covered }, sources, narrative).accepted).toBe(true);
  expect(assessCoverage({ rows: covered.slice(1) }, sources, narrative).invalid).toBe(true);
  expect(assessCoverage({ rows: [covered[0], covered[0]] }, sources, narrative).invalid).toBe(true);
});

test("a cited source with missing advice fails the independent audit", () => {
  const result = assessCoverage({ rows: [covered[0],
    { evidenceId: sources[1]!.id, covered: false, missing: ["The food safety protocol is missing."] }] }, sources, narrative);
  expect(result).toMatchObject({ accepted: false, invalid: false,
    gaps: [{ id: sources[1]!.id, field: "treatmentAdvice", missing: ["The food safety protocol is missing."] }] });
  const withoutText = structuredClone(narrative);
  for (const field of narrativeFieldNames) withoutText[field] = { text: "", evidenceIds: [] };
  withoutText.treatmentAdvice = { text: "", evidenceIds: [evidence[1]!.id, sources[1]!.id] };
  expect(assessCoverage({ rows: covered }, sources, withoutText).gaps.map(gap => gap.id))
    .toEqual([sources[0]!.id, sources[1]!.id]);
  expect(assessCoverage({ rows: [covered[0], { evidenceId: sources[1]!.id, covered: false, missing: [] }] }, sources, narrative).invalid).toBe(true);
});


test("every matched candidate needs one safe summary and a complete audit", () => {
  const candidates = evidence.filter(item => item.id.startsWith("possible:toxicity:"));
  const rows = [{ evidenceId: candidates[0]!.id, text: "If mouth sores occur, choose soft food and seek help if unable to eat." }];
  expect(assessInterventionSummaries({ rows }, candidates).rows).toEqual(rows);
  expect(assessInterventionSummaries({ rows: [] }, candidates).rows).toBeNull();
  expect(assessInterventionSummaries({ rows: [rows[0], rows[0]] }, candidates).rows).toBeNull();
  expect(assessInterventionSummaries({ rows: [{ ...rows[0], text: "Call if fever reaches 99 degrees." }] }, candidates).issues)
    .toContain(`${candidates[0]!.id}:UNSUPPORTED_NUMBER`);
  expect(assessInterventionSummaryCoverage({ rows: [{ evidenceId: candidates[0]!.id, covered: false,
    missing: ["Escalation when unable to eat is missing."] }] }, candidates, rows).accepted).toBe(false);
  expect(assessInterventionSummaryCoverage({ rows: [{ evidenceId: candidates[0]!.id, covered: true,
    missing: [] }] }, candidates, rows).accepted).toBe(true);
});

test("possible-effect cards reject placeholders and references instead of care", () => {
  const candidates = evidence.filter(item => item.id.startsWith("possible:toxicity:"));
  for (const text of ["A related symptom was reported separately.", "For comfort, see Reported symptom care.", "Refer to the food safety section."]) {
    expect(assessInterventionSummaries({ rows: [{ evidenceId: candidates[0]!.id, text }] }, candidates).issues)
      .toContain(`${candidates[0]!.id}:INCOMPLETE_REFERENCED_CARE`);
  }
});

test("a detailed treatment audit preserves fifteen distinct concerns for manager review", () => {
  const missing = Array.from({length:15},(_,index)=>`Distinct supported treatment action ${index+1} is missing.`);
  const result=assessCoverage({rows:[covered[0],{evidenceId:sources[1]!.id,covered:false,missing}]},sources,narrative);
  expect(result.invalid).toBe(false);
  expect(result.gaps[0]?.missing).toEqual(missing);
});

test("card sentence capitalization is repaired before review without changing clinical notation", () => {
  const id = "possible:toxicity:fatigue";
  const text = "Monitor weight and intake. your care team should intensify support if weight loss continues. ask the care team about tests. Keep 1.2–1.5 g/kg/day, pH and e.g. your usual foods unchanged.";
  const input = {rows: [{evidenceId: id, text}]};
  const result = assessInterventionSummaries(input, [{id, text}]);
  expect(result.issues).toEqual([]);
  expect(result.rows?.[0]?.text).toBe("Monitor weight and intake. Your care team should intensify support if weight loss continues. Ask the care team about tests. Keep 1.2–1.5 g/kg/day, pH and e.g. your usual foods unchanged.");
  expect(input.rows[0]!.text).toBe(text);
});
