import { expect, test } from "bun:test";
import { MemoryReportGenerationStore, REPORT_RUN_LEASE_MS } from "./report-generation-store";
import { MemoryReportTraceStore, REPORT_TRACE_RETENTION_MS } from "./report-trace-store";

async function fixture() {
  let time = new Date("2026-01-01T00:00:00Z");
  const runs = new MemoryReportGenerationStore(() => time);
  const traces = new MemoryReportTraceStore(runs, () => time);
  const reserved = await runs.reserve({ clientId: "client", deploymentId: "deployment", assessmentReference: "assessment", resultReference: "result", ruleVersionId: "version", checksum: "checksum", idempotencyKey: "trace-test", fingerprint: "fingerprint", model: "model", promptVersion: "prompt-v1", schemaVersion: 4 });
  if (reserved.status !== "NEW") throw new Error("Expected reservation");
  return { runs, traces, run: reserved.run, advance: (ms: number) => { time = new Date(time.getTime() + ms); } };
}
const request = { sequence: 1, step: "writer", system: "exact system instruction", user: "assessment context", schema: { type: "object" } };

test("retains exact admitted prompts, completion and safe errors in invocation order", async () => {
  const { traces, run } = await fixture();
  const [first, second] = await Promise.all([traces.beginCall(run.id, run.attemptId, request), traces.beginCall(run.id, run.attemptId, { ...request, sequence: 2, step: "reviewer" })]);
  expect(first).toBeString(); expect(second).toBeString();
  expect(await traces.completeCall(run.id, run.attemptId, second!, { errorCode: "MODEL_UNAVAILABLE" })).toBe(true);
  expect(await traces.completeCall(run.id, run.attemptId, first!, { response: { advice: ["supported advice"] }, usage: { promptTokens: 100 } })).toBe(true);
  expect(await traces.completeCall(run.id, run.attemptId, first!, { response: { overwritten: true } })).toBe(false);
  expect(await traces.appendEvent(run.id, run.attemptId, { stage: "fallback", payload: { issues: [{ field: "nutritionAdvice", code: "SOURCE_CONFLICT" }] } })).toBe(true);
  const trace = await traces.read(run.id);
  expect(trace?.run.promptVersion).toBe("prompt-v1");
  expect(trace?.calls.map(call => call.sequence)).toEqual([1, 2]);
  expect(trace?.calls[0]).toMatchObject({ ...request, response: { advice: ["supported advice"] }, usage: { promptTokens: 100 } });
  expect(trace?.calls[1]?.errorCode).toBe("MODEL_UNAVAILABLE");
  expect(trace?.events[0]?.payload).toEqual({ issues: [{ field: "nutritionAdvice", code: "SOURCE_CONFLICT" }] });
  if (trace) trace.calls[0]!.system = "mutated";
  expect((await traces.read(run.id))?.calls[0]?.system).toBe(request.system);
});

test("fences all writes by attempt, lease and processing status", async () => {
  const { traces, runs, run, advance } = await fixture();
  const call = await traces.beginCall(run.id, run.attemptId, request);
  expect(await traces.beginCall(run.id, "stale", { ...request, sequence: 2 })).toBeNull();
  expect(await traces.completeCall(run.id, "stale", call!, { response: {} })).toBe(false);
  expect(await traces.appendEvent(run.id, "stale", { stage: "review", payload: {} })).toBe(false);
  advance(REPORT_RUN_LEASE_MS + 1);
  expect(await traces.beginCall(run.id, run.attemptId, { ...request, sequence: 2 })).toBeNull();
  expect(await traces.completeCall(run.id, run.attemptId, call!, { response: {} })).toBe(false);
  expect(await traces.appendEvent(run.id, run.attemptId, { stage: "review", payload: {} })).toBe(false);
  run.leaseExpiresAt = new Date("2027-01-01");
  await runs.finish(run.id, run.attemptId, "READY", {});
  expect(await traces.beginCall(run.id, run.attemptId, { ...request, sequence: 2 })).toBeNull();
  expect(await traces.completeCall(run.id, run.attemptId, call!, { response: {} })).toBe(false);
});

