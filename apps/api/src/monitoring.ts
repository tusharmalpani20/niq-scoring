import * as Sentry from "@sentry/bun";
import { sanitizeMonitoringEvent, monitoringFailureCode } from "@niq/monitoring";

/** Errors only. No automatic request, database, AI, console, profiling or session collection. */
export function initializeMonitoring(env: Record<string, string | undefined> = process.env,
  transport?: NonNullable<Parameters<typeof Sentry.init>[0]>["transport"]) {
  if (!env.SENTRY_DSN || env.NODE_ENV === "test") return;
  try { Sentry.init({
    ...(transport ? { transport } : {}),
    dsn: env.SENTRY_DSN, environment: env.SENTRY_ENVIRONMENT || env.NODE_ENV || "development",
    release: env.SENTRY_RELEASE, serverName: "niq-scoring-api",
    defaultIntegrations: false,
    dataCollection: { userInfo: false, cookies: false, httpHeaders: false, httpBodies: [],
      urlQueryParams: false, genAI: { inputs: false, outputs: false }, mcp: { inputs: false, outputs: false },
      databaseQueryData: false, queues: false, stackFrameVariables: false, frameContextLines: 0 },
    integrations: [Sentry.onUncaughtExceptionIntegration(), Sentry.onUnhandledRejectionIntegration()],
    traceLifecycle: "static", tracesSampleRate: 0, tracePropagationTargets: [], sendClientReports: false, maxBreadcrumbs: 0, beforeSendLog: () => null, beforeSendTransaction: () => null,
    beforeSend: sanitizeMonitoringEvent,
  }); } catch { console.warn("Error monitoring is unavailable. Check its configuration."); }
}

const lastFailure = new Map<string, number>();

export function captureOperationalFailure(operation: string, error?: unknown) {
  // Explicit failures may be caught and stored by workers rather than reaching the global handler.
  if (!Sentry.isInitialized()) return;
  // A broken worker can tick every five seconds. Bound repeated telemetry per operation.
  const now = Date.now();
  if (now - (lastFailure.get(operation) ?? 0) < 60_000) return;
  lastFailure.set(operation, now);
  try {
    Sentry.withScope(scope => {
      scope.setTag("operation", operation);
      const code = monitoringFailureCode(error);
      if (code) scope.setTag("failure_code", code);
      Sentry.captureException(error instanceof Error ? error : new Error("Operational failure"));
    });
  } catch { /* Monitoring must never interrupt clinical processing. */ }
}
