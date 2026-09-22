import { expect, test } from "bun:test";
import postgres from "postgres";
import { FaceScanWorkflow } from "./face-scan-workflow";
import { createEntityId } from "./lib/id";
import { decryptActivationToken } from "./lib/activation-secret";
import { faceScanCreateSchema, faceScanSignalSchema } from "@niq-scoring/contracts/face-scan-session";
import { CarePlixUnprocessableResultError, normalizeCarePlixResult, type CarePlixProvider } from "./careplix-provider";
import { allowlistedFaceScanReceipt } from "./face-scan-receipt";

const signal = faceScanSignalSchema.parse({ raw_intensity: [{ r: 1, g: 2, b: 3 }], ppg_time: [0], average_fps: 30 });
test.skipIf(process.env.FACE_SCAN_DATABASE_TEST !== "1")("dispatch races preserve provider correlation and durable evidence without submitting expired captures", async () => {
  const db = postgres(process.env.DATABASE_URL!, { max: 1 });
  const rollback = new Error("synthetic audit rollback");
  try {
    await db.begin(async tx => {
      const scoped = new Proxy(tx, { get(target, key) { return key === "begin" ? (fn: (sql: typeof tx) => Promise<unknown>) => tx.savepoint(fn) : Reflect.get(target, key); } }) as unknown as ReturnType<typeof postgres>;
      const clientId = createEntityId(), deploymentId = createEntityId(), credentialId = createEntityId();
      const identity = { clientId, deploymentId, credentialId };
      await tx`insert into clients(id,name) values(${clientId},${`Audit fixture ${clientId}`})`;
      await tx`insert into deployments(id,client_id,name,environment) values(${deploymentId},${clientId},'audit','test')`;
      await tx`insert into deployment_credentials(id,deployment_id,key_prefix,secret_hash) values(${credentialId},${deploymentId},${credentialId.slice(0,20)},${"b".repeat(64)})`;
      await tx`insert into entitlements(id,deployment_id,capability,enabled) values(${createEntityId()},${deploymentId},'FACE_SCAN',true)`;
      let mode = "success", sessionId = "", tokenCalls = 0, submitCalls = 0;
      let workflow: FaceScanWorkflow;
      const provider: CarePlixProvider = {
        async createToken() {
          tokenCalls++;
          if (mode === "expired") await tx`update face_scan_workflows set capture_expires_at=clock_timestamp()-interval '1 second' where session_id=${sessionId}`;
          if (mode === "stale") await tx`update face_scan_workflows set state='RECONCILIATION_REQUIRED',failure_code='DISPATCH_INTERRUPTED' where session_id=${sessionId}`;
          if (mode === "cancel-race") await expect(workflow.cancel(identity, sessionId, "org")).rejects.toThrow("CANCELLATION_NOT_ALLOWED");
          return { scanId: `audit-${tokenCalls}`, token: "synthetic-token" };
        },
        async submit(_context, _signal, _token, id, retain) {
          submitCalls++;
          if (mode === "malformed") throw new CarePlixUnprocessableResultError(allowlistedFaceScanReceipt({ scan_id: id, event_data: { scan_id: id, wellness_score: "invalid", metadata: { api_key: "secret", raw_intensity: signal.raw_intensity, physiological_score: "unsupported" } } }));
          const body = { scan_id: id, wellness_score: 75, vitals: { heart_rate: 70 }, future_parameter: 123 };
          await retain?.(body);
          if (mode === "callback-first") await workflow.webhook({ scan_id: id, scan_completion_time: "2026-09-20T10:00:00Z", event_data: { ...body, event_key: "scan_completion" } });
          return normalizeCarePlixResult({ ...body, scan_completion_time: "2026-09-20T10:01:00Z" }, id);
        },
      };
      const options = { enabled: () => true, provider, encryptionKey: "a".repeat(64), providerAccount: "audit:staging", retentionHours: 24, minDispatchIntervalMs: 0 };
      workflow = new FaceScanWorkflow(scoped, options);
      const start = async (name: string) => {
        const input = faceScanCreateSchema.parse({ clientId, organizationReference: "org", assessmentReference: name, idempotencyKey: name, context: { dob: "1990-01-01", gender: "male", heightCm: 170, weightKg: 70, posture: "resting", employeeId: "synthetic" } });
        const created = await workflow.create(identity, input);
        sessionId = created.session.id;
        await workflow.upload(identity, sessionId, "org", signal);
      };
      await start("account-isolation");
      await new FaceScanWorkflow(scoped, { ...options, enabled: () => false, providerAccount: "audit:production" }).tick();
      expect((await workflow.get(identity, sessionId, "org")).session.state).toBe("UPLOAD_ACCEPTED");
      await workflow.cancel(identity, sessionId, "org");
      for (const race of ["expired", "stale"]) {
        mode = race; await start(race);
        const before = submitCalls;
        await workflow.tick();
        expect(submitCalls).toBe(before);
        const [stored] = await tx`select provider_scan_id,token_ciphertext,state from face_scan_workflows where session_id=${sessionId}`;
        expect(stored?.provider_scan_id).toBe(`audit-${tokenCalls}`);
        expect(stored?.state).toBe(race === "expired" ? "FAILED" : "RECONCILIATION_REQUIRED");
        if (race === "expired") expect(stored?.token_ciphertext).toBeNull();
      }
      mode = "malformed"; await start(mode); await workflow.tick();
      expect((await workflow.get(identity, sessionId, "org")).session.failureCode).toBe("INVALID_PROVIDER_RESULT");
      const [receipt] = await tx`select receipt_ciphertext from face_scan_receipts where session_id=${sessionId} and channel='DIRECT' and disposition='UNPROCESSABLE'`;
      const evidence = decryptActivationToken(receipt!.receipt_ciphertext, options.encryptionKey);
      expect(evidence).toContain("unsupported"); expect(evidence).not.toContain("secret"); expect(evidence).not.toContain("raw_intensity");
      const before = tokenCalls; await workflow.tick(); expect(tokenCalls).toBe(before);
      mode = "callback-first"; await start(mode); await workflow.tick();
      expect((await workflow.get(identity, sessionId, "org")).session.state).toBe("COMPLETED");
      const [duplicate] = await tx`select count(*)::int as n from face_scan_receipts where session_id=${sessionId} and channel='DIRECT' and disposition='DUPLICATE'`;
      expect(duplicate?.n).toBe(1);
      const [original] = await tx`select receipt_ciphertext from face_scan_receipts where session_id=${sessionId} and channel='DIRECT' and disposition='RECEIVED'`;
      expect(original?.receipt_ciphertext).toBeTruthy();
      expect(original?.receipt_ciphertext).not.toContain("future_parameter");
      expect(JSON.parse(decryptActivationToken(original!.receipt_ciphertext, options.encryptionKey)).future_parameter).toBe(123);
      mode = "cancel-race"; await start(mode); await workflow.tick();
      expect((await workflow.get(identity, sessionId, "org")).session.state).toBe("COMPLETED");
      throw rollback;
    });
  } catch (error) { if (error !== rollback) throw error; }
  finally { await db.end(); }
});

