import postgres from "postgres";
import type { CreateCustomer, CreateDeployment, CreateOrganization, EntitlementInput, VersionAssignmentInput } from "@niq-scoring/contracts";
import { PROVISIONAL_SCORING_VERSION } from "@niq-scoring/contracts";
import { decideEntitlement, type Capability } from "@niq-scoring/entitlements";
import { createEntityId } from "./lib/id";
import type { Customer, Deployment, DeploymentIdentity, Organization, ScoringStore, UsageReservation } from "./store";

type Database = ReturnType<typeof postgres>;

export class PostgresScoringStore implements ScoringStore {
  constructor(private readonly database: Database) {}

  async overview() {
    const [customers, organizations, deployments, links, entitlements, assignments, versions] = await Promise.all([
      this.database<Customer[]>`select id, legal_name as "legalName", external_reference as "externalReference", enabled from customers order by created_at`,
      this.database<Organization[]>`select id, customer_id as "customerId", name, external_reference as "externalReference", enabled from organizations order by created_at`,
      this.database<Array<Omit<Deployment, "organizationIds">>>`select id, customer_id as "customerId", name, environment, region, enabled from deployments order by created_at`,
      this.database<Array<{ deploymentId: string; organizationId: string }>>`select deployment_id as "deploymentId", organization_id as "organizationId" from deployment_organizations`,
      this.database<Array<EntitlementInput & { organizationId: string }>>`select organization_id as "organizationId", capability, enabled, monthly_limit as "monthlyLimit" from entitlements where effective_until is null`,
      this.database<Array<{ organizationId: string; mode: "LATEST_APPROVED" | "PINNED"; scoringRuleVersionId: string | null }>>`select organization_id as "organizationId", mode, scoring_rule_version_id as "scoringRuleVersionId" from organization_version_assignments where effective_until is null`,
      this.database<Array<{ id: string; version: string; lifecycle: string; clinicalUsePermitted: boolean }>>`select id, version, lifecycle, clinical_use_permitted as "clinicalUsePermitted" from scoring_rule_versions order by created_at desc`,
    ]);
    return { customers: [...customers], organizations: [...organizations], deployments: deployments.map((row) => ({ ...row, organizationIds: links.filter((link) => link.deploymentId === row.id).map((link) => link.organizationId) })), entitlements: [...entitlements], assignments: assignments.map((row) => row.mode === "PINNED" ? { organizationId: row.organizationId, mode: "PINNED" as const, scoringRuleVersionId: row.scoringRuleVersionId! } : { organizationId: row.organizationId, mode: "LATEST_APPROVED" as const }), versions: [...versions] };
  }

