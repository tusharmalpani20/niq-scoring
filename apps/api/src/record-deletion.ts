import type postgres from "postgres";
import type { Hono } from "hono";
import { ulidSchema } from "@niq-scoring/contracts";
import type { MemoryScoringStore } from "./store";
import { adminMutationAudit, recordAdminMutation, type AdminMutationAudit } from "./admin-mutation-audit";

export type RecordKind = "clients" | "deployments";
export type DeletionStatus = { allowed: boolean; reason?: string; missing?: boolean };
const used = { allowed: false, reason: "This record has been activated or used. Disable it instead." };
const missing = { allowed: false, missing: true, reason: "This record no longer exists." };

export function memoryDeletion(store: MemoryScoringStore, kind: RecordKind, id: string, remove = false, audit?: AdminMutationAudit): DeletionStatus {
  if (!store[kind].some(row => row.id === id)) return missing;
  const history = store as MemoryScoringStore & { auditEvents?: Array<{ clientId?: string; deploymentId?: string }> };
  const scans = store.faceScans as Array<{ clientId?: string; deploymentId?: string }>;
  const historyKey = kind === "clients" ? "clientId" : "deploymentId";
  if (store.bindings.some(row => row[historyKey] === id)) return used;
  if (scans.some(row => row[historyKey] === id) || history.auditEvents?.some(row => row[historyKey] === id)) return used;
  if (kind === "clients") {
    if (store.deployments.some(row => row.clientId === id)) return { allowed: false, reason: "Remove this client’s unused deployments first." };
    if (store.usages.some(row => row.clientId === id)) return used;
    if (remove) store.clients = store.clients.filter(row => row.id !== id);
  } else {
    if (store.credentials.some(row => row.deploymentId === id) || store.activations.some(row => row.deploymentId === id && row.usedAt) || store.usages.some(row => row.deploymentId === id)) return used;
    if (remove) {
      store.activations = store.activations.filter(row => row.deploymentId !== id);
      store.entitlements = store.entitlements.filter(row => row.deploymentId !== id);
      store.assignments = store.assignments.filter(row => row.deploymentId !== id);
      store.deployments = store.deployments.filter(row => row.id !== id);
    }
  }
  if (remove && audit) store.adminMutationEvents.push({ ...audit, action: kind === "clients" ? "CLIENT_DELETED" : "DEPLOYMENT_DELETED", resourceType: kind === "clients" ? "CLIENT" : "DEPLOYMENT", resourceId: id, metadata: {} });
  return { allowed: true };
}

export async function postgresDeletion(database: ReturnType<typeof postgres>, kind: RecordKind, id: string, remove = false, audit?: AdminMutationAudit): Promise<DeletionStatus> {
  try {
    return await database.begin(async tx => {
      // Lock tokens before their parent, matching activation exchange. Parent locks
      // also prevent new FK children from appearing between eligibility and delete.
      if (remove && kind === "deployments") await tx`select id from activation_tokens where deployment_id=${id} for update`;
      const rows = kind === "clients"
        ? await tx`select id from clients where id=${id} for update`
        : await tx`select id from deployments where id=${id} for update`;
      if (!rows.length) return missing;
      if (kind === "clients") {
        const [children] = await tx`select exists(select 1 from deployments where client_id=${id}) as present`;
        if (children?.present) return { allowed: false, reason: "Remove this client’s unused deployments first." };
        const [history] = await tx`select exists(select 1 from assessment_bindings where client_id=${id}) or exists(select 1 from usage_events where client_id=${id}) or exists(select 1 from face_scan_sessions where client_id=${id}) or exists(select 1 from audit_events where client_id=${id}) as present`;
        if (history?.present) return used;
        if (remove) await tx`delete from clients where id=${id}`;
      } else {
        const [history] = await tx`select exists(select 1 from assessment_bindings where deployment_id=${id}) or exists(select 1 from deployment_credentials where deployment_id=${id}) or exists(select 1 from activation_tokens where deployment_id=${id} and used_at is not null) or exists(select 1 from usage_events where deployment_id=${id}) or exists(select 1 from face_scan_sessions where deployment_id=${id}) or exists(select 1 from audit_events where deployment_id=${id}) as present`;
        if (history?.present) return used;
        if (remove) {
          await tx`delete from activation_tokens where deployment_id=${id}`;
          await tx`delete from entitlements where deployment_id=${id}`;
          await tx`delete from deployment_version_assignments where deployment_id=${id}`;
          await tx`delete from deployments where id=${id}`;
        }
      }
      if (remove) await recordAdminMutation(tx, audit, kind === "clients" ? "CLIENT_DELETED" : "DEPLOYMENT_DELETED", kind === "clients" ? "CLIENT" : "DEPLOYMENT", id);
      return { allowed: true };
    });
  } catch (error) {
    // A concurrent activation/configuration write must never result in history loss.
    if (["23503", "40P01", "40001"].includes((error as { code?: string }).code ?? "")) return { allowed: false, reason: "This record changed. Refresh and try again." };
    throw error;
  }
}

export function installRecordDeletion(app: Hono, store: {
  deletionStatus(kind: RecordKind, id: string): Promise<DeletionStatus>;
    deleteUnused(kind: RecordKind, id: string, audit?: AdminMutationAudit): Promise<DeletionStatus>;
}) {
  for (const kind of ["clients", "deployments"] as const) {
    app.get(`/admin/${kind}/:id/deletion`, async c => {
      if (!ulidSchema.safeParse(c.req.param("id")).success) return c.json({ error: "INVALID_REQUEST" }, 400);
      const result = await store.deletionStatus(kind, c.req.param("id"));
      return c.json(result, result.missing ? 404 : 200);
    });
    app.delete(`/admin/${kind}/:id`, async c => {
      if (!ulidSchema.safeParse(c.req.param("id")).success) return c.json({ error: "INVALID_REQUEST" }, 400);
      const result = await store.deleteUnused(kind, c.req.param("id"), c.get("adminUserId") ? adminMutationAudit(c) : undefined);
      return c.json(result.allowed ? { deleted: true } : { error: result.missing ? "NOT_FOUND" : "RECORD_IN_USE", ...result }, result.allowed ? 200 : result.missing ? 404 : 409);
    });
  }
}
