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
function replacePassage(user: string, field: string, text: string) {
  const draft = JSON.parse(user.match(/\nCurrent draft: ([^\n]*)/)![1]!);
  return {edits: [{field, find: draft[field].text, replace: text,
    evidenceIds: draft[field].evidenceIds}]};
}
function audit(user: string) {
  const sources = JSON.parse(user.match(/(?:Candidate source rows|Source rows): (\[[\s\S]*?\])\n/)?.[1] ?? "[]") as { id: string }[];
  return { rows: sources.map(row => ({ evidenceId: row.id, covered: true, missing: [] })) };
}

test("highlights only after the final clinical decision approves the complete report", async () => {
  const f = fixture(); let approved = false; const formattedBeforeApproval: boolean[] = [];
  await manageReportAgents({ ...f, invoke: async (step, _system, user, schema) => {
    if (step === "highlighter" && (schema.properties as any).sections) formattedBeforeApproval.push(!approved);
    const protocol = protocolResponse(user, schema); if (protocol) return protocol;
    if (step === "writer") return f.fallback;
    if (step === "reviewer") return { accepted: true, issues: [] };
    if (step === "coverage") return audit(user);
    if (step === "highlighter") { formattedBeforeApproval.push(!approved); return { points: JSON.parse(user).points.map((p: any) => ({ id: p.id, phrases: [] })) }; }
    const props = schema.properties as any;
    if (props.assignments) return { assignments: ["writer", "reviewer", "coverage", "summarizer", "highlighter"].map(role => ({ role })) };
    if (props.decision) { approved = true; return { decision: "approve", issues: [] }; }
    return { accepted: true, issues: [] };
  } });
  expect(formattedBeforeApproval.length).toBeGreaterThan(0);
  expect(formattedBeforeApproval.every(value => !value)).toBe(true);
});

test("assembled coverage sees generated effect cards rather than rejecting their future absence", async () => {
  const f = fixture(true); let summarized = false; const snapshots: string[] = [];
  const result = await manageReportAgents({ ...f, invoke: async (step, _system, user, schema) => {
    const protocol = protocolResponse(user, schema); if (protocol) return protocol;
    if (step === "writer") return f.fallback;
    if (step === "reviewer") return { accepted: true, issues: [] };
    if (step === "summarizer") { summarized = true; return { rows: [{ evidenceId: "possible:toxicity:example", text: "If nausea occurs, eat small, frequent meals." }] }; }
    if (step === "coverage") { if (user.includes("Complete report")) { expect(summarized).toBe(true); snapshots.push(user); } return audit(user); }
    if (step === "highlighter") return { points: JSON.parse(user).points.map((p: any) => ({ id: p.id, phrases: [] })) };
    const props = schema.properties as any;
    if (props.assignments) return { assignments: ["writer", "reviewer", "coverage", "summarizer", "highlighter"].map(role => ({ role })) };
    if (props.decision) return { decision: "approve", issues: [] };
    return { accepted: true, issues: [] };
  } });
  expect(result.status).toBe("READY");
  expect(snapshots.length).toBeGreaterThan(0);
  expect(snapshots[0]).toContain('"interventionSummaries"');
  expect(snapshots[0]).toContain("If nausea occurs, eat small, frequent meals.");
});

test("section recovery preserves unrelated agent prose and independently reviews the merged report", async () => {
  const f = fixture();
  const original = { ...f.fallback,
    keyFindings: { text: "Your assessment identifies nutritional concerns that need attention.", evidenceIds: ["fact:niq_risk"] },
    nutritionAdvice: { text: "Maintain regular meals and adequate nutrition.", evidenceIds: ["rule:nutrition:nutrition_low"] } };
  let sawMergedReview = false;
  const result = await manageReportAgents({ ...f, sectionFallback: () => f.fallback, invoke: async (step, _system, user, schema) => {
    const protocol = protocolResponse(user, schema); if (protocol) return protocol;
    if (step === "writer") return original;
    if (step === "reviewer") {
      const draft = JSON.parse(user.split("\nDraft: ").at(-1)!);
      const repaired = draft.nutritionAdvice.text === f.fallback.nutritionAdvice.text.replaceAll("**", "");
      sawMergedReview ||= repaired;
      return repaired ? { accepted: true, issues: [] } : { accepted: false, issues: [{ field: "nutritionAdvice", code: "UNCLEAR_WORDING", evidenceIds: ["rule:nutrition:nutrition_low"], reason: "The nutrition instruction omits the source's specific practical guidance." }] };
    }
    if (step === "revision") return {edits: []};
    if (step === "coverage") return audit(user);
    if (step === "highlighter") return { points: JSON.parse(user).points.map((p: any) => ({ id: p.id, phrases: [] })) };
    const props = schema.properties as any;
    if (props.retainedIssueIndexes) return { retainedIssueIndexes: [0] };
    if (props.decision) return { decision: "approve", issues: [] };
    return { accepted: true, issues: [] };
  } });
  expect(result.status).toBe("READY");
  expect(sawMergedReview).toBe(true);
  expect(result.narrative.keyFindings.text.replaceAll("**", "")).toBe(original.keyFindings.text);
  expect(result.sectionOrigins.nutritionAdvice).toBe("rule_fallback");
  expect(result.sectionOrigins.keyFindings).toBe("agent");
});

test("coverage errors describe repaired content even when its new clinical review fails", async () => {
  const f = fixture(); let audits = 0, afterRepair = false;
  const result = await manageReportAgents({ ...f, invoke: async (step, _system, user, schema) => {
    const protocol = protocolResponse(user, schema); if (protocol) return protocol;
    if (step === "writer") return f.fallback;
    if (step === "reviewer") return afterRepair
      ? { accepted: false, issues: [{ field: "nutritionAdvice", code: "UNCLEAR_WORDING", evidenceIds: ["rule:nutrition:nutrition_low"], reason: "The repaired wording needs clarification." }] }
      : { accepted: true, issues: [] };
    if (step === "revision") { afterRepair = true;
      return replacePassage(user, "nutritionAdvice", "Maintain your nutrition intake with regular meals."); }
    if (step === "coverage") {
      const rows = audit(user).rows; audits++;
      return { rows: rows.map(row => audits === 1 ? { ...row, covered: false, missing: ["[nutritionAdvice] The practical nutrition action is missing."] } : row) };
    }
    const props = schema.properties as any;
    if (props.retainedIssueIndexes) return { retainedIssueIndexes: [0] };
    if (props.rows) return { rows: audit(user).rows.map(row => ({ ...row, covered: false, missing: ["[nutritionAdvice] The practical nutrition action is missing."] })) };
    if (props.decision) return { decision: "approve", issues: [] };
    return { accepted: true, issues: [] };
  } });
  expect(audits).toBe(3);
  expect(result.status).toBe("REVIEW_REQUIRED");
  expect(result.issues).toContain("nutritionAdvice:UNCLEAR_WORDING");
  expect(result.issues).not.toContain("nutritionAdvice:MISSING_SOURCE_CONTENT");
  expect(result.narrative.nutritionAdvice.text).toContain("regular meals");
});

