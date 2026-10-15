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
