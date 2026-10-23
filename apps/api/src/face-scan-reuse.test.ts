import postgres from "postgres";
import { createEntityId } from "./lib/id";
import { faceScanCreateSchema } from "@niq-scoring/contracts/face-scan-session";
import { PostgresScoringStore } from "./postgres-store";
import { expect, test } from "bun:test";
import { Hono } from "hono";
import { installFaceScanRoutes } from "./face-scan-routes";
import { FaceScanWorkflow } from "./face-scan-workflow";

test("historical reuse route authenticates and validates destination references before dispatch", async () => {
  const app = new Hono();
  let authenticated = false, calls = 0;
  const workflow = { async reuse(_identity: unknown, id: string, input: unknown) { calls++; return { id, input }; } } as unknown as FaceScanWorkflow;
  installFaceScanRoutes(app, { workflow, authenticate: async () => authenticated ? { clientId: "c", deploymentId: "d", credentialId: "k" } : null });
  const request = (body: unknown) => app.request("/v1/face-scans/source/reuse", { method: "POST", body: JSON.stringify(body) });
  expect((await request({})).status).toBe(401);
  authenticated = true;
  expect((await request({})).status).toBe(400);
  expect(calls).toBe(0);
  const input = { organizationReference: "org", sourceAssessmentReference: "original", assessmentReference: "copy" };
  const response = await request(input);
  expect(response.status).toBe(200);
  expect(response.headers.get("cache-control")).toBe("no-store");
  expect(await response.json()).toEqual({ id: "source", input });
  expect(calls).toBe(1);
});


