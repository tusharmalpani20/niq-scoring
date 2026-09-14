import {
  activationExchangeSchema, activationTokenInputSchema, calculateRequestSchema,
   deploymentConfigurationSchema, createDeploymentSchema, createFaceScanSessionSchema,
  createClientSchema, entitlementInputSchema, PROVISIONAL_SCORING_VERSION,
  PROVISIONAL_VERSION_STATUS, ulidSchema, updateEnabledSchema, versionAssignmentInputSchema,
} from "@niq-scoring/contracts";
import { calculateProvisionalScore } from "@niq-scoring/scoring-engine";
import { installAdminAuth } from "./admin-auth";
import { type AdminAuthStore } from "./admin-auth-store";
import { Hono, type Context } from "hono";
import { cors } from "hono/cors";
import { secureHeaders } from "hono/secure-headers";
import { createEntityId } from "./lib/id";
import { StubFaceScanAdapter, type FaceScanAdapter } from "./face-scan";
import type { DeploymentIdentity, ScoringStore } from "./store";

export interface AppOptions {
  store: ScoringStore;
  authStore: AdminAuthStore;
  adminBootstrapToken?: string;
  allowedOrigins: string[];
  region: string;
  runtimeEnvironment: "development" | "test" | "production";
  provisionalScoringRequested: boolean;
  platformEnabled?: boolean;
  faceScanAdapter?: FaceScanAdapter;
  readinessCheck?: () => Promise<boolean>;
  now?: () => Date;
}