test("a report-wide budget bounds concurrent calls before dispatch", async () => {
  const { createReportCallBudget, ReportCallBudgetExceeded } = await import("./report-manager");
  let dispatched = 0;
  const invoke = createReportCallBudget(async () => { dispatched++; return {}; }, 2, 1);
  await Promise.all([invoke("reviewer", "", "", {}), invoke("coverage", "", "", {})]);
  await expect(invoke("manager", "", "", {})).rejects.toBeInstanceOf(ReportCallBudgetExceeded);
  await invoke("highlighter", "", "", {});
  await expect(invoke("highlighter", "", "", {})).rejects.toBeInstanceOf(ReportCallBudgetExceeded);
  expect(dispatched).toBe(3);
});

test("matched drug class remains explicit evidence for source conflict judgments", () => {
  const definition = createFinalAssessmentTemplate("Class evidence");
  const facts = { reviewedScore: 12, reviewedRiskCategoryId: "low", treatmentTypeIds: ["current_cancer_treatment_chemotherapy"], drugClassIds: ["antimetabolites"], confirmedToxicityIds: [], assessmentDate: "2026-10-15", observations: [] };
  const classification = { id: "low", label: "Low Risk" };
  const guidance = matchedReportPacket(definition, facts, classification.id, facts.assessmentDate);
  const evidence = reportEvidence(definition, facts, classification, guidance);
  expect(evidence.find(row => row.id === "fact:drug_class_antimetabolites")?.text).toContain("Antimetabolites");
});

test("card writers and assembled auditors receive matched context and recorded target decisions", async () => {
  const f = fixture(true);
  f.evidence.push({ id: "resolution:target:protein", text: "Manager numeric-target resolution. Your care team will individualise your protein target. Withhold the disputed numeric ranges." });
  const observed: string[] = [];
  await manageReportAgents({ ...f, invoke: async (step, _system, user, schema) => {
    const protocol = protocolResponse(user, schema); if (protocol) return protocol;
    if (step === "writer") return f.fallback;
    if (step === "reviewer") return { accepted: true, issues: [] };
    if (step === "summarizer") { observed.push(user); return { rows: [{ evidenceId: "possible:toxicity:example", text: "If nausea occurs, eat small, frequent meals." }] }; }
    if (step === "coverage") { observed.push(user); return audit(user); }
    if (step === "highlighter") return { points: JSON.parse(user).points.map((p: any) => ({ id: p.id, phrases: [] })) };
    if ((schema.properties as any).decision) return { decision: "approve", issues: [] };
    return { accepted: true, issues: [] };
  } });
  expect(observed.length).toBeGreaterThanOrEqual(3);
  expect(observed.every(user => user.includes("resolution:target:protein"))).toBe(true);
});


test("patient prose does not prescribe clinician-managed feeding as self-care", () => {
  const f = fixture();
  f.evidence.push({ id: "rule:nutrition:feeding", text: "Under medical supervision, initiate enteral nutrition when intake is inadequate." });
  const part = { text: "If intake is inadequate, start enteral nutrition.", evidenceIds: ["rule:nutrition:nutrition_low", "rule:nutrition:feeding"] };
  expect(validateNarrative({ ...f.fallback, nutritionAdvice: part }, f.evidence).issues).toContain("nutritionAdvice:CLINICIAN_ACTION_NEEDS_ACTOR");
  expect(validateNarrative({ ...f.fallback, nutritionAdvice: { ...part, text: "If intake is inadequate, your care team should assess and initiate enteral nutrition." } }, f.evidence).issues).not.toContain("nutritionAdvice:CLINICIAN_ACTION_NEEDS_ACTOR");
});

test("nutrition guidance cannot invent frequency by repeating the structured product regimen", () => {
  const f = fixture();
  f.evidence.push({ id: "rule:product:example", text: "Selected product plan: Sample Nutrition. Dose: 3 per day. Mix in water." });
  const part = { text: "Take Sample Nutrition 3 times daily and mix in water.", evidenceIds: ["rule:nutrition:nutrition_low", "rule:product:example"] };
  expect(validateNarrative({ ...f.fallback, nutritionAdvice: part }, f.evidence).issues).toContain("nutritionAdvice:REGIMEN_BELONGS_IN_PRODUCT_PLAN");
});

test("a clear care-team pronoun remains a clinician-managed instruction after punctuation normalization", () => {
  const f = fixture();
  f.evidence.push({ id: "rule:nutrition:feeding", text: "Under medical supervision, initiate enteral nutrition and consider parenteral nutrition when required." });
  const part = { text: "Your care team should initiate enteral nutrition. If that is not feasible, they may consider parenteral nutrition.", evidenceIds: ["rule:nutrition:nutrition_low", "rule:nutrition:feeding"] };
  expect(validateNarrative({ ...f.fallback, treatmentAdvice: part }, f.evidence).issues).not.toContain("treatmentAdvice:CLINICIAN_ACTION_NEEDS_ACTOR");
});

test("a newly rejected card is repaired and re-audited without regenerating approved cards", async () => {
  const f = fixture(true); let repairedNarrative = false, repairedCard = 0, cardAudits = 0, incompleteAuditReturned = false;
  f.evidence.find(row => row.id === "possible:toxicity:example")!.text += " Wash fruit before eating.";
  const result = await manageReportAgents({ ...f, invoke: async (step, _system, user, schema) => {
    const protocol = protocolResponse(user, schema); if (protocol) return protocol;
    if (step === "writer") return f.fallback;
    if (step === "reviewer") return { accepted: true, issues: [] };
    if (step === "summarizer") {
      if ((schema.properties as any).edits) {
        expect(user).toContain("Missing practical card action"); repairedCard++;
        return {edits: [{evidenceId: "possible:toxicity:example", find: "",
          replace: repairedCard === 1 ? "Retain the supported practical care." : "Wash fruit before eating."}]};
      }
      return {rows: [{evidenceId: "possible:toxicity:example", text: "If nausea occurs, eat small, frequent meals."}]};
    }
    if (step === "revision") {
      expect((schema.properties as any).edits).toBeDefined();
      expect(user).toContain("Current draft:");
      repairedNarrative = true;
      return {edits: [{field: "foodSafetyAdvice", find: "", replace: "Wash fruit before eating.", evidenceIds: ["possible:toxicity:example"]}]};
    }
    if (step === "coverage" || (schema.properties as any).rows) {
      const response = audit(user);
      if (user.includes("Candidate source rows:") || user.startsWith("Source rows:")) {
        cardAudits++;
        if (repairedNarrative) {
          const shared = JSON.parse(user.match(/Shared report sections: ([^\n]*)/)![1]!);
          expect(shared.foodSafetyAdvice.text).toContain("Wash fruit before eating.");
        }
        if (repairedNarrative && !incompleteAuditReturned) { expect(user).toContain("Earlier adjudicated card judgments"); expect(user).toContain('"previouslyCovered":true'); incompleteAuditReturned = true; return { rows: [] }; }
        if (repairedNarrative && repairedCard < 2) return { rows: response.rows.map(row => ({ ...row, covered: false, missing: [repairedCard === 0 ? "Missing practical card action" : "Missing practical card action: retain the source qualification"] })) };
      } else if (!repairedNarrative) return { rows: response.rows.map(row => ({ ...row, covered: false, missing: ["[foodSafetyAdvice] Missing supported nutrition action"] })) };
      return response;
    }
    if (step === "highlighter") return { points: JSON.parse(user).points.map((p: any) => ({ id: p.id, phrases: [] })) };
    if ((schema.properties as any).decision) return { decision: "approve", issues: [] };
    return { accepted: true, issues: [] };
  } });
  expect(repairedCard).toBe(2);
  expect(cardAudits).toBeGreaterThanOrEqual(3);
  expect(result.status).toBe("READY");
  expect(result.interventionSummaries[0]!.text.replaceAll("**", "")).toBe("If nausea occurs, eat small, frequent meals. Retain the supported practical care. Wash fruit before eating.");
});

