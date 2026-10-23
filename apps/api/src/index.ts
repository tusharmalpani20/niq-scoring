import { FaceScanWorkflow } from "./face-scan-workflow";
import { HttpCarePlixProvider } from "./careplix-provider";
import { parseEnvironment } from "@niq-scoring/config";
import postgres from "postgres";
import { PostgresAdminAuthStore } from "./admin-auth-store";
import { createApp } from "./app";
import { PostgresScoringStore } from "./postgres-store";
import { createFaceScanAdapter } from "./face-scan";
import { PostgresReportTraceStore } from "./report-trace-store";
import { PostgresReportGenerationStore } from "./report-generation-store";
import { PostgresReportContentJobStore } from "./report-content-job-store";
import { OpenRouterReportClient } from "./openrouter-report-client";
import { CodexProxyReportClient } from "./codex-proxy-report-client";

const environment = parseEnvironment(Bun.env);
const database = postgres(environment.DATABASE_URL, { max: 2, idle_timeout: 10 });
const workflow = environment.FACE_SCAN_ENCRYPTION_KEY && environment.CAREPLIX_ACCOUNT_REFERENCE
  ? new FaceScanWorkflow(database, {
      enabled: () => environment.FACE_SCAN_ENABLED && environment.SCORING_PLATFORM_ENABLED,
      encryptionKey: environment.FACE_SCAN_ENCRYPTION_KEY,
      providerAccount: environment.CAREPLIX_ACCOUNT_REFERENCE,
      retentionHours: environment.FACE_SCAN_RETENTION_HOURS,
      minDispatchIntervalMs: environment.FACE_SCAN_MIN_DISPATCH_INTERVAL_MS,
      provider: new HttpCarePlixProvider({ baseUrl: environment.CAREPLIX_API_BASE_URL ?? "https://disabled.invalid", apiKey: environment.CAREPLIX_API_KEY ?? "", apiSecret: environment.CAREPLIX_API_SECRET ?? "" }),
    }) : undefined;
