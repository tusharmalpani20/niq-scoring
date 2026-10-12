import { expect, test } from "bun:test";
import { createFinalAssessmentTemplate } from "@niq-scoring/contracts/final-assessment-template";
import { createApp } from "./app";
import { MemoryScoringStore } from "./store";
import { MemoryReportGenerationStore, REPORT_RUN_LEASE_MS } from "./report-generation-store";
import { MemoryAdminAuthStore } from "./admin-auth-store";
import { createEntityId } from "./lib/id";
import { ruleChecksum } from "./rule-routes";
import { ReportModelError, type ReportTextProvider } from "./openrouter-report-client";
import { matchedReportPacket, normalizeNarrativePunctuation, reportEvidence, validateNarrative } from "./report-content";
import { resolveCarePlanGuidance } from "@niq-scoring/contracts/care-plan-resolver";
import type { FinalAssessmentDefinition } from "@niq-scoring/contracts/final-assessment";

const safePart = { text: "The NIQ risk category needs clinician review.", evidenceIds: ["fact:niq_risk"] };
const omittedPart = { text: "", evidenceIds: [] as string[] };
const defaultNutritionPart = { text: "Maintain nutrition and monitor appetite during treatment.", evidenceIds: ["rule:nutrition:nutrition_low"] };
const safeNarrative = { overview: safePart, keyFindings: safePart, actionSummary: safePart, monitoringSummary: safePart,
  nutritionAdvice: defaultNutritionPart, treatmentAdvice: omittedPart, conditionAdvice: omittedPart, effectsAdvice: omittedPart };
const noGuidanceNarrative = { ...safeNarrative, nutritionAdvice: omittedPart };
const usage = { model: "openai/gpt-6-luna", provider: "test-provider", generationId: "gen-test", promptTokens: 120, completionTokens: 40, reasoningTokens: 5, costUsd: 0.001, latencyMs: 10 };
type Step = "writer" | "reviewer" | "revision";

async function setup(handler: (step: Step, call: number, user: string, system: string) => unknown = step => step === "reviewer" ? { accepted: true, issues: [] } : safeNarrative,
  configure?: (definition: FinalAssessmentDefinition) => void, runs = new MemoryReportGenerationStore()) {
  const store = new MemoryScoringStore();
  const definition = createFinalAssessmentTemplate("Report test");
  configure?.(definition);
  const rule = { id: createEntityId(), version: "Report test", lifecycle: "ACTIVE" as const, clinicalUsePermitted: true, definition,
    packageChecksum: ruleChecksum(definition), revision: 1, validatedRevision: 1, createdAt: "2026-01-01T00:00:00Z", updatedAt: "2026-01-01T00:00:00Z", createdBy: null, approvedAt: "2026-01-01T00:00:00Z" };
  store.rules.records.push(rule);
  await store.rules.setDefault({ id: rule.id, revision: rule.revision, actor: "test", now: rule.createdAt });
  const client = await store.createClient({ name: "Report test client" });
  const deployment = await store.createDeployment({ clientId: client.id, name: "Report test deployment", environment: "test" });
  await store.setEntitlement(deployment.id, { capability: "SCORING", enabled: true, monthlyLimit: null });
  await store.assignVersion(deployment.id, { mode: "LATEST_APPROVED" });
  const token = `niq_dep_report123456.${"a".repeat(40)}`;
  store.credentials.push({ credentialId: createEntityId(), clientId: client.id, deploymentId: deployment.id, keyPrefix: "report123456", secretHash: new Bun.CryptoHasher("sha256").update(token).digest("hex") });
  let calls = 0;
  const provider: ReportTextProvider = { complete: async ({ step, user, system }) => ({ content: await handler(step, ++calls, user, system), usage }) };
  const app = createApp({ store, authStore: new MemoryAdminAuthStore(), reportGenerationStore: runs, reportTextProvider: provider,
    region: "test", allowedOrigins: [], runtimeEnvironment: "test", provisionalScoringRequested: false, now: () => new Date("2026-01-02T00:00:00Z") });
  const call = (action: string, data: unknown) => app.request(`/v1/assessments/${action}`, { method: "POST", headers: { authorization: `Bearer ${token}`, "content-type": "application/json" }, body: JSON.stringify(data) });
  await call("start", { assessmentReference: "report-assessment" });
  const reviewed = await (await call("classify-reviewed", { assessmentReference: "report-assessment", idempotencyKey: "reviewed-result-1", score: 12 })).json();
  const resultReference = reviewed.result.resultReference as string;
  const facts = { reviewedScore: 12, reviewedRiskCategoryId: "low", treatmentTypeIds: [], drugClassIds: [], confirmedToxicityIds: [], assessmentDate: "2026-01-02", observations: [{ id: "current_weight_kg", label: "Current weight", value: "68.4", unit: "kg" }] };
  const request = (overrides: Record<string, unknown> = {}) => ({ assessmentReference: "report-assessment", resultReference, idempotencyKey: "report-run-1", facts, ...overrides });
  return { app, call, store, runs, rule, request, facts, getCalls: () => calls };
}

test("report content uses pinned rules, eight bounded fields, idempotency, and sanitized admin usage", async () => {
  const { app, call, runs, request, rule, getCalls } = await setup();
  const response = await call("report-content", request());
  expect(response.status).toBe(200);
  const body = await response.json();
  expect(body).toMatchObject({ status: "READY", ruleVersionId: rule.id, checksum: rule.packageChecksum,
    model: "openai/gpt-6-luna", narrative: safeNarrative });
  expect(getCalls()).toBe(2);
  expect(await (await call("report-content", request())).json()).toEqual(body);
  expect(getCalls()).toBe(2);
  expect((await call("report-content", request({ facts: { ...request().facts, reviewedScore: 13 } }))).status).toBe(409);
  const listing = await runs.list({ page: 1, pageSize: 20 });
  expect(listing.items[0]?.calls).toHaveLength(2);
  const serialized = JSON.stringify(listing);
  expect(serialized).not.toContain("Current weight");
  expect(serialized).not.toContain("68.4");
  expect(serialized).not.toContain(safePart.text);
  expect(serialized).not.toContain("writerPrompt");
  expect((await app.request("/v1/assessments/report-content", { method: "POST", body: JSON.stringify(request()) })).status).toBe(401);
});