test("an incomplete card audit gets one bounded fresh audit before holding the report", async () => {
  const f = fixture(true); let cardAudits = 0;
  const result = await manageReportAgents({ ...f, invoke: async (step, _system, user, schema) => {
    const protocol = protocolResponse(user, schema); if (protocol) return protocol;
    if (step === "writer") return f.fallback;
    if (step === "reviewer") return { accepted: true, issues: [] };
    if (step === "summarizer") return { rows: [{ evidenceId: "possible:toxicity:example", text: "If nausea occurs, eat small, frequent meals." }] };
    if (step === "coverage") {
      if (user.includes("Candidate source rows:") && ++cardAudits === 1) return { rows: [] };
      return audit(user);
    }
    if (step === "highlighter") return { points: JSON.parse(user).points.map((p: any) => ({ id: p.id, phrases: [] })) };
    if ((schema.properties as any).decision) return { decision: "approve", issues: [] };
    return { accepted: true, issues: [] };
  } });
  expect(result.status).toBe("READY");
  expect(cardAudits).toBe(2);
});

test("patient-facing interpretation rejects internal scoring workflow language", () => {
  const f = fixture();
  const keyFindings={text:'Your reviewed NIQ score is 12, mapped to the nutritional status Well nourished.',evidenceIds:['fact:niq_risk']};
  expect(validateNarrative({...f.fallback,keyFindings},f.evidence).issues).toContain('keyFindings:INTERNAL_WORKFLOW_WORDING');
});

test("nutrition repairs receive treatment-derived advice and preserve cited source context", async () => {
  const { coordinateReportAgents } = await import("./report-agent-coordinator");
  const f = fixture();
  const source = { id: "rule:treatment:radiotherapy_nutrition", text: "Have regular meals and 2–3 snacks, with tolerated prebiotic foods." };
  f.evidence.push(source);
  let repairEvidence: Array<{ id: string; text: string }> = [];
  await expect(coordinateReportAgents({ ...f, initialDraft: f.fallback, invoke: async (step, _system, user, schema) => {
    const protocol = protocolResponse(user, schema); if (protocol) return protocol;
    if (step === "reviewer") return { accepted: false, issues: [{ field: "nutritionAdvice", code: "UNCLEAR_WORDING", reason: "Include the supported meals, snack quantity and prebiotic guidance.", evidenceIds: [source.id] }] };
    if ((schema.properties as any).retainedIssueIndexes) return { retainedIssueIndexes: [0] };
    if (step === "revision") {
      repairEvidence = JSON.parse(user.split("\nEvidence: ").at(-1)!).evidence;
      throw new Error("Stop after observing the actual repair request");
    }
    throw new Error(`Unexpected step ${step}`);
  } })).rejects.toThrow("Stop after observing the actual repair request");
  expect(repairEvidence).toContainEqual(source);
});

test.each([false,true])("assembled repair resolves fresh placement concerns even when coverage cleared: %s", async (coverageClearsFirst) => {
  const { coordinateReportAgents } = await import("./report-agent-coordinator");
  const f = fixture(); let repairs = 0;
  const result = await coordinateReportAgents({ ...f, initialDraft: f.fallback, invoke: async (step, _system, user, schema) => {
    const protocol = protocolResponse(user, schema); if (protocol) return protocol;
    if (step === "reviewer") return repairs === 1
      ? { accepted: false, issues: [{ field: "treatmentAdvice", code: "UNCLEAR_WORDING", reason: "Move the supported food guidance into nutritionAdvice.", evidenceIds: ["rule:nutrition:nutrition_low"] }] }
      : { accepted: true, issues: [] };
    if (step === "coverage" || (schema.properties as any).rows) return { rows: audit(user).rows.map(row => ({ ...row, covered: repairs >= (coverageClearsFirst ? 1 : 2), missing: repairs >= (coverageClearsFirst ? 1 : 2) ? [] : ["[nutritionAdvice] The nutrition guidance is missing from its proper field."] })) };
    if ((schema.properties as any).retainedIssueIndexes) return { retainedIssueIndexes: [0] };
    if (step === "revision") {
      repairs++;
      return {edits: []};
    }
    throw new Error(`Unexpected step ${step}`);
  } });
  expect(repairs).toBe(2);
  expect(result.status).toBe("READY");
  expect(result.issues).toEqual([]);
});


test("an invalid shared checklist stops before drafting or formatting", async () => {
  const f = fixture(); const steps: string[] = [];
  await expect(manageReportAgents({ ...f, invoke: async step => {
    steps.push(step); return { sources: [] };
  } })).rejects.toThrow("MODEL_INVALID_SOURCE_CHECKLIST");
  expect(steps).toEqual(["manager"]);
});

test("model approval cannot waive a recorded diet mismatch in an effect card", async () => {
  const f = fixture(true); f.evidence.push({ id: "fact:diet_preference", text: "Reported diet preference: Vegetarian" });
  f.evidence.find(row => row.id === "possible:toxicity:example")!.text += " Paneer is a protein option.";
  let repaired = false;
  const result = await manageReportAgents({ ...f, invoke: async (step, _system, user, schema) => {
    const protocol = protocolResponse(user, schema); if (protocol) return protocol;
    if (step === "writer") return f.fallback;
    if (step === "reviewer") return { accepted: true, issues: [] };
    if (step === "summarizer") {
      if ((schema.properties as any).edits) {
        expect(user).toContain("DIET_INCOMPATIBLE_FOOD"); repaired = true;
        return { edits: [{ evidenceId: "possible:toxicity:example", find: "Try eggs for protein.", replace: "Choose paneer for protein." }] };
      }
      return { rows: [{ evidenceId: "possible:toxicity:example", text: "If nausea occurs, eat small, frequent meals. Try eggs for protein." }] };
    }
    if (step === "coverage" || (schema.properties as any).rows) return audit(user);
    if ((schema.properties as any).decision) return { decision: "approve", issues: [] };
    return { accepted: true, issues: [] };
  } });
  expect(repaired).toBe(true);
  expect(result.status).toBe("READY");
  expect(result.interventionSummaries[0]!.text).not.toMatch(/\beggs?\b/iu);
  expect(result.interventionSummaries[0]!.text.replaceAll("**", "")).toContain("eat small, frequent meals.");
});

