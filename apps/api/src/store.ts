import { OrganizationInfoError } from "./organization-info";
import type { OrganizationInfo } from "@niq-scoring/contracts";
import { BindingError, eligibleRule, type AssessmentBinding, type BindingInput, type BoundAssessment } from "./assessment-binding";
import { versionedRuleDefinitionSchema } from "@niq-scoring/contracts/versioned-definition";
import { isFinalAssessmentDefinition } from "@niq-scoring/contracts/versioned-definition";
import { MemoryRuleStore } from "./memory-rule-store";
import { RuleStoreError, type RuleStore } from "./rule-store";
import { DuplicateClientNameError } from "./lib/client-name";
import { memoryDeletion, type RecordKind, type DeletionStatus } from "./record-deletion";
import type {
  CreateDeployment,
  DeploymentConfiguration,
  CreateClient,
  EntitlementInput,
  VersionAssignmentInput,
} from "@niq-scoring/contracts";
import { decideEntitlement, type Capability } from "@niq-scoring/entitlements";
import { PROVISIONAL_SCORING_VERSION } from "@niq-scoring/contracts";
import { createEntityId } from "./lib/id";
import { buildUsageSummary, type DeploymentUsage, type UsageCount } from "./usage-summary";

export type StoredActivationToken = { id: string; tokenHash: string; tokenCiphertext: string; expiresAt: Date | null };
export type TokenRecord = { id: string; expiresAt: Date | null; createdAt: Date; usedAt: Date | null; revokedAt: Date | null; canCopy: boolean; credentialStatus: "Active" | "Revoked" | null };
export type CredentialRevocation = "REVOKED" | "ALREADY_REVOKED" | "UNAVAILABLE";
export type Client = CreateClient & { id: string; enabled: boolean };
export type Deployment = CreateDeployment & { id: string; enabled: boolean; hostingType: DeploymentConfiguration["hostingType"] | null };
export type VersionAssignment = VersionAssignmentInput & { deploymentId: string };
export type DeploymentIdentity = { credentialId: string; deploymentId: string; clientId: string };

export type UsageReservation =
  | { status: "NEW"; usageId: string; version: string }
  | { status: "DUPLICATE"; usageId: string; response: unknown }
  | { status: "REJECTED"; reason: string };

export type ReserveInput = { identity: DeploymentIdentity; clientId: string; capability: Capability; idempotencyKey: string; assessmentReference: string; platformEnabled: boolean; fingerprint?: string; binding?: AssessmentBinding };

export interface ScoringStore {
  organizationInfo(identity: DeploymentIdentity, now: Date): Promise<OrganizationInfo>;
  bindAssessment(input: BindingInput): Promise<BoundAssessment>;
  rules: RuleStore;
  deletionStatus(kind: RecordKind, id: string): Promise<DeletionStatus>;
  deleteUnused(kind: RecordKind, id: string): Promise<DeletionStatus>;
  overview(): Promise<{ clients: Client[]; deployments: Deployment[]; entitlements: Array<EntitlementInput & { deploymentId: string }>; assignments: VersionAssignment[]; versions: Array<{ id: string; version: string; lifecycle: string; clinicalUsePermitted: boolean; isDefault?: boolean }> }>;
  usageByDeployment(clientId: string, now: Date): Promise<DeploymentUsage[]>;
  createClient(input: CreateClient): Promise<Client>;
  setClientEnabled(id: string, enabled: boolean): Promise<boolean>;
  saveDeploymentConfiguration(id: string | null, input: DeploymentConfiguration, activation?: StoredActivationToken): Promise<Deployment | null>;
  createDeployment(input: CreateDeployment): Promise<Deployment>;
  setDeploymentEnabled(id: string, enabled: boolean): Promise<boolean>;
  setEntitlement(deploymentId: string, input: EntitlementInput): Promise<void>;
  assignVersion(deploymentId: string, input: VersionAssignmentInput): Promise<void>;
  storeActivationToken(input: StoredActivationToken & { deploymentId: string }): Promise<void>;
  getActivationToken(deploymentId: string, now: Date, tokenId?: string): Promise<{ tokenCiphertext: string; expiresAt: Date | null } | null>;
  listActivationTokens(deploymentId: string): Promise<TokenRecord[]>;
  revokeActivationToken(deploymentId: string, tokenId: string, now: Date): Promise<boolean>;
  revokeTokenCredential(deploymentId: string, tokenId: string, now: Date): Promise<CredentialRevocation>;
  exchangeActivation(input: { tokenHash: string; credentialId: string; keyPrefix: string; secretHash: string; now: Date }): Promise<{ deploymentId: string; clientId: string } | null>;
  authenticateDeployment(keyPrefix: string, secretHash: string): Promise<DeploymentIdentity | null>;
  reserveUsage(input: ReserveInput): Promise<UsageReservation>;
  completeUsage(usageId: string, response: unknown): Promise<void>;
  storePendingUsageResponse(usageId: string, response: unknown): Promise<void>;
  failUsage(usageId: string): Promise<void>;
  createFaceScanSession(input: { identity: DeploymentIdentity; clientId: string; usageId: string; assessmentReference: string; idempotencyKey: string; provider: string; providerSessionReference?: string }): Promise<{ id: string; state: "REQUESTED" }>;
}

