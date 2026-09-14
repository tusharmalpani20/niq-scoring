import { expect, test } from "bun:test";
import { blankRuleDefinition, questionSchema } from "@niq-scoring/contracts/rules";
import { createApp } from "./app";
import { MemoryScoringStore } from "./store";
import { MemoryAdminAuthStore } from "./admin-auth-store";
import { createEntityId } from "./lib/id";
import { ruleChecksum } from "./rule-routes";
function synthetic(store: MemoryScoringStore, name: string, approvedAt: string) {
  const definition = blankRuleDefinition(name);
  definition.sections = [{ id: "section", title: "Synthetic", description: "", questions: [questionSchema.parse({ id: "amount", label: "Amount", type: "number", purpose: "scoring", required: true, validation: { min: 0, max: 10 } })] }];
  definition.domains = [{ id: "domain", label: "Synthetic domain", cap: null, sources: [] }];
  definition.scoring = [{ id: "points", label: "Points", domainId: "domain", kind: "ranges", input: { kind: "question", id: "amount" }, bands: [{ id: "band", min: 0, max: 10, minInclusive: true, maxInclusive: true, points: 3 }], sources: [] }];
  definition.classifications = [{ id: "category", label: "Synthetic category", min: null, max: null, minInclusive: true, maxInclusive: true, interpretation: "Test only", sources: [] }];
  const row = { id: createEntityId(), version: name, lifecycle: "APPROVED" as const, clinicalUsePermitted: true, definition, packageChecksum: ruleChecksum(definition), revision: 3, validatedRevision: 3, createdAt: approvedAt, updatedAt: approvedAt, createdBy: null, approvedAt };
  store.rules.records.push(row); return row;
}
async function setup() {
  const store = new MemoryScoringStore();
  const rule = synthetic(store, "Synthetic first", "2026-01-01T00:00:00Z");
  const client = await store.createClient({ name: "Synthetic client" });
  const deployment = await store.createDeployment({ clientId: client.id, name: "Synthetic deployment", environment: "test" });
  await store.setEntitlement(deployment.id, { capability: "SCORING", enabled: true, monthlyLimit: 1 });
  await store.assignVersion(deployment.id, { mode: "LATEST_APPROVED" });
  const secret = "a".repeat(40);
  store.credentials.push({ credentialId: createEntityId(), clientId: client.id, deploymentId: deployment.id, keyPrefix: "synthetic123", secretHash: new Bun.CryptoHasher("sha256").update(`niq_dep_synthetic123.${secret}`).digest("hex") });
  const app = createApp({ store, authStore: new MemoryAdminAuthStore(), region: "test", allowedOrigins: [], runtimeEnvironment: "test", provisionalScoringRequested: false });
  const call = (action: string, data: unknown) => app.request(`/v1/assessments/${action}`, { method: "POST", headers: { authorization: `Bearer niq_dep_synthetic123.${secret}`, "content-type": "application/json" }, body: JSON.stringify(data) });
  return { store, rule, client, deployment, call, app };
}
test("assessment start pins concrete version and exposes only questionnaire renderer data", async () => {
  const { store, rule, call } = await setup();
  const response = await call("start", { assessmentReference: "test-assessment" });
  expect(response.status).toBe(200);
  const first = await response.json(); expect(first.ruleVersionId).toBe(rule.id);
  expect(first.questionnaire.sections[0].questions[0].label).toBe("Amount");
  expect(first.questionnaire).not.toHaveProperty("scoring");
  expect(first.questionnaire.sections[0].questions[0]).not.toHaveProperty("sources");
  synthetic(store, "Synthetic second", "2026-02-01T00:00:00Z");
  expect((await (await call("start", { assessmentReference: "test-assessment" })).json()).bindingId).toBe(first.bindingId);
  expect((await (await call("start", { assessmentReference: "new-assessment" })).json()).ruleVersionId).not.toBe(rule.id);
  expect(store.usages).toHaveLength(0);
});
test("retired bound assessment completes; new assessments cannot use retired pin", async () => {
  const { store, rule, call, deployment } = await setup();
  await store.assignVersion(deployment.id, { mode: "PINNED", scoringRuleVersionId: rule.id });
  await call("start", { assessmentReference: "before-retirement" });
  await store.rules.transition({ id: rule.id, revision: 3, action: "retire", actor: "test", now: "2026-03-01T00:00:00Z" });
  expect((await call("start", { assessmentReference: "after-retirement" })).status).toBe(409);
  const response = await call("calculate", { assessmentReference: "before-retirement", answers: { amount: 0 }, idempotencyKey: "calc-key-1" });
  expect(response.status).toBe(200);
  const payload = await response.json(); expect(payload.result.score).toBe(3); expect(payload.result.ruleVersionId).toBe(rule.id); expect(payload.result.checksum).toBe(rule.packageChecksum); expect(payload.result.resultReference).toBe(store.usages[0]?.id);
});
test("retries preserve response and quota while changed answers conflict", async () => {
  const { store, call } = await setup();
  await call("start", { assessmentReference: "test-assessment" });
  const input = { assessmentReference: "test-assessment", answers: { amount: 0 }, idempotencyKey: "calc-key-1" };
  const first = await (await call("calculate", input)).json();
  expect(await (await call("calculate", input)).json()).toEqual(first);
  expect(await (await call("calculate", { ...input, answers: { amount: 1 } })).json()).toMatchObject({ reason: "IDEMPOTENCY_CONFLICT" });
  expect(await (await call("calculate", { ...input, idempotencyKey: "calc-key-2" })).json()).toMatchObject({ reason: "MONTHLY_LIMIT_REACHED" });
  expect(store.usages).toHaveLength(1);
});
test("disabled clients cannot retrieve or replay assessments; missing answers are not billable", async () => {
  const { store, call, client } = await setup();
  expect((await call("calculate", { assessmentReference: "missing", answers: {}, idempotencyKey: "calc-key-1" })).status).toBe(404);
  await call("start", { assessmentReference: "test-assessment" });
  expect((await call("calculate", { assessmentReference: "test-assessment", answers: {}, idempotencyKey: "calc-key-1" })).status).toBe(422);
  expect(store.usages).toHaveLength(0);
  await store.setClientEnabled(client.id, false);
  expect(await (await call("start", { assessmentReference: "test-assessment" })).json()).toEqual({ error: "CLIENT_DISABLED" });
  expect((await call("calculate", { assessmentReference: "test-assessment", answers: { amount: 0 }, idempotencyKey: "calc-key-1" })).status).toBe(409);
});
test("caller cannot select arbitrary rule IDs and drafts cannot be assigned", async () => {
  const { store, call, app, deployment } = await setup();
  expect((await call("start", { assessmentReference: "test", ruleVersionId: createEntityId() })).status).toBe(400);
  expect((await app.request("/v1/assessments/start", { method: "POST", body: "{}" })).status).toBe(401);
  const draft = synthetic(store, "Synthetic draft", "2026-03-01T00:00:00Z");
  store.rules.records.find(r => r.id === draft.id)!.lifecycle = "DRAFT";
  await expect(store.assignVersion(deployment.id, { mode: "PINNED", scoringRuleVersionId: draft.id })).rejects.toThrow("VERSION_UNAVAILABLE");
});
