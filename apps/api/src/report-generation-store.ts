import postgres from "postgres";
import { createEntityId } from "./lib/id";

export type ReportCall = {
  step: "writer" | "reviewer" | "revision";
  status: "SUCCEEDED" | "FAILED";
  model: string;
  provider: string | null;
  generationId: string | null;
  promptTokens: number | null;
  completionTokens: number | null;
  reasoningTokens: number | null;
  costUsd: number | null;
  latencyMs: number;
  errorCode: string | null;
};

export type ReportRun = {
  id: string;
  clientId: string;
  deploymentId: string;
  assessmentReference: string;
  resultReference: string;
  ruleVersionId: string;
  checksum: string;
  idempotencyKey: string;
  fingerprint: string;
  model: string;
  promptVersion: string;
  schemaVersion: number;
  status: "PROCESSING" | "READY" | "REVIEW_REQUIRED" | "FAILED";
  response: unknown | null;
  errorCode: string | null;
  createdAt: string;
  completedAt: string | null;
};

export type ReportRunReservation =
  | { status: "NEW"; run: ReportRun }
  | { status: "DUPLICATE"; run: ReportRun }
  | { status: "CONFLICT" | "IN_PROGRESS" };

export type NewReportRun = Omit<ReportRun, "id" | "status" | "response" | "errorCode" | "createdAt" | "completedAt">;
export type ReportRunSummary = Pick<ReportRun, "id" | "clientId" | "deploymentId" | "ruleVersionId" | "checksum" | "model" | "promptVersion" | "schemaVersion" | "status" | "errorCode" | "createdAt" | "completedAt"> & { calls: ReportCall[] };
export type ReportRunPage = { items: ReportRunSummary[]; total: number; page: number; pageSize: number };

export interface ReportGenerationStore {
  reserve(input: NewReportRun): Promise<ReportRunReservation>;
  appendCall(runId: string, call: ReportCall): Promise<void>;
  finish(runId: string, status: "READY" | "REVIEW_REQUIRED" | "FAILED", response: unknown | null, errorCode?: string): Promise<void>;
  list(input: { page: number; pageSize: number; clientId?: string }): Promise<ReportRunPage>;
}

export class MemoryReportGenerationStore implements ReportGenerationStore {
  runs: ReportRun[] = [];
  calls: Array<{ runId: string; call: ReportCall }> = [];
  async reserve(input: NewReportRun): Promise<ReportRunReservation> {
    const prior = this.runs.find(row => row.deploymentId === input.deploymentId && row.idempotencyKey === input.idempotencyKey);
    if (prior) {
      if (prior.fingerprint !== input.fingerprint) return { status: "CONFLICT" };
      if (prior.status === "PROCESSING") return { status: "IN_PROGRESS" };
      if (prior.response !== null) return { status: "DUPLICATE", run: prior };
      prior.status = "PROCESSING";
      prior.errorCode = null;
      return { status: "NEW", run: prior };
    }
    const run: ReportRun = { ...input, id: createEntityId(), status: "PROCESSING", response: null, errorCode: null, createdAt: new Date().toISOString(), completedAt: null };
    this.runs.push(run);
    return { status: "NEW", run };
  }
  async appendCall(runId: string, call: ReportCall) { this.calls.push({ runId, call }); }
  async finish(runId: string, status: ReportRun["status"], response: unknown | null, errorCode?: string) {
    const run = this.runs.find(row => row.id === runId);
    if (!run) throw new Error("REPORT_RUN_NOT_FOUND");
    run.status = status;
    run.response = response;
    run.errorCode = errorCode ?? null;
    run.completedAt = new Date().toISOString();
  }
  async list({ page, pageSize, clientId }: { page: number; pageSize: number; clientId?: string }): Promise<ReportRunPage> {
    const filtered = this.runs.filter(row => !clientId || row.clientId === clientId).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    // Report content is intentionally absent from admin usage responses.
    return { items: filtered.slice((page - 1) * pageSize, page * pageSize).map(row => ({ id: row.id, clientId: row.clientId, deploymentId: row.deploymentId, ruleVersionId: row.ruleVersionId, checksum: row.checksum, model: row.model, promptVersion: row.promptVersion, schemaVersion: row.schemaVersion, status: row.status, errorCode: row.errorCode, createdAt: row.createdAt, completedAt: row.completedAt, calls: this.calls.filter(c => c.runId === row.id).map(c => c.call) })), total: filtered.length, page, pageSize };
  }
}

