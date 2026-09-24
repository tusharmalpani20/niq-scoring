import { assertAssignmentEligible } from "./version-eligibility";
import { postgresBindAssessment } from "./postgres-assessment-binding";
import { postgresOrganizationInfo } from "./postgres-organization-info";
import type { BindingInput } from "./assessment-binding";
import type { ReserveInput } from "./store";
import { PostgresRuleStore } from "./postgres-rule-store";
import { DuplicateClientNameError } from "./lib/client-name";
import { postgresDeletion, type RecordKind } from "./record-deletion";
import type { StoredActivationToken, TokenRecord, CredentialRevocation } from "./store";
import postgres from "postgres";
import type { DeploymentConfiguration, CreateDeployment, CreateClient, EntitlementInput, VersionAssignmentInput } from "@niq-scoring/contracts";
import { PROVISIONAL_SCORING_VERSION } from "@niq-scoring/contracts";
import { decideEntitlement, type Capability } from "@niq-scoring/entitlements";
import { createEntityId } from "./lib/id";
import { buildUsageSummary, type DeploymentUsage, type UsageCount } from "./usage-summary";
import { buildAdminDashboard, previousMonthComparisonEnd, type DashboardUsageEvent, type DashboardActivation } from "./admin-dashboard";
import { recordAdminMutation, type AdminMutationAudit } from "./admin-mutation-audit";
import type { Deployment, DeploymentCreateRequest, PriorDeploymentCreate, DeploymentIdentity, Client, ScoringStore, UsageReservation, RuleUsage } from "./store";

type Database = ReturnType<typeof postgres>;

export class PostgresScoringStore implements ScoringStore {
  async organizationInfo(identity: DeploymentIdentity, now: Date) { return postgresOrganizationInfo(this.database, identity, now); }
  async bindAssessment(input: BindingInput) { return postgresBindAssessment(this.database, input); }
  async deletionStatus(kind: RecordKind, id: string) { return postgresDeletion(this.database, kind, id); }
  async deleteUnused(kind: RecordKind, id: string, audit?: AdminMutationAudit) { return postgresDeletion(this.database, kind, id, true, audit); }
  readonly rules: PostgresRuleStore;
  constructor(private readonly database: Database) { this.rules = new PostgresRuleStore(database); }

  async overview() {
    const [clients, deployments, entitlements, assignments, versions] = await Promise.all([
      this.database<Client[]>`select id, name, enabled from clients order by created_at`,
      this.database<Deployment[]>`select id, client_id as "clientId", name, environment, hosting_type as "hostingType", enabled from deployments order by created_at, id`,
      this.database<Array<EntitlementInput & { deploymentId: string }>>`select deployment_id as "deploymentId", capability, enabled, monthly_limit as "monthlyLimit" from entitlements where effective_until is null`,
      this.database<Array<{ deploymentId: string; mode: "LATEST_APPROVED" | "PINNED"; scoringRuleVersionId: string | null }>>`select deployment_id as "deploymentId", mode, scoring_rule_version_id as "scoringRuleVersionId" from deployment_version_assignments where effective_until is null`,
      this.database<Array<{ id: string; version: string; lifecycle: string; clinicalUsePermitted: boolean; isDefault: boolean }>>`select id, version, lifecycle, clinical_use_permitted as "clinicalUsePermitted", exists(select 1 from scoring_rule_default where rule_id=scoring_rule_versions.id) as "isDefault" from scoring_rule_versions order by created_at desc`,
    ]);
    return { clients: [...clients], deployments: [...deployments], entitlements: [...entitlements], assignments: assignments.map((row) => row.mode === "PINNED" ? { deploymentId: row.deploymentId, mode: "PINNED" as const, scoringRuleVersionId: row.scoringRuleVersionId! } : { deploymentId: row.deploymentId, mode: "LATEST_APPROVED" as const }), versions: [...versions] };
  }

