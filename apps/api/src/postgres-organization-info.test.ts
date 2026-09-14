import { expect, test } from "bun:test";
import postgres from "postgres";
import { PostgresScoringStore } from "./postgres-store";
import { createEntityId } from "./lib/id";

test.skipIf(process.env.RULE_DATABASE_TEST !== "1")("PostgreSQL organization info binds identity, reports monthly usage and audits without secrets", async () => {
  const db = postgres(process.env.DATABASE_URL!, { max: 1 });
  const rollback = new Error("rollback organization info fixture");
  try {
    await db.begin(async tx => {
      const scoped = new Proxy(tx, { get(target, key) { return key === "begin" ? (fn: (sql: typeof tx) => Promise<unknown>) => tx.savepoint(fn) : Reflect.get(target, key); } }) as unknown as ReturnType<typeof postgres>;
      const store = new PostgresScoringStore(scoped);
      const client = await store.createClient({ name: `Synthetic organization info ${createEntityId()}` });
      const dep = await store.createDeployment({ clientId: client.id, name: "Organization info", environment: "test" });
      const credentialId = createEntityId();
      const secret = "a".repeat(64);
      await tx`insert into deployment_credentials (id,deployment_id,key_prefix,secret_hash,hash_algorithm) values (${credentialId},${dep.id},${createEntityId().slice(0,20)},${secret},'sha256')`;
      const identity = { clientId: client.id, deploymentId: dep.id, credentialId };
      const now = new Date("2026-09-14T00:00:00Z");
      await expect(store.organizationInfo(identity, now)).rejects.toThrow("CONFIGURATION_INCOMPLETE");
      await tx`update deployments set hosting_type='CLIENT_CLOUD' where id=${dep.id}`;
      await store.setEntitlement(dep.id, { capability: "SCORING", enabled: true, monthlyLimit: 0 });
      await expect(store.organizationInfo(identity, now)).rejects.toThrow("CONFIGURATION_INCOMPLETE");
      await store.setEntitlement(dep.id, { capability: "FACE_SCAN", enabled: false, monthlyLimit: null });
      for (const [capability, outcome, occurredAt] of [
        ["SCORING", "SUCCEEDED", "2026-09-01T00:00:00Z"],
        ["SCORING", "PENDING", "2026-09-13T00:00:00Z"],
        ["SCORING", "FAILED", "2026-09-13T00:00:00Z"],
        ["SCORING", "REJECTED", "2026-09-13T00:00:00Z"],
        ["SCORING", "SUCCEEDED", "2026-08-31T23:59:59Z"],
        ["SCORING", "SUCCEEDED", "2026-10-01T00:00:00Z"],
        ["FACE_SCAN", "SUCCEEDED", "2026-09-13T00:00:00Z"],
      ]) {
        const id = createEntityId();
        await tx`insert into usage_events (id,client_id,deployment_id,credential_id,capability,request_id,idempotency_key,assessment_reference,outcome,billable,occurred_at)
          values (${id},${client.id},${dep.id},${credentialId},${capability!},${id},${id},'synthetic',${outcome!},${outcome === 'SUCCEEDED'},${occurredAt!})`;
      }
      const snapshot = await store.organizationInfo(identity, now);
      expect(snapshot).toMatchObject({
        organization: { id: client.id, name: client.name, status: "ACTIVE" },
        deployment: { id: dep.id, mode: "CLIENT_CLOUD", environment: "test", status: "ACTIVE" },
        services: { scoring: { enabled: true }, faceScan: { enabled: false } },
        limits: { scoresPerMonth: 0, faceScansPerMonth: null },
        usage: { period: "2026-09", scores: 2, faceScans: 1 },
        unavailableFields: ["limits.users"],
      });
      expect((await store.organizationInfo(identity, new Date("2026-09-20T00:00:00Z"))).updatedAt).toBe(snapshot.updatedAt);
      const audit = await tx`select actor_reference,resource_type,resource_reference,metadata from audit_events where action='ORGANIZATION_INFO_READ' and deployment_id=${dep.id}`;
      expect(audit.length).toBe(2);
      expect(audit[0]).toMatchObject({ actor_reference: credentialId, resource_type: "deployment", resource_reference: dep.id, metadata: {} });
      expect(JSON.stringify(audit)).not.toContain(secret);
      await expect(store.organizationInfo({ ...identity, clientId: createEntityId() }, now)).rejects.toThrow("UNAUTHORIZED");
      await expect(store.organizationInfo({ ...identity, deploymentId: createEntityId() }, now)).rejects.toThrow("UNAUTHORIZED");
      await store.setClientEnabled(client.id, false);
      await expect(store.organizationInfo(identity, now)).rejects.toThrow("CLIENT_DISABLED");
      await store.setClientEnabled(client.id, true);
      await store.setDeploymentEnabled(dep.id, false);
      await expect(store.organizationInfo(identity, now)).rejects.toThrow("DEPLOYMENT_DISABLED");
      await store.setDeploymentEnabled(dep.id, true);
      await tx`update deployment_credentials set expires_at=${now} where id=${credentialId}`;
      await expect(store.organizationInfo(identity, now)).rejects.toThrow("UNAUTHORIZED");
      await tx`update deployment_credentials set expires_at=null, revoked_at=${now} where id=${credentialId}`;
      await expect(store.organizationInfo(identity, now)).rejects.toThrow("UNAUTHORIZED");
      expect((await tx`select id from audit_events where action='ORGANIZATION_INFO_READ' and deployment_id=${dep.id}`).length).toBe(2);
      throw rollback;
    });
  } catch (error) { if (error !== rollback) throw error; }
  finally { await db.end(); }
});
