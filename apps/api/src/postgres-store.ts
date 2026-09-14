import postgres from "postgres";
import type { DeploymentConfiguration, CreateDeployment, CreateClient, EntitlementInput, VersionAssignmentInput } from "@niq-scoring/contracts";
import { PROVISIONAL_SCORING_VERSION } from "@niq-scoring/contracts";
import { decideEntitlement, type Capability } from "@niq-scoring/entitlements";
import { createEntityId } from "./lib/id";
import type { Deployment, DeploymentIdentity, Client, ScoringStore, UsageReservation } from "./store";

type Database = ReturnType<typeof postgres>;

export class PostgresScoringStore implements ScoringStore {
  constructor(private readonly database: Database) {}

  async overview() {
    const [clients, deployments, entitlements, assignments, versions] = await Promise.all([
      this.database<Client[]>`select id, name, enabled from clients order by created_at`,
      this.database<Deployment[]>`select id, client_id as "clientId", name, environment, hosting_type as "hostingType", enabled from deployments order by created_at`,
      this.database<Array<EntitlementInput & { deploymentId: string }>>`select deployment_id as "deploymentId", capability, enabled, monthly_limit as "monthlyLimit" from entitlements where effective_until is null`,
      this.database<Array<{ deploymentId: string; mode: "LATEST_APPROVED" | "PINNED"; scoringRuleVersionId: string | null }>>`select deployment_id as "deploymentId", mode, scoring_rule_version_id as "scoringRuleVersionId" from deployment_version_assignments where effective_until is null`,
      this.database<Array<{ id: string; version: string; lifecycle: string; clinicalUsePermitted: boolean }>>`select id, version, lifecycle, clinical_use_permitted as "clinicalUsePermitted" from scoring_rule_versions order by created_at desc`,
    ]);
    return { clients: [...clients], deployments: [...deployments], entitlements: [...entitlements], assignments: assignments.map((row) => row.mode === "PINNED" ? { deploymentId: row.deploymentId, mode: "PINNED" as const, scoringRuleVersionId: row.scoringRuleVersionId! } : { deploymentId: row.deploymentId, mode: "LATEST_APPROVED" as const }), versions: [...versions] };
  }

