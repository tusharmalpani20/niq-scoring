import postgres from "postgres";
import { createEntityId } from "./lib/id";

export const REPORT_RUN_LEASE_MS = 15 * 60 * 1000;

export type ReportCall = {
  step: "manager" | "writer" | "reviewer" | "revision" | "coverage" | "summarizer" | "highlighter";
  status: "SUCCEEDED" | "FAILED";
  model: string;
  provider: string | null;
  generationId: string | null;
  promptTokens: number | null;
  cachedInputTokens?: number | null;
  reasoningEffort?: "medium" | "default" | null;
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
  attemptId: string;
  leaseExpiresAt: Date;
  createdAt: string;
  completedAt: string | null;
};

export type ReportRunReservation =
  | { status: "NEW"; run: ReportRun }
  | { status: "DUPLICATE"; run: ReportRun }
  | { status: "CONFLICT" | "IN_PROGRESS" };

export type NewReportRun = Omit<ReportRun, "id" | "status" | "response" | "errorCode" | "attemptId" | "leaseExpiresAt" | "createdAt" | "completedAt">;
export type ReportRunSummary = Pick<ReportRun, "id" | "clientId" | "deploymentId" | "ruleVersionId" | "checksum" | "model" | "promptVersion" | "schemaVersion" | "status" | "errorCode" | "createdAt" | "completedAt"> & { calls: ReportCall[]; generationMode?: string | null };
export type ReportRunPage = { items: ReportRunSummary[]; total: number; page: number; pageSize: number };

export interface ReportGenerationStore {
  // A matching v1 fingerprint permits an in-flight run to finish across the v2 rollout.
  reserve(input: NewReportRun, legacyFingerprint?: string): Promise<ReportRunReservation>;
  renew(runId: string, attemptId: string): Promise<boolean>;
  appendCall(runId: string, attemptId: string, call: ReportCall): Promise<boolean>;
  finish(runId: string, attemptId: string, status: "READY" | "REVIEW_REQUIRED" | "FAILED", response: unknown | null, errorCode?: string): Promise<boolean>;
  list(input: { page: number; pageSize: number; clientId?: string }): Promise<ReportRunPage>;
}

export class MemoryReportGenerationStore implements ReportGenerationStore {
  constructor(private readonly now = () => new Date()) {}
  runs: ReportRun[] = [];
  calls: Array<{ runId: string; call: ReportCall }> = [];
  isActive(runId: string, attemptId: string) {
    return this.runs.some(run => run.id === runId && run.attemptId === attemptId && run.status === "PROCESSING" && run.leaseExpiresAt > this.now());
  }
  async reserve(input: NewReportRun, legacyFingerprint?: string): Promise<ReportRunReservation> {
    const prior = this.runs.find(row => row.deploymentId === input.deploymentId && row.idempotencyKey === input.idempotencyKey);
    if (prior) {
      const legacy = prior.schemaVersion === 1 && prior.fingerprint === legacyFingerprint;
      if (prior.fingerprint !== input.fingerprint && !legacy) return { status: "CONFLICT" };
      if (prior.status === "PROCESSING" && prior.leaseExpiresAt > this.now()) return { status: "IN_PROGRESS" };
      if (prior.response !== null) return { status: "DUPLICATE", run: prior };
      if (legacy) Object.assign(prior, { fingerprint: input.fingerprint, promptVersion: input.promptVersion, schemaVersion: input.schemaVersion });
      prior.model = input.model;
      prior.status = "PROCESSING";
      prior.attemptId = createEntityId();
      prior.leaseExpiresAt = new Date(this.now().getTime() + REPORT_RUN_LEASE_MS);
      prior.errorCode = null;
      prior.completedAt = null;
      return { status: "NEW", run: { ...prior } };
    }
    const run: ReportRun = { ...input, id: createEntityId(), status: "PROCESSING", response: null, errorCode: null,
      attemptId: createEntityId(), leaseExpiresAt: new Date(this.now().getTime() + REPORT_RUN_LEASE_MS), createdAt: this.now().toISOString(), completedAt: null };
    this.runs.push(run);
    return { status: "NEW", run };
  }
  async appendCall(runId: string, attemptId: string, call: ReportCall) {
    const run = this.runs.find(row => row.id === runId);
    if (!run || run.attemptId !== attemptId || run.status !== "PROCESSING" || run.leaseExpiresAt <= this.now()) return false;
    this.calls.push({ runId, call });
    return true;
  }
  async renew(runId: string, attemptId: string) {
    const run = this.runs.find(row => row.id === runId);
    if (!run || run.attemptId !== attemptId || run.status !== "PROCESSING" || run.leaseExpiresAt <= this.now()) return false;
    run.leaseExpiresAt = new Date(this.now().getTime() + REPORT_RUN_LEASE_MS);
    return true;
  }
  async finish(runId: string, attemptId: string, status: "READY" | "REVIEW_REQUIRED" | "FAILED", response: unknown | null, errorCode?: string) {
    const run = this.runs.find(row => row.id === runId);
    if (!run) throw new Error("REPORT_RUN_NOT_FOUND");
    if (run.attemptId !== attemptId || run.status !== "PROCESSING" || run.leaseExpiresAt <= this.now()) return false;
    run.status = status;
    run.response = response;
    run.errorCode = errorCode ?? null;
    run.completedAt = this.now().toISOString();
    return true;
  }
  async list({ page, pageSize, clientId }: { page: number; pageSize: number; clientId?: string }): Promise<ReportRunPage> {
    const filtered = this.runs.filter(row => !clientId || row.clientId === clientId).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    // Report content is intentionally absent from admin usage responses.
    return { items: filtered.slice((page - 1) * pageSize, page * pageSize).map(row => ({ id: row.id, clientId: row.clientId, deploymentId: row.deploymentId, ruleVersionId: row.ruleVersionId, checksum: row.checksum, model: row.model, promptVersion: row.promptVersion, schemaVersion: row.schemaVersion, generationMode: (row.response as { generationMode?: string } | null)?.generationMode ?? null, status: row.status, errorCode: row.errorCode, createdAt: row.createdAt, completedAt: row.completedAt, calls: this.calls.filter(c => c.runId === row.id).map(c => c.call) })), total: filtered.length, page, pageSize };
  }
}

