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

test.skipIf(process.env.RULE_DATABASE_TEST !== "1")("PostgreSQL lifecycle immutability and latest-approved bindings", async () => {
  const db = postgres(process.env.DATABASE_URL!, { max: 1 });
  const rollback = new Error("rollback lifecycle fixture");
  try {
    await db.begin(async tx => {
      const scoped = new Proxy(tx, { get(target, key) { return key === "begin" ? (fn: (sql: typeof tx) => Promise<unknown>) => tx.savepoint(fn) : Reflect.get(target, key); } }) as unknown as ReturnType<typeof postgres>;
      const store = new PostgresScoringStore(scoped);
      const [latest] = await tx`select max(approved_at) as date from scoring_rule_versions`;
      const base = Math.max(Date.now(), latest?.date ? new Date(latest.date).getTime() : 0) + 1000;
      const now = new Date(base).toISOString();
      // Store-level fixtures intentionally bypass clinical route validation. All
      // records and approvals disappear in the enclosing rollback transaction.
      const create = async () => {
        const id = createEntityId(); const definition = blankRuleDefinition(`Synthetic lifecycle ${id}`);
        return store.rules.create({ id, definition, checksum: ruleChecksum(definition), actor: "synthetic", requestId: crypto.randomUUID(), fingerprint: ruleChecksum(definition), now });
      };
      let first = await create();
      first = await store.rules.transition({ id: first.id, revision: first.revision, action: "validate", actor: "synthetic", now });
      expect(first.validatedRevision).toBe(first.revision);
      const changed = { ...first.definition as ReturnType<typeof blankRuleDefinition>, description: "Changed after validation" };
      first = await store.rules.save({ id: first.id, revision: first.revision, definition: changed, checksum: ruleChecksum(changed), actor: "synthetic", now });
      expect(first.lifecycle).toBe("DRAFT"); expect(first.validatedRevision).toBeNull();
      await expect(store.rules.transition({ id: first.id, revision: first.revision, action: "approve", actor: "synthetic", now })).rejects.toThrow();
      first = await store.rules.transition({ id: first.id, revision: first.revision, action: "validate", actor: "synthetic", now });
      first = await store.rules.transition({ id: first.id, revision: first.revision, action: "approve", actor: "synthetic", now });
      first = await store.rules.transition({ id: first.id, revision: first.revision, action: "activate", actor: "synthetic", now });
      expect(first.lifecycle).toBe("ACTIVE"); expect(first.clinicalUsePermitted).toBe(true);
      await expect(store.rules.save({ id: first.id, revision: first.revision, definition: changed, checksum: ruleChecksum(changed), actor: "synthetic", now })).rejects.toThrow("RULE_IMMUTABLE");
      await expect(store.rules.delete(first.id, first.revision, "synthetic", now)).rejects.toThrow("RULE_IMMUTABLE");
      await expect(tx.savepoint(async sp => { await sp`update scoring_rule_versions set definition='{}'::jsonb where id=${first.id}`; })).rejects.toThrow("immutable");
      await expect(tx.savepoint(async sp => { await sp`delete from scoring_rule_versions where id=${first.id}`; })).rejects.toThrow("cannot be deleted");
      const client = await store.createClient({ name: `Synthetic latest ${createEntityId()}` });
      const dep = await store.createDeployment({ clientId: client.id, name: "Synthetic latest", environment: "test" });
      await store.setEntitlement(dep.id, { capability: "SCORING", enabled: true, monthlyLimit: null });
      await store.assignVersion(dep.id, { mode: "LATEST_APPROVED" });
      const input = { identity: { clientId: client.id, deploymentId: dep.id, credentialId: "synthetic" }, assessmentReference: "first", platformEnabled: true, create: true };
      expect((await store.bindAssessment(input)).binding.ruleVersionId).toBe(first.id);
      let second = await create();
      second = await store.rules.transition({ id: second.id, revision: second.revision, action: "validate", actor: "synthetic", now });
      second = await store.rules.transition({ id: second.id, revision: second.revision, action: "approve", actor: "synthetic", now: new Date(base + 1000).toISOString() });
      expect((await store.bindAssessment({ ...input, assessmentReference: "second" })).binding.ruleVersionId).toBe(second.id);
      expect((await store.bindAssessment(input)).binding.ruleVersionId).toBe(first.id);
      await store.rules.transition({ id: second.id, revision: second.revision, action: "retire", actor: "synthetic", now });
      expect((await store.bindAssessment({ ...input, assessmentReference: "third" })).binding.ruleVersionId).toBe(first.id);
      expect((await store.bindAssessment({ ...input, assessmentReference: "second", create: false })).rule.lifecycle).toBe("RETIRED");
      expect((await store.rules.audit(first.id)).map(event => event.action)).toContain("RULE_ACTIVE");
      throw rollback;
    });
  } catch (error) { if (error !== rollback) throw error; }
  finally { await db.end(); }
});