test.skipIf(process.env.FACE_SCAN_DATABASE_TEST !== "1")("historical reuse rescored under destination binding is durable, scoped and does not bill a new scan", async () => {
  const database = postgres(process.env.DATABASE_URL!, { max: 1 });
  const rollback = new Error("rollback historical reuse fixture");
  try {
    await database.begin(async tx => {
    const db = new Proxy(tx, { get(target, key) { return key === "begin" ? (fn: (sql: typeof tx) => Promise<unknown>) => tx.savepoint(fn) : Reflect.get(target, key); } }) as unknown as ReturnType<typeof postgres>;
    const clientId = createEntityId(), deploymentId = createEntityId(), credentialId = createEntityId(), ruleId = createEntityId();
    const identity = { clientId, deploymentId, credentialId };
    let providerCalls = 0;
    const workflow = new FaceScanWorkflow(db, { enabled: () => true, encryptionKey: "a".repeat(64), providerAccount: `reuse:${deploymentId}`, retentionHours: 24,
      provider: { async createToken() { providerCalls++; throw new Error("Unexpected provider call"); }, async submit() { providerCalls++; throw new Error("Unexpected provider call"); } } });
    const input = { organizationReference: "same-org", sourceAssessmentReference: "original", assessmentReference: "copy" };
    const captured = "2026-10-01T10:20:00.000Z";
    await db`insert into clients(id,name) values(${clientId},${`Reuse test ${clientId}`})`;
    await db`insert into deployments(id,client_id,name,environment) values(${deploymentId},${clientId},'reuse test','test')`;
    await db`insert into deployment_credentials(id,deployment_id,key_prefix,secret_hash) values(${credentialId},${deploymentId},${clientId.slice(0,20)},${"b".repeat(64)})`;
    await db`insert into entitlements(id,deployment_id,capability,enabled) values(${createEntityId()},${deploymentId},'FACE_SCAN',true)`;
    const original = await workflow.create(identity, faceScanCreateSchema.parse({ clientId, organizationReference: "same-org", assessmentReference: "original", idempotencyKey: "source",
      context: { dob: "1990-01-01", gender: "female", heightCm: 170, weightKg: 70, posture: "resting", employeeId: "operator" } }));
    const result = { schemaVersion: 1 as const, providerScanId: "accepted-provider-scan", providerCompletedAt: captured, wellnessScore: 80, healthRiskScore: null,
      vitals: { heartRate: 75, oxygenSaturation: 98, respiratoryRate: 16, systolic: 120, diastolic: 80 }, physiologicalScore: null, mentalWellbeingScore: null };
    await db`update face_scan_workflows set state='COMPLETED',completed_at=${new Date(captured)},result=${db.json(result)},score=${db.json({ status: "SCORED", points: 3, ruleVersionId: "old-rule" })} where session_id=${original.session.id}`;
    await db`insert into scoring_rule_versions(id,version,lifecycle,clinical_use_permitted,package_checksum,definition)
      values(${ruleId},${`reuse-${ruleId}`},'APPROVED',true,${"c".repeat(64)},${db.json({ faceScanScoring: { ranges: [{ id: "all", min: 0, max: 100, minInclusive: true, maxInclusive: true, points: 7 }] } })})`;
    await db`insert into assessment_bindings(id,deployment_id,client_id,assessment_reference,scoring_rule_version_id,package_checksum)
      values(${createEntityId()},${deploymentId},${clientId},'copy',${ruleId},${"c".repeat(64)})`;
    await expect(workflow.reuse(identity, original.session.id, { ...input, organizationReference: "another-org" })).rejects.toThrow("NOT_FOUND");
    await expect(workflow.reuse({ ...identity, clientId: createEntityId() }, original.session.id, input)).rejects.toThrow("NOT_FOUND");
    await expect(workflow.reuse({ ...identity, deploymentId: createEntityId() }, original.session.id, input)).rejects.toThrow("NOT_FOUND");
    await expect(workflow.reuse(identity, original.session.id, { ...input, sourceAssessmentReference: "wrong" })).rejects.toThrow("NOT_FOUND");
    await expect(workflow.reuse(identity, original.session.id, { ...input, assessmentReference: "original" })).rejects.toThrow("SELF_REUSE_NOT_ALLOWED");
    await expect(workflow.reuse(identity, original.session.id, { ...input, assessmentReference: "unbound" })).rejects.toThrow("FACE_SCAN_MAPPING_UNAVAILABLE");
    await db`update face_scan_workflows set state='PROCESSING' where session_id=${original.session.id}`;
    await expect(workflow.reuse(identity, original.session.id, input)).rejects.toThrow("HISTORICAL_MEASUREMENT_UNAVAILABLE");
    await db`update face_scan_workflows set state='COMPLETED' where session_id=${original.session.id}`;
    const copies = [await workflow.reuse(identity, original.session.id, input), await workflow.reuse(identity, original.session.id, input)];
    const copy = copies[0]!;
    expect(copies[1]?.session.id).toBe(copy.session.id);
    expect(copy.session.id).not.toBe(original.session.id);
    expect(copy.session.completedAt).toBe(captured);
    expect(copy.session.historicalSource).toEqual({ sessionId: original.session.id, assessmentReference: "original", capturedAt: captured });
    expect(copy.session.result).toEqual(result);
    expect(copy.session.score).toMatchObject({ status: "SCORED", points: 7, ruleVersionId: ruleId });
    expect(await workflow.get(identity, copy.session.id, "same-org")).toEqual(copy);
    await expect(workflow.get(identity, copy.session.id, "wrong-org")).rejects.toThrow("NOT_FOUND");
    const store = new PostgresScoringStore(db);
    const pointsInput = { identity, assessmentReference: "copy", sessionId: copy.session.id, ruleVersionId: ruleId };
    expect(await store.faceScanPoints(pointsInput)).toBe(7);
    expect(await store.faceScanPoints({ ...pointsInput, ruleVersionId: "wrong-rule" })).toBeNull();
    expect(await store.faceScanPoints({ ...pointsInput, assessmentReference: "original" })).toBeNull();
    expect(await store.faceScanPoints({ ...pointsInput, identity: { ...identity, clientId: "wrong" } })).toBeNull();
    const [counts] = await db`select (select count(*)::int from usage_events where deployment_id=${deploymentId}) as usage,
      (select count(*)::int from face_scan_sessions where deployment_id=${deploymentId}) as captures,
      (select count(*)::int from audit_events where deployment_id=${deploymentId} and action='FACE_SCAN_MEASUREMENT_REUSED') as audits`;
    expect(counts).toEqual({ usage: 1, captures: 1, audits: 1 });
    expect(providerCalls).toBe(0);
    throw rollback;
    });
  } catch (error) { if (error !== rollback) throw error; }
  finally { await database.end(); }
});
