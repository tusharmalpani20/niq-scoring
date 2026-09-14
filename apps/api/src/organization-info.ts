import { organizationInfoSchema } from "@niq-scoring/contracts";
import type { Context, Hono } from "hono";
import type { DeploymentIdentity, ScoringStore } from "./store";

export class OrganizationInfoError extends Error {
  constructor(public readonly code: "UNAUTHORIZED" | "CLIENT_DISABLED" | "DEPLOYMENT_DISABLED" | "CONFIGURATION_INCOMPLETE") { super(code); }
}

export function installOrganizationInfoRoute(app: Hono, store: ScoringStore, authenticate: (c: Context) => Promise<DeploymentIdentity | null>, now: () => Date) {
  app.get("/v1/integrations/organization-info", async c => {
    c.header("Cache-Control", "no-store");
    if (!/^Bearer niq_dep_/.test(c.req.header("authorization") ?? "")) return c.json({ error: "UNAUTHORIZED" }, 401);
    const identity = await authenticate(c);
    if (!identity) return c.json({ error: "UNAUTHORIZED" }, 401);
    // Tenant selection is exclusively derived from the credential.
    if (new URL(c.req.url).search) return c.json({ error: "INVALID_REQUEST" }, 400);
    try {
      return c.json(organizationInfoSchema.parse(await store.organizationInfo(identity, now())));
    } catch (error) {
      if (!(error instanceof OrganizationInfoError)) throw error;
      return c.json({ error: error.code }, error.code === "UNAUTHORIZED" ? 401 : error.code === "CONFIGURATION_INCOMPLETE" ? 409 : 403);
    }
  });
}
