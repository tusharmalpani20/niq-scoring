import { reportFaceScanStatus } from "./face-scan-status-report";
import type postgres from "postgres";
import { createHash } from "node:crypto";
import type { FaceScanCreate, FaceScanContext, FaceScanSignal, FaceScanResult, FaceScanState } from "@niq-scoring/contracts/face-scan-session";
import { faceScanScoringConfigSchema, type FaceScanScoringConfig } from "@niq-scoring/contracts/face-scan-scoring";
import { calculateFaceScanScore } from "@niq-scoring/scoring-engine/face-scan-scoring";
import { encryptActivationToken, decryptActivationToken } from "./lib/activation-secret";
import { ruleChecksum } from "./rule-routes";
import { createEntityId } from "./lib/id";
import type { DeploymentIdentity } from "./store";
import type { CarePlixProvider } from "./careplix-provider";
import { allowlistedFaceScanReceipt } from "./face-scan-receipt";
import { CarePlixResponseError, CarePlixUnprocessableResultError, normalizeCarePlixResult } from "./careplix-provider";

type Database = ReturnType<typeof postgres>;
type Mapping = { ruleVersionId: string; checksum: string; assignmentId: string; configuration: FaceScanScoringConfig };
type Row = {
 session_id: string; usage_id: string; deployment_id: string; organization_reference: string; assessment_reference: string;
 request_fingerprint: string; context_ciphertext: string; state: FaceScanState; provider_account: string; provider_scan_id: string | null;
 token_ciphertext: string | null; signal_ciphertext: string | null; signal_checksum: string | null; mapping: Mapping | null;
 result: FaceScanResult | null; score: ReturnType<typeof calculateFaceScanScore> | null; dispatch_phase: string | null;
 failure_code: string | null; created_at: Date; updated_at: Date; completed_at: Date | null; capture_expires_at: Date; fence: string | null;
};
export class FaceScanError extends Error { constructor(public code: string, public status: 400 | 403 | 404 | 408 | 409 | 413 | 503 = 409) { super(code); } }
export const faceScanHash = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex");
const semanticHash = (result: FaceScanResult) => { const { providerCompletedAt: _timestamp, ...fields } = result; return ruleChecksum(fields); };
// Keep the pinned scoring bands in the durable record, but expose only the outcome to consumers.
export function publicFaceScanScore(score: Row["score"]) {
 if (!score) return null;
 return { status: score.status, points: score.points, ruleVersionId: score.ruleVersionId,
   wellnessScore: score.wellnessScore, scoringVersion: score.scoringVersion };
}
export class FaceScanWorkflow {
 constructor(private sql: Database, private options: { enabled: () => boolean; encryptionKey: string; providerAccount: string; retentionHours: number; minDispatchIntervalMs?: number; provider: CarePlixProvider }) {}
 private encrypt(value: unknown) { return encryptActivationToken(JSON.stringify(value), this.options.encryptionKey); }
 private decrypt<T>(value: string): T { return JSON.parse(decryptActivationToken(value, this.options.encryptionKey)) as T; }
 private envelope(row: Row) {
   return { session: { id: row.session_id, state: row.state, assessmentReference: row.assessment_reference, organizationReference: row.organization_reference,
     context: this.decrypt<FaceScanContext>(row.context_ciphertext), createdAt: row.created_at.toISOString(), updatedAt: row.updated_at.toISOString(),
     completedAt: row.completed_at?.toISOString() ?? null, failureCode: row.failure_code, result: row.result, score: publicFaceScanScore(row.score),
   }, providerConfigured: true };
 }
 private async scoped(identity: DeploymentIdentity, id: string, organization: string): Promise<Row> {
   const [row] = await this.sql<Row[]>`select w.* from face_scan_workflows w join face_scan_sessions s on s.id=w.session_id
     where w.session_id=${id} and w.organization_reference=${organization} and s.deployment_id=${identity.deploymentId} and s.client_id=${identity.clientId}`;
   if (!row) throw new FaceScanError("NOT_FOUND", 404); return row;
 }
 async get(identity: DeploymentIdentity, id: string, organization: string) { return this.envelope(await this.scoped(identity, id, organization)); }
 async create(identity: DeploymentIdentity, input: FaceScanCreate) {
   if (input.clientId !== identity.clientId) throw new FaceScanError("CLIENT_NOT_ALLOWED", 403);
   const fingerprint = faceScanHash(input);
   const row = await this.sql.begin(async tx => {
     // Serialize this workflow's keys; the entitlement row lock below also coordinates legacy quota reservations.
     await tx`select pg_advisory_xact_lock(hashtext(${`${identity.deploymentId}:FACE_SCAN`}))`;
     const [old] = await tx<Row[]>`select w.* from face_scan_workflows w join face_scan_sessions s on s.id=w.session_id where s.deployment_id=${identity.deploymentId} and s.idempotency_key=${input.idempotencyKey}`;
     if (old) { if (old.request_fingerprint !== fingerprint) throw new FaceScanError("IDEMPOTENCY_CONFLICT"); return old; }
     if (!this.options.enabled()) throw new FaceScanError("FACE_SCAN_DISABLED", 503);
     const [entitlement] = await tx<{ monthly_limit: number | null }[]>`select e.monthly_limit from entitlements e join deployments d on d.id=e.deployment_id join clients c on c.id=d.client_id
       where d.id=${identity.deploymentId} and c.id=${identity.clientId} and c.enabled and d.enabled and e.capability='FACE_SCAN' and e.enabled and e.effective_from<=now() and (e.effective_until is null or e.effective_until>now()) order by e.effective_from desc limit 1 for update of e`;
     if (!entitlement) throw new FaceScanError("CAPABILITY_DISABLED", 403);
     const [active] = await tx`select session_id from face_scan_workflows where deployment_id=${identity.deploymentId} and organization_reference=${input.organizationReference} and assessment_reference=${input.assessmentReference} and state in ('REQUESTED','UPLOAD_ACCEPTED','PROCESSING','RECONCILIATION_REQUIRED','PAUSED')`;
     if (active) throw new FaceScanError("ACTIVE_FACE_SCAN_EXISTS");
     const [usage] = await tx<{ count: number }[]>`select count(*)::integer as count from usage_events where deployment_id=${identity.deploymentId} and capability='FACE_SCAN' and outcome in ('PENDING','SUCCEEDED') and occurred_at>=date_trunc('month',now() at time zone 'UTC') at time zone 'UTC'`;
     if (entitlement.monthly_limit !== null && (usage?.count ?? 0) >= entitlement.monthly_limit) throw new FaceScanError("MONTHLY_LIMIT_REACHED");
     // Only an explicit approved mapping qualifies. Missing mappings never inherit a provisional default.
     const [rule] = await tx<{ id: string; package_checksum: string; assignment_id: string; configuration: unknown }[]>`select r.id,r.package_checksum,a.id as assignment_id,r.definition->'faceScanScoring' as configuration
       from deployment_version_assignments a join scoring_rule_versions r on r.id=case when a.mode='PINNED' then a.scoring_rule_version_id else (select rule_id from scoring_rule_default where singleton=true) end
       where a.deployment_id=${identity.deploymentId} and a.effective_from<=now() and a.effective_until is null and r.lifecycle in ('APPROVED','ACTIVE') and r.clinical_use_permitted=true limit 1`;
     const config = faceScanScoringConfigSchema.safeParse(rule?.configuration);
     const mapping: Mapping | null = rule && config.success ? { ruleVersionId: rule.id, checksum: rule.package_checksum, assignmentId: rule.assignment_id, configuration: config.data } : null;
     const sessionId = createEntityId(), usageId = createEntityId();
     await tx`insert into usage_events(id,client_id,deployment_id,credential_id,capability,scoring_rule_version_id,request_id,idempotency_key,assessment_reference,outcome,request_fingerprint)
       values(${usageId},${identity.clientId},${identity.deploymentId},${identity.credentialId},'FACE_SCAN',${mapping?.ruleVersionId ?? null},${sessionId},${input.idempotencyKey},${input.assessmentReference},'PENDING',${fingerprint})`;
     await tx`insert into face_scan_sessions(id,client_id,deployment_id,assessment_reference,provider,idempotency_key) values(${sessionId},${identity.clientId},${identity.deploymentId},${input.assessmentReference},'careplix',${input.idempotencyKey})`;
     const [created] = await tx<Row[]>`insert into face_scan_workflows(session_id,usage_id,deployment_id,organization_reference,assessment_reference,request_fingerprint,context_ciphertext,provider_account,mapping,capture_expires_at)
       values(${sessionId},${usageId},${identity.deploymentId},${input.organizationReference},${input.assessmentReference},${fingerprint},${this.encrypt(input.context)},${this.options.providerAccount},${tx.json(mapping)},now()+${this.options.retentionHours}*interval '1 hour') returning *`;
     return created!;
   });
   return this.envelope(row);
 }
 async upload(identity: DeploymentIdentity, id: string, organization: string, signal: FaceScanSignal) {
   await this.scoped(identity, id, organization);
   const checksum = faceScanHash(signal), ciphertext = this.encrypt(signal);
   await this.sql.begin(async tx => {
     const [row] = await tx<Row[]>`select * from face_scan_workflows where session_id=${id} for update`;
     if (!row) throw new FaceScanError("NOT_FOUND", 404);
     if (row.signal_checksum) { if (row.signal_checksum !== checksum) throw new FaceScanError("SIGNAL_CONFLICT"); return; }
     if (!this.options.enabled()) throw new FaceScanError("FACE_SCAN_DISABLED", 503);
     if (row.state !== "REQUESTED" || row.capture_expires_at <= new Date()) throw new FaceScanError("CAPTURE_NOT_ALLOWED");
     await tx`update face_scan_workflows set signal_ciphertext=${ciphertext},signal_checksum=${checksum},signal_bytes=${Buffer.byteLength(JSON.stringify(signal))},state='UPLOAD_ACCEPTED',updated_at=now() where session_id=${id}`;
   });
   return this.get(identity, id, organization);
 }
 async cancel(identity: DeploymentIdentity, id: string, organization: string) {
   await this.scoped(identity, id, organization);
   await this.sql.begin(async tx => {
     const [row] = await tx<Row[]>`select * from face_scan_workflows where session_id=${id} for update`;
     if (row?.state === "CANCELLED") return;
     if (!row || !["REQUESTED","UPLOAD_ACCEPTED","PAUSED"].includes(row.state) || row.dispatch_phase) throw new FaceScanError("CANCELLATION_NOT_ALLOWED");
     await tx`update face_scan_workflows set state='CANCELLED',signal_ciphertext=null,updated_at=now() where session_id=${id}`;
     await tx`update usage_events set outcome='FAILED',completed_at=now() where id=${row.usage_id}`;
   });
   return this.get(identity, id, organization);
 }
 /** Local repair uses only the accepted result and pinned mapping; it never reserves or dispatches. */
 async retryScore(identity: DeploymentIdentity, id: string, organization: string) {
   await this.scoped(identity, id, organization);
   const row = await this.sql.begin(async tx => {
     const [stored] = await tx<Row[]>`select * from face_scan_workflows where session_id=${id} for update`;
     if (!stored || stored.state !== "COMPLETED" || !stored.result || !stored.mapping) throw new FaceScanError("SCORING_RETRY_UNAVAILABLE");
     if (stored.score) return stored;
     let score: ReturnType<typeof calculateFaceScanScore>;
     try { score = calculateFaceScanScore({ wellnessScore: stored.result.wellnessScore }, stored.mapping.configuration, stored.mapping.ruleVersionId); }
     catch { throw new FaceScanError("SCORING_RETRY_UNAVAILABLE"); }
     const [updated] = await tx<Row[]>`update face_scan_workflows set score=${tx.json(score)},failure_code=case when failure_code='SCORE_MAPPING_UNAVAILABLE' then null else failure_code end,updated_at=now() where session_id=${id} returning *`;
     return updated!;
   });
   return this.envelope(row);
 }
 /** Durable dispatch intent is never re-leased into another outbound call after a crash. */
 async tick(): Promise<void> {
   await this.sql.begin(async tx => {
     await tx`update face_scan_workflows set state='RECONCILIATION_REQUIRED',failure_code='DISPATCH_INTERRUPTED',updated_at=now() where provider_account=${this.options.providerAccount} and state='PROCESSING' and dispatch_started_at<now()-interval '5 minutes'`;
     // TOKEN intent cannot have sent scan data: SUBMIT is persisted before that call.
     // Terminalizing it also fences out a late token response. Never retry dispatch automatically.
     const recoverable = await tx<{ usage_id: string }[]>`update face_scan_workflows
       set state='FAILED',failure_code='SCAN_NOT_SUBMITTED',signal_ciphertext=null,token_ciphertext=null,updated_at=now()
       where provider_account=${this.options.providerAccount} and state='RECONCILIATION_REQUIRED'
         and dispatch_phase='TOKEN' and result is null
         and failure_code in ('PROVIDER_OUTCOME_UNCONFIRMED','DISPATCH_INTERRUPTED')
       returning usage_id`;
     for (const item of recoverable) await tx`update usage_events set outcome='FAILED',completed_at=now() where id=${item.usage_id}`;
     const expired = await tx<{ usage_id: string }[]>`update face_scan_workflows set state='EXPIRED',signal_ciphertext=null,token_ciphertext=null,updated_at=now() where provider_account=${this.options.providerAccount} and state in ('REQUESTED','UPLOAD_ACCEPTED','PAUSED') and capture_expires_at<=now() and dispatch_phase is null returning usage_id`;
     for (const row of expired) await tx`update usage_events set outcome='FAILED',completed_at=now() where id=${row.usage_id}`;
     // Submitted uncertainty retains correlation and accounting evidence, but not raw signals forever.
     await tx`update face_scan_workflows set signal_ciphertext=null,token_ciphertext=null where provider_account=${this.options.providerAccount} and capture_expires_at<=now() and (signal_ciphertext is not null or token_ciphertext is not null)`;
   });
   if (!this.options.enabled()) {
     await this.sql`update face_scan_workflows set state='PAUSED',failure_code='FACE_SCAN_DISABLED',updated_at=now() where provider_account=${this.options.providerAccount} and state='UPLOAD_ACCEPTED'`;
     return;
   }
   const fence = crypto.randomUUID();
   const row = await this.sql.begin(async tx => {
     await tx`select pg_advisory_xact_lock(hashtext(${`face-scan-dispatch:${this.options.providerAccount}`}))`;
     const [busy] = await tx`select session_id from face_scan_workflows where provider_account=${this.options.providerAccount} and state='PROCESSING' limit 1`;
     if (busy) return null;
     const [rateLimited] = await tx`select session_id from face_scan_workflows where provider_account=${this.options.providerAccount} and dispatch_started_at>now()-${this.options.minDispatchIntervalMs ?? 5000}*interval '1 millisecond' limit 1`;
     if (rateLimited) return null;
     await tx`update face_scan_workflows w set state='PAUSED',failure_code='CAPABILITY_DISABLED',updated_at=now()
       where w.provider_account=${this.options.providerAccount} and w.state='UPLOAD_ACCEPTED' and not exists(
         select 1 from entitlements e join deployments d on d.id=e.deployment_id join clients c on c.id=d.client_id where d.id=w.deployment_id and d.enabled and c.enabled and e.capability='FACE_SCAN' and e.enabled and e.effective_from<=now() and (e.effective_until is null or e.effective_until>now()))`;
     const [candidate] = await tx<Row[]>`select w.* from face_scan_workflows w where w.provider_account=${this.options.providerAccount} and w.state in ('UPLOAD_ACCEPTED','PAUSED') and w.dispatch_phase is null and w.signal_ciphertext is not null and w.capture_expires_at>clock_timestamp() and exists(select 1 from entitlements e join deployments d on d.id=e.deployment_id join clients c on c.id=d.client_id where d.id=w.deployment_id and d.enabled and c.enabled and e.capability='FACE_SCAN' and e.enabled and e.effective_from<=now() and (e.effective_until is null or e.effective_until>now())) order by w.created_at for update skip locked limit 1`;
     if (!candidate) return null;
     const [allowed] = await tx`select e.id from entitlements e join deployments d on d.id=e.deployment_id join clients c on c.id=d.client_id where d.id=${candidate.deployment_id} and d.enabled and c.enabled and e.capability='FACE_SCAN' and e.enabled and e.effective_from<=now() and (e.effective_until is null or e.effective_until>now())`;
     if (!allowed) { await tx`update face_scan_workflows set state='PAUSED',failure_code='CAPABILITY_DISABLED',updated_at=now() where session_id=${candidate.session_id}`; return null; }
     await tx`update face_scan_workflows set state='PROCESSING',dispatch_phase='TOKEN',dispatch_started_at=now(),fence=${fence},failure_code=null,updated_at=now() where session_id=${candidate.session_id}`;
     return candidate;
   });
   if (!row) return;
   let statusContext: FaceScanContext | null = null;
   let statusToken: string | null = null;
   let submissionReturned = false;
   let signal: FaceScanSignal | null = null;
   try {
     const context = this.decrypt<FaceScanContext>(row.context_ciphertext);
     signal = this.decrypt<FaceScanSignal>(row.signal_ciphertext!);
     const token = await this.options.provider.createToken(context);
     statusContext = context; statusToken = token.token;
     const saved = await this.sql`update face_scan_workflows set provider_scan_id=${token.scanId},token_ciphertext=case when capture_expires_at>clock_timestamp() then ${this.encrypt(token.token)} else null end,updated_at=now() where session_id=${row.session_id} and fence=${fence} and state in ('PROCESSING','RECONCILIATION_REQUIRED') returning session_id`;
     if (!saved.length) return;
     // Stop between token and submission if the gate changed. No automatic token recreation.
     if (!this.options.enabled()) throw new FaceScanError("DISPATCH_PAUSED_AFTER_TOKEN");
     const submitted = await this.sql`update face_scan_workflows w set dispatch_phase='SUBMIT',dispatch_started_at=now()
       where w.session_id=${row.session_id} and w.fence=${fence} and w.state='PROCESSING'
         and w.signal_ciphertext is not null and w.capture_expires_at>clock_timestamp()
         and exists(select 1 from entitlements e join deployments d on d.id=e.deployment_id join clients c on c.id=d.client_id
           where d.id=w.deployment_id and d.enabled and c.enabled and e.capability='FACE_SCAN' and e.enabled and e.effective_from<=now() and (e.effective_until is null or e.effective_until>now()))
       returning session_id`;
     if (!submitted.length) throw new FaceScanError("SUBMISSION_NO_LONGER_ALLOWED");
     if (!this.options.enabled()) throw new FaceScanError("DISPATCH_PAUSED_AFTER_TOKEN");
     const result = await this.options.provider.submit(context, signal, token.token, token.scanId, receipt => this.retainReceipt(row.session_id, "DIRECT", receipt));
     submissionReturned = true;
     await this.receive(row.session_id, "DIRECT", result);
   } catch (error) {
     if (error instanceof CarePlixResponseError && error.diagnostic) {
       const diagnostic = error.diagnostic;
       await this.sql`insert into face_scan_receipts(id,session_id,channel,payload_hash,normalized_result,disposition,receipt_ciphertext)
         values(${createEntityId()},${row.session_id},'DIRECT',${faceScanHash(diagnostic)},null,'UNPROCESSABLE',${this.encrypt(diagnostic)})
         on conflict(session_id,channel,payload_hash) do nothing`;
     }
     if (error instanceof CarePlixUnprocessableResultError) await this.receive(row.session_id, "DIRECT", null, faceScanHash(error.receipt), error.receipt);
     await this.sql.begin(async tx => {
       const failed = await tx<{ usage_id: string }[]>`update face_scan_workflows
         set state='FAILED',failure_code='SCAN_NOT_SUBMITTED',signal_ciphertext=null,token_ciphertext=null,updated_at=now()
         where session_id=${row.session_id} and fence=${fence} and state='PROCESSING' and dispatch_phase='TOKEN' returning usage_id`;
       for (const item of failed) await tx`update usage_events set outcome='FAILED',completed_at=now() where id=${item.usage_id}`;
       // A confirmed device rejection permits a fresh manual attempt. Keep its usage reservation
       // because the provider has not confirmed whether rejected submissions consume allowance.
       const deviceRejected = error instanceof CarePlixResponseError &&
         error.diagnostic?.stage === "/vitals/add-scan" && error.diagnostic.failure === "PROVIDER_REJECTION" &&
         error.diagnostic.message === "Device is invalid.";
       const failureCode = error instanceof CarePlixResponseError && error.diagnostic?.failure === "PROVIDER_REJECTION"
         ? deviceRejected ? "DEVICE_NOT_SUPPORTED" : "PROVIDER_REJECTED" : "PROVIDER_OUTCOME_UNCONFIRMED";
       await tx`update face_scan_workflows set state=${deviceRejected ? 'FAILED' : 'RECONCILIATION_REQUIRED'},failure_code=${failureCode},updated_at=now()
         where session_id=${row.session_id} and fence=${fence} and state='PROCESSING' and dispatch_phase='SUBMIT'`;
     });
   } finally {
     // No token means there is nothing valid to report. Never invent one or recreate it for telemetry.
     if (statusContext && statusToken && this.options.enabled()) {
       try {
         await reportFaceScanStatus(this.sql, this.options.provider, this.options.encryptionKey,
           row.session_id, statusContext.employeeId, statusToken,
           submissionReturned
             ? { fireType: "on_success", reason: "Scan result received", device: signal?.device }
             : { fireType: "on_error", reason: "Scan request did not complete normally", errorCode: "SCAN_REQUEST_ERROR", device: signal?.device });
       } catch { /* Telemetry persistence/delivery must never replace or fail the scan result. */ }
     }
   }
 }
 async retainReceipt(id: string, channel: "DIRECT" | "WEBHOOK", receipt: unknown) {
   const clean = allowlistedFaceScanReceipt(receipt as object);
   await this.sql`insert into face_scan_receipts(id,session_id,channel,payload_hash,normalized_result,disposition,receipt_ciphertext)
     values(${createEntityId()},${id},${channel},${faceScanHash({ originalResponse: clean })},null,'RECEIVED',${this.encrypt(clean)})
     on conflict(session_id,channel,payload_hash) do nothing`;
 }
 async receive(id: string, channel: "DIRECT" | "WEBHOOK", result: FaceScanResult | null, invalidHash?: string, receipt?: unknown) {
   const hash = invalidHash ?? (result ? semanticHash(result) : faceScanHash(null));
   await this.sql.begin(async tx => {
     const [row] = await tx<Row[]>`select * from face_scan_workflows where session_id=${id} for update`;
     if (!row) throw new FaceScanError("UNKNOWN_PROVIDER_SCAN", 404);
     const disposition = !result ? "UNPROCESSABLE" : row.result ? semanticHash(row.result) === hash ? "DUPLICATE" : "CONFLICT" : "ACCEPTED";
     await tx`insert into face_scan_receipts(id,session_id,channel,payload_hash,normalized_result,disposition,receipt_ciphertext) values(${createEntityId()},${id},${channel},${hash},${tx.json(result)},${disposition},${receipt ? this.encrypt(receipt) : null}) on conflict(session_id,channel,payload_hash) do nothing`;
     if (disposition === "DUPLICATE") {
       // Replayed trusted evidence can repair only local scoring, using the original mapping.
       if (!row.score && row.mapping && row.result) {
         let score: ReturnType<typeof calculateFaceScanScore> | null = null;
         try { score = calculateFaceScanScore({ wellnessScore: row.result.wellnessScore }, row.mapping.configuration, row.mapping.ruleVersionId); } catch { /* Leave the durable scoring failure available for explicit repair. */ }
         if (score) await tx`update face_scan_workflows set score=${tx.json(score)},failure_code=case when failure_code='SCORE_MAPPING_UNAVAILABLE' then null else failure_code end,updated_at=now() where session_id=${id}`;
       }
       return;
     }
     if (disposition !== "ACCEPTED") {
       // A bad later receipt is diagnostic evidence, not a new outcome for a
       // completed or otherwise terminal scan.
       if (row.result || ["COMPLETED", "CANCELLED", "EXPIRED", "FAILED"].includes(row.state)) return;
       await tx`update face_scan_workflows set state=case when result is null then 'RECONCILIATION_REQUIRED' else state end,failure_code=${disposition === "CONFLICT" ? "RESULT_CONFLICT" : "INVALID_PROVIDER_RESULT"},updated_at=now() where session_id=${id}`;
       return;
     }
     let score: ReturnType<typeof calculateFaceScanScore> | null = null;
     let scoringFailure: string | null = null;
     try { if (row.mapping) score = calculateFaceScanScore({ wellnessScore: result!.wellnessScore }, row.mapping.configuration, row.mapping.ruleVersionId); }
     catch { scoringFailure = "SCORE_MAPPING_UNAVAILABLE"; } // Trusted provider evidence must survive optional scoring failure.
     await tx`update face_scan_workflows set state='COMPLETED',result=${tx.json(result)},score=${tx.json(score)},signal_ciphertext=null,token_ciphertext=null,completed_at=now(),updated_at=now(),failure_code=${scoringFailure} where session_id=${id}`;
     await tx`update face_scan_sessions set state='COMPLETED',provider_session_reference=${row.provider_scan_id},completed_at=now(),updated_at=now() where id=${id}`;
     await tx`update usage_events set outcome='SUCCEEDED',billable=true,completed_at=now() where id=${row.usage_id}`;
   });
 }
 async metrics() {
   const [counts] = await this.sql`select count(*) filter(where state in ('UPLOAD_ACCEPTED','PAUSED'))::integer as backlog,
     count(*) filter(where state='RECONCILIATION_REQUIRED')::integer as reconciliation_required,
     coalesce(extract(epoch from now()-min(created_at) filter(where state in ('UPLOAD_ACCEPTED','PAUSED'))),0)::integer as oldest_pending_seconds from face_scan_workflows where provider_account=${this.options.providerAccount}`;
   const [receipts] = await this.sql`select count(*) filter(where disposition='UNPROCESSABLE')::integer as invalid_receipts,
     count(*) filter(where disposition='CONFLICT')::integer as conflicting_receipts from face_scan_receipts r join face_scan_workflows w on w.session_id=r.session_id where w.provider_account=${this.options.providerAccount}`;
   return { ...counts, ...receipts };
 }
 async webhook(body: unknown) {
   if (!body || typeof body !== "object" || !("scan_id" in body) || typeof body.scan_id !== "string") throw new FaceScanError("INVALID_WEBHOOK", 400);
   const [row] = await this.sql<Row[]>`select * from face_scan_workflows where provider_account=${this.options.providerAccount} and provider_scan_id=${body.scan_id}`;
   if (!row) throw new FaceScanError("UNKNOWN_PROVIDER_SCAN", 404);
   await this.retainReceipt(row.session_id, "WEBHOOK", body);
   let result: FaceScanResult | null = null;
   try {
     const event = (body as Record<string, unknown>).event_data;
     if (!event || typeof event !== "object" || !("event_key" in event) || event.event_key !== "scan_completion") throw new Error("INVALID_EVENT");
     result = normalizeCarePlixResult({ ...event, scan_completion_time: (event as Record<string, unknown>).scan_completion_time ?? (body as Record<string, unknown>).scan_completion_time }, row.provider_scan_id!);
   } catch { /* Persist an allowlisted receipt hash; no API keys or raw body retention. */ }
   await this.receive(row.session_id, "WEBHOOK", result, result ? undefined : faceScanHash(body), allowlistedFaceScanReceipt(body));
 }
}
