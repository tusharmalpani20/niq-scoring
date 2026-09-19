import { expect, test } from "bun:test";
import { organizationInfoSchema, organizationInfoErrorSchema } from "@niq-scoring/contracts";
import { createApp } from "./app";
import { MemoryAdminAuthStore } from "./admin-auth-store";
import { MemoryScoringStore } from "./store";
import { createEntityId } from "./lib/id";

const path = "/v1/integrations/organization-info";
const now = new Date("2026-09-14T00:00:00Z");
async function setup() {
  const store = new MemoryScoringStore();
  const app = createApp({ store, authStore: new MemoryAdminAuthStore(), allowedOrigins: [], region: "india", runtimeEnvironment: "test", provisionalScoringRequested: false, now: () => now });
  async function onboard(name: string) {
    const client = await store.createClient({ name });
    const deployment = await store.createDeployment({ name: `${name}-production`, clientId: client.id, environment: "production" });
    store.deployments.find(d => d.id === deployment.id)!.hostingType = "NIQ_HOSTED";
    await store.setEntitlement(deployment.id, { capability: "SCORING", enabled: true, monthlyLimit: 10000 });
    await store.setEntitlement(deployment.id, { capability: "FACE_SCAN", enabled: false, monthlyLimit: null });
    const activationToken = `niq_${crypto.randomUUID()}${crypto.randomUUID()}`;
    await store.storeActivationToken({ id: createEntityId(), deploymentId: deployment.id, tokenHash: new Bun.CryptoHasher("sha256").update(activationToken).digest("hex"), tokenCiphertext: "synthetic-encrypted-token", expiresAt: null });
    const activation = await app.request("/v1/activate", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ activationToken }) });
    expect(activation.status).toBe(201);
    const { credential } = await activation.json() as { credential: string };
    return { client, deployment, credential, activationToken, get: (query = "") => app.request(path + query, { headers: { authorization: `Bearer ${credential}` } }) };
  }
  return { store, app, onboard };
}

test("activation-issued credentials return only their own configuration; caller cannot select a tenant", async () => {
  const { onboard } = await setup();
  const a = await onboard("A"), b = await onboard("B");
  for (const own of [a, b]) {
    const response = await own.get();
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    const body = organizationInfoSchema.parse(await response.json());
    expect(body.organization.id).toBe(own.client.id);
    expect(body.deployment.id).toBe(own.deployment.id);
    expect(body.services.faceScan.enabled).toBe(false);
    expect(body.limits).toEqual({ scoresPerMonth: 10000, faceScansPerMonth: null });
    expect(body.unavailableFields).toEqual(["limits.users"]);
  }
  expect((await a.get(`?organizationId=${b.client.id}`)).status).toBe(400);
  expect((await a.get(`?deploymentId=${b.deployment.id}`)).status).toBe(400);
});

test("invalid, missing, malformed, expired and revoked credentials are rejected", async () => {
  const { app, store, onboard } = await setup();
  const a = await onboard("A");
  for (const authorization of ["", a.credential, "Bearer invalid", `Bearer ${a.credential}wrong`]) {
    const response = await app.request(path, { headers: { authorization } });
    expect(response.status).toBe(401);
    expect(organizationInfoErrorSchema.parse(await response.json())).toEqual({ error: "UNAUTHORIZED" });
  }
  store.credentials[0]!.expiresAt = now;
  expect((await a.get()).status).toBe(401);
  store.credentials[0]!.expiresAt = new Date("2099-01-01");
  expect((await a.get()).status).toBe(200);
  store.credentials[0]!.revokedAt = now;
  expect((await a.get()).status).toBe(401);
});

