import { expect, test } from "bun:test";
import { narrativeFieldNames, type CompleteReportNarrative, type ReportEvidence } from "./report-content";
import { recoverNarrativeSections } from "./report-section-recovery";

const evidence: ReportEvidence[] = [
  { id: "fact:niq_risk", text: "Nutrition risk requires monitoring." },
  { id: "rule:nutrition:test", text: "Maintain adequate energy and protein intake during treatment." },
];
function narrative(): CompleteReportNarrative {
  return Object.fromEntries(narrativeFieldNames.map(field => [field,
    field === "overallSummary" ? { text: "Monitor nutrition needs during treatment.", evidenceIds: ["fact:niq_risk"] }
    : field === "nutritionAdvice" ? { text: "Aim to meet your nutrition needs throughout treatment.", evidenceIds: ["rule:nutrition:test"] }
    : field === "keyFindings" ? { text: "Supporting your intake is the nutrition priority.", evidenceIds: ["fact:niq_risk"] }
    : { text: "", evidenceIds: [] },
  ])) as CompleteReportNarrative;
}
const fallback = () => ({ ...narrative(), nutritionAdvice: {
  text: "Take steps to maintain adequate food intake during treatment.", evidenceIds: ["rule:nutrition:test"],
} });

test("recovery replaces only rejected sections and retains the agent's other wording and evidence", () => {
  const candidate = narrative();
  const result = recoverNarrativeSections({ candidate, issueCodes: ["nutritionAdvice:REVIEW_UNSAFE_INSTRUCTION"], fallbackNarrative: fallback(), evidence });
  expect(result.canPreserve).toBe(true);
  expect(result.replacedFields).toEqual(["nutritionAdvice"]);
  expect(result.candidate?.nutritionAdvice).toEqual(fallback().nutritionAdvice);
  expect(result.candidate?.keyFindings).toEqual(candidate.keyFindings);
  expect(result.candidate?.overallSummary).toEqual(candidate.overallSummary);
  expect(result.origins.keyFindings).toBe("agent");
  expect(result.origins.nutritionAdvice).toBe("rule_fallback");
  expect(result.issues).toEqual([]);
});

test("deterministic evidence failures identify an affected section even without a reviewer field issue", () => {
  const candidate = narrative();
  candidate.nutritionAdvice.evidenceIds = ["missing"];
  const result = recoverNarrativeSections({ candidate, issueCodes: [], fallbackNarrative: fallback(), evidence });
  expect(result.canPreserve).toBe(true);
  expect(result.replacedFields).toEqual(["nutritionAdvice"]);
});

test("unscoped failures stay unresolved instead of replacing the entire report", () => {
  for (const issue of ["REVIEW_NOT_ACCEPTED", "MANAGER_RULE_FALLBACK", "unknownField:UNCLEAR_WORDING"]) {
    const result = recoverNarrativeSections({ candidate: narrative(), issueCodes: [issue], fallbackNarrative: fallback(), evidence });
    expect(result.canPreserve).toBe(false);
    expect(result.issues).toContain(issue);
    expect(result.replacedFields).toEqual([]);
    expect(result.candidate).toEqual(narrative());
  }
});

test("invalid candidate structure cannot be treated as preserved agent content", () => {
  const result = recoverNarrativeSections({ candidate: { keyFindings: "invalid" }, issueCodes: ["nutritionAdvice:UNCLEAR_WORDING"], fallbackNarrative: fallback(), evidence });
  expect(result.canPreserve).toBe(false);
  expect(result.candidate).toBeNull();
  expect(result.issues).toContain("INVALID_NARRATIVE_SCHEMA");
  expect(result.replacedFields).toEqual([]);
});

test("the entire merged narrative must pass deterministic checks, including replacement evidence", () => {
  const unsafeFallback = fallback();
  unsafeFallback.nutritionAdvice.evidenceIds = ["nonexistent"];
  const result = recoverNarrativeSections({ candidate: narrative(), issueCodes: ["nutritionAdvice:UNCLEAR_WORDING"], fallbackNarrative: unsafeFallback, evidence });
  expect(result.canPreserve).toBe(false);
  expect(result.issues).toContain("nutritionAdvice:UNKNOWN_EVIDENCE_ID");
});

test("formatting is normalized before verification without mutating either input", () => {
  const candidate = narrative();
  candidate.keyFindings.text = "**Supporting your intake** is the nutrition priority.";
  const before = structuredClone(candidate);
  const result = recoverNarrativeSections({ candidate, issueCodes: ["nutritionAdvice:UNCLEAR_WORDING", "nutritionAdvice:UNCLEAR_WORDING"], fallbackNarrative: fallback(), evidence });
  expect(result.canPreserve).toBe(true);
  expect(result.candidate?.keyFindings.text).toBe("Supporting your intake is the nutrition priority.");
  expect(result.replacedFields).toEqual(["nutritionAdvice"]);
  expect(candidate).toEqual(before);
});