test("an expired writer cannot publish over a retry with the same idempotency key", async () => {
  let time = new Date("2026-01-02T00:00:00Z");
  const runs = new MemoryReportGenerationStore(() => time);
  let started!: () => void;
  let release!: () => void;
  const firstStarted = new Promise<void>(resolve => { started = resolve; });
  const firstReleased = new Promise<void>(resolve => { release = resolve; });
  const { call, request } = await setup(async (step, invocation) => {
    if (step === "writer" && invocation === 1) { started(); await firstReleased; }
    return step === "reviewer" ? { accepted: true, issues: [] } : safeNarrative;
  }, undefined, runs);
  const first = call("report-content", request());
  await firstStarted;
  time = new Date(time.getTime() + REPORT_RUN_LEASE_MS + 1);
  const retried = await call("report-content", request());
  expect(retried.status).toBe(200);
  const published = await retried.json();
  expect(published.status).toBe("READY");
  release();
  const stale = await first;
  expect(stale.status).toBe(409);
  expect(await stale.json()).toEqual({ error: "REQUEST_IN_PROGRESS" });
  expect(await (await call("report-content", request())).json()).toEqual(published);
  const listing = await runs.list({ page: 1, pageSize: 10 });
  expect(listing.items[0]?.calls).toHaveLength(2);
});

test("report content requires the completed assessment date", async () => {
  const { call, request, facts, getCalls } = await setup();
  const { assessmentDate: _date, ...undated } = facts;
  expect((await call("report-content", request({ facts: undated }))).status).toBe(400);
  expect(getCalls()).toBe(0);
});

test("the reviewer receives independent fixed checks beyond editable wording", async () => {
  const systems: Record<string, string> = {};
  const { call, request } = await setup((step, _call, _user, system) => {
    systems[step] = system;
    return step === "reviewer" ? { accepted: true, issues: [] } : safeNarrative;
  });
  expect((await call("report-content", request())).status).toBe(200);
  expect(systems.reviewer).toContain("independently reviewing a writer draft");
  expect(systems.reviewer).toContain("Check every claim against the cited evidence");
  expect(systems.reviewer).toContain("does not establish kidney disease");
  expect(systems.reviewer).toContain("early oral nutrition supplements");
  expect(systems.writer).not.toContain("independently reviewing a writer draft");
});

test("rule evidence IDs remain distinct when different rule groups reuse an ID", () => {
  const definition = createFinalAssessmentTemplate("Duplicate source IDs");
  const product = definition.carePlanGuidance!.products.plans[0]!;
  const facts = {
    reviewedScore: 12, reviewedRiskCategoryId: "low", treatmentTypeIds: [], drugClassIds: [], confirmedToxicityIds: [],
    assessmentDate: "2026-01-12", treatmentStatusId: "treatment_status_newly_diagnosed", cancerTypeId: "cancer_1",
    plannedTreatmentStartDate: "2026-01-20", observations: [],
  };
  const initiallyMatched = matchedReportPacket(definition, facts, "low", facts.assessmentDate);
  const matchedNutritionId = initiallyMatched.nutritionInterventions[0]!.id;
  definition.reportGuidance!.nutrition.find(row => row.id === matchedNutritionId)!.id = product.id;
  const packet = matchedReportPacket(definition, facts, "low", facts.assessmentDate);
  const evidence = reportEvidence(definition, facts, { id: "low", label: "Low Risk" }, packet);
  expect(packet.nutritionInterventions.length).toBeGreaterThan(0);
  expect(packet.carePlan.products.plans.length).toBeGreaterThan(0);
  expect(new Set(evidence.map(item => item.id)).size).toBe(evidence.length);
  expect(evidence.some(item => item.id === `rule:nutrition:${product.id}`)).toBe(true);
  expect(evidence.some(item => item.id === `rule:product:${product.id}`)).toBe(true);
});

test("a passage over the promised word limit is omitted after one failed revision", async () => {
  const lengthy = { ...safeNarrative, overview: { text: Array(81).fill("review").join(" "), evidenceIds: ["fact:niq_risk"] } };
  const { call, request, getCalls } = await setup(step => step === "reviewer" ? { accepted: true, issues: [] } : lengthy);
  const response = await call("report-content", request());
  expect(response.status).toBe(200);
  const body = await response.json();
  expect(body.status).toBe("READY");
  expect(body.narrative.overview).toEqual({ text: "", evidenceIds: [] });
  expect(body.omittedNarrativeFields).toContain("overview");
  expect(getCalls()).toBe(4);
});

test("care plan passages require matching rule evidence and copied guidance is rejected", () => {
  const evidence = [
    { id: "fact:niq_risk", text: "NIQ risk: High Risk; reviewed score 27" },
    { id: "rule:nutrition:row1", text: "Begin nutrition support early and monitor weight and intake each week. Adjust the plan based on treatment tolerance." },
    { id: "rule:comorbidity:row2", text: "Hypertension: Check and record blood pressure at home during treatment." },
  ];
  const good = { ...safeNarrative,
    nutritionAdvice: { text: "Start nutrition support early. Review weight and intake weekly as treatment continues.", evidenceIds: ["rule:nutrition:row1"] },
    conditionAdvice: { text: "Record blood pressure at home during treatment.", evidenceIds: ["rule:comorbidity:row2"] },
  };
  expect(validateNarrative(good, evidence).issues).toEqual([]);
  const unsupported = { ...good, conditionAdvice: { ...good.conditionAdvice, evidenceIds: ["fact:niq_risk"] } };
  expect(validateNarrative(unsupported, evidence).issues).toContain("conditionAdvice:MISSING_MATCHED_GUIDANCE");
  const copied = { ...good, nutritionAdvice: { text: evidence[1]!.text, evidenceIds: ["rule:nutrition:row1"] } };
  expect(validateNarrative(copied, evidence).issues).toContain("nutritionAdvice:COPIED_GUIDANCE");
});

