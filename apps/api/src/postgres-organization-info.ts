import type postgres from "postgres";
import type { OrganizationInfo } from "@niq-scoring/contracts";
import { createEntityId } from "./lib/id";
import { OrganizationInfoError } from "./organization-info";
import type { DeploymentIdentity } from "./store";

type Snapshot = {
  clientName: string;
  clientEnabled: boolean;
  deploymentEnabled: boolean;
  mode: OrganizationInfo["deployment"]["mode"] | null;
  environment: string;
  scoringEnabled: boolean | null;
  faceScanEnabled: boolean | null;
  scoresPerMonth: number | null;
  faceScansPerMonth: number | null;
  scores: number;
  faceScans: number;
  updatedAt: Date | null;
};

export async function postgresOrganizationInfo(database: ReturnType<typeof postgres>, identity: DeploymentIdentity, now: Date): Promise<OrganizationInfo> {
  const period = now.toISOString().slice(0, 7);
  const start = new Date(`${period}-01T00:00:00.000Z`);
  const end = new Date(start);
  end.setUTCMonth(end.getUTCMonth() + 1);

  return database.begin(async tx => {
    // One statement gives configuration and usage the same snapshot. Row locks
    // keep credential revocation and ownership/status changes behind this read.
    const [row] = await tx<Snapshot[]>`select
      c.name as "clientName", c.enabled as "clientEnabled", d.enabled as "deploymentEnabled",
      d.hosting_type as mode, d.environment,
      scoring.enabled as "scoringEnabled", face.enabled as "faceScanEnabled",
      scoring.monthly_limit as "scoresPerMonth", face.monthly_limit as "faceScansPerMonth",
      totals.scores, totals.face_scans as "faceScans",
      greatest(c.updated_at, d.updated_at, scoring.updated_at, face.updated_at) as "updatedAt"
      from deployment_credentials dc
      join deployments d on d.id=dc.deployment_id
      join clients c on c.id=d.client_id
      left join entitlements scoring on scoring.deployment_id=d.id and scoring.capability='SCORING' and scoring.effective_until is null
      left join entitlements face on face.deployment_id=d.id and face.capability='FACE_SCAN' and face.effective_until is null
      cross join lateral (
        select count(*) filter (where capability='SCORING')::int as scores,
          count(*) filter (where capability='FACE_SCAN')::int as face_scans
        from usage_events where deployment_id=d.id and (billable=true or outcome='PENDING')
          and occurred_at >= ${start} and occurred_at < ${end}
      ) totals
      where dc.id=${identity.credentialId} and d.id=${identity.deploymentId} and c.id=${identity.clientId}
        and dc.revoked_at is null and (dc.expires_at is null or dc.expires_at > ${now})
      for share of dc, d, c`;
    if (!row) throw new OrganizationInfoError("UNAUTHORIZED");
    if (!row.clientEnabled) throw new OrganizationInfoError("CLIENT_DISABLED");
    if (!row.deploymentEnabled) throw new OrganizationInfoError("DEPLOYMENT_DISABLED");
    if (!row.mode || row.scoringEnabled === null || row.faceScanEnabled === null) {
      throw new OrganizationInfoError("CONFIGURATION_INCOMPLETE");
    }
    const result: OrganizationInfo = {
      organization: { id: identity.clientId, name: row.clientName, status: row.clientEnabled ? "ACTIVE" : "DISABLED" },
      deployment: { id: identity.deploymentId, mode: row.mode, environment: row.environment, status: row.deploymentEnabled ? "ACTIVE" : "DISABLED" },
      services: { scoring: { enabled: row.scoringEnabled }, faceScan: { enabled: row.faceScanEnabled } },
      limits: { scoresPerMonth: row.scoresPerMonth, faceScansPerMonth: row.faceScansPerMonth },
      usage: { period, scores: row.scores, faceScans: row.faceScans },
      updatedAt: row.updatedAt?.toISOString() ?? null,
      unavailableFields: ["limits.users"],
    };
    await tx`insert into audit_events
      (id, client_id, deployment_id, actor_type, actor_reference, action, resource_type, resource_reference, request_id, outcome, metadata, occurred_at)
      values (${createEntityId()}, ${identity.clientId}, ${identity.deploymentId}, 'DEPLOYMENT', ${identity.credentialId},
        'ORGANIZATION_INFO_READ', 'deployment', ${identity.deploymentId}, ${crypto.randomUUID()}, 'SUCCEEDED', '{}', ${now})`;
    return result;
  });
}
