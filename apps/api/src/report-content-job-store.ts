import postgres from "postgres";
import { createEntityId } from "./lib/id";
import type { DeploymentIdentity } from "./store";
import type { ReportContentRequest } from "./report-content";

export type ReportContentJob = {
  id: string;
  identity: DeploymentIdentity;
  input: ReportContentRequest;
  fingerprint: string;
  status: "QUEUED" | "PROCESSING" | "READY" | "REVIEW_REQUIRED" | "FAILED";
  response: unknown | null;
  errorCode: string | null;
  attemptId: string | null;
  attempts: number;
  leaseExpiresAt: Date | null;
};

export type JobSubmission = { status: "NEW" | "DUPLICATE"; job: ReportContentJob } | { status: "CONFLICT" };
export interface ReportContentJobStore {
  submit(identity: DeploymentIdentity, input: ReportContentRequest, fingerprint: string): Promise<JobSubmission>;
  get(id: string, identity: DeploymentIdentity): Promise<ReportContentJob | null>;
  claim(): Promise<ReportContentJob | null>;
  renew(id: string, attemptId: string): Promise<boolean>;
  retry(id: string, attemptId: string, errorCode: string): Promise<boolean>;
  finish(id: string, attemptId: string, status: "READY" | "REVIEW_REQUIRED" | "FAILED", response: unknown | null, errorCode?: string): Promise<boolean>;
}

const leaseMs = 30 * 60 * 1000;
const maxAttempts = 3;

export class MemoryReportContentJobStore implements ReportContentJobStore {
  constructor(private readonly now = () => new Date()) {}
  jobs: ReportContentJob[] = [];
  async submit(identity: DeploymentIdentity, input: ReportContentRequest, fingerprint: string): Promise<JobSubmission> {
    const prior = this.jobs.find(job => job.identity.deploymentId === identity.deploymentId && job.input.idempotencyKey === input.idempotencyKey);
    if (prior) return prior.fingerprint === fingerprint ? { status: "DUPLICATE", job: prior } : { status: "CONFLICT" };
    const job: ReportContentJob = { id: createEntityId(), identity, input, fingerprint, status: "QUEUED", response: null,
      errorCode: null, attemptId: null, attempts: 0, leaseExpiresAt: null };
    this.jobs.push(job);
    return { status: "NEW", job };
  }
  async get(id: string, identity: DeploymentIdentity) {
    return this.jobs.find(job => job.id === id && job.identity.deploymentId === identity.deploymentId && job.identity.clientId === identity.clientId) ?? null;
  }
  async claim() {
    const job = this.jobs.find(row => row.status === "QUEUED" && (row.leaseExpiresAt === null || row.leaseExpiresAt <= this.now()) ||
      row.status === "PROCESSING" && row.leaseExpiresAt !== null && row.leaseExpiresAt <= this.now());
    if (!job) return null;
    if (job.attempts >= maxAttempts) { job.status = "FAILED"; job.errorCode = "REPORT_WORKER_ATTEMPTS_EXHAUSTED"; return null; }
    job.status = "PROCESSING";
    job.attemptId = createEntityId();
    job.attempts++;
    job.leaseExpiresAt = new Date(this.now().getTime() + leaseMs);
    return { ...job };
  }
  async retry(id: string, attemptId: string, errorCode: string) {
    const job = this.jobs.find(row => row.id === id);
    if (!job || job.status !== "PROCESSING" || job.attemptId !== attemptId || !job.leaseExpiresAt || job.leaseExpiresAt <= this.now()) return false;
    job.status = job.attempts >= maxAttempts ? "FAILED" : "QUEUED";
    job.errorCode = errorCode;
    job.leaseExpiresAt = job.status === "QUEUED" ? new Date(this.now().getTime() + 30_000 * job.attempts) : null;
    return true;
  }
  async renew(id: string, attemptId: string) {
    const job = this.jobs.find(row => row.id === id);
    if (!job || job.status !== "PROCESSING" || job.attemptId !== attemptId || !job.leaseExpiresAt || job.leaseExpiresAt <= this.now()) return false;
    job.leaseExpiresAt = new Date(this.now().getTime() + leaseMs);
    return true;
  }
  async finish(id: string, attemptId: string, status: "READY" | "REVIEW_REQUIRED" | "FAILED", response: unknown | null, errorCode?: string) {
    const job = this.jobs.find(row => row.id === id);
    if (!job || job.status !== "PROCESSING" || job.attemptId !== attemptId || !job.leaseExpiresAt || job.leaseExpiresAt <= this.now()) return false;
    Object.assign(job, { status, response, errorCode: errorCode ?? null, leaseExpiresAt: null });
    return true;
  }
}