test("matched conditions and treatment effects cannot be silently omitted", () => {
  const evidence = [
    { id: "fact:niq_risk", text: "NIQ risk: High Risk; reviewed score 27" },
    { id: "rule:comorbidity:kidney", text: "Kidney disease: Individualize fluid and protein targets according to renal function." },
    { id: "rule:comorbidity:diabetes", text: "Diabetes: Review meal timing with the care team." },
    { id: "rule:toxicity:diarrhoea", text: "For reported diarrhoea, use the matched fluid advice and contact the team if it persists." },
  ];
  const missing = validateNarrative(noGuidanceNarrative, evidence).issues;
  expect(missing).toContain("conditionAdvice:MISSING_MATCHED_COVERAGE");
  expect(missing).toContain("effectsAdvice:MISSING_MATCHED_COVERAGE");
  const partial = { ...noGuidanceNarrative,
    conditionAdvice: { text: "Review fluid and protein targets with the care team.", evidenceIds: ["rule:comorbidity:kidney"] },
    effectsAdvice: { text: "Contact the team if diarrhoea persists.", evidenceIds: ["rule:toxicity:diarrhoea"] },
  };
  expect(validateNarrative(partial, evidence).issues).toContain("conditionAdvice:MISSING_MATCHED_COVERAGE");
  expect(validateNarrative({ ...partial, conditionAdvice: { ...partial.conditionAdvice, evidenceIds: ["rule:comorbidity:kidney", "rule:comorbidity:diabetes"] } }, evidence).issues).toEqual([]);
});

test("matched nutrition and treatment advice cannot vanish from a ready report", () => {
  const evidence = [
    { id: "fact:niq_risk", text: "NIQ risk: High Risk; reviewed score 31" },
    { id: "rule:nutrition:high", text: "Begin medically supervised nutrition support early." },
    { id: "rule:status:poor", text: "Preserve lean body mass during treatment." },
    { id: "rule:treatment:therapy", text: "Use small frequent meals to support intake." },
    { id: "rule:class:platinum", text: "Monitor hydration during treatment." },
    { id: "rule:product:selected", text: "Selected product plan: Invigour + Protect. Dose: 3 Invigour + 2 Protect." },
  ];
  const missing = validateNarrative(safeNarrative, evidence).issues;
  expect(missing).toContain("nutritionAdvice:MISSING_MATCHED_COVERAGE");
  expect(missing).toContain("treatmentAdvice:MISSING_MATCHED_COVERAGE");
  const covered = { ...safeNarrative,
    nutritionAdvice: { text: "Begin supervised support early to preserve muscle.", evidenceIds: ["rule:nutrition:high"] },
    treatmentAdvice: { text: "Preserve muscle with small frequent meals and monitor hydration.", evidenceIds: ["rule:status:poor", "rule:treatment:therapy", "rule:class:platinum"] },
    actionSummary: { text: "Take 3 Invigour and 2 Protect daily.", evidenceIds: ["rule:product:selected"] },
  };
  expect(validateNarrative(covered, evidence).issues).toContain("actionSummary:REPEATS_PRODUCT_PLAN");
  expect(validateNarrative({ ...covered, actionSummary: omittedPart }, evidence).issues).toEqual([]);
});

test("weight evidence states direction and avoids inventing a time interval", () => {
  const definition = createFinalAssessmentTemplate("Weight direction");
  const facts = { reviewedScore: 12, treatmentTypeIds: [], drugClassIds: [], confirmedToxicityIds: [],
    assessmentDate: "2026-01-12", assessmentAnswers: { previous_weight_kg: 67, current_weight_kg: 63 }, observations: [] };
  const packet = matchedReportPacket(definition, facts, "low", facts.assessmentDate);
  const evidence = reportEvidence(definition, facts, { id: "low", label: "Low Risk" }, packet);
  expect(evidence.find(row => row.id === "fact:weight_direction")?.text).toContain("Recorded weight loss: 67 kg previously and 63 kg currently (6%).");
  expect(evidence.find(row => row.id === "fact:weight_direction")?.text).toContain("interval between measurements was not supplied");
});

test("HbA1c wording is excluded from every report narrative field", () => {
  const evidence = [
    { id: "fact:niq_risk", text: "NIQ risk: High Risk; reviewed score 27" },
    { id: "rule:comorbidity:row1", text: "Review body composition, HbA1c, and lipids." },
  ];
  for (const term of ["HbA1c", "A1c", "glycated haemoglobin", "glycated hemoglobin"]) {
    const candidate = { ...safeNarrative, conditionAdvice: { text: `Review ${term} with the care team.`, evidenceIds: ["rule:comorbidity:row1"] } };
    expect(validateNarrative(candidate, evidence).issues).toContain("conditionAdvice:EXCLUDED_REPORT_TERM");
  }
});

test("an excluded term is removed through report revision before publication", async () => {
  const unsafe = { ...safeNarrative, monitoringSummary: { text: "Review HbA1c during treatment.", evidenceIds: ["fact:niq_risk"] } };
  const prompts: string[] = [];
  const { call, request, getCalls } = await setup((step, _call, _user, system) => {
    prompts.push(system);
    return step === "reviewer" ? { accepted: true, issues: [] } : step === "writer" ? unsafe : safeNarrative;
  });
  const response = await call("report-content", request());
  expect(response.status).toBe(200);
  const body = await response.json();
  expect(body.status).toBe("READY");
  expect(JSON.stringify(body.narrative)).not.toMatch(/hba1c|\ba1c\b/i);
  expect(getCalls()).toBe(4);
  expect(prompts.every(system => system.includes("Do not mention HbA1c"))).toBe(true);
});

