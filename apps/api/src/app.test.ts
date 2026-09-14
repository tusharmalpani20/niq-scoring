import { describe, expect, test } from "bun:test";
import { MemoryAdminAuthStore } from "./admin-auth-store";
import { createApp } from "./app";
import { MemoryScoringStore } from "./store";
import { UnconfiguredCarePlixAdapter } from "./face-scan";

const adminToken = "development-admin-token-at-least-32-characters";
const adminHeaders = { authorization: `Bearer ${adminToken}`, cookie: "niq_scoring_session=test-session", origin: "http://localhost:4173", "content-type": "application/json" };
const jsonRequest = (body: unknown, authorization = adminHeaders.authorization) => ({ method: "POST", headers: { ...adminHeaders, authorization }, body: JSON.stringify(body) });

function setup() {
  const store = new MemoryScoringStore();
  const authStore = new MemoryAdminAuthStore();
  authStore.state.users.push({ id: "01J00000000000000000000001", email: "admin@niq.test", displayName: "Admin", enabled: true, createdAt: "2026-09-13T00:00:00.000Z", passwordHash: "unused" });
  authStore.state.sessions.push({ userId: "01J00000000000000000000001", tokenHash: new Bun.CryptoHasher("sha256").update("test-session").digest("hex"), expiresAt: "2027-01-01T00:00:00.000Z" });
  const app = createApp({ store, authStore, adminBootstrapToken: adminToken, allowedOrigins: ["http://localhost:4173"], region: "india", runtimeEnvironment: "test", provisionalScoringRequested: true, now: () => new Date("2026-09-13T00:00:00.000Z") });
  return { app, store };
}

async function onboard() {
  const { app, store } = setup();

  const client = await (await app.request("/admin/clients", jsonRequest({ name: "Apollo Group" }))).json() as { id: string };
  const deployment = await (await app.request("/admin/deployments", jsonRequest({ name: "Apollo Production", environment: "production", region: "india", clientId: client.id }))).json() as { id: string };
  for (const capability of ["SCORING", "FACE_SCAN"] as const) await app.request(`/admin/deployments/${deployment.id}/entitlement`, { method: "PUT", headers: adminHeaders, body: JSON.stringify({ capability, enabled: true, monthlyLimit: null }) });
  await app.request(`/admin/deployments/${deployment.id}/version-assignment`, { method: "PUT", headers: adminHeaders, body: JSON.stringify({ mode: "PINNED", scoringRuleVersionId: store.versions[0]!.id }) });
  const activation = await (await app.request(`/admin/deployments/${deployment.id}/activation-token`, jsonRequest({ expiresInMinutes: 30 }))).json() as { activationToken: string };
  const activated = await (await app.request("/v1/activate", jsonRequest({ activationToken: activation.activationToken }, ""))).json() as { credential: string };
  return { app, store, client, deployment, activationToken: activation.activationToken, credential: activated.credential };
}

const scoringInput = (clientId: string) => ({ idempotencyKey: "request-key-0001", input: { assessmentReference: "pseudonym-1", clientId, heightCm: 170, weightKg: 70, weightTrend: "stable", weightChangePercent: null, intakeLevel: "normal", appetite: "good", functionalStatus: "fully_active", cancerStage: "Unknown", albumin: null, crp: null, fluidStatus: {}, symptoms: {} } });

