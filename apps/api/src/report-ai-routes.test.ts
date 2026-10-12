import { expect, test } from "bun:test";
import { createFinalAssessmentTemplate } from "@niq-scoring/contracts/final-assessment-template";
import { createApp } from "./app";
import { MemoryScoringStore } from "./store";
import { MemoryReportGenerationStore } from "./report-generation-store";
import { MemoryAdminAuthStore } from "./admin-auth-store";
import { createEntityId } from "./lib/id";
import { ruleChecksum } from "./rule-routes";
import { ReportModelError, type ReportTextProvider } from "./openrouter-report-client";
import type { FinalAssessmentDefinition } from "@niq-scoring/contracts/final-assessment";

const safePart = { text: "The NIQ risk category needs clinician review.", evidenceIds: ["fact:niq_risk"] };
const safeNarrative = { overview: safePart, keyFindings: safePart, actionSummary: safePart, monitoringSummary: safePart };
const usage = { model: "openai/gpt-6-luna", provider: "test-provider", generationId: "gen-test", promptTokens: 120, completionTokens: 40, reasoningTokens: 5, costUsd: 0.001, latencyMs: 10 };
type Step = "writer" | "reviewer" | "revision";

async function setup(handler: (step: Step, call: number, user: string, system: string) => unknown = step => step === "reviewer" ? { accepted: true, issues: [] } : safeNarrative,
  configure?: (definition: FinalAssessmentDefinition) => void) {
  const store = new MemoryScoringStore();
  const runs = new MemoryReportGenerationStore();
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
  const provider: ReportTextProvider = { complete: async ({ step, user, system }) => ({ content: handler(step, ++calls, user, system), usage }) };
  const app = createApp({ store, authStore: new MemoryAdminAuthStore(), reportGenerationStore: runs, reportTextProvider: provider,
    region: "test", allowedOrigins: [], runtimeEnvironment: "test", provisionalScoringRequested: false, now: () => new Date("2026-01-02T00:00:00Z") });
  const call = (action: string, data: unknown) => app.request(`/v1/assessments/${action}`, { method: "POST", headers: { authorization: `Bearer ${token}`, "content-type": "application/json" }, body: JSON.stringify(data) });
  await call("start", { assessmentReference: "report-assessment" });
  const reviewed = await (await call("classify-reviewed", { assessmentReference: "report-assessment", idempotencyKey: "reviewed-result-1", score: 12 })).json();
  const resultReference = reviewed.result.resultReference as string;
  const facts = { reviewedScore: 12, reviewedRiskCategoryId: "low", treatmentTypeIds: [], drugClassIds: [], confirmedToxicityIds: [], observations: [{ id: "current_weight_kg", label: "Current weight", value: "68.4", unit: "kg" }] };
  const request = (overrides: Record<string, unknown> = {}) => ({ assessmentReference: "report-assessment", resultReference, idempotencyKey: "report-run-1", facts, ...overrides });
  return { app, call, store, runs, rule, request, facts, getCalls: () => calls };
}

test("report content uses pinned rules, four bounded fields, idempotency, and sanitized admin usage", async () => {
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

test("missing details leave unsupported passages empty without an unavailable-data placeholder", async () => {
  const omitted = { text: "", evidenceIds: [] };
  const draft = { overview: safePart, keyFindings: omitted, actionSummary: omitted, monitoringSummary: omitted };
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

test("report text with forbidden punctuation or emoji is omitted after one failed revision", async () => {
  const styled = { ...safeNarrative, overview: { text: "Review risk; monitor intake — today 🩺", evidenceIds: ["fact:niq_risk"] } };
  const { call, request, getCalls } = await setup(step => step === "reviewer" ? { accepted: true, issues: [] } : styled);
  const body = await (await call("report-content", request())).json();
  expect(body.status).toBe("READY");
  expect(body.omittedNarrativeFields).toEqual(["overview"]);
  expect(body.narrative.overview).toEqual({ text: "", evidenceIds: [] });
  expect(body.narrative.keyFindings).toEqual(safePart);
  expect(getCalls()).toBe(4);
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
