import { expect, test } from "bun:test";
import postgres from "postgres";
import { createApp } from "./app";
import { MemoryAdminAuthStore } from "./admin-auth-store";
import { createEntityId } from "./lib/id";
import { PostgresScoringStore } from "./postgres-store";

test.skipIf(process.env.RULE_DATABASE_TEST !== "1")("PostgreSQL concurrent activation exchanges issue one credential and replay only its matching request", async () => {
  const db = postgres(process.env.DATABASE_URL!, { max: 4 });
  const store = new PostgresScoringStore(db);
  const client = await store.createClient({ name: `Synthetic activation ${createEntityId()}` });
  let deploymentId = "";
  try {
    const deployment = await store.createDeployment({ clientId: client.id, name: "BYOC", environment: "test" });
    deploymentId = deployment.id;
    const activationToken = "t".repeat(64);
    const tokenId = createEntityId();
    const start = new Date();
    let clock = start;
    await store.storeActivationToken({ id: tokenId, deploymentId, tokenHash: new Bun.CryptoHasher("sha256").update(activationToken).digest("hex"), tokenCiphertext: "unused", expiresAt: new Date(start.getTime() + 30 * 60_000) });
    const app = createApp({ store, authStore: new MemoryAdminAuthStore(), activationTokenEncryptionKey: "ab".repeat(32), allowedOrigins: [], region: "india", runtimeEnvironment: "test", provisionalScoringRequested: false, now: () => clock });
    const appReference = createEntityId();
    const request = (activationRequestId = "85f55824-af44-407c-a0a2-9712f9474dab", clientReference = appReference) => app.request("/v1/activate", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ activationToken, activationRequestId, clientReference }) });
    const responses = await Promise.all([request(), request()]);
    expect(responses.map(r => r.status)).toEqual([201, 201]);
    expect(await responses[0]!.json()).toEqual(await responses[1]!.json());
    const [count] = await db`select count(*)::int as value from deployment_credentials where deployment_id=${deploymentId}`;
    expect(count!.value).toBe(1);
    expect((await request("20b882cd-2c88-4fb4-9a05-d8f6930fc8a9")).status).toBe(401);
    expect((await request(undefined, createEntityId())).status).toBe(401);
    expect((await request()).status).toBe(201);
    clock = new Date(start.getTime() + 15 * 60_000);
    expect((await request()).status).toBe(401);
    clock = new Date(start.getTime() + 60_000);
    await db`update activation_tokens set expires_at=${clock} where id=${tokenId}`;
    expect((await request()).status).toBe(401);
    await db`update activation_tokens set expires_at=null where id=${tokenId}`;
    await store.revokeTokenCredential(deploymentId, tokenId, clock);
    expect((await request()).status).toBe(401);
  } finally {
    await db`delete from activation_tokens where deployment_id=${deploymentId}`;
    await db`delete from deployment_credentials where deployment_id=${deploymentId}`;
    await db`delete from deployments where id=${deploymentId}`;
    await db`delete from clients where id=${client.id}`;
    await db.end();
  }
});