export class PostgresReportContentJobStore implements ReportContentJobStore {
  constructor(private readonly database: ReturnType<typeof postgres>) {}
  private map(row: Record<string, unknown>): ReportContentJob {
    return { id: row.id as string, identity: { credentialId: row.credentialId as string, clientId: row.clientId as string,
      deploymentId: row.deploymentId as string }, input: row.input as ReportContentRequest, fingerprint: row.fingerprint as string,
      status: row.status as ReportContentJob["status"], response: row.response, errorCode: row.errorCode as string | null,
      attemptId: row.attemptId as string | null, attempts: row.attempts as number, leaseExpiresAt: row.leaseExpiresAt as Date | null };
  }
  async submit(identity: DeploymentIdentity, input: ReportContentRequest, fingerprint: string): Promise<JobSubmission> {
    return this.database.begin(async tx => {
      await tx`select pg_advisory_xact_lock(hashtext(${`${identity.deploymentId}:report-job:${input.idempotencyKey}`}))`;
      const [prior] = await tx<Record<string, unknown>[]>`select id, credential_id as "credentialId", client_id as "clientId", deployment_id as "deploymentId", input, fingerprint, status, response, error_code as "errorCode", attempt_id as "attemptId", attempts, lease_expires_at as "leaseExpiresAt" from report_content_jobs where deployment_id=${identity.deploymentId} and idempotency_key=${input.idempotencyKey}`;
      if (prior) return prior.fingerprint === fingerprint ? { status: "DUPLICATE" as const, job: this.map(prior) } : { status: "CONFLICT" as const };
      const id = createEntityId();
      await tx`insert into report_content_jobs (id,credential_id,client_id,deployment_id,idempotency_key,fingerprint,input,status) values (${id},${identity.credentialId},${identity.clientId},${identity.deploymentId},${input.idempotencyKey},${fingerprint},${tx.json(input as never)},'QUEUED')`;
      return { status: "NEW" as const, job: { id, identity, input, fingerprint, status: "QUEUED" as const, response: null, errorCode: null, attemptId: null, attempts: 0, leaseExpiresAt: null } };
    });
  }
  async get(id: string, identity: DeploymentIdentity) {
    const [row] = await this.database<Record<string, unknown>[]>`select id, credential_id as "credentialId", client_id as "clientId", deployment_id as "deploymentId", input, fingerprint, status, response, error_code as "errorCode", attempt_id as "attemptId", attempts, lease_expires_at as "leaseExpiresAt" from report_content_jobs where id=${id} and client_id=${identity.clientId} and deployment_id=${identity.deploymentId}`;
    return row ? this.map(row) : null;
  }
  async claim() {
    const [row] = await this.database<Record<string, unknown>[]>`with candidate as (
      select id from report_content_jobs where (status='QUEUED' and (lease_expires_at is null or lease_expires_at<clock_timestamp())) or (status='PROCESSING' and lease_expires_at<clock_timestamp())
      order by created_at,id for update skip locked limit 1
    ) update report_content_jobs as job set status=case when job.attempts>=${maxAttempts} then 'FAILED' else 'PROCESSING' end,
      error_code=case when job.attempts>=${maxAttempts} then 'REPORT_WORKER_ATTEMPTS_EXHAUSTED' else null end,
      attempt_id=case when job.attempts>=${maxAttempts} then job.attempt_id else ${createEntityId()} end,
      attempts=case when job.attempts>=${maxAttempts} then job.attempts else job.attempts+1 end,
      lease_expires_at=case when job.attempts>=${maxAttempts} then null else clock_timestamp()+${leaseMs}*interval '1 millisecond' end
      from candidate where job.id=candidate.id returning job.id, job.credential_id as "credentialId", job.client_id as "clientId", job.deployment_id as "deploymentId", job.input, job.fingerprint, job.status, job.response, job.error_code as "errorCode", job.attempt_id as "attemptId", job.attempts, job.lease_expires_at as "leaseExpiresAt"`;
    return row?.status === "PROCESSING" ? this.map(row) : null;
  }
  async retry(id: string, attemptId: string, errorCode: string) {
    const updated = await this.database`update report_content_jobs set status=case when attempts>=${maxAttempts} then 'FAILED' else 'QUEUED' end,
      error_code=${errorCode},lease_expires_at=case when attempts>=${maxAttempts} then null else clock_timestamp()+attempts*30000*interval '1 millisecond' end
      where id=${id} and attempt_id=${attemptId} and status='PROCESSING' and lease_expires_at>clock_timestamp() returning id`;
    return updated.length > 0;
  }
  async renew(id: string, attemptId: string) {
    const updated = await this.database`update report_content_jobs set lease_expires_at=clock_timestamp()+${leaseMs}*interval '1 millisecond'
      where id=${id} and attempt_id=${attemptId} and status='PROCESSING' and lease_expires_at>clock_timestamp() returning id`;
    return updated.length > 0;
  }
  async finish(id: string, attemptId: string, status: "READY" | "REVIEW_REQUIRED" | "FAILED", response: unknown | null, errorCode?: string) {
    const updated = await this.database`update report_content_jobs set status=${status},response=${response === null ? null : this.database.json(response as never)},error_code=${errorCode ?? null},lease_expires_at=null where id=${id} and attempt_id=${attemptId} and status='PROCESSING' and lease_expires_at>clock_timestamp() returning id`;
    return updated.length > 0;
  }
}