test("expired content is unreadable before pruning and old runs have empty traces", async () => {
  const { traces, run, advance } = await fixture();
  expect(await traces.read("missing")).toBeNull();
  expect((await traces.read(run.id))?.calls).toEqual([]);
  await traces.beginCall(run.id, run.attemptId, request);
  await traces.appendEvent(run.id, run.attemptId, { stage: "review", payload: {} });
  advance(REPORT_TRACE_RETENTION_MS);
  expect(await traces.read(run.id)).toMatchObject({ calls: [], events: [], retentionDays: 30 });
  await traces.pruneExpired();
  expect(await traces.read(run.id)).toMatchObject({ calls: [], events: [] });
});

// Disposable connection-local tables exercise PostgreSQL locking/JSON/retention without clinical writes.
test.skipIf(process.env.REPORT_TRACE_DATABASE_TEST !== "1")("PostgreSQL trace persistence fences attempts and excludes expired data", async () => {
  const { default: postgres } = await import("postgres");
  const { PostgresReportTraceStore } = await import("./report-trace-store");
  const database = postgres(process.env.DATABASE_URL!, { max: 1 });
  try {
    await database.unsafe(`create temporary table report_generation_runs (
      id varchar(26) primary key,client_id text,deployment_id text,prompt_version text,schema_version integer,status text,
      attempt_id varchar(26),lease_expires_at timestamptz,created_at timestamptz default now()
    )`);
    const migration = await Bun.file(new URL("../drizzle/0032_report_agent_traces.sql", import.meta.url)).text();
    for (const statement of migration.split("--> statement-breakpoint")) await database.unsafe(statement.replace("CREATE TABLE", "CREATE TEMPORARY TABLE"));
    await database`insert into report_generation_runs (id,client_id,deployment_id,prompt_version,schema_version,status,attempt_id,lease_expires_at) values ('run','client','deployment','prompt-v1',4,'PROCESSING','attempt',now()+interval '15 minutes')`;
    const traces = new PostgresReportTraceStore(database);
    const [one, two] = await Promise.all([traces.beginCall("run", "attempt", request), traces.beginCall("run", "attempt", { ...request, sequence: 2 })]);
    expect(one).toBeString(); expect(two).toBeString();
    expect(await traces.beginCall("run", "old-attempt", { ...request, sequence: 3 })).toBeNull();
    expect(await traces.completeCall("run", "old-attempt", one!, { response: {} })).toBe(false);
    expect(await traces.completeCall("run", "attempt", one!, { response: { exact: "response" }, usage: { promptTokens: 10 } })).toBe(true);
    expect(await traces.appendEvent("run", "attempt", { stage: "review", payload: { decision: "repair" } })).toBe(true);
    expect((await traces.read("run"))?.calls.map(call => call.sequence)).toEqual([1, 2]);
    expect((await traces.read("run"))?.calls[0]?.response).toEqual({ exact: "response" });
    await database`update report_generation_runs set lease_expires_at=now()-interval '1 second' where id='run'`;
    expect(await traces.completeCall("run", "attempt", two!, { response: {} })).toBe(false);
    expect(await traces.appendEvent("run", "attempt", { stage: "late", payload: {} })).toBe(false);
    await database`update report_trace_calls set expires_at=now()-interval '1 second'`;
    await database`update report_trace_events set expires_at=now()-interval '1 second'`;
    expect(await traces.read("run")).toMatchObject({ calls: [], events: [] });
    await traces.pruneExpired();
    const [count] = await database<Array<{ count: number }>>`select count(*)::int as count from report_trace_calls`;
    expect(count?.count).toBe(0);
    expect(await traces.read("missing")).toBeNull();
  } finally { await database.end(); }
});