test("Other returns only generic nutrition guidance, never class toxicity or product plans", async () => {
  const { call, request, facts } = await setup();
  const response = await call("report-content", request({ facts: { ...facts, drugClassIds: ["other"] } }));
  expect(response.status).toBe(200);
  const body = await response.json();
  expect(body.guidance.nutritionInterventions.length).toBeGreaterThan(0);
  expect(body.guidance.toxicityInterventions).toEqual([]);
  expect(body.guidance.possibleToxicities).toEqual([]);
  expect(body.guidance.classGuidance).toEqual([]);
  expect(body.guidance.carePlan.products.plans).toEqual([]);
});

test("product windows use the completed assessment date rather than report generation time", async () => {
  const writerInputs: string[] = [];
  const { call, request, facts } = await setup((step, _call, user) => {
    if (step === "writer") writerInputs.push(user);
    return step === "reviewer" ? { accepted: true, issues: [] } : safeNarrative;
  });
  const response = await call("report-content", request({ facts: {
    ...facts,
    assessmentDate: "2026-10-12",
    treatmentStatusId: "treatment_status_newly_diagnosed",
    plannedTreatmentStartDate: "2026-10-20",
    cancerTypeId: "cancer_1",
  } }));
  expect(response.status).toBe(200);
  const body = await response.json();
  expect(body.guidance.carePlan.products).toMatchObject({
    status: "selected",
    plans: [{ stage: "pre_conditioning", duration: "15 days before treatment (2026-10-05 to 2026-10-20)" }],
  });
  expect(writerInputs.at(-1)).toContain("Selected product plan: Invigour + Nourish. Dose: 1 Invigour + 1 Nourish.");
});

test("writer receives the matched cart quantities and descriptions", async () => {
  const writerInputs: string[] = [];
  const { call, request, facts } = await setup((step, _call, user) => {
    if (step === "writer") writerInputs.push(user);
    return step === "reviewer" ? { accepted: true, issues: [] } : safeNarrative;
  }, definition => {
    const plan = definition.carePlanGuidance!.products.plans.find(row => row.id === "product_pre_conditioning_well_nourished")!;
    plan.items = [{ productName: "Invigour", quantityPerDay: 1 }, { productName: "Nourish", quantityPerDay: 2, description: "After meals" }];
    plan.productNames = ["Invigour", "Nourish"];
    plan.dose = "1 Invigour + 2 Nourish (After meals)";
  });
  const response = await call("report-content", request({ facts: {
    ...facts, assessmentDate: "2026-10-12", treatmentStatusId: "treatment_status_newly_diagnosed",
    plannedTreatmentStartDate: "2026-10-20", cancerTypeId: "cancer_1",
  } }));
  expect(response.status).toBe(200);
  const body = await response.json();
  expect(body.guidance.carePlan.products.plans[0].items).toEqual([
    { productName: "Invigour", quantityPerDay: 1 },
    { productName: "Nourish", quantityPerDay: 2, description: "After meals" },
  ]);
  expect(writerInputs.at(-1)).toContain("Nourish: 2 per day; description: After meals");
});

test("writer and reviewer receive the patient's diet preference", async () => {
  const prompts: Record<string, { user: string; system: string }> = {};
  const { call, request, facts } = await setup((step, _call, user, system) => {
    prompts[step] = { user, system };
    return step === "reviewer" ? { accepted: true, issues: [] } : safeNarrative;
  });
  expect((await call("report-content", request({ facts: { ...facts, dietPreferenceId: "jain" } }))).status).toBe(200);
  expect(prompts.writer?.user).toContain('"id":"fact:diet_preference","text":"Reported diet preference: Jain (no eggs, fish, or meat)"');
  expect(prompts.writer?.system).toContain("omit incompatible examples");
  expect(prompts.reviewer?.system).toContain("food suggestions that conflict with a reported diet preference");
});

test("writer receives the sheet's Surgical scoop quantity without a made-up daily frequency", async () => {
  const writerInputs: string[] = [];
  const { call, request, facts } = await setup((step, _call, user) => {
    if (step === "writer") writerInputs.push(user);
    return step === "reviewer" ? { accepted: true, issues: [] } : safeNarrative;
  });
  const response = await call("report-content", request({ facts: {
    ...facts, assessmentDate: "2026-10-12", surgicalStatusId: "cancer_surgical_status_done",
    surgeryDate: "2026-10-10", dietPreferenceId: "non_vegetarian",
  } }));
  expect(response.status).toBe(200);
  const plan = (await response.json()).guidance.carePlan.products.plans[0];
  expect(plan.items).toEqual([{ productName: "Liss WH", quantityPerDay: 1, description: "leveled scoops in 150ml water" }]);
  expect(writerInputs.at(-1)).toContain("Liss WH: 1 leveled scoops in 150ml water");
  expect(writerInputs.at(-1)).not.toContain("Liss WH: undefined per day");
});

