import { installFaceScanRoutes } from "./face-scan-routes";
import type { FaceScanWorkflow } from "./face-scan-workflow";
import { installOrganizationInfoRoute } from "./organization-info";
import { RuleStoreError } from "./rule-store";
import { installAssessmentRoutes } from "./assessment-routes";
import { ruleChecksum } from "./rule-routes";
import { installRuleRoutes } from "./rule-routes";
import { DuplicateClientNameError } from "./lib/client-name";
import { installRecordDeletion } from "./record-deletion";
import { encryptActivationToken, decryptActivationToken } from "./lib/activation-secret";
import {
  activationExchangeSchema, activationTokenInputSchema, calculateRequestSchema,
   deploymentConfigurationRequestSchema, createDeploymentSchema,
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
  activationTokenEncryptionKey?: string;
  runtimeEnvironment: "development" | "test" | "production";
  provisionalScoringRequested: boolean;
  platformEnabled?: boolean;
  faceScanAdapter?: FaceScanAdapter;
  faceScanWorkflow?: FaceScanWorkflow;
  faceScanWebhookConfirmed?: boolean;
  faceScanWebhookSecret?: string;
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
  installRecordDeletion(app, options.store);
  installRuleRoutes(app, options.store.rules, now);

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
    if (!parsed.success) return context.json({ error: "INVALID_REQUEST", issues: parsed.error.issues }, 400);
    try { return context.json(await options.store.createClient(parsed.data), 201); }
    catch (error) {
      if (error instanceof DuplicateClientNameError) return context.json({ error: "CLIENT_NAME_EXISTS" }, 409);
      throw error;
    }
  });
  app.patch("/admin/clients/:id/enabled", async (context) => updateEnabled(context, options.store.setClientEnabled.bind(options.store)));
  async function saveDeploymentConfiguration(context: Context, id: string | null) {
    if (id !== null && !ulidSchema.safeParse(id).success) return context.json({ error: "INVALID_REQUEST" }, 400);
    const parsed = deploymentConfigurationRequestSchema.safeParse(await parseJson(context));
    if (!parsed.success) return context.json({ error: "INVALID_REQUEST", issues: parsed.error.issues }, 400);
    const current = await options.store.overview();
    const client = current.clients.find(c => c.id === parsed.data.clientId);
    if (!client) return context.json({ error: "CLIENT_NOT_FOUND" }, 404);
    const existing = id ? current.deployments.find(d => d.id === id && d.clientId === client.id) : undefined;
    if (id && !existing) return context.json({ error: "DEPLOYMENT_NOT_FOUND" }, 404);
    if (existing && (existing.environment !== parsed.data.environment || (existing.hostingType && existing.hostingType !== parsed.data.hostingType))) {
      return context.json({ error: "DEPLOYMENT_IDENTITY_IMMUTABLE" }, 409);
    }
    const clientSlug = client.name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 70) || "client";
    const hosting = parsed.data.hostingType === "NIQ_HOSTED" ? "niq" : "client-cloud";
    const input = {
      ...parsed.data,
      name: existing?.name ?? `${clientSlug}-${parsed.data.environment}-${hosting}-${crypto.randomUUID().slice(0, 8)}`,
    };
    const policy = input.versionAssignment;
    if (policy.mode === "PINNED") {
      const selected = current.versions.find(v => v.id === policy.scoringRuleVersionId);
      const unchanged = current.assignments.some(a => a.deploymentId === id && a.mode === "PINNED" && a.scoringRuleVersionId === policy.scoringRuleVersionId);
      if (!selected || !unchanged && !(selected.clinicalUsePermitted && ["APPROVED", "ACTIVE"].includes(selected.lifecycle) || provisionalScoringEnabled && selected.version === PROVISIONAL_SCORING_VERSION)) return context.json({ error: "VERSION_UNAVAILABLE" }, 409);
    }
    try {
      if (!id && !options.activationTokenEncryptionKey) return context.json({ error: "TOKEN_STORAGE_UNAVAILABLE" }, 503);
      const expiresAt = tokenExpiryDate(parsed.data.tokenExpiry);
      if (!id && expiresAt === false) return context.json({ error: "INVALID_TOKEN_EXPIRY" }, 400);
      const activation = id ? undefined : await newActivation(expiresAt === false ? null : expiresAt);
      const saved = await options.store.saveDeploymentConfiguration(id, input, activation?.stored);
      context.header("cache-control", "no-store");
      return saved ? context.json({ ...saved, ...(activation ? { activation: activation.public } : {}) }, id ? 200 : 201) : context.json({ error: "DEPLOYMENT_NOT_FOUND" }, 404);
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
    if (body.data.mode === "PINNED") {
      const overview = await options.store.overview();
      const pin = body.data.scoringRuleVersionId;
      const selected = overview.versions.find(v => v.id === pin);
      const unchanged = overview.assignments.some(a => a.deploymentId === id.data && a.mode === "PINNED" && a.scoringRuleVersionId === pin);
      if (!selected || !unchanged && !(selected.clinicalUsePermitted && ["APPROVED", "ACTIVE"].includes(selected.lifecycle) || provisionalScoringEnabled && selected.version === PROVISIONAL_SCORING_VERSION)) return context.json({ error: "VERSION_UNAVAILABLE" }, 409);
    }
    await options.store.assignVersion(id.data, body.data); return context.json({ deploymentId: id.data, ...body.data });
  });
  function tokenExpiryDate(input: { expiresAt?: string | null | undefined; expiresInMinutes?: number | undefined }): Date | null | false {
    if (input.expiresAt === null) return null;
    const date = input.expiresAt ? new Date(input.expiresAt) : new Date(now().getTime() + (input.expiresInMinutes ?? 10080) * 60_000);
    return date.getTime() > now().getTime() ? date : false;
  }
  async function newActivation(expiresAt: Date | null) {
    const token = `niq_${randomSecret(36)}`;
    return {
      stored: { id: createEntityId(), tokenHash: await sha256(token), tokenCiphertext: encryptActivationToken(token, options.activationTokenEncryptionKey!), expiresAt },
      public: { activationToken: token, expiresAt: expiresAt?.toISOString() ?? null },
    };
  }
  app.get("/admin/deployments/:id/activation-token", async context => {
    context.header("cache-control", "no-store");
    const id = ulidSchema.safeParse(context.req.param("id"));
    if (!id.success) return context.json({ error: "INVALID_REQUEST" }, 400);
    if (!(await options.store.overview()).deployments.some(d => d.id === id.data)) return context.json({ error: "DEPLOYMENT_NOT_FOUND" }, 404);
    if (!options.activationTokenEncryptionKey) return context.json({ error: "TOKEN_STORAGE_UNAVAILABLE" }, 503);
    const token = await options.store.getActivationToken(id.data, now());
    return context.json({ activation: token ? { activationToken: decryptActivationToken(token.tokenCiphertext, options.activationTokenEncryptionKey), expiresAt: token.expiresAt?.toISOString() ?? null } : null });
  });
  app.post("/admin/deployments/:id/activation-token", async context => {
    context.header("cache-control", "no-store");
    const id = ulidSchema.safeParse(context.req.param("id")); const body = activationTokenInputSchema.safeParse(await parseJson(context));
    if (!id.success || !body.success) return context.json({ error: "INVALID_REQUEST" }, 400);
    if (!(await options.store.overview()).deployments.some(d => d.id === id.data)) return context.json({ error: "DEPLOYMENT_NOT_FOUND" }, 404);
    if (!options.activationTokenEncryptionKey) return context.json({ error: "TOKEN_STORAGE_UNAVAILABLE" }, 503);
    const expiresAt = tokenExpiryDate(body.data);
    if (expiresAt === false) return context.json({ error: "INVALID_TOKEN_EXPIRY" }, 400);
    const activation = await newActivation(expiresAt);
    await options.store.storeActivationToken({ ...activation.stored, deploymentId: id.data });
    return context.json(activation.public, 201);
  });

  app.get("/admin/deployments/:id/activation-tokens", async context => {
    context.header("cache-control", "no-store");
    const id = ulidSchema.safeParse(context.req.param("id"));
    if (!id.success) return context.json({ error: "INVALID_REQUEST" }, 400);
    if (!(await options.store.overview()).deployments.some(d => d.id === id.data)) return context.json({ error: "DEPLOYMENT_NOT_FOUND" }, 404);
    const tokens = await options.store.listActivationTokens(id.data);
    return context.json({ tokens: tokens.map(token => ({ ...token, status: token.usedAt ? "Used" : token.revokedAt ? "Revoked" : token.expiresAt && token.expiresAt <= now() ? "Expired" : "Unused" })) });
  });
  app.get("/admin/deployments/:id/activation-tokens/:tokenId", async context => {
    context.header("cache-control", "no-store");
    const id = ulidSchema.safeParse(context.req.param("id")); const tokenId = ulidSchema.safeParse(context.req.param("tokenId"));
    if (!id.success || !tokenId.success) return context.json({ error: "INVALID_REQUEST" }, 400);
    if (!options.activationTokenEncryptionKey) return context.json({ error: "TOKEN_STORAGE_UNAVAILABLE" }, 503);
    const token = await options.store.getActivationToken(id.data, now(), tokenId.data);
    return token ? context.json({ activationToken: decryptActivationToken(token.tokenCiphertext, options.activationTokenEncryptionKey), expiresAt: token.expiresAt?.toISOString() ?? null }) : context.json({ error: "TOKEN_UNAVAILABLE" }, 404);
  });
  app.delete("/admin/deployments/:id/activation-tokens/:tokenId", async context => {
    const id = ulidSchema.safeParse(context.req.param("id")); const tokenId = ulidSchema.safeParse(context.req.param("tokenId"));
    if (!id.success || !tokenId.success) return context.json({ error: "INVALID_REQUEST" }, 400);
    return await options.store.revokeActivationToken(id.data, tokenId.data, now()) ? context.json({ revoked: true }) : context.json({ error: "TOKEN_UNAVAILABLE" }, 409);
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
    return context.json({ service: "niq-scoring-api", region: options.region, provisionalVersion: { version: PROVISIONAL_SCORING_VERSION, status: PROVISIONAL_VERSION_STATUS, clinicalUsePermitted: false, calculationEnabled: provisionalScoringEnabled }, faceScanProvider: { configured: Boolean(options.faceScanWorkflow), mode: options.faceScanWorkflow ? "careplix" : faceScanAdapter.name } });
  });

  installOrganizationInfoRoute(app, options.store, authenticateDeployment, now);
  installAssessmentRoutes(app, options.store, authenticateDeployment, now, options.platformEnabled ?? true);

  app.post("/v1/provisional/calculate", async (context) => {
    if (!provisionalScoringEnabled) return context.json({ error: "PROVISIONAL_SCORING_DISABLED" }, 503);
    const identity = await authenticateDeployment(context); if (!identity) return context.json({ error: "UNAUTHORIZED" }, 401);
    const parsed = calculateRequestSchema.safeParse(await parseJson(context));
    if (!parsed.success) return context.json({ error: "INVALID_REQUEST", issues: parsed.error.issues.map(({ path, message }) => ({ path, message })) }, 400);
    const reservation = await options.store.reserveUsage({ identity, clientId: parsed.data.input.clientId, capability: "SCORING", idempotencyKey: parsed.data.idempotencyKey, assessmentReference: parsed.data.input.assessmentReference, fingerprint: ruleChecksum({ endpoint: "provisional", input: parsed.data.input }), platformEnabled: options.platformEnabled ?? true });
    if (reservation.status === "DUPLICATE") return context.json(reservation.response as never);
    if (reservation.status === "REJECTED") return context.json({ error: "SCORING_UNAVAILABLE", reason: reservation.reason }, 409);
    try { const result = calculateProvisionalScore(parsed.data.input, now().toISOString()); const response = { result, idempotencyKey: parsed.data.idempotencyKey }; await options.store.completeUsage(reservation.usageId, response); return context.json(response); }
    catch (error) { await options.store.failUsage(reservation.usageId); throw error; }
  });

  installFaceScanRoutes(app, { authenticate: authenticateDeployment,
    ...(options.faceScanWorkflow ? { workflow: options.faceScanWorkflow } : {}),
    ...(options.faceScanWebhookConfirmed ? { webhookConfirmed: true } : {}),
    ...(options.faceScanWebhookSecret ? { webhookSecret: options.faceScanWebhookSecret } : {}),
  });

  app.notFound((context) => context.json({ error: "NOT_FOUND" }, 404));
  app.onError((error, context) => error instanceof RuleStoreError ? context.json({ error: error.code }, 409) : context.json({ error: "INTERNAL_ERROR" }, 500));
  return app;
}

async function updateEnabled(context: Context, update: (id: string, enabled: boolean) => Promise<boolean>) {
  const id = ulidSchema.safeParse(context.req.param("id")); const body = updateEnabledSchema.safeParse(await parseJson(context));
  if (!id.success || !body.success) return context.json({ error: "INVALID_REQUEST" }, 400);
  return (await update(id.data, body.data.enabled)) ? context.json({ id: id.data, ...body.data }) : context.json({ error: "NOT_FOUND" }, 404);
}