describe("scoring API", () => {
  test("health is public and readiness fails closed", async () => {
    const { app } = setup();
    expect((await app.request("/health")).status).toBe(200);
    const unavailable = createApp({ authStore: new MemoryAdminAuthStore(), store: new MemoryScoringStore(), allowedOrigins: [], region: "india", runtimeEnvironment: "test", provisionalScoringRequested: false, readinessCheck: async () => false });
    expect((await unavailable.request("/ready")).status).toBe(503);
  });

  test("legacy admin bearer token never authenticates in production", async () => {
    const { app, store } = setup();
    expect((await app.request("/admin/overview")).status).toBe(401);
    const production = createApp({ authStore: new MemoryAdminAuthStore(), store, adminBootstrapToken: adminToken, allowedOrigins: [], region: "india", runtimeEnvironment: "production", provisionalScoringRequested: true });
    expect((await production.request("/admin/overview", { headers: adminHeaders })).status).toBe(401);
  });

  test("creates client and deployment through admin boundary", async () => {
    const { app, client, deployment } = await onboard();
    const overview = await (await app.request("/admin/overview", { headers: adminHeaders })).json() as { clients: unknown[]; deployments: unknown[] };
    expect(overview.clients).toHaveLength(1);
    expect(overview.deployments).toEqual([expect.objectContaining({ id: deployment.id, clientId: client.id })]);
  });

  test("rejects another client's request even when its idempotency key matches a completed request", async () => {
    const { app, store, client, deployment, credential } = await onboard();
    expect((await app.request("/v1/provisional/calculate", jsonRequest(scoringInput(client.id), `Bearer ${credential}`))).status).toBe(200);
    const other = await store.createClient({ name: "Other client" });
    const response = await app.request("/v1/provisional/calculate", jsonRequest(scoringInput(other.id), `Bearer ${credential}`));
    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({ reason: "CLIENT_NOT_ALLOWED" });
    expect(store.usages).toHaveLength(1);
  });

  test("activation tokens are one-time and deployment credentials authenticate", async () => {
    const { app, activationToken, credential } = await onboard();
    expect(credential).toStartWith("niq_dep_");
    expect((await app.request("/v1/activate", jsonRequest({ activationToken }, ""))).status).toBe(401);
    expect((await app.request("/v1/metadata", { headers: { authorization: `Bearer ${credential}` } })).status).toBe(200);
  });

  test("deployment limits are independent and issuing another credential does not reset usage", async () => {
    const { app, store, client, deployment, credential } = await onboard();
    await store.setEntitlement(deployment.id, { capability: "SCORING", enabled: true, monthlyLimit: 1 });
    const second = await store.createDeployment({ clientId: client.id, name: "Second", environment: "test", region: "india" });
    await store.setEntitlement(second.id, { capability: "SCORING", enabled: true, monthlyLimit: 2 });
    await store.assignVersion(second.id, { mode: "PINNED", scoringRuleVersionId: store.versions[0]!.id });
    async function activate(id: string) {
      const token = await (await app.request(`/admin/deployments/${id}/activation-token`, jsonRequest({}))).json() as { activationToken: string };
      return (await (await app.request("/v1/activate", jsonRequest(token))).json() as { credential: string }).credential;
    }
    const calculate = (key: string, auth: string) => app.request("/v1/provisional/calculate", jsonRequest({ ...scoringInput(client.id), idempotencyKey: key }, `Bearer ${auth}`));
    expect((await calculate("first-request", credential)).status).toBe(200);
    const renewed = await activate(deployment.id);
    expect((await calculate("second-request", renewed)).status).toBe(409);
    const secondCredential = await activate(second.id);
    expect((await calculate("first-request", secondCredential)).status).toBe(200);
    expect((await calculate("second-request", secondCredential)).status).toBe(200);
    expect((await calculate("third-request", secondCredential)).status).toBe(409);
    await store.assignVersion(second.id, { mode: "LATEST_APPROVED" });
    expect(store.assignments.find(a => a.deploymentId === deployment.id)?.mode).toBe("PINNED");
    expect(store.entitlements.find(e => e.deploymentId === deployment.id && e.capability === "SCORING")?.monthlyLimit).toBe(1);
  });

  test("guards provisional scoring, records usage and returns idempotent result", async () => {
    const { app, store, client, deployment, credential } = await onboard();
    const request = jsonRequest(scoringInput(client.id), `Bearer ${credential}`);
    const first = await app.request("/v1/provisional/calculate", request);
    const firstBody = await first.json();
    expect(first.status).toBe(200);
    expect(firstBody).toMatchObject({ result: { versionStatus: "DRAFT_NON_CLINICAL", clinicalUsePermitted: false } });
    const duplicate = await app.request("/v1/provisional/calculate", request);
    expect(await duplicate.json()).toEqual(firstBody);
    expect(store.usages).toHaveLength(1);
  });

  test("enforces monthly quota and preserves face-scan stub state", async () => {
    const { app, client, deployment, credential } = await onboard();
    await app.request(`/admin/deployments/${deployment.id}/entitlement`, { method: "PUT", headers: adminHeaders, body: JSON.stringify({ capability: "FACE_SCAN", enabled: true, monthlyLimit: 1 }) });
    const auth = `Bearer ${credential}`;
    const first = await app.request("/v1/face-scans", jsonRequest({ clientId: client.id, assessmentReference: "assessment-1", idempotencyKey: "face-scan-0001" }, auth));
    expect(first.status).toBe(202); expect(await first.json()).toMatchObject({ session: { state: "REQUESTED" }, providerConfigured: false });
    const second = await app.request("/v1/face-scans", jsonRequest({ clientId: client.id, assessmentReference: "assessment-2", idempotencyKey: "face-scan-0002" }, auth));
    expect(await second.json()).toEqual({ error: "FACE_SCAN_UNAVAILABLE", reason: "MONTHLY_LIMIT_REACHED" });
  });

  test("production cannot enable provisional scoring", async () => {
    const production = createApp({ authStore: new MemoryAdminAuthStore(), store: new MemoryScoringStore(), allowedOrigins: [], region: "india", runtimeEnvironment: "production", provisionalScoringRequested: true });
    expect((await production.request("/v1/provisional/calculate", { method: "POST" })).status).toBe(503);
  });

  test("CarePlix placeholder fails closed without creating a scan", async () => {
    const setupResult = await onboard();
    const app = createApp({ authStore: new MemoryAdminAuthStore(), store: setupResult.store, adminBootstrapToken: adminToken, allowedOrigins: [], region: "india", runtimeEnvironment: "test", provisionalScoringRequested: true, faceScanAdapter: new UnconfiguredCarePlixAdapter() });
    const response = await app.request("/v1/face-scans", jsonRequest({ clientId: setupResult.client.id, assessmentReference: "assessment-careplix", idempotencyKey: "face-scan-careplix" }, `Bearer ${setupResult.credential}`));
    expect(response.status).toBe(500);
    expect(setupResult.store.faceScans).toHaveLength(0);
    expect(setupResult.store.usages.at(-1)?.outcome).toBe("FAILED");
  });
});
