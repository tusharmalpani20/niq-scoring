import { FaceScanWorkflow } from "./face-scan-workflow";
import { HttpCarePlixProvider } from "./careplix-provider";
import { parseEnvironment } from "@niq-scoring/config";
import postgres from "postgres";
import { PostgresAdminAuthStore } from "./admin-auth-store";
import { createApp } from "./app";
import { PostgresScoringStore } from "./postgres-store";
import { createFaceScanAdapter } from "./face-scan";

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
const app = createApp({
  ...(workflow ? { faceScanWorkflow: workflow } : {}),
  faceScanWebhookConfirmed: environment.FACE_SCAN_WEBHOOK_BEARER_CONFIRMED,
  ...(environment.FACE_SCAN_WEBHOOK_SECRET ? { faceScanWebhookSecret: environment.FACE_SCAN_WEBHOOK_SECRET } : {}),
  store: new PostgresScoringStore(database),
  authStore: new PostgresAdminAuthStore(database),
  ...(environment.ADMIN_BOOTSTRAP_TOKEN ? { adminBootstrapToken: environment.ADMIN_BOOTSTRAP_TOKEN } : {}),
  allowedOrigins: environment.CORS_ALLOWED_ORIGINS.split(",").map((origin) => origin.trim()),
  region: environment.DEPLOYMENT_REGION,
  ...(environment.ACTIVATION_TOKEN_ENCRYPTION_KEY ? { activationTokenEncryptionKey: environment.ACTIVATION_TOKEN_ENCRYPTION_KEY } : {}),
  runtimeEnvironment: environment.NODE_ENV,
  provisionalScoringRequested: environment.ENABLE_PROVISIONAL_SCORING,
  platformEnabled: environment.SCORING_PLATFORM_ENABLED,
  faceScanAdapter: createFaceScanAdapter(environment.FACE_SCAN_PROVIDER),
  readinessCheck: async () => {
    try {
      const [result] = await database<{ schemaReady: boolean }[]>`
        select to_regclass('public.scoring_rule_versions') is not null
          and to_regclass('public.audit_events') is not null
          and to_regclass('public.admin_users') is not null
          and to_regclass('public.admin_invitations') is not null
          and to_regclass('public.admin_sessions') is not null
          and to_regclass('public.admin_auth_attempts') is not null as "schemaReady"
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

console.info(JSON.stringify({ event: "service_started", service: "niq-scoring-api", port: environment.PORT, region: environment.DEPLOYMENT_REGION }));

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