const reportTraceStore = new PostgresReportTraceStore(database);
let reportJobTick: (() => Promise<void>) | undefined;
const app = createApp({
  ...(workflow ? { faceScanWorkflow: workflow } : {}),
  faceScanWebhookConfirmed: environment.FACE_SCAN_WEBHOOK_BEARER_CONFIRMED,
  ...(environment.FACE_SCAN_WEBHOOK_SECRET ? { faceScanWebhookSecret: environment.FACE_SCAN_WEBHOOK_SECRET } : {}),
  store: new PostgresScoringStore(database),
  reportGenerationStore: new PostgresReportGenerationStore(database),
  reportTraceStore,
  reportContentJobStore: new PostgresReportContentJobStore(database),
  onReportJobTick: tick => { reportJobTick = tick; },
  ...(environment.REPORT_AI_PROVIDER_ENABLED
    ? environment.REPORT_AI_PROVIDER === "codex_proxy"
      ? { reportTextProvider: new CodexProxyReportClient(environment.CODEX_PROXY_BASE_URL, environment.CODEX_PROXY_TOKEN!, environment.CODEX_PROXY_MANAGER_MODEL, environment.CODEX_PROXY_WORKER_MODEL) }
      : environment.OPENROUTER_API_KEY ? { reportTextProvider: new OpenRouterReportClient(environment.OPENROUTER_API_KEY) } : {}
    : {}),
  authStore: new PostgresAdminAuthStore(database),
  ...(environment.ADMIN_BOOTSTRAP_TOKEN ? { adminBootstrapToken: environment.ADMIN_BOOTSTRAP_TOKEN } : {}),
  allowedOrigins: environment.CORS_ALLOWED_ORIGINS.split(",").map((origin) => origin.trim()),
  secureCookies: environment.SECURE_COOKIES || environment.NODE_ENV === "production",
  region: environment.DEPLOYMENT_REGION,
  ...(environment.ACTIVATION_TOKEN_ENCRYPTION_KEY ? { activationTokenEncryptionKey: environment.ACTIVATION_TOKEN_ENCRYPTION_KEY } : {}),
  runtimeEnvironment: environment.NODE_ENV,
  reportDiagnosticsEnabled: environment.REPORT_DIAGNOSTICS_ENABLED,
  provisionalScoringRequested: environment.ENABLE_PROVISIONAL_SCORING,
  platformEnabled: environment.SCORING_PLATFORM_ENABLED,
  faceScanAdapter: createFaceScanAdapter(environment.FACE_SCAN_PROVIDER),
  readinessCheck: async () => {
    try {
      const [result] = await database<{ schemaReady: boolean }[]>`
        select to_regclass('public.scoring_rule_versions') is not null
          and to_regclass('public.audit_events') is not null
          and to_regclass('public.admin_deployment_create_key_uq') is not null
          and to_regclass('public.admin_users') is not null
          and to_regclass('public.admin_invitations') is not null
          and to_regclass('public.admin_sessions') is not null
          and to_regclass('public.admin_auth_attempts') is not null
          and to_regclass('public.report_generation_runs') is not null
          and to_regclass('public.report_generation_calls') is not null
          and to_regclass('public.report_trace_calls') is not null
          and to_regclass('public.report_trace_events') is not null
          and exists(select 1 from information_schema.columns where table_schema='public' and table_name='report_generation_calls' and column_name='cached_input_tokens')
          and exists(select 1 from information_schema.columns where table_schema='public' and table_name='report_generation_calls' and column_name='reasoning_effort')
          and to_regclass('public.report_content_jobs') is not null
          and exists(select 1 from information_schema.columns where table_schema='public' and table_name='report_generation_runs' and column_name='attempt_id')
          and exists(select 1 from information_schema.columns where table_schema='public' and table_name='report_generation_runs' and column_name='lease_expires_at')
          and to_regclass('public.products') is not null
          and (${!workflow} or (to_regclass('public.face_scan_workflows') is not null
            and exists(select 1 from information_schema.columns where table_schema='public' and table_name='face_scan_receipts' and column_name='receipt_ciphertext')
            and exists(select 1 from information_schema.columns where table_schema='public' and table_name='face_scan_workflows' and column_name='status_report_ciphertext'))) as "schemaReady"
      `;
      return result?.schemaReady === true;
    } catch {
      return false;
    }
  },
});

Bun.serve({
  port: environment.PORT,
  fetch: app.fetch,
});

console.info(JSON.stringify({ event: "service_started", service: "niq-scoring-api", port: environment.PORT, region: environment.DEPLOYMENT_REGION, reportAiProvider: environment.REPORT_AI_PROVIDER_ENABLED ? environment.REPORT_AI_PROVIDER : "disabled", reportDiagnosticsEnabled: environment.REPORT_DIAGNOSTICS_ENABLED }));

// One in-flight job per process; database row locks fence multiple service replicas.
let workerRunning = false;
let workerTicks = 0;
if (workflow) setInterval(async () => {
  if (workerRunning) return;
  workerRunning = true;
  try { await workflow.tick(); if (++workerTicks % 12 === 0) console.info(JSON.stringify({ event: "face_scan_worker_metrics", ...await workflow.metrics() })); }
  catch { console.error(JSON.stringify({ event: "face_scan_worker_error" })); }
  finally { workerRunning = false; }
}, 5_000);

let reportWorkerRunning = false;
setInterval(async () => {
  if (reportWorkerRunning || !reportJobTick) return;
  reportWorkerRunning = true;
  try { await reportJobTick(); }
  catch (error) {
    const failure = error as { name?: string; code?: string; message?: string };
    console.error(JSON.stringify({ event: "report_worker_error", name: failure?.name ?? "UnknownError",
      code: failure?.code ?? null, message: failure?.message?.slice(0, 200) ?? "Report worker failed" }));
  }
  finally { reportWorkerRunning = false; }
}, 5_000);

// Expired clinical traces are hidden immediately and physically removed in
// bounded batches. Usage metadata and report records have separate lifetimes.
const pruneReportTraces = async () => {
  try { await reportTraceStore.pruneExpired(); }
  catch { console.error(JSON.stringify({ event: "report_trace_cleanup_failed" })); }
};
void pruneReportTraces();
setInterval(pruneReportTraces, 60 * 60 * 1000);
