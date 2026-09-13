import type {
  CreateCustomer,
  CreateDeployment,
  CreateOrganization,
  EntitlementInput,
  VersionAssignmentInput,
} from "@niq-scoring/contracts";
import { decideEntitlement, type Capability } from "@niq-scoring/entitlements";
import { PROVISIONAL_SCORING_VERSION } from "@niq-scoring/contracts";
import { createEntityId } from "./lib/id";

export type Customer = CreateCustomer & { id: string; enabled: boolean };
export type Organization = Omit<CreateOrganization, "customerId"> & { id: string; customerId: string; enabled: boolean };
export type Deployment = Omit<CreateDeployment, "organizationIds"> & { id: string; enabled: boolean; organizationIds: string[] };
export type VersionAssignment = VersionAssignmentInput & { organizationId: string };
export type DeploymentIdentity = { credentialId: string; deploymentId: string; customerId: string };

export type UsageReservation =
  | { status: "NEW"; usageId: string; version: string }
  | { status: "DUPLICATE"; usageId: string; response: unknown }
  | { status: "REJECTED"; reason: string };

export interface ScoringStore {
  overview(): Promise<{ customers: Customer[]; organizations: Organization[]; deployments: Deployment[]; entitlements: Array<EntitlementInput & { organizationId: string }>; assignments: VersionAssignment[]; versions: Array<{ id: string; version: string; lifecycle: string; clinicalUsePermitted: boolean }> }>;
  createCustomer(input: CreateCustomer): Promise<Customer>;
  setCustomerEnabled(id: string, enabled: boolean): Promise<boolean>;
  createOrganization(input: CreateOrganization): Promise<Organization>;
  setOrganizationEnabled(id: string, enabled: boolean): Promise<boolean>;
  createDeployment(input: CreateDeployment): Promise<Deployment>;
  setDeploymentEnabled(id: string, enabled: boolean): Promise<boolean>;
  setEntitlement(organizationId: string, input: EntitlementInput): Promise<void>;
  assignVersion(organizationId: string, input: VersionAssignmentInput): Promise<void>;
  storeActivationToken(input: { id: string; deploymentId: string; tokenHash: string; expiresAt: Date }): Promise<void>;
  exchangeActivation(input: { tokenHash: string; organizationReference: string; credentialId: string; keyPrefix: string; secretHash: string; now: Date }): Promise<{ deploymentId: string; organizationId: string } | null>;
  authenticateDeployment(keyPrefix: string, secretHash: string): Promise<DeploymentIdentity | null>;
  reserveUsage(input: { identity: DeploymentIdentity; organizationId: string; capability: Capability; idempotencyKey: string; assessmentReference: string; platformEnabled: boolean }): Promise<UsageReservation>;
  completeUsage(usageId: string, response: unknown): Promise<void>;
  storePendingUsageResponse(usageId: string, response: unknown): Promise<void>;
  failUsage(usageId: string): Promise<void>;
  createFaceScanSession(input: { identity: DeploymentIdentity; organizationId: string; usageId: string; assessmentReference: string; idempotencyKey: string; provider: string; providerSessionReference?: string }): Promise<{ id: string; state: "REQUESTED" }>;
}

type Credential = DeploymentIdentity & { keyPrefix: string; secretHash: string };
type Activation = { deploymentId: string; tokenHash: string; expiresAt: Date; usedAt: Date | null };
type Usage = { id: string; organizationId: string; deploymentId: string; capability: Capability; idempotencyKey: string; response?: unknown; outcome: "PENDING" | "SUCCEEDED" | "FAILED" };

/** Deterministic in-process implementation used by unit tests; production uses PostgreSQL. */
export class MemoryScoringStore implements ScoringStore {
  customers: Customer[] = [];
  organizations: Organization[] = [];
  deployments: Deployment[] = [];
  entitlements: Array<EntitlementInput & { organizationId: string }> = [];
  assignments: VersionAssignment[] = [];
  activations: Activation[] = [];
  credentials: Credential[] = [];
  usages: Usage[] = [];
  faceScans: Array<{ id: string; state: "REQUESTED" }> = [];

