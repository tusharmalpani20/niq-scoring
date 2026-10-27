import { expect, test } from "bun:test";
import postgres from "postgres";
import { PostgresScoringStore } from "./postgres-store";
import { createEntityId } from "./lib/id";

// Run only against an explicitly supplied disposable database; fixtures roll back.
test.skipIf(process.env.RULE_DATABASE_TEST !== "1")("PostgreSQL reclaims expired scoring ownership once and fences stale completion", async () => {
  const db = postgres(process.env.DATABASE_URL!, { max: 1 });
  const rollback = new Error("rollback recovery fixture");
  try {
    await db.begin(async tx => {
      const scoped = new Proxy(tx, { get(target, key) { return key === "begin" ? (fn: (sql: typeof tx) => Promise<unknown>) => tx.savepoint(fn) : Reflect.get(target, key); } }) as unknown as ReturnType<typeof postgres>;
      const store = new PostgresScoringStore(scoped);
      const client = await store.createClient({ name: `Synthetic recovery ${createEntityId()}` });
      const deployment = await store.createDeployment({ clientId: client.id, name: "Recovery", environment: "test" });
      const credentialId = createEntityId();
      await tx`insert into deployment_credentials (id,deployment_id,key_prefix,secret_hash,hash_algorithm) values (${credentialId},${deployment.id},${createEntityId().slice(0, 20)},${"b".repeat(64)},'sha256')`;
      await store.setEntitlement(deployment.id, { capability: "SCORING", enabled: true, monthlyLimit: 1 });
      const usageId = createEntityId();
      await tx`insert into usage_events (id,client_id,deployment_id,credential_id,capability,request_id,idempotency_key,assessment_reference,request_fingerprint,outcome,occurred_at) values (${usageId},${client.id},${deployment.id},${credentialId},'SCORING','recovery-request','recovery-request','synthetic',${"a".repeat(64)},'PENDING',now()-interval '10 minutes')`;
      // Pin the provisional version directly, as existing legacy deployments do.
      const ruleId = createEntityId();
      await tx`insert into scoring_rule_versions (id,version,package_checksum,definition,lifecycle) values (${ruleId},'NIQ-DRAFT-2026-09',${"a".repeat(64)},'{}','APPROVED')`;
      await tx`insert into deployment_version_assignments (id,deployment_id,mode,scoring_rule_version_id) values (${createEntityId()},${deployment.id},'PINNED',${ruleId})`;
      const input = { identity: { clientId: client.id, deploymentId: deployment.id, credentialId }, clientId: client.id, capability: "SCORING" as const, idempotencyKey: "recovery-request", assessmentReference: "synthetic", fingerprint: "a".repeat(64), platformEnabled: true };
      const reclaimed = await store.reserveUsage(input);
      expect(reclaimed.status).toBe("NEW");
      if (reclaimed.status !== "NEW") throw new Error("No recovery reservation");
      expect(reclaimed.usageId).toBe(usageId);
      expect(await store.reserveUsage(input)).toMatchObject({ status: "REJECTED", reason: "REQUEST_IN_PROGRESS" });
      expect(await store.reserveUsage({ ...input, fingerprint: "b".repeat(64) })).toMatchObject({ status: "REJECTED", reason: "IDEMPOTENCY_CONFLICT" });
      await expect(store.completeUsage(usageId, { obsolete: true })).rejects.toThrow("SCORING_LEASE_LOST");
      await store.failUsage(usageId); // A pre-migration worker without a fence cannot fail the new owner.
      await store.completeUsage(usageId, { current: true }, reclaimed.leaseToken);
      expect(await store.reserveUsage(input)).toMatchObject({ status: "DUPLICATE", response: { current: true } });
      throw rollback;
    });
  } catch (error) { if (error !== rollback) throw error; }
  finally { await db.end(); }
});

