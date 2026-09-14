import { describe, expect, test } from "bun:test";
import { Hono } from "hono";
import { MemoryScoringStore } from "./store";
import { installRecordDeletion, memoryDeletion } from "./record-deletion";

async function fixture() {
  const store = new MemoryScoringStore();
  const client = await store.createClient({ name: "Unused client" });
  const deployment = await store.createDeployment({ clientId: client.id, name: "unused", environment: "test" });
  await store.setEntitlement(deployment.id, { capability: "SCORING", enabled: true, monthlyLimit: null });
  await store.assignVersion(deployment.id, { mode: "LATEST_APPROVED" });
  return { store, client, deployment };
}
describe("unused record deletion", () => {
  test("client requires child deployments to be removed first; config is cleaned up", async () => {
    const { store, client, deployment } = await fixture();
    expect(memoryDeletion(store, "clients", client.id, true).allowed).toBe(false);
    expect(memoryDeletion(store, "deployments", deployment.id, true).allowed).toBe(true);
    expect(store.entitlements).toHaveLength(0);
    expect(store.assignments).toHaveLength(0);
    expect(memoryDeletion(store, "clients", client.id, true).allowed).toBe(true);
    expect(memoryDeletion(store, "clients", client.id).missing).toBe(true);
  });
  test("credentials permanently prevent deletion", async () => {
    const { store, deployment, client } = await fixture();
    store.credentials.push({ deploymentId: deployment.id, clientId: client.id, credentialId: "credential", keyPrefix: "prefix", secretHash: "hash" });
    expect(memoryDeletion(store, "deployments", deployment.id, true).allowed).toBe(false);
    expect(store.deployments).toHaveLength(1);
  });
  test("used tokens preserve history and unused tokens are removed", async () => {
    const { store, deployment } = await fixture();
    await store.storeActivationToken({ id: "token", deploymentId: deployment.id, tokenHash: "hash", tokenCiphertext: "encrypted", expiresAt: null });
    store.activations[0]!.usedAt = new Date();
    expect(memoryDeletion(store, "deployments", deployment.id, true).allowed).toBe(false);
    store.activations[0]!.usedAt = null;
    expect(memoryDeletion(store, "deployments", deployment.id, true).allowed).toBe(true);
    expect(store.activations).toHaveLength(0);
  });
  test("even failed usage prevents deletion", async () => {
    const { store, deployment, client } = await fixture();
    store.usages.push({ occurredAt: new Date(), id: "usage", deploymentId: deployment.id, clientId: client.id, capability: "SCORING", idempotencyKey: "key", outcome: "FAILED" });
    expect(memoryDeletion(store, "deployments", deployment.id, true).allowed).toBe(false);
  });
  test("routes recheck eligibility after a previous successful read", async () => {
    const { store, deployment, client } = await fixture();
    const app = new Hono();
    installRecordDeletion(app, {
      deletionStatus: async (kind, id) => memoryDeletion(store, kind, id),
      deleteUnused: async (kind, id) => memoryDeletion(store, kind, id, true),
    });
    expect((await app.request(`/admin/deployments/${deployment.id}/deletion`)).status).toBe(200);
    store.credentials.push({ deploymentId: deployment.id, clientId: client.id, credentialId: "credential", keyPrefix: "prefix", secretHash: "hash" });
    expect((await app.request(`/admin/deployments/${deployment.id}`, { method: "DELETE" })).status).toBe(409);
    expect((await app.request("/admin/clients/bad", { method: "DELETE" })).status).toBe(400);
  });
});