  async createClient(input: CreateClient) {
    const id = createEntityId();
    const [row] = await this.database<Client[]>`insert into clients (id, name) values (${id}, ${input.name}) returning id, name, enabled`;
    return row!;
  }
  async setClientEnabled(id: string, enabled: boolean) { const rows = await this.database`update clients set enabled=${enabled}, updated_at=now() where id=${id} returning id`; return rows.length === 1; }
  async createDeployment(input: CreateDeployment) {
    return this.database.begin(async (tx) => {
      const id = createEntityId();
      const [row] = await tx<Deployment[]>`insert into deployments (id, client_id, name, environment) values (${id}, ${input.clientId}, ${input.name}, ${input.environment}) returning id, client_id as "clientId", name, environment, hosting_type as "hostingType", enabled`;
      return row!;
    });
  }
  async saveDeploymentConfiguration(id: string | null, input: DeploymentConfiguration) {
    return this.database.begin(async tx => {
      const deploymentId = id ?? createEntityId();
      const [deployment] = id
        ? await tx<Deployment[]>`update deployments set name=${input.name}, environment=${input.environment}, hosting_type=${input.hostingType}, enabled=${input.enabled}, updated_at=now() where id=${id} and client_id=${input.clientId} returning id, client_id as "clientId", name, environment, hosting_type as "hostingType", enabled`
        : await tx<Deployment[]>`insert into deployments (id,client_id,name,environment,hosting_type,enabled) values (${deploymentId},${input.clientId},${input.name},${input.environment},${input.hostingType},${input.enabled}) returning id, client_id as "clientId", name, environment, hosting_type as "hostingType", enabled`;
      if (!deployment) return null;
      // Persist the complete form atomically; credentials and usage remain untouched.
      for (const capability of ["SCORING", "FACE_SCAN"] as const) {
        const setting = capability === "SCORING" ? input.scoring : input.faceScan;
        await tx`select pg_advisory_xact_lock(hashtext(${`${deploymentId}:${capability}`}))`;
        await tx`update entitlements set effective_until=clock_timestamp(), updated_at=clock_timestamp() where deployment_id=${deploymentId} and capability=${capability} and effective_until is null`;
        await tx`insert into entitlements (id,deployment_id,capability,enabled,monthly_limit) values (${createEntityId()},${deploymentId},${capability},${setting.enabled},${setting.monthlyLimit})`;
      }
      const policy = input.versionAssignment;
      await tx`select pg_advisory_xact_lock(hashtext(${`version:${deploymentId}`}))`;
      await tx`update deployment_version_assignments set effective_until=clock_timestamp() where deployment_id=${deploymentId} and effective_until is null`;
      await tx`insert into deployment_version_assignments (id,deployment_id,mode,scoring_rule_version_id) values (${createEntityId()},${deploymentId},${policy.mode},${policy.mode === "PINNED" ? policy.scoringRuleVersionId : null})`;
      return deployment;
    });
  }
  async setDeploymentEnabled(id: string, enabled: boolean) { const rows = await this.database`update deployments set enabled=${enabled}, updated_at=now() where id=${id} returning id`; return rows.length === 1; }
  async setEntitlement(deploymentId: string, input: EntitlementInput) {
    await this.database.begin(async (tx) => {
      await tx`select pg_advisory_xact_lock(hashtext(${`${deploymentId}:${input.capability}`}))`;
      await tx`update entitlements set effective_until=now(), updated_at=now() where deployment_id=${deploymentId} and capability=${input.capability} and effective_until is null`;
      await tx`insert into entitlements (id, deployment_id, capability, enabled, monthly_limit) values (${createEntityId()}, ${deploymentId}, ${input.capability}, ${input.enabled}, ${input.monthlyLimit})`;
    });
  }
  async assignVersion(deploymentId: string, input: VersionAssignmentInput) {
    await this.database.begin(async (tx) => {
      await tx`select pg_advisory_xact_lock(hashtext(${`version:${deploymentId}`}))`;
      await tx`update deployment_version_assignments set effective_until=now() where deployment_id=${deploymentId} and effective_until is null`;
      await tx`insert into deployment_version_assignments (id, deployment_id, mode, scoring_rule_version_id) values (${createEntityId()}, ${deploymentId}, ${input.mode}, ${input.mode === "PINNED" ? input.scoringRuleVersionId : null})`;
    });
  }
  async storeActivationToken(input: { id: string; deploymentId: string; tokenHash: string; expiresAt: Date }) { await this.database`insert into activation_tokens (id, deployment_id, token_hash, expires_at) values (${input.id}, ${input.deploymentId}, ${input.tokenHash}, ${input.expiresAt})`; }
  async exchangeActivation(input: { tokenHash: string; credentialId: string; keyPrefix: string; secretHash: string; now: Date }) {
    return this.database.begin(async (tx) => {
      const [token] = await tx<Array<{ deploymentId: string }>>`select deployment_id as "deploymentId" from activation_tokens where token_hash=${input.tokenHash} and used_at is null and expires_at>${input.now} for update`;
      if (!token) return null;
      const [client] = await tx<Array<{ clientId: string }>>`select client.id as "clientId" from deployments link join clients client on client.id=link.client_id where link.id=${token.deploymentId}`;
      if (!client) return null;
      await tx`update activation_tokens set used_at=${input.now} where token_hash=${input.tokenHash}`;
      await tx`insert into deployment_credentials (id, deployment_id, key_prefix, secret_hash, hash_algorithm) values (${input.credentialId}, ${token.deploymentId}, ${input.keyPrefix}, ${input.secretHash}, 'sha256')`;
      return { deploymentId: token.deploymentId, clientId: client.clientId };
    });
  }
  async authenticateDeployment(keyPrefix: string, secretHash: string) {
    const [row] = await this.database<DeploymentIdentity[]>`select dc.id as "credentialId", d.id as "deploymentId", d.client_id as "clientId" from deployment_credentials dc join deployments d on d.id=dc.deployment_id where dc.key_prefix=${keyPrefix} and dc.secret_hash=${secretHash} and dc.revoked_at is null and (dc.expires_at is null or dc.expires_at>now())`;
    if (row) await this.database`update deployment_credentials set last_used_at=now() where id=${row.credentialId}`;
    return row ?? null;
  }
  async reserveUsage(input: { identity: DeploymentIdentity; clientId: string; capability: Capability; idempotencyKey: string; assessmentReference: string; platformEnabled: boolean }): Promise<UsageReservation> {
    return this.database.begin(async (tx) => {
      await tx`select pg_advisory_xact_lock(hashtext(${`${input.identity.deploymentId}:${input.capability}:${input.idempotencyKey}`}))`;
      const [scope] = await tx<Array<{ clientEnabled: boolean; deploymentEnabled: boolean }>>`select o.enabled as "clientEnabled", d.enabled as "deploymentEnabled" from deployments d join clients o on o.id=d.client_id where d.client_id=${input.identity.clientId} and d.id=${input.identity.deploymentId} and o.id=${input.clientId}`;
      if (!scope) return { status: "REJECTED", reason: "CLIENT_NOT_ALLOWED" };
      const [duplicate] = await tx<Array<{ id: string; outcome: string; response: unknown }>>`select id, outcome, response_payload as response from usage_events where deployment_id=${input.identity.deploymentId} and capability=${input.capability} and idempotency_key=${input.idempotencyKey}`;
      if (duplicate?.response != null) return { status: "DUPLICATE", usageId: duplicate.id, response: duplicate.response };
      if (duplicate?.outcome === "PENDING") return { status: "REJECTED", reason: "REQUEST_IN_PROGRESS" };
      const [entitlement] = await tx<Array<{ enabled: boolean; monthlyLimit: number | null }>>`select enabled, monthly_limit as "monthlyLimit" from entitlements where deployment_id=${input.identity.deploymentId} and capability=${input.capability} and effective_until is null for update`;
      if (!entitlement?.enabled) return { status: "REJECTED", reason: "CAPABILITY_DISABLED" };
      const [assignment] = await tx<Array<{ mode: "LATEST_APPROVED" | "PINNED"; scoringRuleVersionId: string | null }>>`select mode, scoring_rule_version_id as "scoringRuleVersionId" from deployment_version_assignments where deployment_id=${input.identity.deploymentId} and effective_until is null`;
      const [resolvedVersion] = assignment?.mode === "PINNED"
        ? await tx<Array<{ id: string; version: string }>>`select id, version from scoring_rule_versions where id=${assignment.scoringRuleVersionId}`
        : await tx<Array<{ id: string; version: string }>>`select id, version from scoring_rule_versions where lifecycle in ('APPROVED','ACTIVE') order by approved_at desc nulls last, created_at desc limit 1`;
      const [count] = await tx<Array<{ value: number }>>`select count(*)::int as value from usage_events where deployment_id=${input.identity.deploymentId} and capability=${input.capability} and (billable=true or outcome='PENDING') and occurred_at >= (date_trunc('month', now() at time zone 'UTC') at time zone 'UTC')`;
      const decision = decideEntitlement({ platformEnabled: input.platformEnabled, clientEnabled: scope.clientEnabled, deploymentEnabled: scope.deploymentEnabled, versionActive: input.capability === "FACE_SCAN" || resolvedVersion?.version === PROVISIONAL_SCORING_VERSION, monthlyLimit: entitlement.monthlyLimit, monthlyUsage: count?.value ?? 0 });
      if (!decision.allowed) return { status: "REJECTED", reason: decision.reason };
      const usageId = duplicate?.id ?? createEntityId();
      if (duplicate) await tx`update usage_events set outcome='PENDING', response_payload=null, completed_at=null, occurred_at=now() where id=${usageId}`;
      else await tx`insert into usage_events (id, client_id, deployment_id, credential_id, capability, request_id, idempotency_key, assessment_reference, outcome) values (${usageId}, ${input.clientId}, ${input.identity.deploymentId}, ${input.identity.credentialId}, ${input.capability}, ${input.idempotencyKey}, ${input.idempotencyKey}, ${input.assessmentReference}, 'PENDING')`;
      return { status: "NEW", usageId, version: resolvedVersion?.version ?? PROVISIONAL_SCORING_VERSION };
    });
  }
  async completeUsage(usageId: string, response: unknown) { await this.database`update usage_events set outcome='SUCCEEDED', billable=true, response_payload=${this.database.json(response as never)}, completed_at=now() where id=${usageId} and outcome='PENDING'`; }
  async storePendingUsageResponse(usageId: string, response: unknown) { await this.database`update usage_events set response_payload=${this.database.json(response as never)} where id=${usageId} and outcome='PENDING'`; }
  async failUsage(usageId: string) { await this.database`update usage_events set outcome='FAILED', completed_at=now() where id=${usageId} and outcome='PENDING'`; }
  async createFaceScanSession(input: { identity: DeploymentIdentity; clientId: string; usageId: string; assessmentReference: string; idempotencyKey: string; provider: string; providerSessionReference?: string }) {
    const id = createEntityId();
    const [row] = await this.database<Array<{ id: string; state: "REQUESTED" }>>`insert into face_scan_sessions (id, client_id, deployment_id, assessment_reference, provider, provider_session_reference, idempotency_key) values (${id}, ${input.clientId}, ${input.identity.deploymentId}, ${input.assessmentReference}, ${input.provider}, ${input.providerSessionReference ?? null}, ${input.idempotencyKey}) returning id, state`;
    return row!;
  }
}
