import type postgres from "postgres";
import type { Context } from "hono";
import { createEntityId } from "./lib/id";

export type AdminMutationAudit = { actorId: string; requestId: string };

export function adminMutationAudit(c: Context): AdminMutationAudit {
  return { actorId: c.get("adminUserId"), requestId: c.res.headers.get("x-request-id") ?? crypto.randomUUID() };
}

export async function recordAdminMutation(
  sql: postgres.TransactionSql,
  audit: AdminMutationAudit | undefined,
  action: string,
  resourceType: "CLIENT" | "DEPLOYMENT" | "ACTIVATION_TOKEN" | "DEPLOYMENT_CREDENTIAL",
  resourceId: string,
  metadata: Record<string, unknown> = {},
) {
  if (!audit) return;
  // Keep the deletable resource ID as text: audit_events client/deployment FKs
  // intentionally make records with historical usage ineligible for deletion.
  await sql`insert into audit_events (id,actor_type,actor_reference,action,resource_type,resource_reference,request_id,outcome,metadata)
    values (${createEntityId()},'NIQ_ADMIN',${audit.actorId},${action},${resourceType},${resourceId},${audit.requestId},'SUCCEEDED',${sql.json(metadata)})`;
}