  async createCustomer(input: CreateCustomer) {
    const id = createEntityId();
    const [row] = await this.database<Customer[]>`insert into customers (id, legal_name, external_reference) values (${id}, ${input.legalName}, ${input.externalReference}) returning id, legal_name as "legalName", external_reference as "externalReference", enabled`;
    return row!;
  }
  async setCustomerEnabled(id: string, enabled: boolean) { const rows = await this.database`update customers set enabled=${enabled}, updated_at=now() where id=${id} returning id`; return rows.length === 1; }
  async createOrganization(input: CreateOrganization) {
    const id = createEntityId();
    const [row] = await this.database<Organization[]>`insert into organizations (id, customer_id, name, external_reference) values (${id}, ${input.customerId}, ${input.name}, ${input.externalReference}) returning id, customer_id as "customerId", name, external_reference as "externalReference", enabled`;
    return row!;
  }
  async setOrganizationEnabled(id: string, enabled: boolean) { const rows = await this.database`update organizations set enabled=${enabled}, updated_at=now() where id=${id} returning id`; return rows.length === 1; }
  async createDeployment(input: CreateDeployment) {
    return this.database.begin(async (tx) => {
      const id = createEntityId();
      const [row] = await tx<Array<Omit<Deployment, "organizationIds">>>`insert into deployments (id, customer_id, name, environment, region) values (${id}, ${input.customerId}, ${input.name}, ${input.environment}, ${input.region}) returning id, customer_id as "customerId", name, environment, region, enabled`;
      for (const organizationId of input.organizationIds) await tx`insert into deployment_organizations (customer_id, deployment_id, organization_id) values (${input.customerId}, ${id}, ${organizationId})`;
      return { ...row!, organizationIds: input.organizationIds };
    });
  }
  async setDeploymentEnabled(id: string, enabled: boolean) { const rows = await this.database`update deployments set enabled=${enabled}, updated_at=now() where id=${id} returning id`; return rows.length === 1; }
  async setEntitlement(organizationId: string, input: EntitlementInput) {
    await this.database.begin(async (tx) => {
      await tx`select pg_advisory_xact_lock(hashtext(${`${organizationId}:${input.capability}`}))`;
      await tx`update entitlements set effective_until=now(), updated_at=now() where organization_id=${organizationId} and capability=${input.capability} and effective_until is null`;
      await tx`insert into entitlements (id, organization_id, capability, enabled, monthly_limit) values (${createEntityId()}, ${organizationId}, ${input.capability}, ${input.enabled}, ${input.monthlyLimit})`;
    });
  }
  async assignVersion(organizationId: string, input: VersionAssignmentInput) {
    await this.database.begin(async (tx) => {
      await tx`select pg_advisory_xact_lock(hashtext(${`version:${organizationId}`}))`;
      await tx`update organization_version_assignments set effective_until=now() where organization_id=${organizationId} and effective_until is null`;
      await tx`insert into organization_version_assignments (id, organization_id, mode, scoring_rule_version_id) values (${createEntityId()}, ${organizationId}, ${input.mode}, ${input.mode === "PINNED" ? input.scoringRuleVersionId : null})`;
    });
  }
  async storeActivationToken(input: { id: string; deploymentId: string; tokenHash: string; expiresAt: Date }) { await this.database`insert into activation_tokens (id, deployment_id, token_hash, expires_at) values (${input.id}, ${input.deploymentId}, ${input.tokenHash}, ${input.expiresAt})`; }
  async exchangeActivation(input: { tokenHash: string; organizationReference: string; credentialId: string; keyPrefix: string; secretHash: string; now: Date }) {
    return this.database.begin(async (tx) => {
      const [token] = await tx<Array<{ deploymentId: string }>>`select deployment_id as "deploymentId" from activation_tokens where token_hash=${input.tokenHash} and used_at is null and expires_at>${input.now} for update`;
      if (!token) return null;
      const [organization] = await tx<Array<{ organizationId: string }>>`select organization.id as "organizationId" from deployment_organizations link join organizations organization on organization.customer_id=link.customer_id and organization.id=link.organization_id where link.deployment_id=${token.deploymentId} and organization.external_reference=${input.organizationReference}`;
      if (!organization) return null;
      await tx`update activation_tokens set used_at=${input.now} where token_hash=${input.tokenHash}`;
      await tx`insert into deployment_credentials (id, deployment_id, key_prefix, secret_hash, hash_algorithm) values (${input.credentialId}, ${token.deploymentId}, ${input.keyPrefix}, ${input.secretHash}, 'sha256')`;
      return { deploymentId: token.deploymentId, organizationId: organization.organizationId };
    });
  }
  async authenticateDeployment(keyPrefix: string, secretHash: string) {
    const [row] = await this.database<DeploymentIdentity[]>`select dc.id as "credentialId", d.id as "deploymentId", d.customer_id as "customerId" from deployment_credentials dc join deployments d on d.id=dc.deployment_id where dc.key_prefix=${keyPrefix} and dc.secret_hash=${secretHash} and dc.revoked_at is null and (dc.expires_at is null or dc.expires_at>now())`;
    if (row) await this.database`update deployment_credentials set last_used_at=now() where id=${row.credentialId}`;
    return row ?? null;
  }
  async reserveUsage(input: { identity: DeploymentIdentity; organizationId: string; capability: Capability; idempotencyKey: string; assessmentReference: string; platformEnabled: boolean }): Promise<UsageReservation> {
    return this.database.begin(async (tx) => {
      await tx`select pg_advisory_xact_lock(hashtext(${`${input.identity.deploymentId}:${input.capability}:${input.idempotencyKey}`}))`;
      const [duplicate] = await tx<Array<{ id: string; outcome: string; response: unknown }>>`select id, outcome, response_payload as response from usage_events where deployment_id=${input.identity.deploymentId} and capability=${input.capability} and idempotency_key=${input.idempotencyKey}`;
      if (duplicate?.response != null) return { status: "DUPLICATE", usageId: duplicate.id, response: duplicate.response };
      if (duplicate?.outcome === "PENDING") return { status: "REJECTED", reason: "REQUEST_IN_PROGRESS" };
      const [scope] = await tx<Array<{ customerEnabled: boolean; organizationEnabled: boolean; deploymentEnabled: boolean }>>`select c.enabled as "customerEnabled", o.enabled as "organizationEnabled", d.enabled as "deploymentEnabled" from deployment_organizations link join customers c on c.id=link.customer_id join organizations o on o.id=link.organization_id join deployments d on d.id=link.deployment_id where link.customer_id=${input.identity.customerId} and link.deployment_id=${input.identity.deploymentId} and link.organization_id=${input.organizationId}`;
      if (!scope) return { status: "REJECTED", reason: "ORGANIZATION_NOT_ALLOWED" };
      const [entitlement] = await tx<Array<{ enabled: boolean; monthlyLimit: number | null }>>`select enabled, monthly_limit as "monthlyLimit" from entitlements where organization_id=${input.organizationId} and capability=${input.capability} and effective_until is null for update`;
      if (!entitlement?.enabled) return { status: "REJECTED", reason: "CAPABILITY_DISABLED" };
      const [assignment] = await tx<Array<{ mode: "LATEST_APPROVED" | "PINNED"; scoringRuleVersionId: string | null }>>`select mode, scoring_rule_version_id as "scoringRuleVersionId" from organization_version_assignments where organization_id=${input.organizationId} and effective_until is null`;
      const [resolvedVersion] = assignment?.mode === "PINNED"
        ? await tx<Array<{ id: string; version: string }>>`select id, version from scoring_rule_versions where id=${assignment.scoringRuleVersionId}`
        : await tx<Array<{ id: string; version: string }>>`select id, version from scoring_rule_versions where lifecycle in ('APPROVED','ACTIVE') order by approved_at desc nulls last, created_at desc limit 1`;
      const [count] = await tx<Array<{ value: number }>>`select count(*)::int as value from usage_events where organization_id=${input.organizationId} and capability=${input.capability} and (billable=true or outcome='PENDING') and occurred_at >= (date_trunc('month', now() at time zone 'UTC') at time zone 'UTC')`;
      const decision = decideEntitlement({ platformEnabled: input.platformEnabled, organizationEnabled: scope.customerEnabled && scope.organizationEnabled, deploymentEnabled: scope.deploymentEnabled, versionActive: input.capability === "FACE_SCAN" || resolvedVersion?.version === PROVISIONAL_SCORING_VERSION, monthlyLimit: entitlement.monthlyLimit, monthlyUsage: count?.value ?? 0 });
      if (!decision.allowed) return { status: "REJECTED", reason: decision.reason };
      const usageId = duplicate?.id ?? createEntityId();
      if (duplicate) await tx`update usage_events set outcome='PENDING', response_payload=null, completed_at=null, occurred_at=now() where id=${usageId}`;
      else await tx`insert into usage_events (id, customer_id, organization_id, deployment_id, credential_id, capability, request_id, idempotency_key, assessment_reference, outcome) values (${usageId}, ${input.identity.customerId}, ${input.organizationId}, ${input.identity.deploymentId}, ${input.identity.credentialId}, ${input.capability}, ${input.idempotencyKey}, ${input.idempotencyKey}, ${input.assessmentReference}, 'PENDING')`;
      return { status: "NEW", usageId, version: resolvedVersion?.version ?? PROVISIONAL_SCORING_VERSION };
    });
  }
  async completeUsage(usageId: string, response: unknown) { await this.database`update usage_events set outcome='SUCCEEDED', billable=true, response_payload=${this.database.json(response as never)}, completed_at=now() where id=${usageId} and outcome='PENDING'`; }
  async storePendingUsageResponse(usageId: string, response: unknown) { await this.database`update usage_events set response_payload=${this.database.json(response as never)} where id=${usageId} and outcome='PENDING'`; }
  async failUsage(usageId: string) { await this.database`update usage_events set outcome='FAILED', completed_at=now() where id=${usageId} and outcome='PENDING'`; }
  async createFaceScanSession(input: { identity: DeploymentIdentity; organizationId: string; usageId: string; assessmentReference: string; idempotencyKey: string; provider: string; providerSessionReference?: string }) {
    const id = createEntityId();
    const [row] = await this.database<Array<{ id: string; state: "REQUESTED" }>>`insert into face_scan_sessions (id, customer_id, organization_id, deployment_id, assessment_reference, provider, provider_session_reference, idempotency_key) values (${id}, ${input.identity.customerId}, ${input.organizationId}, ${input.identity.deploymentId}, ${input.assessmentReference}, ${input.provider}, ${input.providerSessionReference ?? null}, ${input.idempotencyKey}) returning id, state`;
    return row!;
  }
}