export class PostgresReportGenerationStore implements ReportGenerationStore {
  constructor(private readonly database: ReturnType<typeof postgres>) {}
  async reserve(input: NewReportRun, legacyFingerprint?: string): Promise<ReportRunReservation> {
    return this.database.begin(async tx => {
      await tx`select pg_advisory_xact_lock(hashtext(${`${input.deploymentId}:report:${input.idempotencyKey}`}))`;
      const [prior] = await tx<(ReportRun & { leaseActive: boolean })[]>`select id, client_id as "clientId", deployment_id as "deploymentId", assessment_reference as "assessmentReference", result_reference as "resultReference", rule_version_id as "ruleVersionId", checksum, idempotency_key as "idempotencyKey", fingerprint, model, prompt_version as "promptVersion", schema_version as "schemaVersion", status, response, error_code as "errorCode", attempt_id as "attemptId", lease_expires_at as "leaseExpiresAt", lease_expires_at > clock_timestamp() as "leaseActive", created_at as "createdAt", completed_at as "completedAt" from report_generation_runs where deployment_id=${input.deploymentId} and idempotency_key=${input.idempotencyKey}`;
      if (prior) {
        const legacy = prior.schemaVersion === 1 && prior.fingerprint === legacyFingerprint;
        if (prior.fingerprint !== input.fingerprint && !legacy) return { status: "CONFLICT" };
        if (prior.status === "PROCESSING" && prior.leaseActive) return { status: "IN_PROGRESS" };
        if (prior.response !== null) return { status: "DUPLICATE", run: prior };
        const attemptId = createEntityId();
        const [updated] = await tx<Array<{ leaseExpiresAt: Date }>>`update report_generation_runs set model=${input.model}, status='PROCESSING', attempt_id=${attemptId}, lease_expires_at=clock_timestamp()+${REPORT_RUN_LEASE_MS}*interval '1 millisecond', response=null, error_code=null, completed_at=null, fingerprint=${input.fingerprint}, prompt_version=${input.promptVersion}, schema_version=${input.schemaVersion} where id=${prior.id} returning lease_expires_at as "leaseExpiresAt"`;
        return { status: "NEW", run: { ...prior, model: input.model, fingerprint: input.fingerprint, promptVersion: input.promptVersion, schemaVersion: input.schemaVersion,
          status: "PROCESSING" as const, response: null, errorCode: null, completedAt: null, attemptId, leaseExpiresAt: updated!.leaseExpiresAt } };
      }
      const id = createEntityId();
      const attemptId = createEntityId();
      const [inserted] = await tx<Array<{ leaseExpiresAt: Date; createdAt: string }>>`insert into report_generation_runs (id,client_id,deployment_id,assessment_reference,result_reference,rule_version_id,checksum,idempotency_key,fingerprint,model,prompt_version,schema_version,status,attempt_id,lease_expires_at) values (${id},${input.clientId},${input.deploymentId},${input.assessmentReference},${input.resultReference},${input.ruleVersionId},${input.checksum},${input.idempotencyKey},${input.fingerprint},${input.model},${input.promptVersion},${input.schemaVersion},'PROCESSING',${attemptId},clock_timestamp()+${REPORT_RUN_LEASE_MS}*interval '1 millisecond') returning lease_expires_at as "leaseExpiresAt", created_at as "createdAt"`;
      return { status: "NEW", run: { ...input, id, status: "PROCESSING" as const, response: null, errorCode: null, attemptId, leaseExpiresAt: inserted!.leaseExpiresAt, createdAt: inserted!.createdAt, completedAt: null } };
    });
  }
  async appendCall(runId: string, attemptId: string, call: ReportCall) {
    const inserted = await this.database`with current_run as (
      select id from report_generation_runs where id=${runId} and attempt_id=${attemptId} and status='PROCESSING' and lease_expires_at>clock_timestamp() for update
    ) insert into report_generation_calls (id,run_id,step,status,model,provider,generation_id,prompt_tokens,cached_input_tokens,reasoning_effort,completion_tokens,reasoning_tokens,cost_usd,latency_ms,error_code) select ${createEntityId()},id,${call.step},${call.status},${call.model},${call.provider},${call.generationId},${call.promptTokens},${call.cachedInputTokens ?? null},${call.reasoningEffort ?? null},${call.completionTokens},${call.reasoningTokens},${call.costUsd},${call.latencyMs},${call.errorCode} from current_run returning id`;
    return inserted.length > 0;
  }
  async renew(runId: string, attemptId: string) {
    const updated = await this.database`update report_generation_runs set lease_expires_at=clock_timestamp()+${REPORT_RUN_LEASE_MS}*interval '1 millisecond'
      where id=${runId} and attempt_id=${attemptId} and status='PROCESSING' and lease_expires_at>clock_timestamp() returning id`;
    return updated.length > 0;
  }
  async finish(runId: string, attemptId: string, status: "READY" | "REVIEW_REQUIRED" | "FAILED", response: unknown | null, errorCode?: string) {
    const updated = await this.database`update report_generation_runs set status=${status},response=${response === null ? null : this.database.json(response as never)},error_code=${errorCode ?? null},completed_at=now() where id=${runId} and attempt_id=${attemptId} and status='PROCESSING' and lease_expires_at>clock_timestamp() returning id`;
    return updated.length > 0;
  }
  async list({ page, pageSize, clientId }: { page: number; pageSize: number; clientId?: string }): Promise<ReportRunPage> {
    const [count] = await this.database<Array<{ total: number }>>`select count(*)::int as total from report_generation_runs where (${clientId ?? null}::text is null or client_id=${clientId ?? null})`;
    const rows = await this.database<Array<Omit<ReportRunSummary, "calls">>>`select id,client_id as "clientId",deployment_id as "deploymentId",rule_version_id as "ruleVersionId",checksum,model,prompt_version as "promptVersion",schema_version as "schemaVersion",status,response->>'generationMode' as "generationMode",error_code as "errorCode",created_at as "createdAt",completed_at as "completedAt" from report_generation_runs where (${clientId ?? null}::text is null or client_id=${clientId ?? null}) order by created_at desc,id desc limit ${pageSize} offset ${(page - 1) * pageSize}`;
    const items = await Promise.all(rows.map(async row => {
      const calls = await this.database<ReportCall[]>`select step,status,model,provider,generation_id as "generationId",prompt_tokens as "promptTokens",cached_input_tokens as "cachedInputTokens",reasoning_effort as "reasoningEffort",completion_tokens as "completionTokens",reasoning_tokens as "reasoningTokens",cost_usd::float8 as "costUsd",latency_ms as "latencyMs",error_code as "errorCode" from report_generation_calls where run_id=${row.id} order by created_at,id`;
      return { ...row, response: null, calls: [...calls] };
    }));
    return { items, total: count?.total ?? 0, page, pageSize };
  }
}
