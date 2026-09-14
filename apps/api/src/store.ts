import type {
  CreateDeployment,
  CreateClient,
  EntitlementInput,
  VersionAssignmentInput,
} from "@niq-scoring/contracts";
import { decideEntitlement, type Capability } from "@niq-scoring/entitlements";
import { PROVISIONAL_SCORING_VERSION } from "@niq-scoring/contracts";
import { createEntityId } from "./lib/id";

export type Client = CreateClient & { id: string; enabled: boolean };
export type Deployment = CreateDeployment & { id: string; enabled: boolean };
export type VersionAssignment = VersionAssignmentInput & { clientId: string };
export type DeploymentIdentity = { credentialId: string; deploymentId: string; clientId: string };

export type UsageReservation =
  | { status: "NEW"; usageId: string; version: string }
  | { status: "DUPLICATE"; usageId: string; response: unknown }
  | { status: "REJECTED"; reason: string };

export interface ScoringStore {
  overview(): Promise<{ clients: Client[]; deployments: Deployment[]; entitlements: Array<EntitlementInput & { clientId: string }>; assignments: VersionAssignment[]; versions: Array<{ id: string; version: string; lifecycle: string; clinicalUsePermitted: boolean }> }>;
  createClient(input: CreateClient): Promise<Client>;
  setClientEnabled(id: string, enabled: boolean): Promise<boolean>;
  createDeployment(input: CreateDeployment): Promise<Deployment>;
  setDeploymentEnabled(id: string, enabled: boolean): Promise<boolean>;
  setEntitlement(clientId: string, input: EntitlementInput): Promise<void>;
  assignVersion(clientId: string, input: VersionAssignmentInput): Promise<void>;
  storeActivationToken(input: { id: string; deploymentId: string; tokenHash: string; expiresAt: Date }): Promise<void>;
  exchangeActivation(input: { tokenHash: string; clientReference: string; credentialId: string; keyPrefix: string; secretHash: string; now: Date }): Promise<{ deploymentId: string; clientId: string } | null>;
  authenticateDeployment(keyPrefix: string, secretHash: string): Promise<DeploymentIdentity | null>;
  reserveUsage(input: { identity: DeploymentIdentity; clientId: string; capability: Capability; idempotencyKey: string; assessmentReference: string; platformEnabled: boolean }): Promise<UsageReservation>;
  completeUsage(usageId: string, response: unknown): Promise<void>;
  storePendingUsageResponse(usageId: string, response: unknown): Promise<void>;
  failUsage(usageId: string): Promise<void>;
  createFaceScanSession(input: { identity: DeploymentIdentity; clientId: string; usageId: string; assessmentReference: string; idempotencyKey: string; provider: string; providerSessionReference?: string }): Promise<{ id: string; state: "REQUESTED" }>;
}

type Credential = DeploymentIdentity & { keyPrefix: string; secretHash: string };
type Activation = { deploymentId: string; tokenHash: string; expiresAt: Date; usedAt: Date | null };
type Usage = { id: string; clientId: string; deploymentId: string; capability: Capability; idempotencyKey: string; response?: unknown; outcome: "PENDING" | "SUCCEEDED" | "FAILED" };

/** Deterministic in-process implementation used by unit tests; production uses PostgreSQL. */
export class MemoryScoringStore implements ScoringStore {
  clients: Client[] = [];
  deployments: Deployment[] = [];
  entitlements: Array<EntitlementInput & { clientId: string }> = [];
  assignments: VersionAssignment[] = [];
  activations: Activation[] = [];
  credentials: Credential[] = [];
  usages: Usage[] = [];
  faceScans: Array<{ id: string; state: "REQUESTED" }> = [];

  versions = [{ id: "01K4ZJ9QJ7F3TWHDW1B1T6A4YV", version: PROVISIONAL_SCORING_VERSION, lifecycle: "DRAFT", clinicalUsePermitted: false }];
  async overview() { return { clients: this.clients, deployments: this.deployments, entitlements: this.entitlements, assignments: this.assignments, versions: this.versions }; }
  async createClient(input: CreateClient) { const value = { id: createEntityId(), ...input, enabled: true }; this.clients.push(value); return value; }
  async setClientEnabled(id: string, enabled: boolean) { const row = this.clients.find((item) => item.id === id); if (!row) return false; row.enabled = enabled; return true; }
  async createDeployment(input: CreateDeployment) { const value = { id: createEntityId(), ...input, enabled: true }; this.deployments.push(value); return value; }
  async setDeploymentEnabled(id: string, enabled: boolean) { const row = this.deployments.find((item) => item.id === id); if (!row) return false; row.enabled = enabled; return true; }
  async setEntitlement(clientId: string, input: EntitlementInput) { this.entitlements = this.entitlements.filter((item) => item.clientId !== clientId || item.capability !== input.capability); this.entitlements.push({ clientId, ...input }); }
  async assignVersion(clientId: string, input: VersionAssignmentInput) { this.assignments = this.assignments.filter((item) => item.clientId !== clientId); this.assignments.push({ clientId, ...input }); }
  async storeActivationToken(input: { deploymentId: string; tokenHash: string; expiresAt: Date }) { this.activations.push({ deploymentId: input.deploymentId, tokenHash: input.tokenHash, expiresAt: input.expiresAt, usedAt: null }); }
  async exchangeActivation(input: { tokenHash: string; clientReference: string; credentialId: string; keyPrefix: string; secretHash: string; now: Date }) {
    const token = this.activations.find((item) => item.tokenHash === input.tokenHash && !item.usedAt && item.expiresAt > input.now);
    if (!token) return null;
    const deployment = this.deployments.find((item) => item.id === token.deploymentId)!;
    const client = this.clients.find((item) => deployment.clientId === item.id && item.externalReference === input.clientReference);
    if (!client) return null;
    token.usedAt = input.now;
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
    const entitlement = this.entitlements.find((item) => item.clientId === input.clientId && item.capability === input.capability);
    const assignment = this.assignments.find((item) => item.clientId === input.clientId);
    const resolvedVersion = assignment?.mode === "PINNED"
      ? this.versions.find((item) => item.id === assignment.scoringRuleVersionId)
      : this.versions.find((item) => item.lifecycle === "APPROVED" || item.lifecycle === "ACTIVE");
    const usage = this.usages.filter((item) => item.clientId === input.clientId && item.capability === input.capability && item.outcome !== "FAILED").length;
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
