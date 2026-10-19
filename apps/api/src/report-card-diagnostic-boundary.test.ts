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

test("long mandatory source diagnostics stay valid and drive precise card repair", async () => {
  const f = fixture(true), cardId = "possible:toxicity:example";
  const longSource = "If nausea occurs, choose pasteurised curd if tolerated, " + "alongside suitable soft foods and small portions ".repeat(30) + ".";
  f.evidence.find(row => row.id === cardId)!.text = "Conditional possible effect: nausea. " + longSource;
  let repaired = false, sawFullDiagnostic = false, audits = 0;
  const result = await manageReportAgents({...f, invoke: async (step, _system, user, schema) => {
    const protocol = protocolResponse(user, schema); if (protocol) return protocol;
    if (step === "writer") return f.fallback;
    if (step === "reviewer") return {accepted: true, issues: []};
    if (step === "summarizer") {
      if (!(schema.properties as any).edits) return {rows: [{evidenceId: cardId, text: "If nausea occurs, choose curd."}]};
      const gaps = JSON.parse(user.match(/Audit gaps to repair: ([^\n]+)/)![1]!);
      expect(gaps).toHaveLength(1);
      expect(gaps[0].missing[0]).toContain("SOURCE_FOOD_QUALIFICATION");
      expect(gaps[0].missing[0]).toContain("pasteurised and if tolerated");
      expect(gaps[0].missing[0].length).toBeLessThanOrEqual(500);
      expect(user).toContain(longSource);
      repaired = true;
      return {edits: [{evidenceId: cardId, find: "If nausea occurs, choose curd.", replace: "If nausea occurs, choose pasteurised curd if tolerated."}]};
    }
    if (step === "coverage") {
      if (user.includes("Candidate summaries:")) {
        audits++;
        const findings = JSON.parse(user.match(/Mandatory non-waivable source, safety and wording findings: ([^\n]+)/)![1]!);
        if (findings.length) {
          expect(findings[0].reason.length).toBeGreaterThan(500);
          expect(findings[0].reason).toContain(longSource);
          sawFullDiagnostic = true;
        }
      }
      return audit(user);
    }
    if ((schema.properties as any).decision) return {decision: "approve", issues: []};
    return audit(user);
  }});
  expect(result.status).toBe("READY");
  expect(result.issues).toEqual([]);
  expect(repaired).toBe(true);
  expect(sawFullDiagnostic).toBe(true);
  expect(audits).toBe(2);
});
