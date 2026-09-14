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

export type StoredActivationToken = { id: string; tokenHash: string; tokenCiphertext: string; expiresAt: Date };
export type Client = CreateClient & { id: string; enabled: boolean };
export type Deployment = CreateDeployment & { id: string; enabled: boolean; hostingType: DeploymentConfiguration["hostingType"] | null };
export type VersionAssignment = VersionAssignmentInput & { deploymentId: string };
export type DeploymentIdentity = { credentialId: string; deploymentId: string; clientId: string };

export type UsageReservation =
  | { status: "NEW"; usageId: string; version: string }
  | { status: "DUPLICATE"; usageId: string; response: unknown }
  | { status: "REJECTED"; reason: string };

export interface ScoringStore {
  overview(): Promise<{ clients: Client[]; deployments: Deployment[]; entitlements: Array<EntitlementInput & { deploymentId: string }>; assignments: VersionAssignment[]; versions: Array<{ id: string; version: string; lifecycle: string; clinicalUsePermitted: boolean }> }>;
  createClient(input: CreateClient): Promise<Client>;
  setClientEnabled(id: string, enabled: boolean): Promise<boolean>;
  saveDeploymentConfiguration(id: string | null, input: DeploymentConfiguration, activation?: StoredActivationToken): Promise<Deployment | null>;
  createDeployment(input: CreateDeployment): Promise<Deployment>;
  setDeploymentEnabled(id: string, enabled: boolean): Promise<boolean>;
  setEntitlement(deploymentId: string, input: EntitlementInput): Promise<void>;
  assignVersion(deploymentId: string, input: VersionAssignmentInput): Promise<void>;
  storeActivationToken(input: StoredActivationToken & { deploymentId: string }): Promise<void>;
  getActivationToken(deploymentId: string, now: Date): Promise<{ tokenCiphertext: string; expiresAt: Date } | null>;
  exchangeActivation(input: { tokenHash: string; credentialId: string; keyPrefix: string; secretHash: string; now: Date }): Promise<{ deploymentId: string; clientId: string } | null>;
  authenticateDeployment(keyPrefix: string, secretHash: string): Promise<DeploymentIdentity | null>;
  reserveUsage(input: { identity: DeploymentIdentity; clientId: string; capability: Capability; idempotencyKey: string; assessmentReference: string; platformEnabled: boolean }): Promise<UsageReservation>;
  completeUsage(usageId: string, response: unknown): Promise<void>;
  storePendingUsageResponse(usageId: string, response: unknown): Promise<void>;
  failUsage(usageId: string): Promise<void>;
  createFaceScanSession(input: { identity: DeploymentIdentity; clientId: string; usageId: string; assessmentReference: string; idempotencyKey: string; provider: string; providerSessionReference?: string }): Promise<{ id: string; state: "REQUESTED" }>;
}

type Credential = DeploymentIdentity & { keyPrefix: string; secretHash: string };
type Activation = { tokenCiphertext: string | null; deploymentId: string; tokenHash: string; expiresAt: Date; usedAt: Date | null };
type Usage = { id: string; clientId: string; deploymentId: string; capability: Capability; idempotencyKey: string; response?: unknown; outcome: "PENDING" | "SUCCEEDED" | "FAILED" };

/** Deterministic in-process implementation used by unit tests; production uses PostgreSQL. */
export class MemoryScoringStore implements ScoringStore {
  clients: Client[] = [];
  deployments: Deployment[] = [];
  entitlements: Array<EntitlementInput & { deploymentId: string }> = [];
  assignments: VersionAssignment[] = [];
  activations: Activation[] = [];
  credentials: Credential[] = [];
  usages: Usage[] = [];
  faceScans: Array<{ id: string; state: "REQUESTED" }> = [];

