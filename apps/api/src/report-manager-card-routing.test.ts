import { expect, test } from "bun:test";
import { createFinalAssessmentTemplate } from "@niq-scoring/contracts/final-assessment-template";
import { matchedReportPacket, reportEvidence, validateNarrative } from "./report-content";
import { buildDeterministicReportFallback } from "./report-fallback";
import { manageReportAgents } from "./report-manager";

function fixture(extraCard = false) {
  const definition = createFinalAssessmentTemplate("Workflow");
  const facts = { reviewedScore: 12, reviewedRiskCategoryId: "low", treatmentTypeIds: [], drugClassIds: [], confirmedToxicityIds: [], assessmentDate: "2026-10-15", observations: [] };
  const classification = { id: "low", label: "Low Risk" };
  const guidance = matchedReportPacket(definition, facts, classification.id, facts.assessmentDate);
  const evidence = reportEvidence(definition, facts, classification, guidance);
  const fallback = buildDeterministicReportFallback({ facts, classification, guidance, evidence }).narrative;
  if (extraCard) evidence.push({ id: "possible:toxicity:example", text: "Conditional possible effect: nausea. If nausea occurs, eat small, frequent meals." });
  return { aiConfig: definition.reportAi!, evidence, guidance, classification, fallback };
}
// These fixtures exercise clinical orchestration; model protocol scaffolding
// returns structurally valid source plans and optional formatting independently.
function protocolResponse(user: string, schema: Record<string, unknown>) {
  const props = schema.properties as Record<string, unknown>;
  if ((props.assignments as any)?.items?.properties?.unitId) return { assignments: JSON.parse(user).units.map((unit: any) => ({
    unitId: unit.unitId, destination: unit.evidenceId.startsWith("possible:toxicity:") ? "possibleEffectCard"
      : /^(?:rule:product:|catalog:product:)/u.test(unit.evidenceId) ? "structuredProductPlan" : "nutritionAdvice",
    cardEvidenceId: unit.evidenceId.startsWith("possible:toxicity:") ? unit.evidenceId : null,
  })) };
  if (props.sources) return {sources: JSON.parse(user).evidence.map((source: {id: string; text: string}) => {
    const card = source.id.startsWith("possible:toxicity:");
    const product = /^(?:rule:product:|catalog:product:)/u.test(source.id);
    return {evidenceId: source.id, actions: source.id.startsWith("fact:") ? [] : [{
      action: source.text, qualification: "", sourceQuote: source.text,
      destination: card ? "possibleEffectCard" : product ? "structuredProductPlan" : "nutritionAdvice",
      cardEvidenceId: card ? source.id : null, stage: card ? "card" : product ? "assembled" : "narrative",
    }]};
  })};
  if (props.sections) return {sections: JSON.parse(user).sections.map((section: {section: string; points: Array<{id: string}>}) => ({
    section: section.section, points: section.points.map(point => ({id: point.id, phrases: []})),
  }))};
  return undefined;
}
function audit(user: string) {
  const sources = JSON.parse(user.match(/(?:Candidate source rows|Source rows): (\[[\s\S]*?\])\n/)?.[1] ?? "[]") as { id: string }[];
  return { rows: sources.map(row => ({ evidenceId: row.id, covered: true, missing: [] })) };
}

test("final manager repairs the named effect card and independently rechecks changed text", async () => {
  const f = fixture(true), cardId = "possible:toxicity:example";
  const original = "If nausea occurs, eat small, frequent meals.";
  const addition = " Choose plain foods if tolerated.";
  f.evidence.find(row => row.id === cardId)!.text += addition;
  let decisions = 0, cardRepairs = 0, checkedChanged = false;
  const result = await manageReportAgents({...f, invoke: async (step, _system, user, schema) => {
    const protocol = protocolResponse(user, schema); if (protocol) return protocol;
    if (step === "writer") return f.fallback;
    if (step === "reviewer") return {accepted: true, issues: []};
    if (step === "revision") throw new Error("Card concern must never edit narrative");
    if (step === "summarizer") {
      if (!(schema.properties as any).edits) return {rows: [{evidenceId: cardId, text: original}]};
      cardRepairs++;
      expect(user).toContain("Choose plain foods if tolerated");
      return {edits: [{evidenceId: cardId, find: "", replace: addition.trim()}]};
    }
    if (step === "coverage") {
      if (user.includes("Candidate summaries:") && user.includes(original + addition)) checkedChanged = true;
      // Deliberately permissive worker: the retained manager finding must still
      // force repair of the original card, then clear on independent re-audit.
      return audit(user);
    }
    if ((schema.properties as any).decision) {
      decisions++;
      expect((schema.properties as any).issues.items.properties.field.enum).toContain(cardId);
      if (decisions === 1) return {decision: "fallback", issues: [{field: cardId, evidenceIds: [cardId], reason: "Missing source instruction: Choose plain foods if tolerated."}]};
      expect(checkedChanged).toBe(true);
      return {decision: "approve", issues: []};
    }
    return audit(user);
  }});
  expect(result.status).toBe("READY");
  expect(result.issues).toEqual([]);
  expect(cardRepairs).toBe(1);
  expect(decisions).toBe(2);
  expect(result.interventionSummaries[0]!.text.replaceAll("**", "")).toBe(original + addition);
  for (const field of Object.keys(f.fallback) as Array<keyof typeof f.fallback>)
    expect(result.narrative[field].text.replaceAll("**", "")).toBe(f.fallback[field]!.text.replaceAll("**", ""));
});

test.each(["possible:toxicity:absent", "fact:niq_risk"])("final manager rejects component %s absent from issued output identifiers", async invalidField => {
  const f = fixture(true);
  const result = await manageReportAgents({...f, invoke: async (step, _system, user, schema) => {
    const protocol = protocolResponse(user, schema); if (protocol) return protocol;
    if (step === "writer") return f.fallback;
    if (step === "reviewer") return {accepted: true, issues: []};
    if (step === "summarizer") return {rows: [{evidenceId: "possible:toxicity:example", text: "If nausea occurs, eat small, frequent meals."}]};
    if ((schema.properties as any).decision) return {decision: "fallback", issues: [{field: invalidField, evidenceIds: ["possible:toxicity:example"], reason: "Missing instruction."}]};
    return audit(user);
  }});
  expect(result.status).toBe("REVIEW_REQUIRED");
  expect(result.issues).toEqual(["MODEL_INVALID_MANAGER_DECISION"]);
});
