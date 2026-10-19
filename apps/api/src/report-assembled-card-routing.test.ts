import { expect, test } from "bun:test";
import { createFinalAssessmentTemplate } from "@niq-scoring/contracts/final-assessment-template";
import { matchedReportPacket, reportEvidence, validateNarrative } from "./report-content";
import { buildDeterministicReportFallback } from "./report-fallback";
import { coordinateReportAgents } from "./report-agent-coordinator";
import { assessCoverage, requiredCoverageSources, coverageJsonSchema } from "./report-coverage";
import { constrainCoverageComponents } from "./report-output-scope";

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

test.each([false, true])("assembled source findings route into actual card repair (mixed narrative: %s)", async mixed => {
  const f = fixture(true), cardId = "possible:toxicity:example";
  const original = "Increase fibre gradually with cooked vegetables, fruit or oats.";
  const corrected = "When appropriate and according to tolerance, increase fibre gradually with cooked vegetables, fruit or oats.";
  f.evidence.find(row => row.id === cardId)!.text = "Conditional possible effect: Constipation. " + corrected;
  let cardRepairs = 0, narrativeRepairs = 0, assembledPasses = 0;
  let independentlyChecked = false;
  const result = await coordinateReportAgents({...f, invoke: async (step, _system, user, schema) => {
    if (step === "writer") return f.fallback;
    if (step === "reviewer") return {accepted: true, issues: []};
    if (step === "revision") {
      narrativeRepairs++;
      expect(mixed).toBe(true);
      expect(user).not.toContain(`[${cardId}]`);
      return {edits: [{field: "nutritionAdvice", find: "", replace: "Keep meals regular.", evidenceIds: [f.evidence.find(row => row.id.startsWith("rule:nutrition:"))!.id]}]};
    }
    if (step === "summarizer") {
      if (!(schema.properties as any).edits) return {rows: [{evidenceId: cardId, text: original}]};
      cardRepairs++;
      expect(user).toContain("Qualify the gradual fibre increase");
      return {edits: [{evidenceId: cardId, find: original, replace: corrected}]};
    }
    if (step === "coverage" && user.includes("Complete report")) {
      assembledPasses++;
      const rows = audit(user).rows;
      if (assembledPasses === 1) return {rows: rows.map((row, i) => i ? row : ({...row, covered: false,
        missing: [`[${cardId}] Qualify the gradual fibre increase as appropriate and according to tolerance.`, ...(mixed ? ["[nutritionAdvice] Missing regular-meal instruction."] : [])]}))};
      expect(cardRepairs).toBe(1);
      return {rows};
    }
    if (step === "coverage" && user.includes("Candidate summaries:") && user.includes(corrected)) independentlyChecked = true;
    if (step === "manager" && user.includes("Original audit:")) return user.includes("Candidate summaries:")
      ? audit(user) : JSON.parse(user.match(/Original audit: (\{.*\})$/su)![1]!);
    // Deliberately permissive card workers cannot forget an assembled finding
    // on the unchanged card; only a repair plus fresh audit can clear it.
    return audit(user);
  }});
  expect(result.status).toBe("READY");
  expect(result.issues).toEqual([]);
  expect(cardRepairs).toBe(1);
  expect(narrativeRepairs).toBe(mixed ? 1 : 0);
  expect(independentlyChecked).toBe(true);
  expect(result.interventionSummaries[0]!.text).toBe(corrected);
});


test("assembled component routing preserves attribution and rejects unknown or malformed targets", () => {
  const f = fixture(true), sources = requiredCoverageSources(f.evidence);
  const source = sources[0]!;
  const allowed = ["nutritionAdvice", "monitoringSummary", "possible:toxicity:example"];
  const rows = sources.map(row => ({evidenceId: row.id, covered: true, missing: [] as string[]}));
  const result = assessCoverage({rows: rows.map(row => row.evidenceId === source.id ? {...row, covered: false, missing: [
    "[monitoringSummary] Name the care team as actor.", "[possible:toxicity:example] Retain the local source qualification.",
  ]} : row)}, sources, f.fallback, allowed);
  expect(result.invalid).toBe(false);
  expect(result.gaps).toEqual([
    {id: source.id, field: source.field, component: "monitoringSummary", missing: ["Name the care team as actor."]},
    {id: source.id, field: source.field, component: "possible:toxicity:example", missing: ["Retain the local source qualification."]},
  ]);
  for (const missing of ["Missing an explicit component.", "[possible:toxicity:unknown] Missing warning.", "[fact:niq_risk] Missing warning.", "[nutritionAdvice]", "[nutritionAdvice Missing warning."]) {
    expect(assessCoverage({rows: rows.map(row => row.evidenceId === source.id ? {...row, covered: false, missing: [missing]} : row)}, sources, f.fallback, allowed).invalid).toBe(true);
  }
});

test("live assembled schema requires known component prefixes without mutating card audit schema", () => {
  const scoped = constrainCoverageComponents(coverageJsonSchema, ["nutritionAdvice", "possible:toxicity:a.b"] ) as any;
  const pattern = new RegExp(scoped.properties.rows.items.properties.missing.items.pattern);
  expect(pattern.test("[nutritionAdvice] Missing action.")).toBe(true);
  expect(pattern.test("[possible:toxicity:a.b] Missing qualification.")).toBe(true);
  for (const value of ["Unscoped action.", "[possible:toxicity:axb] Missing qualification.", "[possible:toxicity:absent] Missing qualification.", "[nutritionAdvice] "]) expect(pattern.test(value)).toBe(false);
  expect((coverageJsonSchema as any).properties.rows.items.properties.missing.items.pattern).toBeUndefined();
});