  versions = [{ id: "01K4ZJ9QJ7F3TWHDW1B1T6A4YV", version: PROVISIONAL_SCORING_VERSION, lifecycle: "DRAFT", clinicalUsePermitted: false }];
  async overview() { return { customers: this.customers, organizations: this.organizations, deployments: this.deployments, entitlements: this.entitlements, assignments: this.assignments, versions: this.versions }; }
  async createCustomer(input: CreateCustomer) { const value = { id: createEntityId(), ...input, enabled: true }; this.customers.push(value); return value; }
  async setCustomerEnabled(id: string, enabled: boolean) { const row = this.customers.find((item) => item.id === id); if (!row) return false; row.enabled = enabled; return true; }
  async createOrganization(input: CreateOrganization) { const value = { id: createEntityId(), ...input, enabled: true }; this.organizations.push(value); return value; }
  async setOrganizationEnabled(id: string, enabled: boolean) { const row = this.organizations.find((item) => item.id === id); if (!row) return false; row.enabled = enabled; return true; }
  async createDeployment(input: CreateDeployment) { const value = { id: createEntityId(), ...input, enabled: true }; this.deployments.push(value); return value; }
  async setDeploymentEnabled(id: string, enabled: boolean) { const row = this.deployments.find((item) => item.id === id); if (!row) return false; row.enabled = enabled; return true; }
  async setEntitlement(organizationId: string, input: EntitlementInput) { this.entitlements = this.entitlements.filter((item) => item.organizationId !== organizationId || item.capability !== input.capability); this.entitlements.push({ organizationId, ...input }); }
  async assignVersion(organizationId: string, input: VersionAssignmentInput) { this.assignments = this.assignments.filter((item) => item.organizationId !== organizationId); this.assignments.push({ organizationId, ...input }); }
  async storeActivationToken(input: { deploymentId: string; tokenHash: string; expiresAt: Date }) { this.activations.push({ deploymentId: input.deploymentId, tokenHash: input.tokenHash, expiresAt: input.expiresAt, usedAt: null }); }
  async exchangeActivation(input: { tokenHash: string; organizationReference: string; credentialId: string; keyPrefix: string; secretHash: string; now: Date }) {
    const token = this.activations.find((item) => item.tokenHash === input.tokenHash && !item.usedAt && item.expiresAt > input.now);
    if (!token) return null;
    const deployment = this.deployments.find((item) => item.id === token.deploymentId)!;
    const organization = this.organizations.find((item) => deployment.organizationIds.includes(item.id) && item.externalReference === input.organizationReference);
    if (!organization) return null;
    token.usedAt = input.now;
    this.credentials.push({ credentialId: input.credentialId, deploymentId: token.deploymentId, customerId: deployment.customerId, keyPrefix: input.keyPrefix, secretHash: input.secretHash });
    return { deploymentId: token.deploymentId, organizationId: organization.id };
  }
  async authenticateDeployment(keyPrefix: string, secretHash: string) { const row = this.credentials.find((item) => item.keyPrefix === keyPrefix && item.secretHash === secretHash); return row ? { credentialId: row.credentialId, deploymentId: row.deploymentId, customerId: row.customerId } : null; }
  async reserveUsage(input: { identity: DeploymentIdentity; organizationId: string; capability: Capability; idempotencyKey: string; assessmentReference: string; platformEnabled: boolean }): Promise<UsageReservation> {
    const duplicate = this.usages.find((item) => item.deploymentId === input.identity.deploymentId && item.capability === input.capability && item.idempotencyKey === input.idempotencyKey);
    if (duplicate?.response !== undefined) return { status: "DUPLICATE", usageId: duplicate.id, response: duplicate.response };
    if (duplicate?.outcome === "PENDING") return { status: "REJECTED", reason: "REQUEST_IN_PROGRESS" };
    const deployment = this.deployments.find((item) => item.id === input.identity.deploymentId);
    const organization = this.organizations.find((item) => item.id === input.organizationId && item.customerId === input.identity.customerId);
    const customer = this.customers.find((item) => item.id === input.identity.customerId);
    if (!deployment?.organizationIds.includes(input.organizationId)) return { status: "REJECTED", reason: "ORGANIZATION_NOT_ALLOWED" };
    const entitlement = this.entitlements.find((item) => item.organizationId === input.organizationId && item.capability === input.capability);
    const assignment = this.assignments.find((item) => item.organizationId === input.organizationId);
    const resolvedVersion = assignment?.mode === "PINNED"
      ? this.versions.find((item) => item.id === assignment.scoringRuleVersionId)
      : this.versions.find((item) => item.lifecycle === "APPROVED" || item.lifecycle === "ACTIVE");
    const usage = this.usages.filter((item) => item.organizationId === input.organizationId && item.capability === input.capability && item.outcome !== "FAILED").length;
    const decision = decideEntitlement({ platformEnabled: input.platformEnabled, organizationEnabled: Boolean(customer?.enabled && organization?.enabled), deploymentEnabled: Boolean(deployment.enabled), versionActive: input.capability === "FACE_SCAN" || resolvedVersion?.version === PROVISIONAL_SCORING_VERSION, monthlyLimit: entitlement?.monthlyLimit ?? null, monthlyUsage: usage });
    if (!entitlement?.enabled) return { status: "REJECTED", reason: "CAPABILITY_DISABLED" };
    if (!decision.allowed) return { status: "REJECTED", reason: decision.reason };
    const event = duplicate ?? { id: createEntityId(), organizationId: input.organizationId, deploymentId: input.identity.deploymentId, capability: input.capability, idempotencyKey: input.idempotencyKey, outcome: "PENDING" as const };
    event.outcome = "PENDING";
    if (!duplicate) this.usages.push(event);
    return { status: "NEW", usageId: event.id, version: resolvedVersion?.version ?? PROVISIONAL_SCORING_VERSION };
  }
  async completeUsage(usageId: string, response: unknown) { const row = this.usages.find((item) => item.id === usageId)!; row.outcome = "SUCCEEDED"; row.response = response; }
  async storePendingUsageResponse(usageId: string, response: unknown) { const row = this.usages.find((item) => item.id === usageId)!; row.response = response; }
  async failUsage(usageId: string) { const row = this.usages.find((item) => item.id === usageId)!; row.outcome = "FAILED"; }
  async createFaceScanSession() { const value = { id: createEntityId(), state: "REQUESTED" as const }; this.faceScans.push(value); return value; }
}