test("a final manager concern goes straight to repair and reviews only the changed draft", async () => {
  const f = fixture(); let reviewers = 0, decisions = 0, repaired = false;
  const result = await manageReportAgents({ ...f, invoke: async (step, _system, user, schema) => {
    const protocol = protocolResponse(user, schema); if (protocol) return protocol;
    if (step === "writer") return f.fallback;
    if (step === "reviewer") { reviewers++; return {accepted: true, issues: []}; }
    if (step === "coverage") return audit(user);
    if (step === "revision") { repaired = true; return replacePassage(user, "monitoringSummary", "Track your weight and intake with the care team."); }
    if ((schema.properties as any).decision) {
      decisions++;
      return decisions === 1 ? {decision: "fallback", issues: [{field: "monitoringSummary", reason: "Include intake tracking in monitoringSummary.", evidenceIds: ["rule:nutrition:nutrition_low"]}]}
        : {decision: "approve", issues: []};
    }
    return {retainedIssueIndexes: []};
  }});
  expect(result.status).toBe("READY");
  expect(repaired).toBe(true);
  expect(decisions).toBe(2);
  expect(reviewers).toBe(2);
});

test("a trailing clinician clarification cannot waive an earlier patient-directed deficiency instruction", () => {
  const f = fixture();
  f.evidence.push({id: "rule:treatment:deficiencies", text: "Correct documented deficiencies."});
  const part = {text: "Ensure adequate vitamins and minerals, correct documented deficiencies, and avoid high-dose supplements. The care team should manage correction of documented deficiencies.", evidenceIds: ["rule:treatment:deficiencies"]};
  expect(validateNarrative({...f.fallback, nutritionAdvice: part},f.evidence).issues).toContain("nutritionAdvice:CLINICIAN_ACTION_NEEDS_ACTOR");
  expect(validateNarrative({...f.fallback, nutritionAdvice: {...part,text: "Ensure adequate vitamins and minerals. The care team should correct documented deficiencies. Avoid high-dose supplements."}},f.evidence).issues).not.toContain("nutritionAdvice:CLINICIAN_ACTION_NEEDS_ACTOR");
});

test("model approval cannot waive matched food qualifications within each recommending card", async () => {
  const f = fixture(true);
  f.evidence.find(row => row.id === "possible:toxicity:example")!.text += " Include pasteurised curd if tolerated.";
  let repaired = false;
  const result = await manageReportAgents({...f,invoke: async(step,_system,user,schema)=>{
    const protocol=protocolResponse(user,schema);if(protocol)return protocol;
    if(step==="writer")return f.fallback;
    if(step==="reviewer")return {accepted:true,issues:[]};
    if(step==="summarizer"){
      if((schema.properties as any).edits){
        expect(user).toContain("SOURCE_FOOD_QUALIFICATION");repaired=true;
        return {edits:[{evidenceId:"possible:toxicity:example",find:"Choose curd.",replace:"Choose pasteurised curd if tolerated."}]};
      }
      return {rows:[{evidenceId:"possible:toxicity:example",text:"If nausea occurs, eat small, frequent meals. Choose curd."}]};
    }
    if(step==="coverage"||(schema.properties as any).rows)return audit(user);
    if((schema.properties as any).decision)return {decision:"approve",issues:[]};
    return {accepted:true,issues:[]};
  }});
  expect(repaired).toBe(true);
  expect(result.status).toBe("READY");
  expect(result.interventionSummaries[0]!.text.replaceAll("**","")).toContain("Choose pasteurised curd if tolerated.");
  expect(result.interventionSummaries[0]!.text.replaceAll("**","")).toContain("eat small, frequent meals.");
});

test("copy repairs receive the actual overlapping source passage instead of guessing a food list", async()=>{
 const f=fixture();
 const copied="Increase fibre gradually for constipation when appropriate. Include prebiotic foods such as oats, banana and tolerated vegetables. Modify fermentable foods if bloating occurs. Pasteurised curd may be included if tolerated.";
 const id="rule:treatment:copy_diagnostic";
 f.evidence.push({id,text:copied});
 const draft={...f.fallback,nutritionAdvice:{text:f.fallback.nutritionAdvice.text+" "+copied,evidenceIds:[...f.fallback.nutritionAdvice.evidenceIds,id]}};
 let diagnosed=false, firstReviewDiagnosed=false;
 const result=await manageReportAgents({...f,invoke:async(step,_system,user,schema)=>{
  const protocol=protocolResponse(user,schema);if(protocol)return protocol;
  if(step==="writer")return draft;
  if(step==="reviewer") {
   if(!diagnosed) {
    const findings=JSON.parse(user.match(/Known candidate validation findings \(check these in this same pass\): (.*?)\. Do not reopen/s)![1]!);
    expect(findings.find((i:any)=>i.code==="nutritionAdvice:COPIED_GUIDANCE").copiedPassages[0].anchors).toContain("Modify fermentable foods if bloating occurs.");
    firstReviewDiagnosed=true;
   }
   return {accepted:true,issues:[]};
  }
  if(step==="revision"){
   const issues=JSON.parse(user.match(/\nIssues: ([^\n]*)/)![1]!);
   const diagnostic=issues.find((i:any)=>i.code==="nutritionAdvice:COPIED_GUIDANCE");
   expect(diagnostic.copiedPassages[0].evidenceId).toBe(id);
   expect(diagnostic.copiedPassages[0].matchedText).toContain("Increase fibre gradually");
   expect(diagnostic.copiedPassages[0].anchors).toContain("Modify fermentable foods if bloating occurs.");
   diagnosed=true;
   return {edits:[{field:"nutritionAdvice",find:"Increase fibre gradually for constipation when appropriate.",replace:"If constipation occurs, build up fibre slowly when suitable.",evidenceIds:[id]},
    {field:"nutritionAdvice",find:"Include prebiotic foods such as oats, banana and tolerated vegetables.",replace:"Oats and banana can provide prebiotic foods alongside vegetables you tolerate.",evidenceIds:[id]}]};
  }
  if(step==="coverage")return audit(user);
  if((schema.properties as any).decision)return {decision:"approve",issues:[]};
  return {accepted:true,issues:[]};
 }});
 expect(firstReviewDiagnosed).toBe(true);expect(diagnosed).toBe(true);expect(result.status).toBe("READY");
});