async function sha256(value: string): Promise<string> {
  const bytes = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return [...new Uint8Array(bytes)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

function randomSecret(bytes = 32): string {
  return Buffer.from(crypto.getRandomValues(new Uint8Array(bytes))).toString("base64url");
}

const parseJson = (context: Context) => context.req.json().catch(() => null);

export function createApp(options: AppOptions) {
  const app = new Hono();
  const provisionalScoringEnabled = options.runtimeEnvironment !== "production" && options.provisionalScoringRequested;
  const now = options.now ?? (() => new Date());
  const faceScanAdapter: FaceScanAdapter = options.faceScanAdapter ?? new StubFaceScanAdapter();
  app.use("*", secureHeaders());
  app.use("/v1/*", cors({ origin: options.allowedOrigins }));
  app.use("/admin/*", cors({ origin: options.allowedOrigins, credentials: true }));
  app.use("/auth/*", cors({ origin: options.allowedOrigins, credentials: true }));
  app.use("*", async (context, next) => { context.header("x-request-id", context.req.header("x-request-id") ?? crypto.randomUUID()); await next(); });

  installAdminAuth(app, { ...options, authStore: options.authStore });

  const authenticateDeployment = async (context: Context): Promise<DeploymentIdentity | null> => {
    const credential = context.req.header("authorization")?.replace(/^Bearer /, "");
    const match = credential?.match(/^niq_dep_([A-Za-z0-9_-]{8,20})\.([A-Za-z0-9_-]{32,})$/);
    if (!match) return null;
    return options.store.authenticateDeployment(match[1]!, await sha256(credential!));
  };

  app.get("/health", (context) => context.json({ status: "ok", service: "niq-scoring-api", region: options.region }));
  app.get("/ready", async (context) => { const ready = await (options.readinessCheck ?? (async () => true))(); return context.json({ status: ready ? "ready" : "not_ready" }, ready ? 200 : 503); });
  app.get("/admin/overview", async (context) => context.json(await options.store.overview()));

  app.post("/admin/clients", async (context) => {
    const parsed = createClientSchema.safeParse(await parseJson(context));
    return parsed.success ? context.json(await options.store.createClient(parsed.data), 201) : context.json({ error: "INVALID_REQUEST", issues: parsed.error.issues }, 400);
  });
  app.patch("/admin/clients/:id/enabled", async (context) => updateEnabled(context, options.store.setClientEnabled.bind(options.store)));
  async function saveDeploymentConfiguration(context: Context, id: string | null) {
    if (id !== null && !ulidSchema.safeParse(id).success) return context.json({ error: "INVALID_REQUEST" }, 400);
    const parsed = deploymentConfigurationSchema.safeParse(await parseJson(context));
    if (!parsed.success) return context.json({ error: "INVALID_REQUEST", issues: parsed.error.issues }, 400);
    const input = parsed.data;
    const current = await options.store.overview();
    if (!current.clients.some(c => c.id === input.clientId)) return context.json({ error: "CLIENT_NOT_FOUND" }, 404);
    if (id && !current.deployments.some(d => d.id === id && d.clientId === input.clientId)) return context.json({ error: "DEPLOYMENT_NOT_FOUND" }, 404);
    if (current.deployments.some(d => d.id !== id && d.clientId === input.clientId && d.name === input.name)) return context.json({ error: "DEPLOYMENT_NAME_EXISTS" }, 409);
    const policy = input.versionAssignment;
    if (policy.mode === "PINNED" && !current.versions.some(v => v.id === policy.scoringRuleVersionId)) return context.json({ error: "VERSION_NOT_FOUND" }, 400);
    try {
      const saved = await options.store.saveDeploymentConfiguration(id, input);
      return saved ? context.json(saved, id ? 200 : 201) : context.json({ error: "DEPLOYMENT_NOT_FOUND" }, 404);
    } catch (error) {
      if (typeof error === "object" && error !== null && "code" in error && error.code === "23505") return context.json({ error: "DEPLOYMENT_NAME_EXISTS" }, 409);
      throw error;
    }
  }
  app.post("/admin/deployments/configuration", context => saveDeploymentConfiguration(context, null));
  app.put("/admin/deployments/:id/configuration", context => saveDeploymentConfiguration(context, context.req.param("id")));
  app.post("/admin/deployments", async (context) => {
    const parsed = createDeploymentSchema.safeParse(await parseJson(context));
    return parsed.success ? context.json(await options.store.createDeployment(parsed.data), 201) : context.json({ error: "INVALID_REQUEST", issues: parsed.error.issues }, 400);
  });
  app.patch("/admin/deployments/:id/enabled", async (context) => updateEnabled(context, options.store.setDeploymentEnabled.bind(options.store)));
  app.put("/admin/deployments/:id/entitlement", async (context) => {
    const id = ulidSchema.safeParse(context.req.param("id")); const body = entitlementInputSchema.safeParse(await parseJson(context));
    if (!id.success || !body.success) return context.json({ error: "INVALID_REQUEST" }, 400);
    if (!(await options.store.overview()).deployments.some(d => d.id === id.data)) return context.json({ error: "NOT_FOUND" }, 404);
    await options.store.setEntitlement(id.data, body.data); return context.json({ deploymentId: id.data, ...body.data });
  });
  app.put("/admin/deployments/:id/version-assignment", async (context) => {
    const id = ulidSchema.safeParse(context.req.param("id")); const body = versionAssignmentInputSchema.safeParse(await parseJson(context));
    if (!id.success || !body.success) return context.json({ error: "INVALID_REQUEST" }, 400);
    if (!(await options.store.overview()).deployments.some(d => d.id === id.data)) return context.json({ error: "NOT_FOUND" }, 404);
    await options.store.assignVersion(id.data, body.data); return context.json({ deploymentId: id.data, ...body.data });
  });
  app.post("/admin/deployments/:id/activation-token", async (context) => {
    const id = ulidSchema.safeParse(context.req.param("id")); const body = activationTokenInputSchema.safeParse(await parseJson(context));
    if (!id.success || !body.success) return context.json({ error: "INVALID_REQUEST" }, 400);
    const token = `niq_act_${randomSecret(36)}`; const expiresAt = new Date(now().getTime() + body.data.expiresInMinutes * 60_000);
    await options.store.storeActivationToken({ id: createEntityId(), deploymentId: id.data, tokenHash: await sha256(token), expiresAt });
    context.header("cache-control", "no-store");
    return context.json({ activationToken: token, expiresAt: expiresAt.toISOString() }, 201);
  });

  app.post("/v1/activate", async (context) => {
    const parsed = activationExchangeSchema.safeParse(await parseJson(context)); if (!parsed.success) return context.json({ error: "INVALID_REQUEST" }, 400);
    const prefix = randomSecret(9).slice(0, 12); const credential = `niq_dep_${prefix}.${randomSecret(32)}`;
    const exchanged = await options.store.exchangeActivation({ tokenHash: await sha256(parsed.data.activationToken), credentialId: createEntityId(), keyPrefix: prefix, secretHash: await sha256(credential), now: now() });
    context.header("cache-control", "no-store");
    return exchanged ? context.json({ deploymentId: exchanged.deploymentId, clientId: exchanged.clientId, credential }, 201) : context.json({ error: "ACTIVATION_INVALID_OR_EXPIRED" }, 401);
  });

  app.get("/v1/metadata", async (context) => {
    if (!(await authenticateDeployment(context))) return context.json({ error: "UNAUTHORIZED" }, 401);
    return context.json({ service: "niq-scoring-api", region: options.region, provisionalVersion: { version: PROVISIONAL_SCORING_VERSION, status: PROVISIONAL_VERSION_STATUS, clinicalUsePermitted: false, calculationEnabled: provisionalScoringEnabled }, faceScanProvider: { configured: faceScanAdapter.configured, mode: faceScanAdapter.name } });
  });

  app.post("/v1/provisional/calculate", async (context) => {
    if (!provisionalScoringEnabled) return context.json({ error: "PROVISIONAL_SCORING_DISABLED" }, 503);
    const identity = await authenticateDeployment(context); if (!identity) return context.json({ error: "UNAUTHORIZED" }, 401);
    const parsed = calculateRequestSchema.safeParse(await parseJson(context));
    if (!parsed.success) return context.json({ error: "INVALID_REQUEST", issues: parsed.error.issues.map(({ path, message }) => ({ path, message })) }, 400);
    const reservation = await options.store.reserveUsage({ identity, clientId: parsed.data.input.clientId, capability: "SCORING", idempotencyKey: parsed.data.idempotencyKey, assessmentReference: parsed.data.input.assessmentReference, platformEnabled: options.platformEnabled ?? true });
    if (reservation.status === "DUPLICATE") return context.json(reservation.response as never);
    if (reservation.status === "REJECTED") return context.json({ error: "SCORING_UNAVAILABLE", reason: reservation.reason }, 409);
    try { const result = calculateProvisionalScore(parsed.data.input, now().toISOString()); const response = { result, idempotencyKey: parsed.data.idempotencyKey }; await options.store.completeUsage(reservation.usageId, response); return context.json(response); }
    catch (error) { await options.store.failUsage(reservation.usageId); throw error; }
  });

  app.post("/v1/face-scans", async (context) => {
    const identity = await authenticateDeployment(context); if (!identity) return context.json({ error: "UNAUTHORIZED" }, 401);
    const parsed = createFaceScanSessionSchema.safeParse(await parseJson(context)); if (!parsed.success) return context.json({ error: "INVALID_REQUEST" }, 400);
    const reservation = await options.store.reserveUsage({ identity, clientId: parsed.data.clientId, capability: "FACE_SCAN", idempotencyKey: parsed.data.idempotencyKey, assessmentReference: parsed.data.assessmentReference, platformEnabled: options.platformEnabled ?? true });
    if (reservation.status === "DUPLICATE") return context.json(reservation.response as never);
    if (reservation.status === "REJECTED") return context.json({ error: "FACE_SCAN_UNAVAILABLE", reason: reservation.reason }, 409);
    try {
      const providerSession = await faceScanAdapter.createSession({ clientId: parsed.data.clientId, assessmentReference: parsed.data.assessmentReference });
      const session = await options.store.createFaceScanSession({ identity, clientId: parsed.data.clientId, usageId: reservation.usageId, assessmentReference: parsed.data.assessmentReference, idempotencyKey: parsed.data.idempotencyKey, provider: faceScanAdapter.name, ...(providerSession.providerSessionReference ? { providerSessionReference: providerSession.providerSessionReference } : {}) });
      const response = { session, providerConfigured: faceScanAdapter.configured };
      await options.store.storePendingUsageResponse(reservation.usageId, response);
      return context.json(response, 202);
    } catch (error) { await options.store.failUsage(reservation.usageId); throw error; }
  });

  app.notFound((context) => context.json({ error: "NOT_FOUND" }, 404));
  app.onError((_error, context) => context.json({ error: "INTERNAL_ERROR" }, 500));
  return app;
}

async function updateEnabled(context: Context, update: (id: string, enabled: boolean) => Promise<boolean>) {
  const id = ulidSchema.safeParse(context.req.param("id")); const body = updateEnabledSchema.safeParse(await parseJson(context));
  if (!id.success || !body.success) return context.json({ error: "INVALID_REQUEST" }, 400);
  return (await update(id.data, body.data.enabled)) ? context.json({ id: id.data, ...body.data }) : context.json({ error: "NOT_FOUND" }, 404);
}
