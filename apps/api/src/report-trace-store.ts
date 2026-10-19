import postgres from "postgres";
import { createEntityId } from "./lib/id";
import type { MemoryReportGenerationStore, ReportRun } from "./report-generation-store";

/** Assessment-derived prompts/responses expire after 30 days; usage metadata is separate. */
export const REPORT_TRACE_RETENTION_MS = 30 * 24 * 60 * 60 * 1000;
export type NewTraceCall = { sequence: number; step: string; system: string; user: string; schema: Record<string, unknown> };
export type TraceCompletion = { response?: unknown; usage?: unknown; errorCode?: string | null };
export type ReportTraceCall = NewTraceCall & { id: string; attemptId: string; response: unknown | null; usage: unknown | null; errorCode: string | null; createdAt: string; completedAt: string | null; expiresAt: string };
export type ReportTraceEvent = { id: string; attemptId: string; stage: string; payload: unknown; createdAt: string; expiresAt: string };
export type ReportTrace = { run: Pick<ReportRun, "id" | "clientId" | "deploymentId" | "promptVersion" | "schemaVersion" | "status" | "createdAt">; retentionDays: number; calls: ReportTraceCall[]; events: ReportTraceEvent[] };
export interface ReportTraceStore {
  beginCall(runId: string, attemptId: string, input: NewTraceCall): Promise<string | null>;
  completeCall(runId: string, attemptId: string, callId: string, input: TraceCompletion): Promise<boolean>;
  appendEvent(runId: string, attemptId: string, input: { stage: string; payload: unknown }): Promise<boolean>;
  read(runId: string): Promise<ReportTrace | null>;
  pruneExpired(): Promise<void>;
}

const metadata = (run: ReportTrace["run"]): ReportTrace["run"] => ({ id: run.id, clientId: run.clientId, deploymentId: run.deploymentId, promptVersion: run.promptVersion, schemaVersion: run.schemaVersion, status: run.status, createdAt: run.createdAt });
export class MemoryReportTraceStore implements ReportTraceStore {
  private calls: Array<ReportTraceCall & { runId: string }> = [];
  private events: Array<ReportTraceEvent & { runId: string }> = [];
  constructor(private readonly runs: MemoryReportGenerationStore, private readonly now = () => new Date()) {}
  private active(runId: string, attemptId: string) {
    return this.runs.isActive(runId, attemptId);
  }
  async beginCall(runId: string, attemptId: string, input: NewTraceCall) {
    if (!this.active(runId, attemptId)) return null;
    if (this.calls.some(call => call.runId === runId && call.attemptId === attemptId && call.sequence === input.sequence)) throw new Error("REPORT_TRACE_DUPLICATE_SEQUENCE");
    const id = createEntityId();
    this.calls.push({ ...structuredClone(input), id, runId, attemptId, response: null, usage: null, errorCode: null, createdAt: this.now().toISOString(), completedAt: null, expiresAt: new Date(this.now().getTime() + REPORT_TRACE_RETENTION_MS).toISOString() });
    return id;
  }
  async completeCall(runId: string, attemptId: string, callId: string, input: TraceCompletion) {
    if (!this.active(runId, attemptId)) return false;
    const call = this.calls.find(row => row.id === callId && row.runId === runId && row.attemptId === attemptId && row.expiresAt > this.now().toISOString() && row.completedAt === null);
    if (!call) return false;
    Object.assign(call, { response: structuredClone(input.response ?? null), usage: structuredClone(input.usage ?? null), errorCode: input.errorCode ?? null, completedAt: this.now().toISOString() });
    return true;
  }
  async appendEvent(runId: string, attemptId: string, input: { stage: string; payload: unknown }) {
    if (!this.active(runId, attemptId)) return false;
    this.events.push({ ...structuredClone(input), id: createEntityId(), runId, attemptId, createdAt: this.now().toISOString(), expiresAt: new Date(this.now().getTime() + REPORT_TRACE_RETENTION_MS).toISOString() });
    return true;
  }
  async read(runId: string): Promise<ReportTrace | null> {
    const run = this.runs.runs.find(row => row.id === runId);
    if (!run) return null;
    const live = (row: { runId: string; expiresAt: string }) => row.runId === runId && row.expiresAt > this.now().toISOString();
    return structuredClone({ run: metadata(run), retentionDays: 30,
      calls: this.calls.filter(live).sort((a, b) => a.attemptId.localeCompare(b.attemptId) || a.sequence - b.sequence).map(({ runId: _, ...call }) => call),
      events: this.events.filter(live).sort((a, b) => a.createdAt.localeCompare(b.createdAt)).map(({ runId: _, ...event }) => event) });
  }
  async pruneExpired() {
    const live = (row: { expiresAt: string }) => row.expiresAt > this.now().toISOString();
    this.calls = this.calls.filter(live);
    this.events = this.events.filter(live);
  }
}

