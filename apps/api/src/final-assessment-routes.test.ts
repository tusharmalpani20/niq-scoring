import { expect, test } from "bun:test";
import { createFinalAssessmentTemplate, createLegacyFinalAssessmentTemplate, upgradeFinalAssessmentDefinition } from "@niq-scoring/contracts/final-assessment-template";
import type { FinalAssessmentDefinition } from "@niq-scoring/contracts/final-assessment";
import { createApp } from "./app";
import { MemoryAdminAuthStore } from "./admin-auth-store";
import { MemoryScoringStore } from "./store";
import { createEntityId } from "./lib/id";
import { ruleChecksum } from "./rule-routes";
import type { RuleRecord } from "./rule-store";

const actorId = "01J00000000000000000000001";
const now = "2026-09-17T00:00:00.000Z";
const headers = { cookie: "niq_scoring_session=final-test-session", origin: "http://localhost:4173", "content-type": "application/json" };

function adminSetup() {
  const store = new MemoryScoringStore();
  const authStore = new MemoryAdminAuthStore();
  authStore.state.users.push({ id: actorId, email: "final@niq.test", displayName: "Final administrator", enabled: true, createdAt: now, passwordHash: "unused" });
  authStore.state.sessions.push({ userId: actorId, tokenHash: new Bun.CryptoHasher("sha256").update("final-test-session").digest("hex"), expiresAt: "2027-01-01T00:00:00.000Z" });
  const app = createApp({ store, authStore, allowedOrigins: [headers.origin], region: "india", runtimeEnvironment: "test", provisionalScoringRequested: false, now: () => new Date(now) });
  const request = (path: string, method = "GET", body?: unknown) => app.request(`/admin/rules${path}`, { method, headers, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
  const create = async (name = "Final assessment draft") => {
    const response = await request("", "POST", { name, requestId: crypto.randomUUID() });
    expect(response.status).toBe(201);
    return await response.json() as RuleRecord;
  };
  return { store, request, create };
}

function completeSample(definition: FinalAssessmentDefinition) {
  definition.samples = [{
    id: "localized_case",
    name: "Synthetic localized case",
    answers: { stage: "stage_localized" },
    expected: { complete: true, score: 1, classificationId: "low" },
  }];
}

test("final assessment creation uses the versioned fixed profile and supports save/reopen", async () => {
  const { request, create } = adminSetup();
  const draft = await create();
  expect(draft.definition).toMatchObject({ formatVersion: 2, profile: "NIQ_FINAL_ASSESSMENT", provisional: { clinicalUsePermitted: true } });
  const definition = draft.definition as FinalAssessmentDefinition;
  expect(definition.sections.map(section => section.fields.length)).toEqual([3, 5, 3, 2, 6]);
  expect(definition.sections.flatMap(section => section.fields)).toHaveLength(19);
  expect(definition.sections.flatMap(section => section.fields).every(field => !Object.hasOwn(field, "cap"))).toBe(true);
  const changed = structuredClone(definition);
  changed.description = "Internal review copy";
  const saved = await request(`/${draft.id}`, "PUT", { revision: draft.revision, definition: changed });
  expect(saved.status).toBe(200);
  const reopened = await (await request(`/${draft.id}`)).json() as RuleRecord & { audit: unknown[] };
  expect(reopened.definition).toEqual(changed);
  expect(reopened.revision).toBe(2);
  expect(reopened.audit).toHaveLength(2);
});

test("final assessment keeps fixed options while allowing point edits", async () => {
  const { request, create } = adminSetup();
  const draft = await create();
  const definition = structuredClone(draft.definition as FinalAssessmentDefinition);
  const stage = definition.sections[0]!.fields[1]!;
  if (stage.kind !== "select") throw new Error("template stage field changed");
  stage.options[0]!.label = "Tampered option";
  expect(await (await request(`/${draft.id}`, "PUT", { revision: 1, definition })).json()).toEqual({ error: "FIXED_RULE_REQUIRED" });
  const points = structuredClone(draft.definition as FinalAssessmentDefinition);
  const pointsStage = points.sections[0]!.fields[1]!;
  if (pointsStage.kind !== "select") throw new Error("template stage field changed");
  pointsStage.scoring.points[0]!.points = 4;
  const response = await request(`/${draft.id}`, "PUT", { revision: 1, definition: points });
  expect(response.status).toBe(200);
});

test("final assessment preview evaluates partial answers without recording usage", async () => {
  const { request, create, store } = adminSetup();
  const draft = await create();
  const preview = await request(`/${draft.id}/preview`, "POST", { revision: 1, answers: { stage: "stage_localized" } });
  expect(preview.status).toBe(200);
  expect(await preview.json()).toMatchObject({ complete: true, score: 1, classification: { id: "low" }, preview: true, riskStatus: "CLIENT_CONFIRMED", clinicalUsePermitted: true });
  const invalid = await request(`/${draft.id}/preview`, "POST", { revision: 1, answers: { patient_name: "not accepted" } });
  expect(invalid.status).toBe(400);
  expect((await invalid.json()).result.issues[0]).toMatchObject({ code: "IDENTITY_FIELD_NOT_ALLOWED" });
  expect(store.usages).toHaveLength(0);
});

test("legacy drafts stay blocked until explicitly upgraded and approved", async () => {
  const { request, create } = adminSetup();
  const draft = await create();
  const definition = createLegacyFinalAssessmentTemplate(draft.version);
  completeSample(definition);
  let record = await (await request(`/${draft.id}`, "PUT", { revision: 1, definition })).json() as RuleRecord;
  expect((await request(`/${record.id}/validate`, "POST", { revision: record.revision })).status).toBe(200);
  record = await (await request(`/${record.id}`)).json() as RuleRecord;
  expect(record.lifecycle).toBe("VALIDATED");
  const approval = await request(`/${record.id}/approve`, "POST", { revision: record.revision });
  expect(approval.status).toBe(409);
  expect(await approval.json()).toEqual({ error: "PROVISIONAL_THRESHOLDS_UNCONFIRMED" });
  const upgraded = upgradeFinalAssessmentDefinition(definition);
  const saved = await request(`/${record.id}`, "PUT", { revision: record.revision, definition: upgraded });
  expect(saved.status).toBe(200);
  record = await saved.json() as RuleRecord;
  for (const action of ["validate", "approve", "activate"]) {
    const response = await request(`/${record.id}/${action}`, "POST", { revision: record.revision });
    expect(response.status).toBe(200);
    record = await response.json() as RuleRecord;
  }
  const active = await (await request(`/${record.id}`)).json() as RuleRecord;
  expect(active).toMatchObject({ lifecycle: "ACTIVE", clinicalUsePermitted: true, revision: 7 });
  expect((await request(`/${record.id}`, "PUT", { revision: 2, definition: upgraded })).status).not.toBe(200);
});

test("public assessment binding rejects the final profile until clinical use is permitted", async () => {
  const { store } = adminSetup();
  const definition = createFinalAssessmentTemplate("Final public block");
  const rule: RuleRecord = { id: createEntityId(), version: definition.name, lifecycle: "APPROVED", clinicalUsePermitted: false, definition, packageChecksum: ruleChecksum(definition), revision: 1, validatedRevision: 1, createdAt: now, updatedAt: now, createdBy: actorId, approvedAt: now };
  store.rules.records.push(rule);
  const client = await store.createClient({ name: "Final client" });
  const deployment = await store.createDeployment({ clientId: client.id, name: "Final deployment", environment: "test" });
  await store.setEntitlement(deployment.id, { capability: "SCORING", enabled: true, monthlyLimit: 5 });
  store.assignments.push({ deploymentId: deployment.id, mode: "PINNED", scoringRuleVersionId: rule.id });
  const secret = "a".repeat(40);
  store.credentials.push({ credentialId: createEntityId(), clientId: client.id, deploymentId: deployment.id, keyPrefix: "finalpublic", secretHash: new Bun.CryptoHasher("sha256").update(`niq_dep_finalpublic.${secret}`).digest("hex") });
  const app = createApp({ store, authStore: new MemoryAdminAuthStore(), region: "test", allowedOrigins: [], runtimeEnvironment: "test", provisionalScoringRequested: false });
  const response = await app.request("/v1/assessments/start", { method: "POST", headers: { authorization: `Bearer niq_dep_finalpublic.${secret}`, "content-type": "application/json" }, body: JSON.stringify({ assessmentReference: "blocked-final" }) });
  expect(response.status).toBe(409);
  expect(await response.json()).toEqual({ error: "VERSION_UNAVAILABLE" });
});