test.skipIf(process.env.FACE_SCAN_DATABASE_TEST !== "1")("workflow quota reservation waits for an in-flight legacy entitlement reservation", async () => {
  const db = postgres(process.env.DATABASE_URL!, { max: 3 });
  const clientId = createEntityId(), deploymentId = createEntityId(), credentialId = createEntityId();
  let releaseLegacy!: () => void;
  let legacy: Promise<unknown> | undefined;
  let competing: Promise<unknown> | undefined;
  try {
    await db`insert into clients(id,name) values(${clientId},${`Quota audit ${clientId}`})`;
    await db`insert into deployments(id,client_id,name,environment) values(${deploymentId},${clientId},'quota-audit','test')`;
    await db`insert into deployment_credentials(id,deployment_id,key_prefix,secret_hash) values(${credentialId},${deploymentId},${credentialId.slice(0,20)},${"b".repeat(64)})`;
    await db`insert into entitlements(id,deployment_id,capability,enabled,monthly_limit) values(${createEntityId()},${deploymentId},'FACE_SCAN',true,1)`;
    let acquired!: () => void;
    const locked = new Promise<void>(resolve => { acquired = resolve; });
    const release = new Promise<void>(resolve => { releaseLegacy = resolve; });
    legacy = db.begin(async tx => {
      await tx`select id from entitlements where deployment_id=${deploymentId} and capability='FACE_SCAN' for update`;
      await tx`insert into usage_events(id,client_id,deployment_id,credential_id,capability,request_id,idempotency_key,assessment_reference,outcome)
        values(${createEntityId()},${clientId},${deploymentId},${credentialId},'FACE_SCAN','legacy','legacy','legacy','PENDING')`;
      acquired(); await release;
    });
    await locked;
    const workflow = new FaceScanWorkflow(db, { enabled: () => true, encryptionKey: "a".repeat(64), providerAccount: "quota:test", retentionHours: 24,
      provider: { async createToken() { throw new Error("must not dispatch"); }, async submit() { throw new Error("must not dispatch"); } } });
    const input = faceScanCreateSchema.parse({ clientId, organizationReference: "org", assessmentReference: "modern", idempotencyKey: "modern", context: { dob: "1990-01-01", gender: "male", heightCm: 170, weightKg: 70, posture: "resting", employeeId: "synthetic" } });
    competing = workflow.create({ clientId, deploymentId, credentialId }, input).then(() => "accepted", error => error.message);
    expect(await Promise.race([competing, new Promise(resolve => setTimeout(() => resolve("blocked"), 50))])).toBe("blocked");
    releaseLegacy(); await legacy;
    expect(await competing).toBe("MONTHLY_LIMIT_REACHED");
    const [usage] = await db`select count(*)::int as n from usage_events where deployment_id=${deploymentId}`;
    expect(usage?.n).toBe(1);
  } finally {
    releaseLegacy?.(); await legacy; await competing;
    await db`delete from face_scan_workflows where deployment_id=${deploymentId}`;
    await db`delete from face_scan_sessions where deployment_id=${deploymentId}`;
    await db`delete from usage_events where deployment_id=${deploymentId}`;
    await db`delete from entitlements where deployment_id=${deploymentId}`;
    await db`delete from deployment_credentials where deployment_id=${deploymentId}`;
    await db`delete from deployments where id=${deploymentId}`;
    await db`delete from clients where id=${clientId}`;
    await db.end();
  }
});
