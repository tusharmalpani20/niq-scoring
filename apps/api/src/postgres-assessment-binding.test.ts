import { expect, test } from "bun:test";
import postgres from "postgres";
import { blankRuleDefinition } from "@niq-scoring/contracts/rules";
import { PostgresScoringStore } from "./postgres-store";
import { createEntityId } from "./lib/id";
import { ruleChecksum } from "./rule-routes";
test.skipIf(process.env.RULE_DATABASE_TEST !== "1")("PostgreSQL assessment binding retains version and enforces quota and replay fingerprint", async () => {
  const db = postgres(process.env.DATABASE_URL!, { max: 1 });
  const rollback = new Error("rollback synthetic fixture");
  try {
    await db.begin(async tx => {
      // Run each store transaction as a savepoint, then roll back the entire synthetic scenario.
      const scoped = new Proxy(tx, { get(target, key) { return key === "begin" ? (fn: (sql: typeof tx) => Promise<unknown>) => tx.savepoint(fn) : Reflect.get(target, key); } }) as unknown as ReturnType<typeof postgres>;
      const store = new PostgresScoringStore(scoped);
      const client = await store.createClient({ name: `Synthetic binding ${createEntityId()}` });
      const dep = await store.createDeployment({ clientId: client.id, name: "Synthetic binding", environment: "test" });
      const credentialId = createEntityId();
      await tx`insert into deployment_credentials (id,deployment_id,key_prefix,secret_hash,hash_algorithm) values (${credentialId},${dep.id},${createEntityId().slice(0,20)},${"a".repeat(64)},'sha256')`;
      const definition = blankRuleDefinition("Synthetic database fixture");
      const rule = await store.rules.create({ id: createEntityId(), definition, checksum: ruleChecksum(definition), actor: "synthetic", requestId: crypto.randomUUID(), fingerprint: ruleChecksum(definition), now: new Date().toISOString() });
      await expect(store.assignVersion(dep.id, { mode: "PINNED", scoringRuleVersionId: rule.id })).rejects.toThrow("VERSION_UNAVAILABLE");
      await store.rules.transition({ id: rule.id, revision: 1, action: "validate", actor: "synthetic", now: new Date().toISOString() });
      await store.rules.transition({ id: rule.id, revision: 2, action: "approve", actor: "synthetic", now: new Date().toISOString() });
      await store.assignVersion(dep.id, { mode: "PINNED", scoringRuleVersionId: rule.id });
      await store.setEntitlement(dep.id, { capability: "SCORING", enabled: true, monthlyLimit: 1 });
      const identity = { clientId: client.id, deploymentId: dep.id, credentialId };
      const input = { identity, assessmentReference: "synthetic-assessment", platformEnabled: true, create: true };
      const first = await store.bindAssessment(input);
      expect(first.binding.ruleVersionId).toBe(rule.id);
      expect((await store.bindAssessment(input)).binding.id).toBe(first.binding.id);
      await store.rules.transition({ id: rule.id, revision: 3, action: "retire", actor: "synthetic", now: new Date().toISOString() });
      expect((await store.bindAssessment({ ...input, create: false })).rule.lifecycle).toBe("RETIRED");
      await expect(store.bindAssessment({ ...input, assessmentReference: "new-assessment" })).rejects.toThrow("VERSION_UNAVAILABLE");
      const usage = { identity, clientId: client.id, capability: "SCORING" as const, idempotencyKey: "synthetic-request", assessmentReference: input.assessmentReference, platformEnabled: true, fingerprint: "a".repeat(64), binding: first.binding };
      const reservation = await store.reserveUsage(usage);
      expect(reservation.status).toBe("NEW");
      if (reservation.status !== "NEW") throw new Error("Missing reservation");
      await store.completeUsage(reservation.usageId, { synthetic: true });
      expect((await store.reserveUsage(usage)).status).toBe("DUPLICATE");
      expect(await store.reserveUsage({ ...usage, fingerprint: "b".repeat(64) })).toMatchObject({ status: "REJECTED", reason: "IDEMPOTENCY_CONFLICT" });
      expect(await store.reserveUsage({ ...usage, idempotencyKey: "another-request" })).toMatchObject({ status: "REJECTED", reason: "MONTHLY_LIMIT_REACHED" });
      const [event] = await tx`select scoring_rule_version_id from usage_events where id=${reservation.usageId}`;
      expect(event?.scoring_rule_version_id).toBe(rule.id);
      await store.setClientEnabled(client.id, false);
      await expect(store.bindAssessment(input)).rejects.toThrow("CLIENT_DISABLED");
      expect(await store.reserveUsage(usage)).toMatchObject({ status: "REJECTED", reason: "CLIENT_DISABLED" });
      throw rollback;
    });
  } catch (error) { if (error !== rollback) throw error; }
  finally { await db.end(); }
});