test("writer receives only the product plan after matched structured exceptions", async () => {
  const writerInputs: string[] = [];
  const { call, request, facts } = await setup((step, _call, user) => {
    if (step === "writer") writerInputs.push(user);
    return step === "reviewer" ? { accepted: true, issues: [] } : safeNarrative;
  }, definition => {
    const plan = definition.carePlanGuidance!.products.plans.find(row => row.id === "product_pre_conditioning_well_nourished")!;
    plan.items = [{ productName: "Invigour", quantityPerDay: 1 }, { productName: "Nourish", quantityPerDay: 3 }];
    plan.productNames = ["Invigour", "Nourish"];
    plan.dose = "1 Invigour + 3 Nourish";
  });
  const matchedFacts = { ...facts, assessmentDate: "2026-10-12", treatmentStatusId: "treatment_status_newly_diagnosed",
    plannedTreatmentStartDate: "2026-10-20" };
  const limited = await (await call("report-content", request({ facts: { ...matchedFacts, cancerTypeId: "cancer_5" } }))).json();
  expect(limited.guidance.carePlan.products).toMatchObject({ status: "selected", plans: [{ dose: "1 Invigour + 1 Nourish" }],
    notes: [{ action: { type: "limit", productName: "Nourish", maxQuantityPerDay: 1 } }] });
  expect(writerInputs.at(-1)).toContain("Limit Nourish to at most 1 per day.");
  expect(writerInputs.at(-1)).toContain("Nourish: 1 per day");
  const excluded = await (await call("report-content", request({ idempotencyKey: "report-run-2",
    facts: { ...matchedFacts, cancerTypeId: "cancer_6" } }))).json();
  expect(excluded.guidance.carePlan.products).toMatchObject({ status: "selected", plans: [{ products: "Invigour" }],
    notes: [{ action: { type: "remove", productName: "Nourish" } }] });
  expect(writerInputs.at(-1)).toContain("Remove Nourish from the product plan.");
  expect(writerInputs.at(-1)).toContain("Selected product plan: Invigour.");
});

test("an unresolved product plan withholds matched exception wording from the writer", async () => {
  const writerInputs: string[] = [];
  const { call, request, facts, rule } = await setup((step, _call, user) => {
    if (step === "writer") writerInputs.push(user);
    return step === "reviewer" ? { accepted: true, issues: [] } : safeNarrative;
  }, definition => {
    definition.carePlanGuidance!.surgicalOverlapPolicy = "clinician_choice";
  });
  const matchedFacts = {
    ...facts, treatmentStatusId: "treatment_status_under_treatment",
    treatmentTypeIds: ["current_cancer_treatment_chemotherapy"],
    surgicalStatusId: "cancer_surgical_status_done", surgeryDate: "2026-01-01",
    dietPreferenceId: "vegetarian" as const,
  };
  const resolved = resolveCarePlanGuidance(rule.definition, {
    ...matchedFacts, riskCategoryId: "low", asOfDate: matchedFacts.assessmentDate,
  });
  expect(resolved.products.notes.length).toBeGreaterThan(0);
  const response = await call("report-content", request({ facts: matchedFacts }));
  expect(response.status).toBe(200);
  const body = await response.json();
  expect(body.guidance.carePlan.products).toMatchObject({ status: "clinician_choice_required", plans: [], notes: [] });
  expect(writerInputs.at(-1)).not.toContain("rule:exception:");
  expect(writerInputs.at(-1)).not.toContain("Selected product plan:");
});

test("report includes only answer-matched guidance with actual reported symptom evidence", async () => {
  const writerInputs: string[] = [];
  const safetyInstructions: string[] = [];
  const { call, request, facts } = await setup((step, _call, user, system) => {
    if (step === "writer") { writerInputs.push(user); safetyInstructions.push(system); }
    return step === "reviewer" ? { accepted: true, issues: [] } : safeNarrative;
  }, definition => {
    definition.reportGuidance!.toxicity.find(row => row.id === "toxicity_row_006")!.match = { mode: "assessment_answer", anyOf: [{ fieldId: "dietary_symptoms", optionId: "dietary_symptoms_diarrhoea" }] };
    definition.reportGuidance!.toxicity.find(row => row.id === "toxicity_row_009")!.match = { mode: "assessment_answer", anyOf: [
      { fieldId: "dietary_symptoms", optionId: "dietary_symptoms_fatigue" },
      { fieldId: "appetite_status", optionId: "appetite_status_reduced" },
    ], operator: "any" };
  });
  const selected = { ...facts, drugClassIds: ["taxanes"], treatmentTypeIds: ["current_cancer_treatment_chemotherapy"] };
  const none = await (await call("report-content", request({ facts: selected }))).json();
  expect(none.guidance.possibleToxicities).toEqual([]);
  expect(none.guidance.toxicityInterventions).toEqual([]);
  const matched = await (await call("report-content", request({ idempotencyKey: "report-run-2", facts: { ...selected,
    assessmentAnswers: { dietary_symptoms: ["dietary_symptoms_diarrhoea", "dietary_symptoms_fatigue"] } } }))).json();
  expect(matched.guidance.toxicityInterventions.map((item: { id: string }) => item.id)).toEqual(["toxicity_row_006", "toxicity_row_009"]);
  expect(matched.guidance.toxicityInterventions[0]).toMatchObject({ expectedToxicity: "Diarrhea", matchSource: "assessment_answer", matchedAnswerLabels: ["Diarrhoea"] });
  expect(matched.guidance.toxicityInterventions[1]).toMatchObject({ matchSource: "assessment_answer", matchedAnswerLabels: ["Fatigue"] });
  expect(JSON.stringify(matched.guidance)).not.toContain("docetaxel");
  expect(writerInputs.at(-1)).toContain("Patient reported Fatigue");
  expect(writerInputs.at(-1)).not.toContain("Patient reported Reduced");
  expect(writerInputs.at(-1)).not.toContain("Nutrition guidance source topic: Fatigue / reduced appetite");
  expect(safetyInstructions.at(-1)).toContain("the title does not prove all of those terms occurred");
});