test("a selected plan does not suppress source-supported clinician initiation of supplements",()=>{
 const f=fixture();
 f.evidence.push({id:"rule:product:selected",text:"Selected product plan: Example. Dosage and preparation: 1 per day."});
 const part={text:"If intake is suboptimal, the care team should introduce oral nutrition supplements.",evidenceIds:["rule:nutrition:nutrition_low"]};
 expect(validateNarrative({...f.fallback,nutritionAdvice:part},f.evidence).issues).not.toContain("nutritionAdvice:REDUNDANT_SUPPLEMENT_PROMPT");
 expect(validateNarrative({...f.fallback,nutritionAdvice:{...part,text:"Ask whether oral nutrition supplements are suitable."}},f.evidence).issues).toContain("nutritionAdvice:REDUNDANT_SUPPLEMENT_PROMPT");
});

test("supplement wording distinguishes clinical actions from suitability questions", () => {
 const f=fixture();
 f.evidence.push({id:"rule:product:selected",text:"Selected product plan: Example. Dosage and preparation: 1 per day."});
 for (const field of ["nutritionAdvice", "effectsAdvice"] as const) {
  for (const text of [
   "Have 2–3 snacks, and ask your care team to add oral nutrition supplements if your intake is insufficient.",
   "Ask your care team to add or manage oral nutrition supplements if they are required.",
   "Ask your care team about your appetite. Use oral nutrition supplements as prescribed.",
  ]) expect(validateNarrative({...f.fallback,[field]:{text,evidenceIds:["rule:nutrition:nutrition_low"]}},f.evidence).issues).not.toContain(`${field}:REDUNDANT_SUPPLEMENT_PROMPT`);
  for (const text of [
   "Ask whether oral nutrition supplements are suitable.",
   "Ask your care team about oral nutrition supplements.",
   "Ask your care team if diabetic supplements are suitable.",
   "Ask your care team about supplement compatibility.",
  ]) expect(validateNarrative({...f.fallback,[field]:{text,evidenceIds:["rule:nutrition:nutrition_low"]}},f.evidence).issues).toContain(`${field}:REDUNDANT_SUPPLEMENT_PROMPT`);
 }
});

test("invalid and empty repair transactions retry within the same limit without re-reviewing unchanged text",async()=>{
 const f=fixture();let revisions=0,reviews=0,repaired=false;
 const result=await manageReportAgents({...f,invoke:async(step,_system,user,schema)=>{
  const protocol=protocolResponse(user,schema);if(protocol)return protocol;
  if(step==="writer")return f.fallback;
  if(step==="reviewer"){reviews++;return repaired?{accepted:true,issues:[]}:{accepted:false,issues:[{field:"monitoringSummary",code:"UNCLEAR_WORDING",reason:"Include intake tracking.",evidenceIds:["rule:nutrition:nutrition_low"]}]};}
  if(step==="revision"){
   revisions++;
   if(revisions===1)return {edits:[{field:"monitoringSummary",find:"",replace:"",evidenceIds:[]}]};
   expect(user).toContain("Previous patch was not applied");
   if(revisions===2)return {edits:[]};
   repaired=true;return replacePassage(user,"monitoringSummary","Track weight and intake with the care team.");
  }
  if(step==="coverage")return audit(user);
  if((schema.properties as any).retainedIssueIndexes)return {retainedIssueIndexes:[0]};
  if((schema.properties as any).decision)return {decision:"approve",issues:[]};
  return {accepted:true,issues:[]};
 }});
 expect(result.status).toBe("READY");expect(revisions).toBe(3);expect(reviews).toBe(2);
});

test("evidence IDs belong in metadata rather than patient prose",()=>{
 const f=fixture();
 const part={...f.fallback.nutritionAdvice,text:"Choose regular meals. [rule:nutrition:nutrition_low]"};
 expect(validateNarrative({...f.fallback,nutritionAdvice:part},f.evidence).issues).toContain("nutritionAdvice:INTERNAL_EVIDENCE_MARKER");
});

test("model approval cannot waive patient wording corrections",async()=>{
 const f=fixture();let repaired=false;
 const original={...f.fallback,redFlagsAdvice:{text:"The matched nutrition guidance advises regular meals.",evidenceIds:["rule:nutrition:nutrition_low"]}};
 const result=await manageReportAgents({...f,invoke:async(step,_system,user,schema)=>{
  const protocol=protocolResponse(user,schema);if(protocol)return protocol;
  if(step==="writer")return original;
  if(step==="reviewer")return {accepted:true,issues:[]};
  if(step==="revision"){expect(user).toContain("INTERNAL_WORKFLOW_WORDING");expect(user).toContain("direct patient instruction");repaired=true;return replacePassage(user,"redFlagsAdvice","Have regular meals.");}
  if(step==="coverage")return audit(user);
  if((schema.properties as any).decision)return {decision:"approve",issues:[]};
  return {accepted:true,issues:[]};
 }});
 expect(result.status).toBe("READY");expect(repaired).toBe(true);expect(result.narrative.redFlagsAdvice.text).not.toContain("matched");
});

test("a manager cannot waive applicable source precautions in a self-contained card",async()=>{
 const f=fixture(true);const id="rule:treatment:probiotic";
 f.evidence.find(x=>x.id==="possible:toxicity:example")!.text="Conditional possible effect: Myelosuppression / infection risk. Maintain adequate protein and energy.";
 f.evidence.push({id,text:"Probiotic supplements require clinical approval, particularly during immunosuppression."});
 const draft={...f.fallback,nutritionAdvice:{text:f.fallback.nutritionAdvice.text+" Ask your oncologist for approval before taking probiotic supplements, especially if you are immunosuppressed.",evidenceIds:[...f.fallback.nutritionAdvice.evidenceIds,id]}};
 let repaired=false, sawRetainedPrecaution=false;
 const result=await manageReportAgents({...f,invoke:async(step,_system,user,schema)=>{
  const protocol=protocolResponse(user,schema);if(protocol)return protocol;
  if(step==="writer")return draft;
  if(step==="reviewer")return {accepted:true,issues:[]};
  if(step==="summarizer"){
   if((schema.properties as any).edits){expect(user).toContain("SOURCE_CARD_PRECAUTION");repaired=true;return {edits:[{evidenceId:"possible:toxicity:example",find:"",replace:"Probiotic supplements require clinical approval, particularly during immunosuppression."}]};}
   return {rows:[{evidenceId:"possible:toxicity:example",text:"If infection risk occurs, maintain adequate protein and energy."}]};
  }
  if(step==="coverage"||(schema.properties as any).rows)return audit(user);
  if((schema.properties as any).decision){
   const context=JSON.parse(user.match(/Full context: ([^\n]*)/)![1]!);
   const prior=context.adjudications.find((row:any)=>row.issues.some((issue:any)=>issue.field==="possible:toxicity:example"&&issue.code==="COVERAGE_GAP"));
   expect(prior).toBeDefined();
   expect(prior.retainedIssueIndexes).toEqual([0]);
   expect(prior.issues[0].reason).toContain("SOURCE_CARD_PRECAUTION");
   expect(prior.reviewedFields[0].text).not.toContain("Probiotic supplements require clinical approval");
   sawRetainedPrecaution=true;
   return {decision:"approve",issues:[]};
  }
  return {accepted:true,issues:[]};
 }});
 expect(result.status).toBe("READY");expect(repaired).toBe(true);expect(sawRetainedPrecaution).toBe(true);
 expect(result.interventionSummaries[0]!.text.replaceAll("**","")).toContain("Probiotic supplements require clinical approval");
});

