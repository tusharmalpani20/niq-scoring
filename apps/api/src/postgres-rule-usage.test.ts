import { expect, test } from "bun:test";
import postgres from "postgres";
import { PostgresScoringStore } from "./postgres-store";
import { createEntityId } from "./lib/id";

test.skipIf(process.env.RULE_DATABASE_TEST !== "1")("PostgreSQL rule usage groups actual successful scoring versions and scopes by client", async () => {
  const db = postgres(process.env.DATABASE_URL!, { max: 1 });
  const rollback = new Error("rollback rule usage fixture");
  try {
    await db.begin(async tx => {
      const scoped = new Proxy(tx, { get(target, key) { return key === "begin" ? (fn: (sql: typeof tx) => Promise<unknown>) => tx.savepoint(fn) : Reflect.get(target, key); } }) as unknown as ReturnType<typeof postgres>;
      const store = new PostgresScoringStore(scoped);
      const first = await store.createClient({ name: `Rule usage ${createEntityId()}` });
      const second = await store.createClient({ name: `Rule usage ${createEntityId()}` });
      const ruleId = createEntityId();
      const name = `Test rule ${ruleId}`;
      await tx`insert into scoring_rule_versions (id, version, package_checksum, definition) values (${ruleId}, ${name}, ${"a".repeat(64)}, ${tx.json({})})`;

      async function add(clientId: string, capability: "SCORING" | "FACE_SCAN", outcome: "SUCCEEDED" | "FAILED", versionId: string | null) {
        const deployment = await store.createDeployment({ clientId, name: createEntityId(), environment: "test" });
        const credentialId = createEntityId();
        await tx`insert into deployment_credentials (id,deployment_id,key_prefix,secret_hash,hash_algorithm) values (${credentialId},${deployment.id},${createEntityId().slice(0, 20)},${"b".repeat(64)},'sha256')`;
        const usageId = createEntityId();
        await tx`insert into usage_events (id,client_id,deployment_id,credential_id,capability,scoring_rule_version_id,request_id,idempotency_key,assessment_reference,outcome,occurred_at)
          values (${usageId},${clientId},${deployment.id},${credentialId},${capability},${versionId},${usageId},${usageId},'synthetic',${outcome},'2025-01-01T00:00:00Z')`;
      }
      await add(first.id, "SCORING", "SUCCEEDED", ruleId);
      await add(first.id, "SCORING", "SUCCEEDED", ruleId);
      await add(first.id, "SCORING", "SUCCEEDED", null);
      await add(first.id, "SCORING", "FAILED", ruleId);
      await add(first.id, "FACE_SCAN", "SUCCEEDED", null);
      await add(second.id, "SCORING", "SUCCEEDED", ruleId);

      expect(await store.usageByRule(first.id)).toEqual([
        { ruleVersionId: ruleId, name, count: 2 },
        { ruleVersionId: null, name: "Rule not recorded", count: 1 },
      ]);
      expect((await store.usageByRule()).find(item => item.ruleVersionId === ruleId)).toEqual({ ruleVersionId: ruleId, name, count: 3 });
      throw rollback;
    });
  } catch (error) { if (error !== rollback) throw error; }
  finally { await db.end(); }
});