test("clinician options are filtered to the pinned treatment and class and require a completed result", async () => {
  const { app, call, request, rule, getCalls } = await setup(undefined, definition => {
    definition.reportGuidance!.toxicity.find(row => row.id === "toxicity_row_006")!.match = { mode: "clinician_confirmation" };
    definition.reportGuidance!.toxicity.find(row => row.id === "toxicity_row_007")!.match = { mode: "clinician_confirmation" };
    definition.reportGuidance!.toxicity.find(row => row.id === "toxicity_row_004")!.match = { mode: "clinician_confirmation" };
    definition.reportGuidance!.toxicity.find(row => row.id === "toxicity_row_004")!.enabled = false;
  });
  const selected = { assessmentReference: "report-assessment", resultReference: request().resultReference,
    treatmentTypeIds: ["current_cancer_treatment_chemotherapy"], drugClassIds: ["taxanes"] };
  const response = await call("report-toxicity-options", selected);
  expect(response.status).toBe(200);
  const body = await response.json();
  expect(body).toMatchObject({ assessmentReference: selected.assessmentReference, resultReference: selected.resultReference,
    ruleVersionId: rule.id, checksum: rule.packageChecksum });
  expect(body.options.map((item: { id: string }) => item.id)).toEqual([
    "toxicity_row_002", "toxicity_row_006", "toxicity_row_007", "toxicity_row_008", "toxicity_row_010",
  ]);
  expect(body.options[1]).toMatchObject({ id: "toxicity_row_006", classId: "taxanes", classLabel: "Taxanes",
    treatmentTypeId: "current_cancer_treatment_chemotherapy", treatmentTypeLabel: "Chemotherapy (Cytotoxic)", expectedToxicity: "Diarrhea" });
  expect(JSON.stringify(body)).not.toContain("docetaxel");
  expect((await call("report-toxicity-options", { ...selected, drugClassIds: ["other"] })).status).toBe(200);
  expect((await (await call("report-toxicity-options", { ...selected, drugClassIds: ["other"] })).json()).options).toEqual([]);
  expect((await call("report-toxicity-options", { ...selected, resultReference: "wrong" })).status).toBe(404);
  expect((await call("report-toxicity-options", { ...selected, drugClassIds: ["unknown"] })).status).toBe(400);
  expect((await call("report-toxicity-options", { ...selected, treatmentTypeIds: ["unknown"] })).status).toBe(400);
  expect((await call("report-toxicity-options", { ...selected, drugClassIds: ["other", "taxanes"] })).status).toBe(400);
  expect((await app.request("/v1/assessments/report-toxicity-options", { method: "POST", body: JSON.stringify(selected) })).status).toBe(401);
  expect(getCalls()).toBe(0);
});

test("only clinician-confirmation rows accept explicit selections, and duplicate selections do not duplicate guidance", async () => {
  const { call, request, facts, getCalls } = await setup(undefined, definition => {
    definition.reportGuidance!.toxicity.find(row => row.id === "toxicity_row_006")!.match = { mode: "assessment_answer", anyOf: [{ fieldId: "dietary_symptoms", optionId: "dietary_symptoms_diarrhoea" }] };
    definition.reportGuidance!.toxicity.find(row => row.id === "toxicity_row_007")!.match = { mode: "clinician_confirmation" };
  });
  const selected = { ...facts, drugClassIds: ["taxanes"], treatmentTypeIds: ["current_cancer_treatment_chemotherapy"] };
  expect((await call("report-content", request({ facts: { ...selected, confirmedToxicityIds: ["toxicity_row_006"] } }))).status).toBe(400);
  expect((await call("report-content", request({ facts: { ...selected, confirmedToxicityIds: ["toxicity_row_999"] } }))).status).toBe(400);
  expect(getCalls()).toBe(0);
  const response = await call("report-content", request({ facts: { ...selected,
    confirmedToxicityIds: ["toxicity_row_007", "toxicity_row_007"], assessmentAnswers: { dietary_symptoms: ["dietary_symptoms_diarrhoea"] } } }));
  expect(response.status).toBe(200);
  const body = await response.json();
  expect(body.guidance.toxicityInterventions.map((item: { id: string }) => item.id)).toEqual(["toxicity_row_006", "toxicity_row_007"]);
  expect(body.guidance.toxicityInterventions[1]).toMatchObject({ matchSource: "clinician_confirmation", matchedAnswerLabels: [] });
});

test("pinned answer options are validated and positive weight gain selects only matching treatment guidance", async () => {
  const prompts: string[] = [];
  const { call, request, facts, getCalls } = await setup((step, _call, user) => {
    if (step === "writer") prompts.push(user);
    return step === "reviewer" ? { accepted: true, issues: [] } : safeNarrative;
  }, definition => {
    definition.reportGuidance!.toxicity.find(row => row.id === "toxicity_row_107")!.match = { mode: "weight_change", direction: "gain" };
  });
  const selected = { ...facts, drugClassIds: ["anti_estrogens_serms"], treatmentTypeIds: ["current_cancer_treatment_hormonal"] };
  for (const assessmentAnswers of [
    { dietary_symptoms: ["not_an_option"] },
    { appetite_status: "not_an_option" },
    { previous_weight_kg: 0, current_weight_kg: 70 },
    { previous_weight_kg: 70, current_weight_kg: 1001 },
  ]) expect((await call("report-content", request({ facts: { ...selected, assessmentAnswers } }))).status).toBe(400);
  expect(getCalls()).toBe(0);
  const gain = await (await call("report-content", request({ facts: { ...selected,
    assessmentAnswers: { previous_weight_kg: 68, current_weight_kg: 70 } } }))).json();
  expect(gain.guidance.toxicityInterventions.map((item: { id: string }) => item.id)).toEqual(["toxicity_row_107"]);
  expect(gain.guidance.toxicityInterventions[0].matchSource).toBe("weight_change");
  expect(prompts.at(-1)).toContain("Recorded weight gain: 68 kg previously and 70 kg currently");
  const unchanged = await (await call("report-content", request({ idempotencyKey: "unchanged-weight", facts: { ...selected,
    assessmentAnswers: { previous_weight_kg: 70, current_weight_kg: 70 } } }))).json();
  expect(unchanged.guidance.toxicityInterventions).toEqual([]);
});