test.skipIf(process.env.RULE_DATABASE_TEST !== "1")("PostgreSQL simultaneous crash recovery grants one owner and preserves face-scan reservations", async () => {
  const db = postgres(process.env.DATABASE_URL!, { max: 4 });
  const store = new PostgresScoringStore(db);
  const client = await store.createClient({ name: `Synthetic race ${createEntityId()}` });
  let deploymentId = "";
  let ruleId = "";
  try {
    const deployment = await store.createDeployment({ clientId: client.id, name: "Race", environment: "test" });
    deploymentId = deployment.id;
    const credentialId = createEntityId();
    await db`insert into deployment_credentials (id,deployment_id,key_prefix,secret_hash,hash_algorithm) values (${credentialId},${deploymentId},${createEntityId().slice(0, 20)},${"b".repeat(64)},'sha256')`;
    ruleId = createEntityId();
    await db`insert into scoring_rule_versions (id,version,package_checksum,definition,lifecycle) values (${ruleId},'NIQ-DRAFT-2026-09',${"a".repeat(64)},'{}','DRAFT')`;
    await db`insert into deployment_version_assignments (id,deployment_id,mode,scoring_rule_version_id) values (${createEntityId()},${deploymentId},'PINNED',${ruleId})`;
    await store.setEntitlement(deploymentId, { capability: "SCORING", enabled: true, monthlyLimit: 1 });
    await store.setEntitlement(deploymentId, { capability: "FACE_SCAN", enabled: true, monthlyLimit: 1 });
    const input = { identity: { clientId: client.id, deploymentId, credentialId }, clientId: client.id, capability: "SCORING" as const, idempotencyKey: "simultaneous-request", assessmentReference: "synthetic", fingerprint: "a".repeat(64), platformEnabled: true };
    const first = await store.reserveUsage(input);
    expect(first.status).toBe("NEW");
    if (first.status !== "NEW") throw new Error("Missing first owner");
    await db`update usage_events set lease_expires_at=now()-interval '1 second' where id=${first.usageId}`;
    await store.setClientEnabled(client.id, false);
    expect(await store.reserveUsage(input)).toMatchObject({ status: "REJECTED", reason: "CLIENT_DISABLED" });
    await store.setClientEnabled(client.id, true);
    const race = await Promise.all([store.reserveUsage(input), store.reserveUsage(input)]);
    expect(race.filter(item => item.status === "NEW")).toHaveLength(1);
    expect(race.filter(item => item.status === "REJECTED")).toHaveLength(1);
    const winner = race.find(item => item.status === "NEW")!;
    if (winner.status !== "NEW") throw new Error("Missing winner");
    expect(winner.leaseToken).not.toBe(first.leaseToken);
    await expect(store.completeUsage(first.usageId, { old: true }, first.leaseToken)).rejects.toThrow("SCORING_LEASE_LOST");
    await store.failUsage(first.usageId, first.leaseToken);
    await store.storePendingUsageResponse(first.usageId, { old: true });
    const [row] = await db`select outcome,response_payload from usage_events where id=${first.usageId}`;
    expect(row).toMatchObject({ outcome: "PENDING", response_payload: null });
    await store.completeUsage(winner.usageId, { current: true }, winner.leaseToken);
    expect(await store.reserveUsage({ ...input, idempotencyKey: "another-request" })).toMatchObject({ status: "REJECTED", reason: "MONTHLY_LIMIT_REACHED" });
    const face = await store.reserveUsage({ ...input, capability: "FACE_SCAN", idempotencyKey: "face-request" });
    if (face.status !== "NEW") throw new Error("Missing face reservation");
    await db`update usage_events set occurred_at=now()-interval '1 day' where id=${face.usageId}`;
    expect(await store.reserveUsage({ ...input, capability: "FACE_SCAN", idempotencyKey: "face-request" })).toMatchObject({ status: "REJECTED", reason: "REQUEST_IN_PROGRESS" });
  } finally {
    await db`delete from usage_events where deployment_id=${deploymentId}`;
    await db`delete from deployment_version_assignments where deployment_id=${deploymentId}`;
    await db`delete from entitlements where deployment_id=${deploymentId}`;
    await db`delete from deployment_credentials where deployment_id=${deploymentId}`;
    await db`delete from deployments where id=${deploymentId}`;
    await db`delete from scoring_rule_versions where id=${ruleId}`;
    await db`delete from clients where id=${client.id}`;
    await db.end();
  }
});