  async dashboard(now: Date) {
    const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 5, 1));
    const comparisonEnd = previousMonthComparisonEnd(now);
    const previousStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1));
    const lastDay = new Date(now.getTime() - 24 * 60 * 60 * 1000);
    const [overview, usage, recentFailures, limitUsage, activations, previousComparable] = await Promise.all([
      this.overview(),
      this.database<DashboardUsageEvent[]>`select client_id as "clientId", deployment_id as "deploymentId", capability, outcome,
        date_trunc('month', occurred_at at time zone 'UTC') at time zone 'UTC' as "occurredAt",
        count(*)::int as count
        from usage_events where occurred_at >= ${start} and occurred_at <= ${now}
        group by client_id, deployment_id, capability, outcome, "occurredAt"`,
      this.database<Array<{ count: number }>>`select count(*)::int as count from usage_events
        where capability='SCORING' and outcome='FAILED' and completed_at >= ${lastDay} and completed_at <= ${now}`,
      this.database<Array<{ deploymentId: string; capability: "SCORING" | "FACE_SCAN"; used: number }>>`select deployment_id as "deploymentId", capability, count(*)::int as used
        from usage_events where occurred_at >= ${new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1))}
        and occurred_at <= ${now} and (billable=true or outcome='PENDING') group by deployment_id, capability`,
      this.database<DashboardActivation[]>`select deployment_id as "deploymentId", expires_at as "expiresAt", used_at as "usedAt", revoked_at as "revokedAt"
        from activation_tokens where used_at is null and revoked_at is null and expires_at > ${now}
        and expires_at <= ${new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000)}`,
      comparisonEnd ? this.database<Array<{ assessments: number; faceScans: number; failedRequests: number }>>`
        select (count(*) filter (where capability='SCORING' and outcome='SUCCEEDED'))::int as assessments,
          (count(*) filter (where capability='FACE_SCAN' and outcome='SUCCEEDED'))::int as "faceScans",
          (count(*) filter (where outcome='FAILED'))::int as "failedRequests"
        from usage_events where occurred_at >= ${previousStart} and occurred_at <= ${comparisonEnd}` : Promise.resolve([]),
    ]);
    return buildAdminDashboard({
      now, clients: overview.clients, deployments: overview.deployments,
      entitlements: overview.entitlements, usage, activations,
      recentFailedScoringCount: recentFailures[0]?.count ?? 0, limitUsage,
      ...(previousComparable[0] ? { previousComparableCounts: previousComparable[0] } : {}),
    });
  }

  async usageByDeployment(clientId: string, now: Date): Promise<DeploymentUsage[]> {
    const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 5, 1));
    const [deployments, totals, monthly] = await Promise.all([
      this.database<Array<{ id: string }>>`select id from deployments where client_id=${clientId} order by created_at`,
      this.database<UsageCount[]>`select deployment_id as "deploymentId", capability, count(*)::int as count from usage_events where client_id=${clientId} and outcome='SUCCEEDED' and occurred_at<=${now} group by deployment_id, capability`,
      this.database<UsageCount[]>`select deployment_id as "deploymentId", capability, to_char(occurred_at at time zone 'UTC','YYYY-MM') as month, count(*)::int as count from usage_events where client_id=${clientId} and outcome='SUCCEEDED' and occurred_at>=${start} and occurred_at<=${now} group by deployment_id, capability, month`,
    ]);
    return buildUsageSummary(deployments.map(item => item.id), totals, monthly, now);
  }

  async usageByRule(clientId?: string): Promise<RuleUsage[]> {
    const rows = await this.database<RuleUsage[]>`
      select u.scoring_rule_version_id as "ruleVersionId",
             coalesce(v.version, 'Rule not recorded') as name,
             count(*)::int as count
      from usage_events u
      left join scoring_rule_versions v on v.id = u.scoring_rule_version_id
      where u.capability = 'SCORING' and u.outcome = 'SUCCEEDED'
        and (${clientId ?? null}::varchar is null or u.client_id = ${clientId ?? null})
      group by u.scoring_rule_version_id, v.version
      order by count desc, name asc`;
    return [...rows];
  }

  async createClient(input: CreateClient, audit?: AdminMutationAudit) {
    return this.database.begin(async tx => {
      const id = createEntityId();
      const [row] = await tx<Client[]>`insert into clients (id, name) values (${id}, ${input.name}) on conflict (lower(btrim(name))) do nothing returning id, name, enabled`;
      if (!row) throw new DuplicateClientNameError();
      await recordAdminMutation(tx, audit, "CLIENT_CREATED", "CLIENT", id, { name: input.name });
      return row;
    });
  }
  async setClientEnabled(id: string, enabled: boolean, audit?: AdminMutationAudit) {
    return this.database.begin(async tx => {
      const [prior] = await tx<Array<{ enabled: boolean }>>`select enabled from clients where id=${id} for update`;
      if (!prior) return false;
      if (prior.enabled === enabled) return true;
      await tx`update clients set enabled=${enabled}, updated_at=now() where id=${id}`;
      await recordAdminMutation(tx, audit, "CLIENT_STATUS_CHANGED", "CLIENT", id, { before: prior.enabled, after: enabled });
      return true;
    });
  }
  async createDeployment(input: CreateDeployment, audit?: AdminMutationAudit) {
    return this.database.begin(async (tx) => {
      const id = createEntityId();
      const [row] = await tx<Deployment[]>`insert into deployments (id, client_id, name, environment) values (${id}, ${input.clientId}, ${input.name}, ${input.environment}) returning id, client_id as "clientId", name, environment, hosting_type as "hostingType", enabled`;
      await recordAdminMutation(tx, audit, "DEPLOYMENT_CREATED", "DEPLOYMENT", id, { clientId: input.clientId, name: input.name, environment: input.environment });
      return row!;
    });
  }
  async findDeploymentCreate(key: string): Promise<PriorDeploymentCreate | null> {
    const [row] = await this.database<Array<{ fingerprint: string; activationTokenId: string | null; id: string | null; clientId: string | null; name: string | null; environment: Deployment["environment"] | null; hostingType: Deployment["hostingType"]; enabled: boolean | null }>>`
      select e.metadata->>'fingerprint' as fingerprint,e.metadata->>'activationTokenId' as "activationTokenId",
        d.id,d.client_id as "clientId",d.name,d.environment,d.hosting_type as "hostingType",d.enabled
      from audit_events e left join deployments d on d.id=e.resource_reference
      where e.action='DEPLOYMENT_CREATED' and e.metadata->>'createKey'=${key} limit 1`;
    if (!row) return null;
    return { fingerprint: row.fingerprint, activationTokenId: row.activationTokenId,
      deployment: row.id ? { id: row.id, clientId: row.clientId!, name: row.name!, environment: row.environment!, hostingType: row.hostingType, enabled: row.enabled! } : null };
  }
  async saveDeploymentConfiguration(id: string | null, input: DeploymentConfiguration, activation?: StoredActivationToken, audit?: AdminMutationAudit, createRequest?: DeploymentCreateRequest) {
    return this.database.begin(async tx => {
      const deploymentId = id ?? createEntityId();
      const [before] = id ? await tx<Deployment[]>`select id, client_id as "clientId", name, environment, hosting_type as "hostingType", enabled from deployments where id=${id} and client_id=${input.clientId} for update` : [];
      const beforeEntitlements: Array<{ capability: string; enabled: boolean; monthlyLimit: number | null }> = [];
      const [deployment] = id
        ? await tx<Deployment[]>`update deployments set name=${input.name}, environment=${input.environment}, hosting_type=${input.hostingType}, enabled=${input.enabled}, updated_at=now() where id=${id} and client_id=${input.clientId} returning id, client_id as "clientId", name, environment, hosting_type as "hostingType", enabled`
        : await tx<Deployment[]>`insert into deployments (id,client_id,name,environment,hosting_type,enabled) values (${deploymentId},${input.clientId},${input.name},${input.environment},${input.hostingType},${input.enabled}) returning id, client_id as "clientId", name, environment, hosting_type as "hostingType", enabled`;
      if (!deployment) return null;
      // Persist the complete form atomically; credentials and usage remain untouched.
      for (const capability of ["SCORING", "FACE_SCAN"] as const) {
        const setting = capability === "SCORING" ? input.scoring : input.faceScan;
        await tx`select pg_advisory_xact_lock(hashtext(${`${deploymentId}:${capability}`}))`;
        const [prior] = await tx<Array<{ capability: string; enabled: boolean; monthlyLimit: number | null }>>`select capability,enabled,monthly_limit as "monthlyLimit" from entitlements where deployment_id=${deploymentId} and capability=${capability} and effective_until is null`;
        if (prior) beforeEntitlements.push(prior);
        await tx`update entitlements set effective_until=clock_timestamp(), updated_at=clock_timestamp() where deployment_id=${deploymentId} and capability=${capability} and effective_until is null`;
        await tx`insert into entitlements (id,deployment_id,capability,enabled,monthly_limit) values (${createEntityId()},${deploymentId},${capability},${setting.enabled},${setting.monthlyLimit})`;
      }
      const policy = input.versionAssignment;
      await tx`select pg_advisory_xact_lock(hashtext(${`version:${deploymentId}`}))`;
      await assertAssignmentEligible(tx, deploymentId, policy);
      const [beforeAssignment] = await tx<Array<{ mode: string; scoringRuleVersionId: string | null }>>`select mode,scoring_rule_version_id as "scoringRuleVersionId" from deployment_version_assignments where deployment_id=${deploymentId} and effective_until is null`;
      await tx`update deployment_version_assignments set effective_until=clock_timestamp() where deployment_id=${deploymentId} and effective_until is null`;
      await tx`insert into deployment_version_assignments (id,deployment_id,mode,scoring_rule_version_id) values (${createEntityId()},${deploymentId},${policy.mode},${policy.mode === "PINNED" ? policy.scoringRuleVersionId : null})`;
      if (activation) await tx`insert into activation_tokens (id,deployment_id,token_hash,token_ciphertext,expires_at) values (${activation.id},${deploymentId},${activation.tokenHash},${activation.tokenCiphertext},${activation.expiresAt})`;
      await recordAdminMutation(tx, audit, id ? "DEPLOYMENT_CONFIGURATION_UPDATED" : "DEPLOYMENT_CREATED", "DEPLOYMENT", deploymentId, {
        clientId: input.clientId,
        before: before ? { name: before.name, environment: before.environment, hostingType: before.hostingType, enabled: before.enabled, entitlements: beforeEntitlements, versionAssignment: beforeAssignment ?? null } : null,
        after: { name: input.name, environment: input.environment, hostingType: input.hostingType, enabled: input.enabled, scoring: input.scoring, faceScan: input.faceScan, versionAssignment: policy },
        ...(activation ? { activationTokenId: activation.id, activationExpiresAt: activation.expiresAt } : {}),
        ...(createRequest ? { createKey: createRequest.key, fingerprint: createRequest.fingerprint } : {}),
      });
      return deployment;
    });
  }
  async setDeploymentEnabled(id: string, enabled: boolean, audit?: AdminMutationAudit) {
    return this.database.begin(async tx => {
      const [prior] = await tx<Array<{ enabled: boolean }>>`select enabled from deployments where id=${id} for update`;
      if (!prior) return false;
      if (prior.enabled === enabled) return true;
      await tx`update deployments set enabled=${enabled}, updated_at=now() where id=${id}`;
      await recordAdminMutation(tx, audit, "DEPLOYMENT_STATUS_CHANGED", "DEPLOYMENT", id, { before: prior.enabled, after: enabled });
      return true;
    });
  }
  async setEntitlement(deploymentId: string, input: EntitlementInput, audit?: AdminMutationAudit) {
    await this.database.begin(async (tx) => {
      await tx`select pg_advisory_xact_lock(hashtext(${`${deploymentId}:${input.capability}`}))`;
      const [before] = await tx<Array<{ enabled: boolean; monthlyLimit: number | null }>>`select enabled,monthly_limit as "monthlyLimit" from entitlements where deployment_id=${deploymentId} and capability=${input.capability} and effective_until is null`;
      await tx`update entitlements set effective_until=now(), updated_at=now() where deployment_id=${deploymentId} and capability=${input.capability} and effective_until is null`;
      await tx`insert into entitlements (id, deployment_id, capability, enabled, monthly_limit) values (${createEntityId()}, ${deploymentId}, ${input.capability}, ${input.enabled}, ${input.monthlyLimit})`;
      await recordAdminMutation(tx, audit, "DEPLOYMENT_ENTITLEMENT_UPDATED", "DEPLOYMENT", deploymentId, { capability: input.capability, before: before ?? null, after: { enabled: input.enabled, monthlyLimit: input.monthlyLimit } });
    });
  }
  async assignVersion(deploymentId: string, input: VersionAssignmentInput, audit?: AdminMutationAudit) {
    await this.database.begin(async (tx) => {
      await tx`select pg_advisory_xact_lock(hashtext(${`version:${deploymentId}`}))`;
      await assertAssignmentEligible(tx, deploymentId, input);
      const [before] = await tx<Array<{ mode: string; scoringRuleVersionId: string | null }>>`select mode,scoring_rule_version_id as "scoringRuleVersionId" from deployment_version_assignments where deployment_id=${deploymentId} and effective_until is null`;
      await tx`update deployment_version_assignments set effective_until=now() where deployment_id=${deploymentId} and effective_until is null`;
      await tx`insert into deployment_version_assignments (id, deployment_id, mode, scoring_rule_version_id) values (${createEntityId()}, ${deploymentId}, ${input.mode}, ${input.mode === "PINNED" ? input.scoringRuleVersionId : null})`;
      await recordAdminMutation(tx, audit, "DEPLOYMENT_RULE_ASSIGNED", "DEPLOYMENT", deploymentId, { before: before ?? null, after: input });
    });
  }
  async storeActivationToken(input: StoredActivationToken & { deploymentId: string }, audit?: AdminMutationAudit) {
    await this.database.begin(async tx => {
      // Serialize replacement requests so only the latest unused token survives.
      await tx`select id from deployments where id=${input.deploymentId} for update`;
      const replaced = await tx<Array<{ id: string }>>`update activation_tokens set revoked_at=now(), token_ciphertext=null where deployment_id=${input.deploymentId} and used_at is null and revoked_at is null returning id`;
      await tx`insert into activation_tokens (id,deployment_id,token_hash,token_ciphertext,expires_at) values (${input.id},${input.deploymentId},${input.tokenHash},${input.tokenCiphertext},${input.expiresAt})`;
      await recordAdminMutation(tx, audit, "ACTIVATION_TOKEN_CREATED", "ACTIVATION_TOKEN", input.id, { deploymentId: input.deploymentId, expiresAt: input.expiresAt, replacedTokenIds: replaced.map(row => row.id) });
    });
  }
  async getActivationToken(deploymentId: string, now: Date, tokenId?: string) {
    const [token] = await this.database<Array<{ tokenCiphertext: string; expiresAt: Date | null }>>`select token_ciphertext as "tokenCiphertext", expires_at as "expiresAt" from activation_tokens where deployment_id=${deploymentId} and used_at is null and revoked_at is null and (expires_at is null or expires_at>${now}) and (${tokenId ?? null}::varchar is null or id=${tokenId ?? null}) and token_ciphertext is not null order by created_at desc limit 1`;
    return token ?? null;
  }
  async listActivationTokens(deploymentId: string) {
    return this.database<TokenRecord[]>`select token.id, token.expires_at as "expiresAt", token.created_at as "createdAt", token.used_at as "usedAt", token.revoked_at as "revokedAt", (token.token_ciphertext is not null) as "canCopy", case when credential.id is null then null when credential.revoked_at is not null then 'Revoked' when credential.expires_at is not null and credential.expires_at<=now() then 'Expired' else 'Active' end as "credentialStatus" from activation_tokens token left join deployment_credentials credential on credential.id=token.credential_id and credential.deployment_id=token.deployment_id where token.deployment_id=${deploymentId} order by token.created_at desc, token.id desc`;
  }
  async revokeActivationToken(deploymentId: string, tokenId: string, now: Date, audit?: AdminMutationAudit) {
    return this.database.begin(async tx => {
      const rows = await tx`update activation_tokens set revoked_at=${now}, token_ciphertext=null where deployment_id=${deploymentId} and id=${tokenId} and used_at is null and revoked_at is null returning id`;
      if (!rows.length) return false;
      await recordAdminMutation(tx, audit, "ACTIVATION_TOKEN_REVOKED", "ACTIVATION_TOKEN", tokenId, { deploymentId });
      return true;
    });
  }
  async revokeTokenCredential(deploymentId: string, tokenId: string, now: Date, audit?: AdminMutationAudit): Promise<CredentialRevocation> {
    return this.database.begin(async tx => {
      const [credential] = await tx<Array<{ id: string; revokedAt: Date | null }>>`select credential.id, credential.revoked_at as "revokedAt" from activation_tokens token join deployment_credentials credential on credential.id=token.credential_id and credential.deployment_id=token.deployment_id where token.deployment_id=${deploymentId} and token.id=${tokenId} and token.used_at is not null for update of credential`;
      if (!credential) return "UNAVAILABLE";
      if (credential.revokedAt) return "ALREADY_REVOKED";
      await tx`update deployment_credentials set revoked_at=${now} where id=${credential.id} and deployment_id=${deploymentId}`;
      await recordAdminMutation(tx, audit, "DEPLOYMENT_CREDENTIAL_REVOKED", "DEPLOYMENT_CREDENTIAL", credential.id, { deploymentId, tokenId });
      return "REVOKED";
    });
  }
  async exchangeActivation(input: { tokenHash: string; credentialId: string; keyPrefix: string; secretHash: string; now: Date }) {
    return this.database.begin(async (tx) => {
      const [token] = await tx<Array<{ id: string; deploymentId: string }>>`select id, deployment_id as "deploymentId" from activation_tokens where token_hash=${input.tokenHash} and used_at is null and revoked_at is null and (expires_at is null or expires_at>${input.now}) for update`;
      if (!token) return null;
      const [client] = await tx<Array<{ clientId: string }>>`select client.id as "clientId" from deployments link join clients client on client.id=link.client_id where link.id=${token.deploymentId}`;
      if (!client) return null;
      await tx`insert into deployment_credentials (id, deployment_id, key_prefix, secret_hash, hash_algorithm) values (${input.credentialId}, ${token.deploymentId}, ${input.keyPrefix}, ${input.secretHash}, 'sha256')`;
      await tx`update activation_tokens set used_at=${input.now}, token_ciphertext=null, credential_id=${input.credentialId} where id=${token.id} and deployment_id=${token.deploymentId}`;
      return { deploymentId: token.deploymentId, clientId: client.clientId };
    });
  }
  async authenticateDeployment(keyPrefix: string, secretHash: string) {
    const [row] = await this.database<DeploymentIdentity[]>`select dc.id as "credentialId", d.id as "deploymentId", d.client_id as "clientId" from deployment_credentials dc join deployments d on d.id=dc.deployment_id where dc.key_prefix=${keyPrefix} and dc.secret_hash=${secretHash} and dc.revoked_at is null and (dc.expires_at is null or dc.expires_at>now())`;
    if (row) await this.database`update deployment_credentials set last_used_at=now() where id=${row.credentialId}`;
    return row ?? null;
  }
  async reserveUsage(input: ReserveInput): Promise<UsageReservation> {
    return this.database.begin(async (tx) => {
      await tx`select pg_advisory_xact_lock(hashtext(${`${input.identity.deploymentId}:${input.capability}:${input.idempotencyKey}`}))`;
      const [scope] = await tx<Array<{ clientEnabled: boolean; deploymentEnabled: boolean }>>`select o.enabled as "clientEnabled", d.enabled as "deploymentEnabled" from deployments d join clients o on o.id=d.client_id where d.client_id=${input.identity.clientId} and d.id=${input.identity.deploymentId} and o.id=${input.clientId}`;
      if (!scope) return { status: "REJECTED", reason: "CLIENT_NOT_ALLOWED" };
      const [entitlement] = await tx<Array<{ enabled: boolean; monthlyLimit: number | null }>>`select enabled, monthly_limit as "monthlyLimit" from entitlements where deployment_id=${input.identity.deploymentId} and capability=${input.capability} and effective_until is null for update`;
      if (!entitlement?.enabled) return { status: "REJECTED", reason: "CAPABILITY_DISABLED" };
      const [duplicate] = await tx<Array<{ id: string; outcome: string; response: unknown; fingerprint: string | null }>>`select id, outcome, response_payload as response, request_fingerprint as fingerprint from usage_events where deployment_id=${input.identity.deploymentId} and capability=${input.capability} and idempotency_key=${input.idempotencyKey}`;
      if (!input.platformEnabled || !scope.clientEnabled || !scope.deploymentEnabled) return { status: "REJECTED", reason: !input.platformEnabled ? "PLATFORM_DISABLED" : !scope.clientEnabled ? "CLIENT_DISABLED" : "DEPLOYMENT_DISABLED" };
      if (duplicate && duplicate.fingerprint !== (input.fingerprint ?? null)) return { status: "REJECTED", reason: "IDEMPOTENCY_CONFLICT" };
      if (duplicate?.response != null) return { status: "DUPLICATE", usageId: duplicate.id, response: duplicate.response };
      if (duplicate?.outcome === "PENDING") return { status: "REJECTED", reason: "REQUEST_IN_PROGRESS" };
      const [assignment] = await tx<Array<{ mode: "LATEST_APPROVED" | "PINNED"; scoringRuleVersionId: string | null }>>`select mode, scoring_rule_version_id as "scoringRuleVersionId" from deployment_version_assignments where deployment_id=${input.identity.deploymentId} and effective_until is null`;
      const [resolvedVersion] = assignment?.mode === "PINNED"
        ? await tx<Array<{ id: string; version: string }>>`select id, version from scoring_rule_versions where id=${assignment.scoringRuleVersionId}`
        : await tx<Array<{ id: string; version: string }>>`select id, version from scoring_rule_versions where lifecycle in ('APPROVED','ACTIVE') order by approved_at desc nulls last, created_at desc limit 1`;
      const [bound] = input.binding ? await tx`select id from assessment_bindings where id=${input.binding.id} and deployment_id=${input.identity.deploymentId} and assessment_reference=${input.assessmentReference} and scoring_rule_version_id=${input.binding.ruleVersionId} and package_checksum=${input.binding.checksum}` : [];
      const [count] = await tx<Array<{ value: number }>>`select count(*)::int as value from usage_events where deployment_id=${input.identity.deploymentId} and capability=${input.capability} and (billable=true or outcome='PENDING') and occurred_at >= (date_trunc('month', now() at time zone 'UTC') at time zone 'UTC')`;
      const decision = decideEntitlement({ platformEnabled: input.platformEnabled, clientEnabled: scope.clientEnabled, deploymentEnabled: scope.deploymentEnabled, versionActive: input.capability === "FACE_SCAN" || Boolean(bound) || resolvedVersion?.version === PROVISIONAL_SCORING_VERSION, monthlyLimit: entitlement.monthlyLimit, monthlyUsage: count?.value ?? 0 });
      if (!decision.allowed) return { status: "REJECTED", reason: decision.reason };
      const usageId = duplicate?.id ?? createEntityId();
      if (duplicate) await tx`update usage_events set outcome='PENDING', response_payload=null, completed_at=null, occurred_at=now(), request_fingerprint=${input.fingerprint ?? null}, scoring_rule_version_id=${input.binding?.ruleVersionId ?? null} where id=${usageId}`;
      else await tx`insert into usage_events (id, client_id, deployment_id, credential_id, capability, request_id, idempotency_key, assessment_reference, request_fingerprint, scoring_rule_version_id, outcome) values (${usageId}, ${input.clientId}, ${input.identity.deploymentId}, ${input.identity.credentialId}, ${input.capability}, ${input.idempotencyKey}, ${input.idempotencyKey}, ${input.assessmentReference}, ${input.fingerprint ?? null}, ${input.binding?.ruleVersionId ?? null}, 'PENDING')`;
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