test("unsupported numerals trigger one revision and independent reviewer recheck", async () => {
  const bad = { ...safeNarrative, overview: { text: "The score is 999.", evidenceIds: ["fact:niq_risk"] } };
  const { call, request, runs, getCalls } = await setup(step => step === "writer" ? bad : step === "reviewer" ? { accepted: true, issues: [] } : safeNarrative);
  const body = await (await call("report-content", request())).json();
  expect(body.status).toBe("READY");
  expect(body.narrative.overview.text).not.toContain("999");
  expect(getCalls()).toBe(4);
  expect((await runs.list({ page: 1, pageSize: 10 })).items[0]?.calls.map(call => call.step)).toEqual(["writer", "reviewer", "revision", "reviewer"]);
});

test("a second targeted revision can resolve a remaining validation issue", async () => {
  const first = { ...safeNarrative, nutritionAdvice: { text: "Take 999 servings.", evidenceIds: ["rule:nutrition:nutrition_low"] } };
  const second = { ...safeNarrative, nutritionAdvice: { text: "Take 888 servings.", evidenceIds: ["rule:nutrition:nutrition_low"] } };
  let revisions = 0;
  const { call, request, getCalls } = await setup(step => step === "reviewer" ? { accepted: true, issues: [] }
    : step === "writer" ? first : ++revisions === 1 ? second : defaultNutritionPart);
  const body = await (await call("report-content", request())).json();
  expect(body.status).toBe("READY");
  expect(body.narrative.nutritionAdvice).toEqual(defaultNutritionPart);
  expect(getCalls()).toBe(6);
});

test("advice can cover several matched rules within its larger word budget", () => {
  const evidence = [
    { id: "rule:nutrition:a", text: "Nutrition support should be tailored to appetite and treatment tolerance." },
    { id: "rule:nutrition:b", text: "Monitor weekly intake and adjust the care plan with the treating team." },
  ];
  const narrative = { ...safeNarrative, nutritionAdvice: {
    text: Array(100).fill("nutrition").join(" "), evidenceIds: ["rule:nutrition:a", "rule:nutrition:b"],
  } };
  expect(validateNarrative(narrative, evidence).issues).not.toContain("nutritionAdvice:FIELD_TOO_LONG");
});

test("treatment guidance can cover several matched rules without clipping its advice", () => {
  const evidence = [{ id: "rule:treatment:a", text: "Discuss treatment nutrition with the care team." }];
  const narrative = { ...safeNarrative, treatmentAdvice: {
    text: Array(145).fill("care").join(" "), evidenceIds: ["rule:treatment:a"],
  } };
  expect(validateNarrative(narrative, evidence).issues).not.toContain("treatmentAdvice:FIELD_TOO_LONG");
  expect(validateNarrative({ ...narrative, treatmentAdvice: {
    ...narrative.treatmentAdvice, text: Array(161).fill("care").join(" "),
  } }, evidence).issues).toContain("treatmentAdvice:FIELD_TOO_LONG");
});

test("renal guidance blocks fixed nutrition and fluid instructions", () => {
  const evidence = [
    { id: "rule:nutrition:a", text: "Energy 25–30 kcal/kg/day and protein 1.2–1.5 g/kg/day." },
    { id: "rule:comorbidity:kidney", text: "Kidney disease: individualise nutrition targets and fluid needs with the care team." },
  ];
  const base = { ...safeNarrative,
    conditionAdvice: { text: "Discuss kidney targets with the care team.", evidenceIds: ["rule:comorbidity:kidney"] },
  };
  const fixed = { ...base, nutritionAdvice: { text: "Aim for 25–30 kcal/kg/day. Keep fluids up with water.", evidenceIds: ["rule:nutrition:a"] } };
  expect(validateNarrative(fixed, evidence).issues).toContain("nutritionAdvice:RENAL_TARGET_NEEDS_QUALIFICATION");
  const misleading = { ...base, nutritionAdvice: { text: "Aim for 25–30 kcal/kg/day and 1.2–1.5 g protein/kg/day, with your care team setting individual targets.", evidenceIds: ["rule:nutrition:a", "rule:comorbidity:kidney"] } };
  expect(validateNarrative(misleading, evidence).issues).toContain("nutritionAdvice:RENAL_TARGET_NEEDS_QUALIFICATION");
  const qualified = { ...base, nutritionAdvice: { text: "The guidance lists 25–30 kcal/kg/day as a general range. Ask your care team to individualise your energy and fluid targets.", evidenceIds: ["rule:nutrition:a", "rule:comorbidity:kidney"] } };
  expect(validateNarrative(qualified, evidence).issues).not.toContain("nutritionAdvice:RENAL_TARGET_NEEDS_QUALIFICATION");
  const withStatus = [...evidence, { id: "rule:status:a", text: "Potassium-rich foods may be relevant, depending on the patient's kidney plan." }];
  const directFoods = { ...qualified, treatmentAdvice: {
    text: "Include potassium-rich foods such as banana, as appropriate to your plan.", evidenceIds: ["rule:status:a"],
  } };
  expect(validateNarrative(directFoods, withStatus).issues).toContain("treatmentAdvice:RENAL_ELECTROLYTE_FOODS_NEED_APPROVAL");
  const checkedFoods = { ...qualified, treatmentAdvice: {
    text: "Ask your care team whether potassium-rich foods fit your individual plan.", evidenceIds: ["rule:status:a"],
  } };
  expect(validateNarrative(checkedFoods, withStatus).issues).not.toContain("treatmentAdvice:RENAL_ELECTROLYTE_FOODS_NEED_APPROVAL");
});

test("missing details leave unsupported passages empty without an unavailable-data placeholder", async () => {
  const omitted = { text: "", evidenceIds: [] };
  const draft = { ...safeNarrative, overview: safePart, keyFindings: omitted, actionSummary: omitted, monitoringSummary: omitted };
  const prompts: string[] = [];
  const { call, request, getCalls } = await setup((step, _call, user) => {
    prompts.push(user);
    return step === "reviewer" ? { accepted: true, issues: [] } : draft;
  });
  const body = await (await call("report-content", request())).json();
  expect(body.status).toBe("READY");
  expect(body.narrative).toEqual(draft);
  expect(body.omittedNarrativeFields).toEqual([]);
  expect(prompts[0]).toContain('text "" and evidenceIds []');
  expect(prompts[0]).not.toContain("No product plan is selected");
  expect(getCalls()).toBe(2);
});