test("internal source language cannot bypass wording checks inside an effect card",async()=>{
 const f=fixture(true);let repaired=false;
 const result=await manageReportAgents({...f,invoke:async(step,_system,user,schema)=>{
  const protocol=protocolResponse(user,schema);if(protocol)return protocol;
  if(step==="writer")return f.fallback;
  if(step==="reviewer")return {accepted:true,issues:[]};
  if(step==="summarizer"){
   if((schema.properties as any).edits){expect(user).toContain("INTERNAL_WORKFLOW_WORDING");repaired=true;return {edits:[{evidenceId:"possible:toxicity:example",find:"The matched source advises small, frequent meals if nausea occurs.",replace:"If nausea occurs, eat small, frequent meals."}]};}
   return {rows:[{evidenceId:"possible:toxicity:example",text:"The matched source advises small, frequent meals if nausea occurs."}]};
  }
  if(step==="coverage"||(schema.properties as any).rows)return audit(user);
  if((schema.properties as any).decision)return {decision:"approve",issues:[]};
  return {accepted:true,issues:[]};
 }});
 expect(result.status).toBe("READY");expect(repaired).toBe(true);expect(result.interventionSummaries[0]!.text).not.toContain("matched source");
});

test("a shared urgent warning cannot substitute for an assessed condition's card-local warning", async()=>{
 const f=fixture(true),cardId="possible:toxicity:example",sourceId="rule:treatment:warning";
 f.evidence.find(x=>x.id===cardId)!.text="Conditional possible effect: Fatigue. Check for anemia and dehydration. Gentle activity.";
 f.evidence.push({id:sourceId,text:"Monitoring and red-flag notes\n• Persistent vomiting, dehydration or severe skin reactions: prompt medical assessment."});
 const draft={...f.fallback,redFlagsAdvice:{text:"If dehydration occurs, seek prompt medical assessment.",evidenceIds:[sourceId]}};
 let repaired=false,checkedChanged=false;
 const result=await manageReportAgents({...f,invoke:async(step,_system,user,schema)=>{
  const protocol=protocolResponse(user,schema);if(protocol)return protocol;
  if(step==="writer")return draft;
  if(step==="reviewer")return {accepted:true,issues:[]};
  if(step==="summarizer"){
   if((schema.properties as any).edits){
    expect(user).toContain("SOURCE_CARD_WARNING");repaired=true;
    return {edits:[{evidenceId:cardId,find:"",replace:"If dehydration occurs, seek prompt medical assessment."}]};
   }
   return {rows:[{evidenceId:cardId,text:"If fatigue occurs, have your care team assess for anemia and dehydration. Try gentle activity."}]};
  }
  if(step==="coverage"||(schema.properties as any).rows){
   if(user.includes("Candidate summaries:")&&user.includes('seek prompt medical assessment.',user.indexOf("Candidate summaries:")))checkedChanged=repaired;
   return audit(user);
  }
  if((schema.properties as any).decision)return {decision:"approve",issues:[]};
  return {accepted:true,issues:[]};
 }});
 expect(result.status).toBe("READY");expect(repaired).toBe(true);expect(checkedChanged).toBe(true);
 expect(result.interventionSummaries[0]!.text.replaceAll("**","")).toContain("If dehydration occurs, seek prompt medical assessment.");
});

test("treatment interventions may cite their actual matched nutrition source",()=>{
 const f=fixture(),source=f.evidence.find(x=>x.id.startsWith("rule:nutrition:"))!;
 source.text+=" The care team should correct fluid and electrolyte imbalances.";
 const draft={...f.fallback,treatmentAdvice:{text:"The care team should correct fluid and electrolyte imbalances.",evidenceIds:[source.id]}};
 expect(validateNarrative(draft,f.evidence).issues).not.toContain("treatmentAdvice:MISSING_MATCHED_GUIDANCE");
 expect(validateNarrative({...draft,treatmentAdvice:{...draft.treatmentAdvice,evidenceIds:["rule:nutrition:absent"]}},f.evidence).issues.length).toBeGreaterThan(0);
});

test("removing misplaced narrative text requires an existing anchor rather than an append",async()=>{
 const f=fixture();let reviewed=0,sawAnchors=false;
 const text="The care team should provide early nutrition support.";
 const draft={...f.fallback,treatmentAdvice:{text,evidenceIds:[f.evidence.find(x=>x.id.startsWith("rule:nutrition:"))!.id]}};
 await manageReportAgents({...f,invoke:async(step,_system,user,schema)=>{
  const protocol=protocolResponse(user,schema);if(protocol)return protocol;
  if(step==="writer")return draft;
  if(step==="reviewer")return ++reviewed===1?{accepted:false,issues:[{code:"UNCLEAR_WORDING",field:"treatmentAdvice",reason:"Remove this sentence from treatmentAdvice; the nutrition instruction is already covered in nutritionAdvice.",evidenceIds:draft.treatmentAdvice.evidenceIds}]}:{accepted:true,issues:[]};
  if(step==="revision"){
   const branches=(schema as any).properties.edits.items.anyOf;
   const branch=branches.find((b:any)=>b.properties.field.enum.includes("treatmentAdvice"));
   expect(branch.properties.find.enum).not.toContain("");sawAnchors=true;
   return {edits:[{field:"treatmentAdvice",find:text,replace:"",evidenceIds:[]}]};
  }
  if((schema.properties as any).retainedIssueIndexes)return {retainedIssueIndexes:[0]};
  if((schema.properties as any).decision)return {decision:"approve",issues:[]};
  return audit(user);
 }});
 expect(sawAnchors).toBe(true);
});