export class PostgresReportTraceStore implements ReportTraceStore {
  constructor(private readonly database: ReturnType<typeof postgres>) {}
  async beginCall(runId: string, attemptId: string, input: NewTraceCall) {
    const id = createEntityId();
    const inserted = await this.database`with current_run as (
      select id from report_generation_runs where id=${runId} and attempt_id=${attemptId} and status='PROCESSING' and lease_expires_at>clock_timestamp() for update
    ) insert into report_trace_calls (id,run_id,attempt_id,sequence,step,system_prompt,user_prompt,response_schema,expires_at)
    select ${id},id,${attemptId},${input.sequence},${input.step},${input.system},${input.user},${this.database.json(input.schema as never)},clock_timestamp()+${REPORT_TRACE_RETENTION_MS}*interval '1 millisecond' from current_run returning id`;
    return inserted.length ? id : null;
  }
  async completeCall(runId: string, attemptId: string, callId: string, input: TraceCompletion) {
    const updated = await this.database`with current_run as (
      select id from report_generation_runs where id=${runId} and attempt_id=${attemptId} and status='PROCESSING' and lease_expires_at>clock_timestamp() for update
    ) update report_trace_calls set response=${input.response == null ? null : this.database.json(input.response as never)},usage=${input.usage == null ? null : this.database.json(input.usage as never)},error_code=${input.errorCode ?? null},completed_at=clock_timestamp()
      where id=${callId} and run_id in (select id from current_run) and attempt_id=${attemptId} and completed_at is null and expires_at>clock_timestamp() returning id`;
    return updated.length > 0;
  }
  async appendEvent(runId: string, attemptId: string, input: { stage: string; payload: unknown }) {
    const inserted = await this.database`with current_run as (
      select id from report_generation_runs where id=${runId} and attempt_id=${attemptId} and status='PROCESSING' and lease_expires_at>clock_timestamp() for update
    ) insert into report_trace_events (id,run_id,attempt_id,stage,payload,expires_at)
      select ${createEntityId()},id,${attemptId},${input.stage},${this.database.json(input.payload as never)},clock_timestamp()+${REPORT_TRACE_RETENTION_MS}*interval '1 millisecond' from current_run returning id`;
    return inserted.length > 0;
  }
  async read(runId: string): Promise<ReportTrace | null> {
    const [run] = await this.database<ReportTrace["run"][]>`select id,client_id as "clientId",deployment_id as "deploymentId",prompt_version as "promptVersion",schema_version as "schemaVersion",status,created_at::text as "createdAt" from report_generation_runs where id=${runId}`;
    if (!run) return null;
    const [calls, events] = await Promise.all([
      this.database<ReportTraceCall[]>`select id,attempt_id as "attemptId",sequence,step,system_prompt as system,user_prompt as "user",response_schema as schema,response,usage,error_code as "errorCode",created_at::text as "createdAt",completed_at::text as "completedAt",expires_at::text as "expiresAt" from report_trace_calls where run_id=${runId} and expires_at>clock_timestamp() order by attempt_id,sequence,id`,
      this.database<ReportTraceEvent[]>`select id,attempt_id as "attemptId",stage,payload,created_at::text as "createdAt",expires_at::text as "expiresAt" from report_trace_events where run_id=${runId} and expires_at>clock_timestamp() order by created_at,id`,
    ]);
    return { run: metadata(run), retentionDays: 30, calls: [...calls], events: [...events] };
  }
  async pruneExpired() {
    // Bounded batches avoid long startup/hourly cleanup transactions.
    await this.database`delete from report_trace_calls where id in (select id from report_trace_calls where expires_at<=clock_timestamp() order by expires_at limit 1000)`;
    await this.database`delete from report_trace_events where id in (select id from report_trace_events where expires_at<=clock_timestamp() order by expires_at limit 1000)`;
  }
}
