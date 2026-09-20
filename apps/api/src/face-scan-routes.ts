import type { Hono, Context } from "hono";
import { timingSafeEqual } from "node:crypto";
import { FACE_SCAN_MAX_BODY_BYTES, faceScanCreateSchema, faceScanSignalSchema } from "@niq-scoring/contracts/face-scan-session";
import { FaceScanError, type FaceScanWorkflow } from "./face-scan-workflow";
import type { DeploymentIdentity } from "./store";

export async function boundedFaceScanJson(request: Request, limit = FACE_SCAN_MAX_BODY_BYTES): Promise<unknown> {
  if (Number(request.headers.get("content-length")) > limit) throw new FaceScanError("PAYLOAD_TOO_LARGE", 413);
  const reader = request.body?.getReader(); if (!reader) throw new FaceScanError("INVALID_REQUEST", 400);
  let bytes = 0; const chunks: Uint8Array[] = [];
  const timeout = setTimeout(() => { void reader.cancel(); }, 30_000);
  try {
    for (;;) { const { done, value } = await reader.read(); if (done) break; bytes += value.length; if (bytes > limit) { await reader.cancel(); throw new FaceScanError("PAYLOAD_TOO_LARGE", 413); } chunks.push(value); }
    try { return JSON.parse(Buffer.concat(chunks).toString("utf8")); } catch { throw new FaceScanError("INVALID_REQUEST", 400); }
  } finally { clearTimeout(timeout); }
}
export function validWebhookBearer(actual: string | undefined, expected: string | undefined): boolean {
  if (!expected || !actual) return false;
  const left = Buffer.from(actual), right = Buffer.from(`Bearer ${expected}`);
  return left.length === right.length && timingSafeEqual(left, right);
}
export function installFaceScanRoutes(app: Hono, options: { workflow?: FaceScanWorkflow; authenticate: (c: Context) => Promise<DeploymentIdentity | null>; webhookConfirmed?: boolean; webhookSecret?: string }) {
  const run = (operation: (c: Context, identity: DeploymentIdentity, workflow: FaceScanWorkflow) => Promise<unknown>, accepted = false) => async (c: Context) => {
    c.header("cache-control", "no-store");
    const identity = await options.authenticate(c); if (!identity) return c.json({ error: "UNAUTHORIZED" }, 401);
    if (!options.workflow) return c.json({ error: "FACE_SCAN_DISABLED" }, 503);
    try { return c.json(await operation(c, identity, options.workflow) as never, accepted ? 202 : 200); }
    catch (error) { if (error instanceof FaceScanError) return c.json({ error: error.code }, error.status); throw error; }
  };
  const organization = (c: Context) => { const value = c.req.query("organizationReference"); if (!value || value.length > 128) throw new FaceScanError("ORGANIZATION_REQUIRED", 400); return value; };
  app.post("/v1/face-scans", run(async (c, identity, workflow) => {
    const parsed = faceScanCreateSchema.safeParse(await boundedFaceScanJson(c.req.raw, 16_384));
    if (!parsed.success) throw new FaceScanError("INVALID_REQUEST", 400);
    return workflow.create(identity, parsed.data);
  }, true));
  app.get("/v1/face-scans/:id", run((c, identity, workflow) => workflow.get(identity, c.req.param("id")!, organization(c))));
  app.post("/v1/face-scans/:id/signal", run(async (c, identity, workflow) => {
    const parsed = faceScanSignalSchema.safeParse(await boundedFaceScanJson(c.req.raw));
    if (!parsed.success) throw new FaceScanError("INVALID_SIGNAL", 400);
    return workflow.upload(identity, c.req.param("id")!, organization(c), parsed.data);
  }, true));
  app.post("/v1/face-scans/:id/cancel", run((c, identity, workflow) => workflow.cancel(identity, c.req.param("id")!, organization(c))));
  app.post("/webhooks/careplix", async c => {
    c.header("cache-control", "no-store");
    if (!options.webhookConfirmed || !options.workflow) return c.json({ error: "WEBHOOK_DISABLED" }, 503);
    if (!validWebhookBearer(c.req.header("authorization"), options.webhookSecret)) return c.json({ error: "UNAUTHORIZED" }, 401);
    try { await options.workflow.webhook(await boundedFaceScanJson(c.req.raw, 1024 * 1024)); return c.json({ accepted: true }, 200); }
    catch (error) { if (error instanceof FaceScanError) return c.json({ error: error.code }, error.status); return c.json({ error: "RECEIPT_UNAVAILABLE" }, 503); }
  });
}