  versions = [{ id: "01K4ZJ9QJ7F3TWHDW1B1T6A4YV", version: PROVISIONAL_SCORING_VERSION, lifecycle: "DRAFT", clinicalUsePermitted: false }];
  async overview() { return { clients: this.clients, deployments: this.deployments, entitlements: this.entitlements, assignments: this.assignments, versions: this.versions }; }
  async createClient(input: CreateClient) { const value = { id: createEntityId(), ...input, enabled: true }; this.clients.push(value); return value; }
  async setClientEnabled(id: string, enabled: boolean) { const row = this.clients.find((item) => item.id === id); if (!row) return false; row.enabled = enabled; return true; }
  async createDeployment(input: CreateDeployment) { const value = { id: createEntityId(), ...input, enabled: true, hostingType: null }; this.deployments.push(value); return value; }
  async saveDeploymentConfiguration(id: string | null, input: DeploymentConfiguration, activation?: StoredActivationToken) {
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
  async assignVersion(deploymentId: string, input: VersionAssignmentInput) { this.assignments = this.assignments.filter((item) => item.deploymentId !== deploymentId); this.assignments.push({ deploymentId, ...input }); }
  async storeActivationToken(input: StoredActivationToken & { deploymentId: string }) {
    this.activations = this.activations.filter(token => token.deploymentId !== input.deploymentId || token.usedAt);
    this.activations.push({ ...input, usedAt: null });
  }
  async getActivationToken(deploymentId: string, now: Date) {
    const token = this.activations.find(token => token.deploymentId === deploymentId && !token.usedAt && token.expiresAt > now && token.tokenCiphertext);
    return token?.tokenCiphertext ? { tokenCiphertext: token.tokenCiphertext, expiresAt: token.expiresAt } : null;
  }
  async exchangeActivation(input: { tokenHash: string; credentialId: string; keyPrefix: string; secretHash: string; now: Date }) {
    const token = this.activations.find((item) => item.tokenHash === input.tokenHash && !item.usedAt && item.expiresAt > input.now);
    if (!token) return null;
    const deployment = this.deployments.find((item) => item.id === token.deploymentId)!;
    const client = this.clients.find((item) => deployment.clientId === item.id);
    if (!client) return null;
    token.usedAt = input.now;
    token.tokenCiphertext = null;
    this.credentials.push({ credentialId: input.credentialId, deploymentId: token.deploymentId, clientId: deployment.clientId, keyPrefix: input.keyPrefix, secretHash: input.secretHash });
    return { deploymentId: token.deploymentId, clientId: client.id };
  }
  async authenticateDeployment(keyPrefix: string, secretHash: string) { const row = this.credentials.find((item) => item.keyPrefix === keyPrefix && item.secretHash === secretHash); return row ? { credentialId: row.credentialId, deploymentId: row.deploymentId, clientId: row.clientId } : null; }
  async reserveUsage(input: { identity: DeploymentIdentity; clientId: string; capability: Capability; idempotencyKey: string; assessmentReference: string; platformEnabled: boolean }): Promise<UsageReservation> {
    const deployment = this.deployments.find((item) => item.id === input.identity.deploymentId);
    const client = this.clients.find((item) => item.id === input.clientId);
    if (!client || deployment?.clientId !== input.clientId || input.identity.clientId !== input.clientId) return { status: "REJECTED", reason: "CLIENT_NOT_ALLOWED" };
    const duplicate = this.usages.find((item) => item.deploymentId === input.identity.deploymentId && item.capability === input.capability && item.idempotencyKey === input.idempotencyKey);
    if (duplicate?.response !== undefined) return { status: "DUPLICATE", usageId: duplicate.id, response: duplicate.response };
    if (duplicate?.outcome === "PENDING") return { status: "REJECTED", reason: "REQUEST_IN_PROGRESS" };
    const entitlement = this.entitlements.find((item) => item.deploymentId === input.identity.deploymentId && item.capability === input.capability);
    const assignment = this.assignments.find((item) => item.deploymentId === input.identity.deploymentId);
    const resolvedVersion = assignment?.mode === "PINNED"
      ? this.versions.find((item) => item.id === assignment.scoringRuleVersionId)
      : this.versions.find((item) => item.lifecycle === "APPROVED" || item.lifecycle === "ACTIVE");
    const usage = this.usages.filter((item) => item.deploymentId === input.identity.deploymentId && item.capability === input.capability && item.outcome !== "FAILED").length;
    const decision = decideEntitlement({ platformEnabled: input.platformEnabled, clientEnabled: Boolean(client?.enabled), deploymentEnabled: Boolean(deployment.enabled), versionActive: input.capability === "FACE_SCAN" || resolvedVersion?.version === PROVISIONAL_SCORING_VERSION, monthlyLimit: entitlement?.monthlyLimit ?? null, monthlyUsage: usage });
    if (!entitlement?.enabled) return { status: "REJECTED", reason: "CAPABILITY_DISABLED" };
    if (!decision.allowed) return { status: "REJECTED", reason: decision.reason };
    const event = duplicate ?? { id: createEntityId(), clientId: input.clientId, deploymentId: input.identity.deploymentId, capability: input.capability, idempotencyKey: input.idempotencyKey, outcome: "PENDING" as const };
    event.outcome = "PENDING";
    if (!duplicate) this.usages.push(event);
    return { status: "NEW", usageId: event.id, version: resolvedVersion?.version ?? PROVISIONAL_SCORING_VERSION };
  }
  async completeUsage(usageId: string, response: unknown) { const row = this.usages.find((item) => item.id === usageId)!; row.outcome = "SUCCEEDED"; row.response = response; }
  async storePendingUsageResponse(usageId: string, response: unknown) { const row = this.usages.find((item) => item.id === usageId)!; row.response = response; }
  async failUsage(usageId: string) { const row = this.usages.find((item) => item.id === usageId)!; row.outcome = "FAILED"; }
  async createFaceScanSession() { const value = { id: createEntityId(), state: "REQUESTED" as const }; this.faceScans.push(value); return value; }
}