export class PostgresReportGenerationStore implements ReportGenerationStore {
  constructor(private readonly database: ReturnType<typeof postgres>) {}
  async reserve(input: NewReportRun): Promise<ReportRunReservation> {
    return this.database.begin(async tx => {
      await tx`select pg_advisory_xact_lock(hashtext(${`${input.deploymentId}:report:${input.idempotencyKey}`}))`;
      const [prior] = await tx<ReportRun[]>`select id, client_id as "clientId", deployment_id as "deploymentId", assessment_reference as "assessmentReference", result_reference as "resultReference", rule_version_id as "ruleVersionId", checksum, idempotency_key as "idempotencyKey", fingerprint, model, prompt_version as "promptVersion", schema_version as "schemaVersion", status, response, error_code as "errorCode", created_at as "createdAt", completed_at as "completedAt" from report_generation_runs where deployment_id=${input.deploymentId} and idempotency_key=${input.idempotencyKey}`;
      if (prior) {
        if (prior.fingerprint !== input.fingerprint) return { status: "CONFLICT" };
        if (prior.status === "PROCESSING") return { status: "IN_PROGRESS" };
        if (prior.response !== null) return { status: "DUPLICATE", run: prior };
        await tx`update report_generation_runs set status='PROCESSING', error_code=null, completed_at=null where id=${prior.id}`;
        return { status: "NEW", run: { ...prior, status: "PROCESSING" as const } };
      }
      const id = createEntityId();
      await tx`insert into report_generation_runs (id,client_id,deployment_id,assessment_reference,result_reference,rule_version_id,checksum,idempotency_key,fingerprint,model,prompt_version,schema_version,status) values (${id},${input.clientId},${input.deploymentId},${input.assessmentReference},${input.resultReference},${input.ruleVersionId},${input.checksum},${input.idempotencyKey},${input.fingerprint},${input.model},${input.promptVersion},${input.schemaVersion},'PROCESSING')`;
      return { status: "NEW", run: { ...input, id, status: "PROCESSING" as const, response: null, errorCode: null, createdAt: new Date().toISOString(), completedAt: null } };
    });
  }
  async appendCall(runId: string, call: ReportCall) {
    await this.database`insert into report_generation_calls (id,run_id,step,status,model,provider,generation_id,prompt_tokens,completion_tokens,reasoning_tokens,cost_usd,latency_ms,error_code) values (${createEntityId()},${runId},${call.step},${call.status},${call.model},${call.provider},${call.generationId},${call.promptTokens},${call.completionTokens},${call.reasoningTokens},${call.costUsd},${call.latencyMs},${call.errorCode})`;
  }
  async finish(runId: string, status: ReportRun["status"], response: unknown | null, errorCode?: string) {
    await this.database`update report_generation_runs set status=${status},response=${response === null ? null : this.database.json(response as never)},error_code=${errorCode ?? null},completed_at=now() where id=${runId} and status='PROCESSING'`;
  }
  async list({ page, pageSize, clientId }: { page: number; pageSize: number; clientId?: string }): Promise<ReportRunPage> {
    const [count] = await this.database<Array<{ total: number }>>`select count(*)::int as total from report_generation_runs where (${clientId ?? null}::text is null or client_id=${clientId ?? null})`;
    const rows = await this.database<Array<Omit<ReportRunSummary, "calls">>>`select id,client_id as "clientId",deployment_id as "deploymentId",rule_version_id as "ruleVersionId",checksum,model,prompt_version as "promptVersion",schema_version as "schemaVersion",status,error_code as "errorCode",created_at as "createdAt",completed_at as "completedAt" from report_generation_runs where (${clientId ?? null}::text is null or client_id=${clientId ?? null}) order by created_at desc,id desc limit ${pageSize} offset ${(page - 1) * pageSize}`;
    const items = await Promise.all(rows.map(async row => {
      const calls = await this.database<ReportCall[]>`select step,status,model,provider,generation_id as "generationId",prompt_tokens as "promptTokens",completion_tokens as "completionTokens",reasoning_tokens as "reasoningTokens",cost_usd::float8 as "costUsd",latency_ms as "latencyMs",error_code as "errorCode" from report_generation_calls where run_id=${row.id} order by created_at,id`;
      return { ...row, response: null, calls: [...calls] };
    }));
    return { items, total: count?.total ?? 0, page, pageSize };
  }
}
