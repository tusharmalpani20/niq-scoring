import { expect, test } from "bun:test";
import { assessCoverage, requiredCoverageSources } from "./report-coverage";
import type { ReportNarrative } from "./report-content";

const evidence = [
  { id: "rule:nutrition:moderate", text: "Work toward nutrition targets and discuss support if intake falls." },
  { id: "possible:toxicity:mouth", text: "Possible mouth sores. Choose soft food and seek help if unable to eat." },
  { id: "rule:class:taxanes", text: "Follow the class food safety protocol." },
  { id: "fact:diagnosis", text: "Recorded diagnosis." },
];
const sources = requiredCoverageSources(evidence);
const empty = { text: "", evidenceIds: [] };
const narrative = {
  overview: empty, keyFindings: empty, actionSummary: empty, monitoringSummary: empty,
  overallSummary: empty, conditionAdvice: empty, effectsAdvice: empty,
  nutritionAdvice: { text: "Work toward nutrition targets and discuss support if intake falls.", evidenceIds: [sources[0]!.id] },
  treatmentAdvice: { text: "Mouth sores may occur. Choose soft food and seek help if eating becomes difficult. Follow food safety advice.",
    evidenceIds: [sources[1]!.id, sources[2]!.id] },
} as ReportNarrative;
const covered = sources.map(source => ({ evidenceId: source.id, covered: true, missing: [] }));

test("coverage requires every applicable nutrition and class-treatment source", () => {
  expect(sources.map(source => source.id)).toEqual(evidence.slice(0, 3).map(item => item.id));
  expect(assessCoverage({ rows: covered }, sources, narrative).accepted).toBe(true);
  expect(assessCoverage({ rows: covered.slice(1) }, sources, narrative).invalid).toBe(true);
  expect(assessCoverage({ rows: [covered[0], covered[0], covered[2]] }, sources, narrative).invalid).toBe(true);
});

test("a cited source with missing advice fails the independent audit", () => {
  const result = assessCoverage({ rows: [covered[0],
    { evidenceId: sources[1]!.id, covered: false, missing: ["The escalation step is missing."] }, covered[2]] }, sources, narrative);
  expect(result).toMatchObject({ accepted: false, invalid: false,
    gaps: [{ id: sources[1]!.id, field: "treatmentAdvice", missing: ["The escalation step is missing."] }] });
  const withoutText = { ...narrative, treatmentAdvice: { text: "", evidenceIds: [sources[1]!.id, sources[2]!.id] } };
  expect(assessCoverage({ rows: covered }, sources, withoutText).gaps.map(gap => gap.id))
    .toEqual([sources[1]!.id, sources[2]!.id]);
  expect(assessCoverage({ rows: [covered[0], { evidenceId: sources[1]!.id, covered: false, missing: [] }, covered[2]] }, sources, narrative).invalid).toBe(true);
});