test("disabled client and deployment deny access; incomplete configuration fails closed", async () => {
  const { store, onboard } = await setup();
  const a = await onboard("A");
  for (const scope of ["client", "deployment"] as const) {
    if (scope === "client") await store.setClientEnabled(a.client.id, false);
    else await store.setDeploymentEnabled(a.deployment.id, false);
    const response = await a.get();
    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({ error: scope === "client" ? "CLIENT_DISABLED" : "DEPLOYMENT_DISABLED" });
    await store.setClientEnabled(a.client.id, true);
    await store.setDeploymentEnabled(a.deployment.id, true);
  }
  store.deployments[0]!.hostingType = null;
  expect((await a.get()).status).toBe(409);
  store.deployments[0]!.hostingType = "NIQ_HOSTED";
  store.entitlements = [];
  const response = await a.get();
  expect(response.status).toBe(409);
  expect(await response.json()).toEqual({ error: "CONFIGURATION_INCOMPLETE" });
});

test("usage counts current UTC month reservations and successes only within authenticated deployment", async () => {
  const { store, onboard } = await setup();
  const a = await onboard("A"), b = await onboard("B");
  for (const own of [a, b]) for (const date of ["2026-08-31T23:59:59Z", "2026-09-01T00:00:00Z", "2026-10-01T00:00:00Z"]) for (const outcome of ["PENDING", "SUCCEEDED", "FAILED"] as const) {
    store.usages.push({ id: createEntityId(), clientId: own.client.id, deploymentId: own.deployment.id, capability: "SCORING", idempotencyKey: createEntityId(), outcome, occurredAt: new Date(date) });
  }
  expect((await (await a.get()).json()).usage).toEqual({ period: "2026-09", scores: 2, faceScans: 0 });
  expect(store.integrationAuditEvents).toHaveLength(1);
  expect(store.integrationAuditEvents[0]!.resourceReference).toBe(a.deployment.id);
});

test("strict response contract supports finite, zero and unlimited limits and contains no secrets", async () => {
  const { store, onboard } = await setup();
  const a = await onboard("A");
  for (const limit of [0, 10000, null]) {
    await store.setEntitlement(a.deployment.id, { capability: "SCORING", enabled: true, monthlyLimit: limit });
    const body = await (await a.get()).json();
    expect(organizationInfoSchema.parse(body).limits.scoresPerMonth).toBe(limit);
    for (const bad of [-1, 0.5, Infinity, undefined]) expect(organizationInfoSchema.safeParse({ ...body, limits: { ...body.limits, scoresPerMonth: bad } }).success).toBe(false);
    expect(organizationInfoSchema.safeParse({ ...body, credential: a.credential }).success).toBe(false);
    const serialized = JSON.stringify(body);
    for (const secret of [a.credential, a.activationToken, store.credentials[0]!.secretHash, "synthetic-encrypted-token"]) expect(serialized).not.toContain(secret);
    for (const key of ["credential", "secretHash", "activationToken", "tokenCiphertext", "keyPrefix"]) expect(serialized).not.toContain(`"${key}"`);
  }
});

test("reports the authoritative default and preserves specific assignments when it changes", async () => {
  const { store, onboard } = await setup();
  const own = await onboard("Default follower");
  const first = createEntityId(), second = createEntityId();
  const record = { lifecycle: "ACTIVE" as const, clinicalUsePermitted: true, definition: {}, packageChecksum: "test", revision: 1, validatedRevision: 1, createdAt: now.toISOString(), updatedAt: now.toISOString(), createdBy: null, approvedAt: now.toISOString() };
  store.rules.records.push({ ...record, id: first, version: "V1" }, { ...record, id: second, version: "V2" });
  store.assignments.push({ deploymentId: own.deployment.id, mode: "LATEST_APPROVED" });
  store.rules.defaultRuleId = first;
  expect((await (await own.get()).json()).ruleVersion).toEqual({ mode: "DEFAULT", version: "V1" });
  store.rules.defaultRuleId = second;
  expect((await (await own.get()).json()).ruleVersion).toEqual({ mode: "DEFAULT", version: "V2" });
  store.assignments = [{ deploymentId: own.deployment.id, mode: "PINNED", scoringRuleVersionId: first }];
  expect((await (await own.get()).json()).ruleVersion).toEqual({ mode: "SPECIFIC", version: "V1" });
  store.assignments = [];
  expect((await (await own.get()).json()).ruleVersion).toBeNull();
});