type Credential = DeploymentIdentity & { keyPrefix: string; secretHash: string; revokedAt?: Date | null; expiresAt?: Date | null };
type Activation = Omit<StoredActivationToken, "tokenCiphertext"> & { tokenCiphertext: string | null; deploymentId: string; credentialId: string | null; usedAt: Date | null; revokedAt: Date | null; createdAt: Date };
type Usage = { occurredAt: Date; fingerprint?: string; ruleVersionId?: string; id: string; clientId: string; deploymentId: string; capability: Capability; idempotencyKey: string; response?: unknown; outcome: "PENDING" | "SUCCEEDED" | "FAILED" };

/** Deterministic in-process implementation used by unit tests; production uses PostgreSQL. */
export class MemoryScoringStore implements ScoringStore {
  bindings: AssessmentBinding[] = [];
  rules = new MemoryRuleStore(id => this.bindings.some(b => b.ruleVersionId === id) || this.assignments.some(a => a.mode === "PINNED" && a.scoringRuleVersionId === id));
  async deletionStatus(kind: RecordKind, id: string) { return memoryDeletion(this, kind, id); }
  async deleteUnused(kind: RecordKind, id: string) { return memoryDeletion(this, kind, id, true); }
  clients: Client[] = [];
  deployments: Deployment[] = [];
  entitlements: Array<EntitlementInput & { deploymentId: string }> = [];
  assignments: VersionAssignment[] = [];
  activations: Activation[] = [];
  credentials: Credential[] = [];
  usages: Usage[] = [];
  faceScans: Array<{ id: string; state: "REQUESTED"; clientId: string; deploymentId: string }> = [];

