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
  const app = createApp({ store, authStore, activationTokenEncryptionKey: "ab".repeat(32), adminBootstrapToken: adminToken, allowedOrigins: ["http://localhost:4173"], region: "india", runtimeEnvironment: "test", provisionalScoringRequested: true, now: () => new Date("2026-09-13T00:00:00.000Z") });
  return { app, store };
}

async function onboard() {
  const { app, store } = setup();

  const client = await (await app.request("/admin/clients", jsonRequest({ name: "Apollo Group" }))).json() as { id: string };
  const deployment = await (await app.request("/admin/deployments", jsonRequest({ name: "Apollo Production", environment: "production", clientId: client.id }))).json() as { id: string };
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

  test("client usage reports successful deployment events and six UTC months", async () => {
    const { app, store } = setup();
    const client = await store.createClient({ name: "Apollo" });
    const first = await store.createDeployment({ clientId: client.id, name: "Production", environment: "production" });
    const second = await store.createDeployment({ clientId: client.id, name: "Test", environment: "test" });
    const other = await store.createClient({ name: "Other" });
    const otherDeployment = await store.createDeployment({ clientId: other.id, name: "Other production", environment: "production" });
    const add = (deploymentId: string, capability: "SCORING" | "FACE_SCAN", outcome: "SUCCEEDED" | "FAILED", date: string) => store.usages.push({ id: crypto.randomUUID(), clientId: deploymentId === otherDeployment.id ? other.id : client.id, deploymentId, capability, outcome, idempotencyKey: crypto.randomUUID(), occurredAt: new Date(date) });
    add(first.id, "SCORING", "SUCCEEDED", "2026-04-01T00:00:00Z");
    add(first.id, "SCORING", "SUCCEEDED", "2026-09-12T23:00:00Z");
    add(first.id, "FACE_SCAN", "SUCCEEDED", "2026-09-01T00:00:00Z");
    add(first.id, "SCORING", "FAILED", "2026-09-02T00:00:00Z");
    add(second.id, "SCORING", "SUCCEEDED", "2026-02-02T00:00:00Z");
    add(otherDeployment.id, "SCORING", "SUCCEEDED", "2026-09-01T00:00:00Z");
    const response = await app.request(`/admin/clients/${client.id}/usage`, { headers: adminHeaders });
    expect(response.status).toBe(200);
    const usage = await response.json() as { deployments: Array<{ deploymentId: string; assessments: number; vitalIq: number; monthly: Array<{ month: string; assessments: number; vitalIq: number }> }> };
    expect(usage.deployments).toHaveLength(2);
    expect(usage.deployments[0]).toMatchObject({ deploymentId: first.id, assessments: 2, vitalIq: 1 });
    expect(usage.deployments[0]!.monthly).toHaveLength(6);
    expect(usage.deployments[0]!.monthly[0]).toEqual({ month: "2026-04", assessments: 1, vitalIq: 0 });
    expect(usage.deployments[0]!.monthly[5]).toEqual({ month: "2026-09", assessments: 1, vitalIq: 1 });
    expect(usage.deployments[1]).toMatchObject({ deploymentId: second.id, assessments: 1, vitalIq: 0 });
    expect(usage.deployments[1]!.monthly.every(month => month.assessments === 0)).toBe(true);
    expect((await app.request("/admin/clients/invalid/usage", { headers: adminHeaders })).status).toBe(400);
    expect((await app.request(`/admin/clients/${otherDeployment.id}/usage`, { headers: adminHeaders })).status).toBe(404);
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

  test("revokes only the credential issued by a used token", async () => {
    const { app, store, client, deployment, credential } = await onboard();
    const base = `/admin/deployments/${deployment.id}/activation-tokens`;
    const listed = async () => (await (await app.request(base, { headers: adminHeaders })).json() as { tokens: Array<{ id: string; status: string; credentialStatus: "Active" | "Revoked" | "Expired" | null }> }).tokens;
    const first = (await listed()).find(token => token.status === "Used")!;
    expect(first.credentialStatus).toBe("Active");

    const next = await (await app.request(`/admin/deployments/${deployment.id}/activation-token`, jsonRequest({ expiresAt: null }))).json() as { activationToken: string };
    const secondCredential = (await (await app.request("/v1/activate", jsonRequest(next, ""))).json() as { credential: string }).credential;
    const second = (await listed()).find(token => token.id !== first.id)!;
    expect(second.credentialStatus).toBe("Active");

    const other = await store.createDeployment({ clientId: client.id, name: "Other", environment: "test" });
    const revoke = `${base}/${first.id}/credential`;
    expect((await app.request(revoke, { method: "DELETE", headers: { origin: adminHeaders.origin } })).status).toBe(401);
    expect((await app.request(`/admin/deployments/${other.id}/activation-tokens/${first.id}/credential`, { method: "DELETE", headers: adminHeaders })).status).toBe(404);
    expect((await app.request(revoke, { method: "DELETE", headers: adminHeaders })).status).toBe(200);
    expect((await app.request("/v1/metadata", { headers: { authorization: `Bearer ${credential}` } })).status).toBe(401);
    expect((await app.request("/v1/metadata", { headers: { authorization: `Bearer ${secondCredential}` } })).status).toBe(200);
    expect((await listed()).find(token => token.id === first.id)?.credentialStatus).toBe("Revoked");
    expect((await listed()).find(token => token.id === second.id)?.credentialStatus).toBe("Active");
    expect((await app.request(revoke, { method: "DELETE", headers: adminHeaders })).status).toBe(409);

    // Older used tokens cannot be reliably attributed to a credential.
    const secondLink = store.activations.find(token => token.id === second.id)!.credentialId;
    store.activations.find(token => token.id === second.id)!.credentialId = null;
    expect((await listed()).find(token => token.id === second.id)?.credentialStatus).toBeNull();
    expect((await app.request(`${base}/${second.id}/credential`, { method: "DELETE", headers: adminHeaders })).status).toBe(404);
    expect((await app.request("/v1/metadata", { headers: { authorization: `Bearer ${secondCredential}` } })).status).toBe(200);

    // A linked credential can expire independently of its spent activation token.
    store.activations.find(token => token.id === second.id)!.credentialId = secondLink;
    store.credentials.find(item => item.credentialId === secondLink)!.expiresAt = new Date(0);
    expect((await listed()).find(token => token.id === second.id)?.credentialStatus).toBe("Expired");
    expect((await app.request("/v1/metadata", { headers: { authorization: `Bearer ${secondCredential}` } })).status).toBe(401);
  });

  test("deployment limits are independent and issuing another credential does not reset usage", async () => {
    const { app, store, client, deployment, credential } = await onboard();
    await store.setEntitlement(deployment.id, { capability: "SCORING", enabled: true, monthlyLimit: 1 });
    const second = await store.createDeployment({ clientId: client.id, name: "Second", environment: "test" });
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

  test("disabling a client blocks scoring and face scans until enabled again", async () => {
    const { app, client, credential } = await onboard();
    const toggle = (enabled: boolean) => app.request(`/admin/clients/${client.id}/enabled`, { method: "PATCH", headers: adminHeaders, body: JSON.stringify({ enabled }) });
    expect((await toggle(false)).status).toBe(200);
    const blocked = await app.request("/v1/provisional/calculate", jsonRequest(scoringInput(client.id), `Bearer ${credential}`));
    expect(blocked.status).toBe(409);
    expect(await blocked.json()).toMatchObject({ reason: "CLIENT_DISABLED" });
    const face = await app.request("/v1/face-scans", jsonRequest({ clientId: client.id, assessmentReference: "test", idempotencyKey: "face-disabled" }, `Bearer ${credential}`));
    expect(face.status).toBe(503);
    expect(await face.json()).toMatchObject({ error: "FACE_SCAN_DISABLED" });
    expect((await toggle(true)).status).toBe(200);
    expect((await app.request("/v1/provisional/calculate", jsonRequest(scoringInput(client.id), `Bearer ${credential}`))).status).toBe(200);
  });

  test("creates and edits complete deployment settings without changing ownership or credentials", async () => {
    const { app, store, client, deployment, credential } = await onboard();
    const input = { clientId: client.id, environment: "production", hostingType: "CLIENT_CLOUD", enabled: true, scoring: { enabled: true, monthlyLimit: 5 }, faceScan: { enabled: false, monthlyLimit: null }, versionAssignment: { mode: "PINNED", scoringRuleVersionId: store.versions[0]!.id } };
    const update = (body: unknown) => app.request(`/admin/deployments/${deployment.id}/configuration`, { method: "PUT", headers: adminHeaders, body: JSON.stringify(body) });
    expect((await update(input)).status).toBe(200);
    expect(store.deployments.find(d => d.id === deployment.id)).toMatchObject({ name: "Apollo Production", hostingType: "CLIENT_CLOUD" });
    expect(store.entitlements.find(e => e.deploymentId === deployment.id && e.capability === "FACE_SCAN")).toMatchObject({ enabled: false, monthlyLimit: null });
    expect((await app.request("/v1/provisional/calculate", jsonRequest(scoringInput(client.id), `Bearer ${credential}`))).status).toBe(200);
    expect((await update({ ...input, scoring: { enabled: true, monthlyLimit: -1 } })).status).toBe(400);
    expect(store.entitlements.find(e => e.deploymentId === deployment.id && e.capability === "SCORING")?.monthlyLimit).toBe(5);
    const other = await store.createClient({ name: "Other client" });
    expect((await update({ ...input, clientId: other.id })).status).toBe(404);
    expect((await update({ ...input, name: "Final name" })).status).toBe(200);
    expect((await update({ ...input, environment: "staging" })).status).toBe(409);
    expect((await update({ ...input, hostingType: "NIQ_HOSTED" })).status).toBe(409);
    expect(store.deployments.find(d => d.id === deployment.id)).toMatchObject({ name: "Apollo Production", environment: "production", hostingType: "CLIENT_CLOUD" });
    expect(store.usages).toHaveLength(1);
    const created = await app.request("/admin/deployments/configuration", jsonRequest(input));
    expect(created.status).toBe(201);
    const saved = await created.json() as { id: string; name: string };
    expect(saved.name).toMatch(/^apollo-group-production-client-cloud-[a-f0-9]{8}$/);
    expect(saved).not.toHaveProperty("region");
    expect(store.entitlements.filter(e => e.deploymentId === saved.id)).toHaveLength(2);
    expect(store.assignments.find(a => a.deploymentId === saved.id)?.mode).toBe("PINNED");
    const again = await app.request("/admin/deployments/configuration", jsonRequest(input));
    expect(again.status).toBe(201);
    expect((await again.json() as { name: string }).name).not.toBe(saved.name);
  });

  test("recovers unused activation tokens and replaces them without disconnecting credentials", async () => {
    const { app, store, client, credential } = await onboard();
    const input = { clientId: client.id, environment: "staging", hostingType: "NIQ_HOSTED", enabled: true, scoring: { enabled: true, monthlyLimit: null }, faceScan: { enabled: true, monthlyLimit: null }, versionAssignment: { mode: "LATEST_APPROVED" } };
    const created = await app.request("/admin/deployments/configuration", jsonRequest(input));
    expect(created.status).toBe(201);
    expect(created.headers.get("cache-control")).toBe("no-store");
    const deployment = await created.json() as { id: string; activation: { activationToken: string; expiresAt: string } };
    const path = `/admin/deployments/${deployment.id}/activation-token`;
    const read = () => app.request(path, { headers: adminHeaders });
    const first = deployment.activation.activationToken;
    expect(first).toStartWith("niq_");
    expect(store.activations.find(t => t.deploymentId === deployment.id)?.tokenCiphertext).not.toContain(first);
    expect(await (await read()).json()).toEqual({ activation: deployment.activation });
    expect(JSON.stringify(await store.overview())).not.toContain(first);
    expect((await app.request(path)).status).toBe(401);
    const replacement = await app.request(path, jsonRequest({ expiresInMinutes: 30 }));
    const next = await replacement.json() as { activationToken: string };
    expect(next.activationToken).not.toBe(first);
    expect((await app.request("/v1/activate", jsonRequest({ activationToken: first }, ""))).status).toBe(401);
    const activated = await app.request("/v1/activate", jsonRequest(next, ""));
    expect(activated.status).toBe(201);
    const connected = await activated.json() as { credential: string };
    expect(await (await read()).json()).toEqual({ activation: null });
    expect(store.activations.find(t => t.deploymentId === deployment.id)?.tokenCiphertext).toBeNull();
    expect((await app.request("/v1/activate", jsonRequest(next, ""))).status).toBe(401);
    await app.request(path, jsonRequest({ expiresInMinutes: 30 }));
    const prefix = connected.credential.split(".")[0]!.replace("niq_dep_", "");
    expect(await store.authenticateDeployment(prefix, new Bun.CryptoHasher("sha256").update(connected.credential).digest("hex"))).not.toBeNull();
    const unused = store.activations.find(t => t.deploymentId === deployment.id && !t.usedAt && !t.revokedAt)!;
    unused.expiresAt = new Date("2020-01-01");
    expect(await (await read()).json()).toEqual({ activation: null });
    expect((await app.request("/v1/provisional/calculate", jsonRequest(scoringInput(client.id), `Bearer ${credential}`))).status).toBe(200);
  });

  test("supports expiry choices, token history and scoped revocation", async () => {
    const { app, store, deployment } = await onboard();
    const base = `/admin/deployments/${deployment.id}`;
    const generate = (body: unknown) => app.request(`${base}/activation-token`, jsonRequest(body));
    expect((await generate({ expiresAt: "2020-01-01T00:00:00.000Z" })).status).toBe(400);
    expect((await generate({ expiresAt: null, expiresInMinutes: 10 })).status).toBe(400);
    for (const days of [7, 30, 90, 180, 360]) {
      const result = await generate({ expiresInMinutes: days * 1440 });
      expect(result.status).toBe(201);
      expect((await result.json() as { expiresAt: string }).expiresAt).toBe(new Date(Date.parse("2026-09-13T00:00:00Z") + days * 86400000).toISOString());
    }
    const custom = await generate({ expiresAt: "2027-03-01T00:00:00.000Z" });
    expect((await custom.json() as { expiresAt: string }).expiresAt).toBe("2027-03-01T00:00:00.000Z");
    const never = await generate({ expiresAt: null });
    expect((await never.json() as { expiresAt: null }).expiresAt).toBeNull();
    const historyResponse = await app.request(`${base}/activation-tokens`, { headers: adminHeaders });
    expect(historyResponse.headers.get("cache-control")).toBe("no-store");
    const history = await historyResponse.json() as { tokens: Array<{ id: string; status: string; expiresAt: string | null }> };
    expect(history.tokens.filter(t => t.status === "Unused")).toHaveLength(1);
    expect(history.tokens.some(t => t.status === "Revoked")).toBe(true);
    expect(history.tokens.some(t => t.status === "Used")).toBe(true);
    expect(JSON.stringify(history)).not.toContain("niq_");
    const active = history.tokens.find(t => t.status === "Unused")!;
    const path = `${base}/activation-tokens/${active.id}`;
    expect((await app.request(path, { headers: adminHeaders })).status).toBe(200);
    const other = await store.createDeployment({ clientId: store.clients[0]!.id, environment: "test", name: "Other" });
    expect((await app.request(`/admin/deployments/${other.id}/activation-tokens/${active.id}`, { headers: adminHeaders })).status).toBe(404);
    expect((await app.request(path, { method: "DELETE", headers: adminHeaders })).status).toBe(200);
    expect((await app.request(path, { headers: adminHeaders })).status).toBe(404);
    expect((await app.request(path, { method: "DELETE", headers: adminHeaders })).status).toBe(409);
    expect((await app.request(`${base}/activation-tokens`)).status).toBe(401);
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

  test("disabled face scan routes never create stub sessions or reserve usage", async () => {
    const { app, client, credential, store } = await onboard();
    const response = await app.request("/v1/face-scans", jsonRequest({ clientId: client.id, assessmentReference: "assessment-1", idempotencyKey: "face-scan-0001" }, `Bearer ${credential}`));
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ error: "FACE_SCAN_DISABLED" });
    expect(store.faceScans).toHaveLength(0);
    expect(store.usages).toHaveLength(0);
  });

  test("production cannot enable provisional scoring", async () => {
    const production = createApp({ authStore: new MemoryAdminAuthStore(), store: new MemoryScoringStore(), allowedOrigins: [], region: "india", runtimeEnvironment: "production", provisionalScoringRequested: true });
    expect((await production.request("/v1/provisional/calculate", { method: "POST" })).status).toBe(503);
  });

  test("CarePlix placeholder fails closed without creating a scan", async () => {
    const setupResult = await onboard();
    const app = createApp({ authStore: new MemoryAdminAuthStore(), store: setupResult.store, adminBootstrapToken: adminToken, allowedOrigins: [], region: "india", runtimeEnvironment: "test", provisionalScoringRequested: true, faceScanAdapter: new UnconfiguredCarePlixAdapter() });
    const response = await app.request("/v1/face-scans", jsonRequest({ clientId: setupResult.client.id, assessmentReference: "assessment-careplix", idempotencyKey: "face-scan-careplix" }, `Bearer ${setupResult.credential}`));
    expect(response.status).toBe(503);
    expect(setupResult.store.faceScans).toHaveLength(0);
    expect(setupResult.store.usages).toHaveLength(0);
  });
});

test("client names are unique across case, surrounding spaces, disabled clients and concurrent requests", async () => {
  const { app, store } = setup();
  const responses = await Promise.all(["Apollo", " apollo "].map(name => app.request("/admin/clients", jsonRequest({ name }))));
  expect(responses.map(response => response.status).sort()).toEqual([201, 409]);
  await store.setClientEnabled(store.clients[0]!.id, false);
  const duplicate = await app.request("/admin/clients", jsonRequest({ name: "APOLLO" }));
  expect(duplicate.status).toBe(409);
  expect(await duplicate.json()).toEqual({ error: "CLIENT_NAME_EXISTS" });
  expect((await app.request("/admin/clients", jsonRequest({ name: "Apollo Health" }))).status).toBe(201);
});
