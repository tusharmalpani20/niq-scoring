import { expect, test } from "bun:test";
import postgres from "postgres";
import { FaceScanWorkflow } from "./face-scan-workflow";
import { decryptActivationToken } from "./lib/activation-secret";
import { createEntityId } from "./lib/id";
import { faceScanCreateSchema, faceScanSignalSchema } from "@niq-scoring/contracts/face-scan-session";
import { normalizeCarePlixResult } from "./careplix-provider";
import type { CarePlixProvider } from "./careplix-provider";

const signal = faceScanSignalSchema.parse({ raw_intensity: [{ r: 1, g: 2, b: 3 }, { r: 2, g: 3, b: 4 }], ppg_time: [0, 1], average_fps: 30 });
test.skipIf(process.env.FACE_SCAN_DATABASE_TEST !== "1")("durable face scans isolate scope, reserve atomically, survive restart and never retry ambiguous dispatch", async () => {
  const db = postgres(process.env.DATABASE_URL!, { max: 4 });
  const clientId = createEntityId(), deploymentId = createEntityId(), credentialId = createEntityId(), ruleId = createEntityId();
  let enabled = true, mode = "success", tokenCalls = 0, submitCalls = 0;
  const provider: CarePlixProvider = {
    async createToken() { tokenCalls++; if (mode === "token-timeout") throw new Error("timeout"); return { scanId: `synthetic-${tokenCalls}`, token: "secret-token" }; },
    async submit(_context, _signal, _token, id) { submitCalls++; if (mode === "submit-timeout") throw new Error("timeout"); return normalizeCarePlixResult({ scan_id: id, wellness_score: 78, vitals: { heart_rate: 70 } }, id); },
  };
  const options = { enabled: () => enabled, provider, encryptionKey: "a".repeat(64), providerAccount: "synthetic:staging", retentionHours: 24, minDispatchIntervalMs: 0 };
  let workflow = new FaceScanWorkflow(db, options);
  const identity = { clientId, deploymentId, credentialId };
  const input = (key: string) => faceScanCreateSchema.parse({ clientId, organizationReference: "organization-a", assessmentReference: key, idempotencyKey: key, context: { dob: "1990-01-01", gender: "female", heightCm: 170, weightKg: 70, posture: "resting", employeeId: `${deploymentId}:operator` } });
  try {
    await db`insert into clients(id,name) values(${clientId},${`Synthetic scan ${clientId}`})`;
    await db`insert into deployments(id,client_id,name,environment) values(${deploymentId},${clientId},'synthetic','test')`;
    await db`insert into deployment_credentials(id,deployment_id,key_prefix,secret_hash) values(${credentialId},${deploymentId},${clientId.slice(0,20)},${"b".repeat(64)})`;
    await db`insert into entitlements(id,deployment_id,capability,enabled,monthly_limit) values(${createEntityId()},${deploymentId},'FACE_SCAN',true,20)`;
    const pair = await Promise.all([workflow.create(identity, input("first")), workflow.create(identity, input("first"))]);
    const id = pair[0]!.session.id;
    expect(pair[1]!.session.id).toBe(id);
    expect(tokenCalls).toBe(0);
    const [count] = await db`select count(*)::int as n from usage_events where deployment_id=${deploymentId}`;
    expect(count?.n).toBe(1);
    await expect(workflow.create(identity, { ...input("first"), context: { ...input("first").context, heightCm: 180 } })).rejects.toThrow("IDEMPOTENCY_CONFLICT");
    await expect(workflow.create(identity, { ...input("first"), idempotencyKey: "different-key" })).rejects.toThrow("ACTIVE_FACE_SCAN_EXISTS");
    await expect(workflow.get(identity, id, "organization-b")).rejects.toThrow("NOT_FOUND");
    await expect(workflow.get({ ...identity, deploymentId: createEntityId() }, id, "organization-a")).rejects.toThrow("NOT_FOUND");
    await workflow.upload(identity, id, "organization-a", signal);
    await workflow.upload(identity, id, "organization-a", signal);
    await expect(workflow.upload(identity, id, "organization-a", { ...signal, average_fps: 31 })).rejects.toThrow("SIGNAL_CONFLICT");
    const [encrypted] = await db`select context_ciphertext,signal_ciphertext from face_scan_workflows where session_id=${id}`;
    expect(encrypted?.context_ciphertext).not.toContain("1990"); expect(encrypted?.signal_ciphertext).not.toContain("raw_intensity");
    workflow = new FaceScanWorkflow(db, options); // durable accepted work survives process replacement
    enabled = false;
    await workflow.tick(); expect((await workflow.get(identity, id, "organization-a")).session.state).toBe("PAUSED");
    expect((await workflow.create(identity, input("first"))).session.id).toBe(id);
    enabled = true;
    await Promise.all([workflow.tick(), new FaceScanWorkflow(db, options).tick()]);
    expect(tokenCalls).toBe(1); expect(submitCalls).toBe(1);
    const completed = await workflow.get(identity, id, "organization-a");
    expect(completed.session.state).toBe("COMPLETED"); expect(completed.session.score).toBeNull();
    await workflow.webhook({ scan_id: "synthetic-1", api_key: "do-not-store", event_data: { scan_id: "synthetic-1", event_key: "scan_completion", wellness_score: "78", vitals: { heart_rate: "70" } } });
    expect((await workflow.get(identity, id, "organization-a")).session.result).toEqual(completed.session.result);
    await workflow.webhook({ scan_id: "synthetic-1", event_data: { scan_id: "synthetic-1", event_key: "scan_completion", wellness_score: 10, vitals: { heart_rate: 70 } } });
    const conflict = await workflow.get(identity, id, "organization-a");
    expect(conflict.session.state).toBe("COMPLETED"); expect(conflict.session.failureCode).toBe("RESULT_CONFLICT"); expect(conflict.session.result).toEqual(completed.session.result);
    for (const failureMode of ["token-timeout", "submit-timeout"]) {
      mode = failureMode;
      const pending = await workflow.create(identity, input(failureMode));
      await workflow.upload(identity, pending.session.id, "organization-a", signal);
      await workflow.tick();
      const calls = tokenCalls + submitCalls;
      await new FaceScanWorkflow(db, options).tick();
      expect(tokenCalls + submitCalls).toBe(calls);
      expect((await workflow.get(identity, pending.session.id, "organization-a")).session.state).toBe("RECONCILIATION_REQUIRED");
      const [usage] = await db`select u.outcome from usage_events u join face_scan_workflows w on w.usage_id=u.id where w.session_id=${pending.session.id}`;
      expect(usage?.outcome).toBe("PENDING");
    }
    mode = "success";
    const configuration = { ranges: [{ id: "all", min: 0, max: 100, minInclusive: true, maxInclusive: true, points: 7 }] };
    await db`insert into scoring_rule_versions(id,version,lifecycle,clinical_use_permitted,package_checksum,definition) values(${ruleId},${`scan-fixture-${ruleId}`},'APPROVED',true,${"c".repeat(64)},${db.json({ faceScanScoring: configuration })})`;
    await db`insert into deployment_version_assignments(id,deployment_id,mode,scoring_rule_version_id) values(${createEntityId()},${deploymentId},'PINNED',${ruleId})`;
    const pinned = await workflow.create(identity, input("pinned"));
    await db`update deployment_version_assignments set effective_until=clock_timestamp() where deployment_id=${deploymentId}`;
    await workflow.upload(identity, pinned.session.id, "organization-a", signal);
    await workflow.tick();
    expect((await workflow.get(identity, pinned.session.id, "organization-a")).session.score).toMatchObject({ points: 7, ruleVersionId: ruleId, configuration });
    const [mapping] = await db`select mapping from face_scan_workflows where session_id=${pinned.session.id}`;
    expect(mapping?.mapping.checksum).toBe("c".repeat(64));
    await workflow.webhook({ scan_id: `synthetic-${tokenCalls}`, event_data: { scan_id: "wrong", event_key: "scan_completion" } });
    expect((await workflow.get(identity, pinned.session.id, "organization-a")).session.state).toBe("COMPLETED");
    await expect(workflow.webhook({ scan_id: "unknown", event_data: {} })).rejects.toThrow("UNKNOWN_PROVIDER_SCAN");
    const invalidMapping = await workflow.create(identity, input("mapping-failure"));
    await db`update face_scan_workflows set mapping=${db.json({ ruleVersionId: ruleId, configuration: { bad: true } })} where session_id=${invalidMapping.session.id}`;
    await workflow.upload(identity, invalidMapping.session.id, "organization-a", signal);
    await workflow.tick();
    expect((await workflow.get(identity, invalidMapping.session.id, "organization-a")).session).toMatchObject({ state: "COMPLETED", failureCode: "SCORE_MAPPING_UNAVAILABLE", score: null });
    const [billable] = await db`select u.billable from usage_events u join face_scan_workflows w on w.usage_id=u.id where w.session_id=${invalidMapping.session.id}`;
    expect(billable?.billable).toBe(true);
    await workflow.webhook({ scan_id: `synthetic-${tokenCalls}`, api_key: "outer-secret", event_data: { scan_id: "wrong", event_key: "scan_completion", metadata: { api_key: "inner-secret", physiological_score: "bad" } } });
    const [receipt] = await db`select receipt_ciphertext from face_scan_receipts where session_id=${invalidMapping.session.id} and disposition='UNPROCESSABLE'`;
    const retained = decryptActivationToken(receipt!.receipt_ciphertext, options.encryptionKey);
    expect(retained).toContain('physiological_score'); expect(retained).not.toContain('secret');
    const cancelled = await workflow.create(identity, input("cancelled"));
    await workflow.cancel(identity, cancelled.session.id, "organization-a");
    await expect(workflow.upload(identity, cancelled.session.id, "organization-a", signal)).rejects.toThrow("CAPTURE_NOT_ALLOWED");
    const interrupted = await workflow.create(identity, input("crash"));
    await workflow.upload(identity, interrupted.session.id, "organization-a", signal);
    await db`update face_scan_workflows set state='PROCESSING',dispatch_phase='TOKEN',dispatch_started_at=now()-interval '6 minutes' where session_id=${interrupted.session.id}`;
    const calls = tokenCalls; await workflow.tick(); expect(tokenCalls).toBe(calls);
    expect((await workflow.get(identity, interrupted.session.id, "organization-a")).session.state).toBe("RECONCILIATION_REQUIRED");
  } finally {
    await db`delete from face_scan_receipts where session_id in(select session_id from face_scan_workflows where deployment_id=${deploymentId})`;
    await db`delete from face_scan_workflows where deployment_id=${deploymentId}`;
    await db`delete from face_scan_sessions where deployment_id=${deploymentId}`;
    await db`delete from usage_events where deployment_id=${deploymentId}`;
    await db`delete from entitlements where deployment_id=${deploymentId}`;
    await db`delete from deployment_credentials where deployment_id=${deploymentId}`;
    await db`delete from deployment_version_assignments where deployment_id=${deploymentId}`;
    // Approved rule fixtures remain immutable; run this suite only in a disposable database.
    await db`delete from deployments where id=${deploymentId}`;
    await db`delete from clients where id=${clientId}`;
    await db.end();
  }
});

