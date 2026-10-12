import { expect, test } from "bun:test";
import { createFinalAssessmentTemplate } from "@niq-scoring/contracts/final-assessment-template";
import { createApp } from "./app";
import { MemoryScoringStore } from "./store";
import { MemoryReportGenerationStore } from "./report-generation-store";
import { MemoryAdminAuthStore } from "./admin-auth-store";
import { createEntityId } from "./lib/id";
import { ruleChecksum } from "./rule-routes";
import { ReportModelError, type ReportTextProvider } from "./openrouter-report-client";

const safePart = { text: "The NIQ risk category needs clinician review.", evidenceIds: ["fact:niq_risk"] };
const safeNarrative = { overview: safePart, keyFindings: safePart, actionSummary: safePart, monitoringSummary: safePart };
const usage = { model: "openai/gpt-6-luna", provider: "test-provider", generationId: "gen-test", promptTokens: 120, completionTokens: 40, reasoningTokens: 5, costUsd: 0.001, latencyMs: 10 };
type Step = "writer" | "reviewer" | "revision";

async function setup(handler: (step: Step, call: number, user: string, system: string) => unknown = step => step === "reviewer" ? { accepted: true, issues: [] } : safeNarrative) {
  const store = new MemoryScoringStore();
  const runs = new MemoryReportGenerationStore();
  const definition = createFinalAssessmentTemplate("Report test");
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

test("drug-named source wording is withheld and possible toxicity remains separate from confirmed", async () => {
  const writerInputs: string[] = [];
  const safetyInstructions: string[] = [];
  const { call, request, facts } = await setup((step, _call, user, system) => {
    if (step === "writer") { writerInputs.push(user); safetyInstructions.push(system); }
    return step === "reviewer" ? { accepted: true, issues: [] } : safeNarrative;
  });
  const selected = { ...facts, drugClassIds: ["taxanes"], treatmentTypeIds: ["current_cancer_treatment_chemotherapy"] };
  const possible = await (await call("report-content", request({ facts: selected }))).json();
  const row = possible.guidance.possibleToxicities.find((item: { id: string }) => item.id === "toxicity_row_006");
  expect(row.expectedToxicity).toBe("Diarrhea");
  expect(row.nutritionalInterventions).toContain("ORS");
  expect(JSON.stringify(possible.guidance)).not.toContain("docetaxel");
  expect(possible.guidance.toxicityInterventions.find((item: { id: string }) => item.id === row.id)).toBeUndefined();
  const confirmed = await (await call("report-content", request({ idempotencyKey: "report-run-2", facts: { ...selected, confirmedToxicityIds: [row.id] } }))).json();
  expect(confirmed.guidance.toxicityInterventions.find((item: { id: string }) => item.id === row.id).expectedToxicity).toBe("Diarrhea");
  expect(writerInputs.at(-1)).not.toContain("Confirmed toxicity:");
  expect(writerInputs.at(-1)).toContain("Nutrition guidance source topic: Diarrhea");
  expect(safetyInstructions.at(-1)).toContain("the title does not prove all of those terms occurred");
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

test("unresolved reviewer issues remain visible and require clinical review", async () => {
  const { call, request, getCalls } = await setup(step => step === "reviewer"
    ? { accepted: true, issues: [{ field: "overview", code: "UNSUPPORTED_CLAIM", evidenceIds: ["fact:niq_risk"] }] }
    : safeNarrative);
  const body = await (await call("report-content", request())).json();
  expect(body.status).toBe("REVIEW_REQUIRED");
  expect(body.issues).toContain("overview:UNSUPPORTED_CLAIM");
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