  versions = [{ id: "01K4ZJ9QJ7F3TWHDW1B1T6A4YV", version: PROVISIONAL_SCORING_VERSION, lifecycle: "DRAFT", clinicalUsePermitted: false, isDefault: false }];
  async overview() { return { clients: this.clients, deployments: this.deployments, entitlements: this.entitlements, assignments: this.assignments, versions: [...this.versions, ...await this.rules.list()] }; }
  async usageByDeployment(clientId: string, now: Date): Promise<DeploymentUsage[]> {
    const deploymentIds = this.deployments.filter(item => item.clientId === clientId).map(item => item.id);
    const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 5, 1));
    const totals: UsageCount[] = [];
    const monthly: UsageCount[] = [];
    for (const event of this.usages) {
      if (event.clientId !== clientId || event.outcome !== "SUCCEEDED") continue;
      const total = totals.find(item => item.deploymentId === event.deploymentId && item.capability === event.capability);
      if (total) total.count++; else totals.push({ deploymentId: event.deploymentId, capability: event.capability, count: 1 });
      if (event.occurredAt < start || event.occurredAt > now) continue;
      const month = event.occurredAt.toISOString().slice(0, 7);
      const bucket = monthly.find(item => item.deploymentId === event.deploymentId && item.capability === event.capability && item.month === month);
      if (bucket) bucket.count++; else monthly.push({ deploymentId: event.deploymentId, capability: event.capability, month, count: 1 });
    }
    return buildUsageSummary(deploymentIds, totals, monthly, now);
  }
  async createClient(input: CreateClient) { if (this.clients.some(client => client.name.trim().toLowerCase() === input.name.trim().toLowerCase())) throw new DuplicateClientNameError(); const value = { id: createEntityId(), ...input, enabled: true }; this.clients.push(value); return value; }
  async setClientEnabled(id: string, enabled: boolean) { const row = this.clients.find((item) => item.id === id); if (!row) return false; row.enabled = enabled; return true; }
  async createDeployment(input: CreateDeployment) { const value = { id: createEntityId(), ...input, enabled: true, hostingType: null }; this.deployments.push(value); return value; }
  async saveDeploymentConfiguration(id: string | null, input: DeploymentConfiguration, activation?: StoredActivationToken) {
    this.checkAssignment(id, input.versionAssignment);
    const existing = id ? this.deployments.find(d => d.id === id && d.clientId === input.clientId) : null;
    if (id && !existing) return null;
    const deployment = existing ?? await this.createDeployment({ name: input.name, clientId: input.clientId, environment: input.environment });
    Object.assign(deployment, { name: input.name, environment: input.environment, hostingType: input.hostingType, enabled: input.enabled });
    await this.setEntitlement(deployment.id, { capability: "SCORING", ...input.scoring });
    await this.setEntitlement(deployment.id, { capability: "FACE_SCAN", ...input.faceScan });
    await this.assignVersion(deployment.id, input.versionAssignment);
    if (activation) await this.storeActivationToken({ ...activation, deploymentId: deployment.id });
    return deployment;
  }
  async setDeploymentEnabled(id: string, enabled: boolean) { const row = this.deployments.find((item) => item.id === id); if (!row) return false; row.enabled = enabled; return true; }
  async setEntitlement(deploymentId: string, input: EntitlementInput) { this.entitlements = this.entitlements.filter((item) => item.deploymentId !== deploymentId || item.capability !== input.capability); this.entitlements.push({ deploymentId, ...input }); }
  private checkAssignment(deploymentId: string | null, input: VersionAssignmentInput) {
    if (input.mode !== "PINNED") return;
    if (this.assignments.some(a => a.deploymentId === deploymentId && a.mode === "PINNED" && a.scoringRuleVersionId === input.scoringRuleVersionId)) return;
    if (this.versions.some(v => v.id === input.scoringRuleVersionId && v.version === PROVISIONAL_SCORING_VERSION)) return;
    if (!this.rules.records.some(r => r.id === input.scoringRuleVersionId && eligibleRule(r))) throw new RuleStoreError("VERSION_UNAVAILABLE");
  }
  async assignVersion(deploymentId: string, input: VersionAssignmentInput) { this.checkAssignment(deploymentId, input); this.assignments = this.assignments.filter((item) => item.deploymentId !== deploymentId); this.assignments.push({ deploymentId, ...input }); }
  async storeActivationToken(input: StoredActivationToken & { deploymentId: string }) {
    for (const token of this.activations) if (token.deploymentId === input.deploymentId && !token.usedAt && !token.revokedAt) { token.revokedAt = new Date(); token.tokenCiphertext = null; }
    this.activations.push({ ...input, credentialId: null, usedAt: null, revokedAt: null, createdAt: new Date() });
  }
  async getActivationToken(deploymentId: string, now: Date, tokenId?: string) {
    const token = this.activations.find(token => token.deploymentId === deploymentId && !token.usedAt && !token.revokedAt && (!tokenId || token.id === tokenId) && (!token.expiresAt || token.expiresAt > now) && token.tokenCiphertext);
    return token?.tokenCiphertext ? { tokenCiphertext: token.tokenCiphertext, expiresAt: token.expiresAt } : null;
  }
  async listActivationTokens(deploymentId: string): Promise<TokenRecord[]> {
    return this.activations.filter(t => t.deploymentId === deploymentId).map(t => {
      const credential = this.credentials.find(c => c.credentialId === t.credentialId && c.deploymentId === deploymentId);
      return { id: t.id, expiresAt: t.expiresAt, createdAt: t.createdAt, usedAt: t.usedAt, revokedAt: t.revokedAt, canCopy: Boolean(t.tokenCiphertext), credentialStatus: credential ? credential.revokedAt ? "Revoked" as const : "Active" as const : null };
    }).reverse();
  }
  async revokeActivationToken(deploymentId: string, tokenId: string, now: Date) {
    const token = this.activations.find(t => t.deploymentId === deploymentId && t.id === tokenId && !t.usedAt && !t.revokedAt);
    if (!token) return false;
    token.revokedAt = now; token.tokenCiphertext = null; return true;
  }
  async revokeTokenCredential(deploymentId: string, tokenId: string, now: Date): Promise<CredentialRevocation> {
    const token = this.activations.find(t => t.id === tokenId && t.deploymentId === deploymentId && t.usedAt && t.credentialId);
    const credential = this.credentials.find(c => c.credentialId === token?.credentialId && c.deploymentId === deploymentId);
    if (!credential) return "UNAVAILABLE";
    if (credential.revokedAt) return "ALREADY_REVOKED";
    credential.revokedAt = now;
    return "REVOKED";
  }
  async exchangeActivation(input: { tokenHash: string; credentialId: string; keyPrefix: string; secretHash: string; now: Date }) {
    const token = this.activations.find((item) => item.tokenHash === input.tokenHash && !item.usedAt && !item.revokedAt && (!item.expiresAt || item.expiresAt > input.now));
    if (!token) return null;
    const deployment = this.deployments.find((item) => item.id === token.deploymentId)!;
    const client = this.clients.find((item) => deployment.clientId === item.id);
    if (!client) return null;
    token.usedAt = input.now;
    token.credentialId = input.credentialId;
    token.tokenCiphertext = null;
    this.credentials.push({ credentialId: input.credentialId, deploymentId: token.deploymentId, clientId: deployment.clientId, keyPrefix: input.keyPrefix, secretHash: input.secretHash });
    return { deploymentId: token.deploymentId, clientId: client.id };
  }
  async authenticateDeployment(keyPrefix: string, secretHash: string) { const row = this.credentials.find((item) => item.keyPrefix === keyPrefix && item.secretHash === secretHash && !item.revokedAt && (!item.expiresAt || item.expiresAt > new Date())); return row ? { credentialId: row.credentialId, deploymentId: row.deploymentId, clientId: row.clientId } : null; }
  integrationAuditEvents: Array<{ action: string; actorReference: string; resourceReference: string; occurredAt: Date }> = [];
  async organizationInfo(identity: DeploymentIdentity, now: Date): Promise<OrganizationInfo> {
    const credential = this.credentials.find(c => c.credentialId === identity.credentialId && c.deploymentId === identity.deploymentId && c.clientId === identity.clientId);
    if (!credential || credential.revokedAt || credential.expiresAt && credential.expiresAt <= now) throw new OrganizationInfoError("UNAUTHORIZED");
    const client = this.clients.find(c => c.id === identity.clientId);
    const deployment = this.deployments.find(d => d.id === identity.deploymentId && d.clientId === identity.clientId);
    if (!client || !deployment) throw new OrganizationInfoError("UNAUTHORIZED");
    if (!client.enabled) throw new OrganizationInfoError("CLIENT_DISABLED");
    if (!deployment.enabled) throw new OrganizationInfoError("DEPLOYMENT_DISABLED");
    const scoring = this.entitlements.find(e => e.deploymentId === deployment.id && e.capability === "SCORING");
    const faceScan = this.entitlements.find(e => e.deploymentId === deployment.id && e.capability === "FACE_SCAN");
    if (!deployment.hostingType || !scoring || !faceScan) throw new OrganizationInfoError("CONFIGURATION_INCOMPLETE");
    const assignment = this.assignments.find(a => a.deploymentId === deployment.id);
    const selectedRule = this.rules.records.find(r => r.id === (assignment?.mode === "PINNED" ? assignment.scoringRuleVersionId : this.rules.defaultRuleId));
    const period = now.toISOString().slice(0, 7);
    const usage = this.usages.filter(u => u.deploymentId === deployment.id && u.clientId === client.id && u.outcome !== "FAILED" && u.occurredAt.toISOString().slice(0, 7) === period);
    this.integrationAuditEvents.push({ action: "ORGANIZATION_INFO_READ", actorReference: credential.credentialId, resourceReference: deployment.id, occurredAt: now });
    return {
      ruleVersion: assignment ? { mode: assignment.mode === "PINNED" ? "SPECIFIC" : "DEFAULT", version: selectedRule?.version ?? null } : null,
      organization: { id: client.id, name: client.name, status: client.enabled ? "ACTIVE" : "DISABLED" },
      deployment: { id: deployment.id, mode: deployment.hostingType, environment: deployment.environment, status: deployment.enabled ? "ACTIVE" : "DISABLED" },
      services: { scoring: { enabled: scoring.enabled }, faceScan: { enabled: faceScan.enabled } },
      limits: { scoresPerMonth: scoring.monthlyLimit, faceScansPerMonth: faceScan.monthlyLimit },
      usage: { period, scores: usage.filter(u => u.capability === "SCORING").length, faceScans: usage.filter(u => u.capability === "FACE_SCAN").length },
      // This test store has no persisted configuration timestamps. PostgreSQL supplies them.
      updatedAt: null, unavailableFields: ["limits.users"],
    };
  }
  async bindAssessment(input: BindingInput): Promise<BoundAssessment> {
    if (!input.platformEnabled) throw new BindingError("PLATFORM_DISABLED");
    const deployment = this.deployments.find(d => d.id === input.identity.deploymentId && d.clientId === input.identity.clientId);
    const client = this.clients.find(c => c.id === input.identity.clientId);
    if (!deployment || !client) throw new BindingError("CLIENT_NOT_ALLOWED");
    if (!client.enabled) throw new BindingError("CLIENT_DISABLED");
    if (!deployment.enabled) throw new BindingError("DEPLOYMENT_DISABLED");
    if (!this.entitlements.find(e => e.deploymentId === deployment.id && e.capability === "SCORING")?.enabled) throw new BindingError("CAPABILITY_DISABLED");
    const existing = this.bindings.find(b => b.deploymentId === deployment.id && b.assessmentReference === input.assessmentReference);
    if (!existing && !input.create) throw new BindingError("ASSESSMENT_NOT_FOUND");
    const assignment = this.assignments.find(a => a.deploymentId === deployment.id);
    const rule = existing ? this.rules.records.find(r => r.id === existing.ruleVersionId) : !assignment ? undefined : assignment.mode === "PINNED" ? this.rules.records.find(r => r.id === assignment.scoringRuleVersionId && eligibleRule(r)) : this.rules.records.find(r => r.id === this.rules.defaultRuleId && eligibleRule(r));
    if (!rule || !versionedRuleDefinitionSchema.safeParse(rule.definition).success || isFinalAssessmentDefinition(rule.definition) && (!rule.definition.provisional.clinicalUsePermitted || !existing && !rule.clinicalUsePermitted) || existing && (existing.checksum !== rule.packageChecksum || !["APPROVED", "ACTIVE", "RETIRED"].includes(rule.lifecycle))) throw new BindingError("VERSION_UNAVAILABLE");
    const binding = existing ?? { id: createEntityId(), deploymentId: deployment.id, clientId: client.id, assessmentReference: input.assessmentReference, ruleVersionId: rule.id, checksum: rule.packageChecksum, createdAt: new Date().toISOString() };
    if (!existing) this.bindings.push(binding);
    return structuredClone({ binding, rule });
  }
  async reserveUsage(input: ReserveInput): Promise<UsageReservation> {
    const deployment = this.deployments.find((item) => item.id === input.identity.deploymentId);
    const client = this.clients.find((item) => item.id === input.clientId);
    if (!client || deployment?.clientId !== input.clientId || input.identity.clientId !== input.clientId) return { status: "REJECTED", reason: "CLIENT_NOT_ALLOWED" };
    const entitlement = this.entitlements.find(item => item.deploymentId === input.identity.deploymentId && item.capability === input.capability);
    if (!entitlement?.enabled) return { status: "REJECTED", reason: "CAPABILITY_DISABLED" };
    const duplicate = this.usages.find((item) => item.deploymentId === input.identity.deploymentId && item.capability === input.capability && item.idempotencyKey === input.idempotencyKey);
    if (!input.platformEnabled || !client.enabled || !deployment.enabled) return { status: "REJECTED", reason: !input.platformEnabled ? "PLATFORM_DISABLED" : !client.enabled ? "CLIENT_DISABLED" : "DEPLOYMENT_DISABLED" };
    if (duplicate && duplicate.fingerprint !== input.fingerprint) return { status: "REJECTED", reason: "IDEMPOTENCY_CONFLICT" };
    if (duplicate?.response !== undefined) return { status: "DUPLICATE", usageId: duplicate.id, response: duplicate.response };
    if (duplicate?.outcome === "PENDING") return { status: "REJECTED", reason: "REQUEST_IN_PROGRESS" };
    const assignment = this.assignments.find((item) => item.deploymentId === input.identity.deploymentId);
    const resolvedVersion = assignment?.mode === "PINNED"
      ? this.versions.find((item) => item.id === assignment.scoringRuleVersionId)
      : this.versions.find((item) => item.lifecycle === "APPROVED" || item.lifecycle === "ACTIVE");
    const usage = this.usages.filter((item) => item.deploymentId === input.identity.deploymentId && item.capability === input.capability && item.outcome !== "FAILED").length;
    const decision = decideEntitlement({ platformEnabled: input.platformEnabled, clientEnabled: Boolean(client?.enabled), deploymentEnabled: Boolean(deployment.enabled), versionActive: input.capability === "FACE_SCAN" || Boolean(input.binding && this.bindings.some(b => b.id === input.binding!.id && b.deploymentId === deployment.id && b.assessmentReference === input.assessmentReference && b.checksum === input.binding!.checksum)) || resolvedVersion?.version === PROVISIONAL_SCORING_VERSION, monthlyLimit: entitlement?.monthlyLimit ?? null, monthlyUsage: usage });
    if (!entitlement?.enabled) return { status: "REJECTED", reason: "CAPABILITY_DISABLED" };
    if (!decision.allowed) return { status: "REJECTED", reason: decision.reason };
    const event: Usage = duplicate ?? { occurredAt: new Date(), id: createEntityId(), clientId: input.clientId, deploymentId: input.identity.deploymentId, capability: input.capability, idempotencyKey: input.idempotencyKey, outcome: "PENDING" as const };
    event.outcome = "PENDING";
    event.occurredAt = new Date();
    if (input.fingerprint) event.fingerprint = input.fingerprint;
    if (input.binding) event.ruleVersionId = input.binding.ruleVersionId;
    if (!duplicate) this.usages.push(event);
    return { status: "NEW", usageId: event.id, version: resolvedVersion?.version ?? PROVISIONAL_SCORING_VERSION };
  }
  async completeUsage(usageId: string, response: unknown) { const row = this.usages.find((item) => item.id === usageId)!; row.outcome = "SUCCEEDED"; row.response = response; }
  async storePendingUsageResponse(usageId: string, response: unknown) { const row = this.usages.find((item) => item.id === usageId)!; row.response = response; }
  async failUsage(usageId: string) { const row = this.usages.find((item) => item.id === usageId)!; row.outcome = "FAILED"; }
  async createFaceScanSession(input: { clientId: string; identity: DeploymentIdentity }) { const value = { clientId: input.clientId, deploymentId: input.identity.deploymentId, id: createEntityId(), state: "REQUESTED" as const }; this.faceScans.push(value); return value; }
}