test("an invalid duplicate-anchor card patch retries the same rows without regenerating accepted cards", async () => {
  const f = fixture(true), rejectedId = "possible:toxicity:example", acceptedId = "possible:toxicity:accepted";
  f.evidence.find(row => row.id === rejectedId)!.text += " Drink fluids.";
  f.evidence.push({ id: acceptedId, text: "If fatigue occurs, try gentle activity." });
  const original = [{ evidenceId: rejectedId, text: "If nausea occurs, eat small meals." },
    { evidenceId: acceptedId, text: "If fatigue occurs, try gentle activity." }];
  let generated = 0, patches = 0, reviewedRepair = false;
  const check = (user: string) => {
    const rows = audit(user).rows;
    const summaries = JSON.parse(user.match(/Candidate summaries: ([^\n]*)/)?.[1] ?? "[]") as typeof original;
    return { rows: rows.map(row => row.evidenceId === rejectedId && !summaries.find(s => s.evidenceId === rejectedId)?.text.includes("Drink fluids.")
      ? { ...row, covered: false, missing: ["Include the source fluid instruction."] } : row) };
  };
  const result = await manageReportAgents({ ...f, invoke: async (step, _system, user, schema) => {
    const protocol = protocolResponse(user, schema); if (protocol) return protocol;
    if (step === "writer") return f.fallback;
    if (step === "reviewer") return { accepted: true, issues: [] };
    if (step === "summarizer") {
      if (!(schema.properties as any).edits) { generated++; return { rows: original }; }
      patches++;
      expect(JSON.parse(user.match(/Current summaries to repair: ([^\n]*)/)![1]!)).toEqual([original[0]]);
      if (patches === 1) return { edits: [
        { evidenceId: rejectedId, find: original[0]!.text, replace: "If nausea occurs, eat small meals. Drink fluids." },
        { evidenceId: rejectedId, find: original[0]!.text, replace: "Drink fluids." },
      ] };
      expect(user).toContain("INVALID_EXACT_PATCH");
      return { edits: [{ evidenceId: rejectedId, find: "", replace: "Drink fluids." }] };
    }
    if (step === "coverage" || (schema.properties as any).rows) {
      const checked = check(user);
      if (user.includes("Candidate summaries:") && patches === 2 && checked.rows.every(row => row.covered)) reviewedRepair = true;
      return checked;
    }
    if ((schema.properties as any).decision) return { decision: "approve", issues: [] };
    return { accepted: true, issues: [] };
  } });
  expect(result.status).toBe("READY");
  expect(generated).toBe(1);
  expect(patches).toBe(2);
  expect(reviewedRepair).toBe(true);
  expect(result.interventionSummaries.find(row => row.evidenceId === acceptedId)?.text.replaceAll("**", "")).toBe(original[1]!.text);
  expect(result.interventionSummaries.find(row => row.evidenceId === rejectedId)?.text.replaceAll("**", "")).toBe(original[0]!.text + " Drink fluids.");
});

test("exhausted invalid card patches keep every prior row held instead of regenerating", async () => {
  const { coordinateReportAgents } = await import("./report-agent-coordinator");
  const f = fixture(true), rejectedId = "possible:toxicity:example", acceptedId = "possible:toxicity:accepted";
  f.evidence.find(row => row.id === rejectedId)!.text += " Drink fluids.";
  f.evidence.push({ id: acceptedId, text: "If fatigue occurs, try gentle activity." });
  const original = [{ evidenceId: rejectedId, text: "If nausea occurs, eat small meals." },
    { evidenceId: acceptedId, text: "If fatigue occurs, try gentle activity." }];
  let generated = 0, patches = 0;
  const result = await coordinateReportAgents({ ...f, invoke: async (step, _system, user, schema) => {
    const protocol = protocolResponse(user, schema); if (protocol) return protocol;
    if (step === "writer") return f.fallback;
    if (step === "reviewer") return { accepted: true, issues: [] };
    if (step === "summarizer") {
      if (!(schema.properties as any).edits) { generated++; return { rows: original }; }
      patches++;
      return { edits: [
        { evidenceId: rejectedId, find: original[0]!.text, replace: "If nausea occurs, drink fluids." },
        { evidenceId: rejectedId, find: original[0]!.text, replace: "Drink fluids." },
      ] };
    }
    if (step === "coverage" || (schema.properties as any).rows) return { rows: audit(user).rows.map(row =>
      row.evidenceId === rejectedId ? { ...row, covered: false, missing: ["Include the source fluid instruction."] } : row) };
    return { accepted: true, issues: [] };
  } });
  expect(generated).toBe(1);
  expect(patches).toBe(2);
  expect(result.status).toBe("REVIEW_REQUIRED");
  expect(result.issues).toContain("MATCHED_INTERVENTION_COVERAGE");
  expect(result.interventionSummaries).toEqual(original);
});

test("dismissed placement judgments reach assembled coverage and the final manager", async () => {
  const f = fixture(), sourceId = "rule:nutrition:nutrition_low";
  const precaution = "Ask your care team before taking probiotic supplements.";
  f.evidence.find(row => row.id === sourceId)!.text += ` ${precaution}`;
  const draft = { ...f.fallback, nutritionAdvice: {
    text: `${f.fallback.nutritionAdvice.text} ${precaution}`, evidenceIds: [sourceId],
  } };
  const placementReason = "Move the probiotic precaution from nutritionAdvice to monitoringSummary.";
  let sawCoverageHistory = false, sawFinalHistory = false, revisions = 0;
  const result = await manageReportAgents({ ...f, invoke: async (step, system, user, schema) => {
    const protocol = protocolResponse(user, schema); if (protocol) return protocol;
    if (step === "writer") return draft;
    if (step === "reviewer") return { accepted: false, issues: [{ field: "nutritionAdvice", code: "UNCLEAR_WORDING", evidenceIds: [sourceId], reason: placementReason }] };
    if ((schema.properties as any).retainedIssueIndexes) return { retainedIssueIndexes: [] };
    if (step === "revision") { revisions++; return { edits: [] }; }
    if (step === "coverage") {
      expect(system).toContain("Earlier report adjudications:");
      expect(system).toContain(placementReason);
      expect(system).toContain('"retainedIssueIndexes":[]');
      sawCoverageHistory = true;
      return audit(user);
    }
    if ((schema.properties as any).decision) {
      const context = JSON.parse(user.match(/Full context: ([^\n]*)/)![1]!);
      expect(context.adjudications).toHaveLength(1);
      expect(context.adjudications[0].issues[0]).toMatchObject({ field: "nutritionAdvice", evidenceIds: [sourceId], reason: placementReason });
      expect(context.adjudications[0].retainedIssueIndexes).toEqual([]);
      expect(context.adjudications[0].unchangedFields).toContain("nutritionAdvice");
      expect(context.adjudications[0].reviewedFields[0].text).toContain(precaution);
      sawFinalHistory = true;
      return { decision: "approve", issues: [] };
    }
    return { accepted: true, issues: [] };
  } });
  expect(result.status).toBe("READY");
  expect(sawCoverageHistory && sawFinalHistory).toBe(true);
  expect(revisions).toBe(0);
});

