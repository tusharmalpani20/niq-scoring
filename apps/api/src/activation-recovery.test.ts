import { expect, test } from "bun:test";
import { createApp } from "./app";
import { MemoryAdminAuthStore } from "./admin-auth-store";
import { MemoryScoringStore } from "./store";
import { createEntityId } from "./lib/id";

// A disconnected client must recover the original exchange, without opening a second credential.
test("activation request replay returns the original credential and respects revocation and expiry", async () => {
  const store = new MemoryScoringStore();
  const client = await store.createClient({ name: "Synthetic BYOC" });
  const deployment = await store.createDeployment({ clientId: client.id, name: "BYOC", environment: "test" });
  const token = "a".repeat(64);
  const tokenId = createEntityId();
  let now = new Date("2026-10-27T00:00:00Z");
  await store.storeActivationToken({ id: tokenId, deploymentId: deployment.id, tokenHash: new Bun.CryptoHasher("sha256").update(token).digest("hex"), tokenCiphertext: "unused", expiresAt: new Date(now.getTime() + 60 * 60_000) });
  const app = createApp({ store, authStore: new MemoryAdminAuthStore(), activationTokenEncryptionKey: "ab".repeat(32), allowedOrigins: [], region: "india", runtimeEnvironment: "test", provisionalScoringRequested: false, now: () => now });
  const request = (activationRequestId = "bc980d58-49cc-47c8-94bc-4a0ece2ec638") => app.request("/v1/activate", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ activationToken: token, activationRequestId }) });
  const first = await request();
  expect(first.status).toBe(201);
  const issued = await first.json();
  const replay = await request();
  expect(replay.status).toBe(201);
  expect(await replay.json()).toEqual(issued);
  expect(store.credentials).toHaveLength(1);
  const rotated = createApp({ store, authStore: new MemoryAdminAuthStore(), activationTokenEncryptionKey: "cd".repeat(32), allowedOrigins: [], region: "india", runtimeEnvironment: "test", provisionalScoringRequested: false, now: () => now });
  expect((await rotated.request("/v1/activate", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ activationToken: token, activationRequestId: "bc980d58-49cc-47c8-94bc-4a0ece2ec638" }) })).status).toBe(401);
  expect((await request("5c9ed8ef-c0cd-4978-a5bd-7ac492d09cef")).status).toBe(401);
  now = new Date(now.getTime() + 15 * 60_000);
  expect((await request()).status).toBe(401);
  now = new Date("2026-10-27T00:01:00Z");
  await store.revokeTokenCredential(deployment.id, tokenId, now);
  expect((await request()).status).toBe(401);
});
