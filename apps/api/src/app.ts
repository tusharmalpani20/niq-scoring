import { calculateRequestSchema, PROVISIONAL_SCORING_VERSION, PROVISIONAL_VERSION_STATUS } from "@niq-scoring/contracts";
import { calculateProvisionalScore } from "@niq-scoring/scoring-engine";
import { Hono } from "hono";
import { cors } from "hono/cors";
import { secureHeaders } from "hono/secure-headers";

export interface AppOptions {
  apiKey: string;
  allowedOrigins: string[];
  region: string;
  runtimeEnvironment: "development" | "test" | "production";
  provisionalScoringRequested: boolean;
  readinessCheck?: () => Promise<boolean>;
  now?: () => Date;
}

export function createApp(options: AppOptions) {
  const app = new Hono();
  const provisionalScoringEnabled = options.runtimeEnvironment !== "production" && options.provisionalScoringRequested;
  app.use("*", secureHeaders());
  app.use("/v1/*", cors({ origin: options.allowedOrigins }));

  app.get("/health", (context) => context.json({ status: "ok", service: "niq-scoring-api", region: options.region }));
  app.get("/ready", async (context) => {
    const ready = await (options.readinessCheck ?? (async () => true))();
    return context.json({ status: ready ? "ready" : "not_ready" }, ready ? 200 : 503);
  });

  app.use("/v1/*", async (context, next) => {
    const requestId = context.req.header("x-request-id") ?? crypto.randomUUID();
    context.header("x-request-id", requestId);
    const credential = context.req.header("authorization");
    if (credential !== `Bearer ${options.apiKey}`) {
      return context.json({ error: "UNAUTHORIZED", requestId }, 401);
    }
    await next();
  });

  app.get("/v1/metadata", (context) => context.json({
    service: "niq-scoring-api",
    region: options.region,
    provisionalVersion: {
      version: PROVISIONAL_SCORING_VERSION,
      status: PROVISIONAL_VERSION_STATUS,
      clinicalUsePermitted: false,
      calculationEnabled: provisionalScoringEnabled,
    },
    faceScanProvider: { configured: false, mode: "contract-only" },
  }));

  app.post("/v1/provisional/calculate", async (context) => {
    if (!provisionalScoringEnabled) {
      return context.json({ error: "PROVISIONAL_SCORING_DISABLED" }, 503);
    }
    const parsed = calculateRequestSchema.safeParse(await context.req.json().catch(() => null));
    if (!parsed.success) {
      return context.json({ error: "INVALID_REQUEST", issues: parsed.error.issues.map(({ path, message }) => ({ path, message })) }, 400);
    }
    // Database-backed credential, organization entitlement, quota and idempotency checks
    // are deliberately required before exposing this route beyond local development.
    const result = calculateProvisionalScore(parsed.data.input, (options.now ?? (() => new Date()))().toISOString());
    return context.json({ result, idempotencyKey: parsed.data.idempotencyKey });
  });

  app.notFound((context) => context.json({ error: "NOT_FOUND" }, 404));
  app.onError((_error, context) => context.json({ error: "INTERNAL_ERROR" }, 500));
  return app;
}
