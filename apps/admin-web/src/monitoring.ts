import * as Sentry from "@sentry/react";
import { sanitizeMonitoringEvent } from "@niq/monitoring";

export function initializeMonitoring(env: Record<string, string | undefined> = import.meta.env,
  transport?: NonNullable<Parameters<typeof Sentry.init>[0]>["transport"]) {
  if (!env.VITE_SENTRY_DSN || env.MODE === "test") return;
  try { Sentry.init({
    ...(transport ? { transport } : {}),
    dsn: env.VITE_SENTRY_DSN,
    environment: env.VITE_SENTRY_ENVIRONMENT || env.MODE,
    release: env.VITE_SENTRY_RELEASE,
    defaultIntegrations: false,
    dataCollection: { userInfo: false, cookies: false, httpHeaders: false, httpBodies: [],
      urlQueryParams: false, genAI: { inputs: false, outputs: false }, mcp: { inputs: false, outputs: false },
      databaseQueryData: false, queues: false, stackFrameVariables: false, frameContextLines: 0 },
    integrations: [Sentry.globalHandlersIntegration()],
    traceLifecycle: "static", tracesSampleRate: 0, tracePropagationTargets: [], sendClientReports: false, maxBreadcrumbs: 0, beforeSendLog: () => null, beforeSendTransaction: () => null,
    beforeSend: sanitizeMonitoringEvent,
  }); } catch { console.warn("Error monitoring is unavailable. Check its configuration."); }
}

export function captureReactError(error: unknown) {
  if (!Sentry.isInitialized()) return;
  Sentry.withScope(scope => {
    scope.setTag("operation", "browser_error");
    Sentry.captureException(error);
  });
}