test("placement history survives final repair without waiving a genuine source qualification", async () => {
  const f = fixture(), sourceId = "rule:nutrition:nutrition_low";
  const original = "Discuss probiotic supplements with your care team.";
  const corrected = "Ask your care team for approval before taking probiotic supplements.";
  f.evidence.find(row => row.id === sourceId)!.text += ` ${corrected}`;
  const draft = { ...f.fallback, nutritionAdvice: {
    text: `${f.fallback.nutritionAdvice.text} ${original}`, evidenceIds: [sourceId],
  } };
  const placementReason = "Move the probiotic precaution from nutritionAdvice to monitoringSummary.";
  let reviewers = 0, decisions = 0, repairs = 0, sawHistoryAfterRepair = false;
  const result = await manageReportAgents({ ...f, invoke: async (step, system, user, schema) => {
    const protocol = protocolResponse(user, schema); if (protocol) return protocol;
    if (step === "writer") return draft;
    if (step === "reviewer") {
      reviewers++;
      if (reviewers === 1) return { accepted: false, issues: [{ field: "nutritionAdvice", code: "UNCLEAR_WORDING", evidenceIds: [sourceId], reason: placementReason }] };
      expect(system).toContain(placementReason);
      expect(system).toContain(original);
      expect(user).toContain(corrected);
      sawHistoryAfterRepair = true;
      return { accepted: true, issues: [] };
    }
    if ((schema.properties as any).retainedIssueIndexes) return { retainedIssueIndexes: [] };
    if (step === "revision") {
      repairs++;
      expect(system).toContain(placementReason);
      expect(user).toContain("approval before taking");
      return replacePassage(user, "nutritionAdvice", `${f.fallback.nutritionAdvice.text} ${corrected}`);
    }
    if (step === "coverage") return audit(user);
    if ((schema.properties as any).decision) {
      decisions++;
      const context = JSON.parse(user.match(/Full context: ([^\n]*)/)![1]!);
      expect(context.adjudications[0].issues[0].reason).toBe(placementReason);
      expect(context.adjudications[0].reviewedFields[0].text).toContain(original);
      expect(context.adjudications[0].unchangedFields.includes("nutritionAdvice")).toBe(decisions === 1);
      return decisions === 1 ? { decision: "fallback", issues: [{ field: "nutritionAdvice", evidenceIds: [sourceId],
        reason: "The source requires care-team approval before taking probiotics; discussion alone omits approval before taking them." }] }
        : { decision: "approve", issues: [] };
    }
    return { accepted: true, issues: [] };
  } });
  expect(result.status).toBe("READY");
  expect(repairs).toBe(1);
  expect(decisions).toBe(2);
  expect(sawHistoryAfterRepair).toBe(true);
  expect(result.narrative.nutritionAdvice.text.replaceAll("**", "")).toContain(corrected);
});

test("assembled manager placement dismissals reach final review without extra repairs", async () => {
  const f = fixture(), sourceId = "rule:nutrition:nutrition_low";
  const precaution = "Ask your care team before taking probiotic supplements.";
  f.evidence.find(row => row.id === sourceId)!.text += ` ${precaution}`;
  const draft = { ...f.fallback, nutritionAdvice: {
    text: `${f.fallback.nutritionAdvice.text} ${precaution}`, evidenceIds: [sourceId],
  } };
  const reason = "Move the probiotic precaution into monitoringSummary from nutritionAdvice.";
  let revisions = 0, finalChecked = false;
  const result = await manageReportAgents({ ...f, invoke: async (step, _system, user, schema) => {
    const protocol = protocolResponse(user, schema); if (protocol) return protocol;
    if (step === "writer") return draft;
    if (step === "reviewer") return { accepted: true, issues: [] };
    if (step === "revision") { revisions++; return { edits: [] }; }
    if (step === "coverage") return { rows: audit(user).rows.map(row => row.evidenceId === sourceId
      ? { ...row, covered: false, missing: [`[monitoringSummary] ${reason}`] } : row) };
    if (step === "manager" && (schema.properties as any).rows) return audit(user);
    if ((schema.properties as any).decision) {
      const context = JSON.parse(user.match(/Full context: ([^\n]*)/)![1]!);
      expect(context.adjudications).toHaveLength(1);
      expect(context.adjudications[0].issues[0]).toMatchObject({ field: "monitoringSummary", code: "COVERAGE_GAP", reason, evidenceIds: [sourceId] });
      expect(context.adjudications[0].retainedIssueIndexes).toEqual([]);
      expect(context.adjudications[0].unchangedFields).toContain("nutritionAdvice");
      finalChecked = true;
      return { decision: "approve", issues: [] };
    }
    return { accepted: true, issues: [] };
  } });
  expect(result.status).toBe("READY");
  expect(finalChecked).toBe(true);
  expect(revisions).toBe(0);
});

test("immediate card recheck compares placement history with the freshly repaired narrative", async () => {
  const f = fixture(true), sourceId = "rule:nutrition:nutrition_low";
  const addedCare = "Drink fluids to replace losses.";
  f.evidence.find(row => row.id === sourceId)!.text += ` ${addedCare}`;
  let reviewers = 0, cardAudits = 0, patched = false, checkedImmediateSnapshot = false;
  const result = await manageReportAgents({ ...f, invoke: async (step, system, user, schema) => {
    const protocol = protocolResponse(user, schema); if (protocol) return protocol;
    if (step === "writer") return f.fallback;
    if (step === "reviewer") {
      reviewers++;
      return reviewers === 1 ? { accepted: false, issues: [
        { field: "nutritionAdvice", code: "UNCLEAR_WORDING", reason: "Move general nutrition advice into treatmentAdvice.", evidenceIds: [sourceId] },
        { field: "monitoringSummary", code: "UNCLEAR_WORDING", reason: "Move weight tracking into treatmentAdvice.", evidenceIds: [sourceId] },
      ] } : { accepted: true, issues: [] };
    }
    if ((schema.properties as any).retainedIssueIndexes) return { retainedIssueIndexes: [] };
    if (step === "summarizer") return { rows: [{ evidenceId: "possible:toxicity:example", text: "If nausea occurs, eat small, frequent meals." }] };
    if (step === "revision") {
      patched = true;
      return replacePassage(user, "nutritionAdvice", `${f.fallback.nutritionAdvice.text} ${addedCare}`);
    }
    if (step === "coverage" && user.includes("Candidate summaries:")) {
      cardAudits++;
      if (cardAudits === 2) {
        const shared = JSON.parse(user.match(/Shared report sections: ([^\n]*)/)![1]!);
        expect(shared.nutritionAdvice.text).toContain(addedCare);
        const history = JSON.parse(system.split("Earlier report adjudications: ")[1]!.split("\n")[0]!);
        expect(history[0].unchangedFields).not.toContain("nutritionAdvice");
        expect(history[0].unchangedFields).toContain("monitoringSummary");
        checkedImmediateSnapshot = true;
      }
      return audit(user);
    }
    if (step === "coverage" || (step === "manager" && (schema.properties as any).rows)) return {
      rows: audit(user).rows.map(row => row.evidenceId === sourceId && !patched
        ? { ...row, covered: false, missing: [`[nutritionAdvice] Include the source instruction: ${addedCare}`] } : row),
    };
    if ((schema.properties as any).decision) return { decision: "approve", issues: [] };
    return { accepted: true, issues: [] };
  } });
  expect(result.status).toBe("READY");
  expect(checkedImmediateSnapshot).toBe(true);
  expect(result.narrative.nutritionAdvice.text.replaceAll("**", "")).toContain(addedCare);
});