test("reviewed score must equal the completed result even with a fresh idempotency key", async () => {
  const { call, request, facts, runs } = await setup();
  const response = await call("report-content", request({ idempotencyKey: "new-report-key", facts: { ...facts, reviewedScore: 13 } }));
  expect(response.status).toBe(409);
  expect(await response.json()).toEqual({ error: "REVIEWED_SCORE_MISMATCH" });
  expect((await runs.list({ page: 1, pageSize: 10 })).items).toEqual([]);
});

test("reviewer issues cause one targeted revision even if accepted flag is inconsistent", async () => {
  let reviewed = 0;
  const { call, request, getCalls } = await setup(step => {
    if (step === "reviewer") return ++reviewed === 1
      ? { accepted: true, issues: [{ field: "overview", code: "UNCLEAR_WORDING", evidenceIds: ["fact:niq_risk"] }] }
      : { accepted: true, issues: [] };
    return safeNarrative;
  });
  const body = await (await call("report-content", request())).json();
  expect(body.status).toBe("READY");
  expect(getCalls()).toBe(4);
});

test("reviewer claim explanations reach the repair prompt", async () => {
  let reviewed = 0;
  let repairPrompt = "";
  const { call, request } = await setup((step, _call, user) => {
    if (step === "reviewer") return ++reviewed === 1
      ? { accepted: false, issues: [{ field: "overview", code: "UNSUPPORTED_CLAIM", evidenceIds: ["fact:niq_risk"],
        reason: "The draft claims a diagnosis that the score does not establish." }] }
      : { accepted: true, issues: [] };
    if (step === "revision") repairPrompt = user;
    return safeNarrative;
  });
  expect((await (await call("report-content", request())).json()).status).toBe("READY");
  expect(repairPrompt).toContain("The draft claims a diagnosis that the score does not establish.");
});

test("a repeatedly rejected passage is omitted after one revision while supported passages remain", async () => {
  const { call, request, getCalls } = await setup(step => step === "reviewer"
    ? { accepted: true, issues: [{ field: "overview", code: "UNSUPPORTED_CLAIM", evidenceIds: ["fact:niq_risk"] }] }
    : safeNarrative);
  const body = await (await call("report-content", request())).json();
  expect(body.status).toBe("READY");
  expect(body.issues).toEqual([]);
  expect(body.omittedNarrativeFields).toEqual(["overview"]);
  expect(body.narrative.overview).toEqual({ text: "", evidenceIds: [] });
  expect(body.narrative.keyFindings).toEqual(safePart);
  expect(getCalls()).toBe(4);
});

test("a still-unsupported number is omitted even if the reviewer accepts it", async () => {
  const bad = { ...safeNarrative, actionSummary: { text: "Take 999 servings.", evidenceIds: ["fact:niq_risk"] } };
  const { call, request, getCalls } = await setup(step => step === "reviewer" ? { accepted: true, issues: [] } : bad);
  const body = await (await call("report-content", request())).json();
  expect(body.status).toBe("READY");
  expect(body.omittedNarrativeFields).toEqual(["actionSummary"]);
  expect(body.narrative.actionSummary).toEqual({ text: "", evidenceIds: [] });
  expect(body.narrative.overview).toEqual(safePart);
  expect(getCalls()).toBe(4);
});

test("model punctuation and emoji are cleaned before independent clinical review", async () => {
  const styled = { ...safeNarrative, overview: { text: "Review risk; monitor intake — today 🩺", evidenceIds: ["fact:niq_risk"] } };
  const { call, request, getCalls } = await setup(step => step === "reviewer" ? { accepted: true, issues: [] } : styled);
  const body = await (await call("report-content", request())).json();
  expect(body.status).toBe("READY");
  expect(body.omittedNarrativeFields).toEqual([]);
  expect(body.narrative.overview).toEqual({ text: "Review risk. Monitor intake, today", evidenceIds: ["fact:niq_risk"] });
  expect(getCalls()).toBe(2);
  expect(validateNarrative(normalizeNarrativePunctuation(styled), [{ id: "fact:niq_risk", text: "Review risk and monitor intake." }]).issues).not.toContain("overview:REPORT_STYLE");
});

test("caller supplied observation labels never enter model context", async () => {
  const prompts: string[] = [];
  const { call, request, facts } = await setup((step, _call, user) => {
    prompts.push(user);
    return step === "reviewer" ? { accepted: true, issues: [] } : safeNarrative;
  });
  const response = await call("report-content", request({ facts: {
    ...facts, observations: [{ id: "current_weight_kg", label: "Patient Name Secret", value: "68.4", unit: "secret unit" }],
  } }));
  expect(response.status).toBe(200);
  expect(prompts.join(" ")).not.toContain("Patient Name Secret");
  expect(prompts.join(" ")).not.toContain("secret unit");
  expect(prompts.join(" ")).toContain("Current weight: 68.4 kg");
});

test("provider failure fails closed and records no prompts or clinical content in admin usage", async () => {
  const { call, request, runs } = await setup(() => { throw new ReportModelError("MODEL_UNAVAILABLE"); });
  const response = await call("report-content", request());
  expect(response.status).toBe(503);
  expect(await response.json()).toMatchObject({ error: "MODEL_UNAVAILABLE" });
  const run = (await runs.list({ page: 1, pageSize: 10 })).items[0];
  expect(run?.status).toBe("FAILED");
  expect(run?.calls[0]).toMatchObject({ status: "FAILED", errorCode: "MODEL_UNAVAILABLE" });
});