test.skipIf(process.env.FACE_SCAN_DATABASE_TEST !== "1")("a disabled tenant cannot starve other deployments in the provider queue", async () => {
  const db = postgres(process.env.DATABASE_URL!, { max: 1 });
  const rollback = new Error("synthetic rollback");
  try {
    await db.begin(async tx => {
      const scoped = new Proxy(tx, { get(target, key) { return key === "begin" ? (fn: (sql: typeof tx) => Promise<unknown>) => tx.savepoint(fn) : Reflect.get(target, key); } }) as unknown as ReturnType<typeof postgres>;
      const clientId = createEntityId();
      await tx`insert into clients(id,name) values(${clientId},${`Queue fixture ${clientId}`})`;
      const workflow = new FaceScanWorkflow(scoped, { enabled: () => true, encryptionKey: "a".repeat(64), providerAccount: "queue:test", retentionHours: 24, minDispatchIntervalMs: 0,
        provider: { async createToken() { return { scanId: "queue-result", token: "synthetic" }; }, async submit(_context, _signal, _token, id) { return normalizeCarePlixResult({ scan_id: id, wellness_score: 75, vitals: {} }, id); } } });
      const fixtures = [];
      for (const label of ["blocked", "eligible"]) {
        const deploymentId = createEntityId(), credentialId = createEntityId();
        await tx`insert into deployments(id,client_id,name,environment) values(${deploymentId},${clientId},${label},'test')`;
        await tx`insert into deployment_credentials(id,deployment_id,key_prefix,secret_hash) values(${credentialId},${deploymentId},${credentialId.slice(0,20)},${"b".repeat(64)})`;
        await tx`insert into entitlements(id,deployment_id,capability,enabled) values(${createEntityId()},${deploymentId},'FACE_SCAN',true)`;
        const identity = { clientId, deploymentId, credentialId };
        const input = faceScanCreateSchema.parse({ clientId, organizationReference: "same-org-reference", assessmentReference: "same-assessment-reference", idempotencyKey: "same-key", context: { dob: "1990-01-01", gender: "male", heightCm: 180, weightKg: 80, posture: "resting", employeeId: label } });
        const session = await workflow.create(identity, input);
        await workflow.upload(identity, session.session.id, input.organizationReference, signal);
        fixtures.push({ identity, id: session.session.id, organization: input.organizationReference });
      }
      await tx`update deployments set enabled=false where id=${fixtures[0]!.identity.deploymentId}`;
      await workflow.tick();
      expect((await workflow.get(fixtures[0]!.identity, fixtures[0]!.id, fixtures[0]!.organization)).session.state).toBe("PAUSED");
      expect((await workflow.get(fixtures[1]!.identity, fixtures[1]!.id, fixtures[1]!.organization)).session.state).toBe("COMPLETED");
      throw rollback;
    });
  } catch (error) { if (error !== rollback) throw error; }
  finally { await db.end(); }
});
