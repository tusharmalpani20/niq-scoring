import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  foreignKey,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  primaryKey,
  timestamp,
  text,
  uniqueIndex,
  varchar,
} from "drizzle-orm/pg-core";

export const lifecycleEnum = pgEnum("scoring_rule_lifecycle", ["DRAFT", "VALIDATED", "APPROVED", "ACTIVE", "RETIRED"]);
export const capabilityEnum = pgEnum("entitlement_capability", ["SCORING", "FACE_SCAN"]);
export const usageOutcomeEnum = pgEnum("usage_outcome", ["SUCCEEDED", "FAILED", "REJECTED", "PENDING"]);
export const faceScanStateEnum = pgEnum("face_scan_state", ["REQUESTED", "PROVIDER_SESSION_CREATED", "CAPTURE_IN_PROGRESS", "PROCESSING", "COMPLETED", "FAILED", "EXPIRED"]);
export const versionAssignmentModeEnum = pgEnum("version_assignment_mode", ["LATEST_APPROVED", "PINNED"]);

const timestamps = {
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
};

// A client is the single tenant boundary; facilities remain in the clinical application.
export const clients = pgTable("clients", {
  id: varchar("id", { length: 26 }).primaryKey(),
  name: varchar("name", { length: 200 }).notNull(),
  enabled: boolean("enabled").notNull().default(true),
  ...timestamps,
});

export const deployments = pgTable("deployments", {
  id: varchar("id", { length: 26 }).primaryKey(),
  clientId: varchar("client_id", { length: 26 }).notNull().references(() => clients.id),
  name: varchar("name", { length: 120 }).notNull(),
  environment: varchar("environment", { length: 30 }).notNull(),
  hostingType: varchar("hosting_type", { length: 30 }),
  enabled: boolean("enabled").notNull().default(true),
  lastSeenAt: timestamp("last_seen_at", { withTimezone: true }),
  ...timestamps,
}, (table) => [
  check("deployments_hosting_type_ck", sql`${table.hostingType} is null or ${table.hostingType} in ('NIQ_HOSTED','CLIENT_CLOUD','ON_PREMISES')`),
  uniqueIndex("deployments_client_name_uq").on(table.clientId, table.name),
  uniqueIndex("deployments_client_id_uq").on(table.clientId, table.id),
]);

export const deploymentCredentials = pgTable("deployment_credentials", {
  id: varchar("id", { length: 26 }).primaryKey(),
  deploymentId: varchar("deployment_id", { length: 26 }).notNull().references(() => deployments.id),
  keyPrefix: varchar("key_prefix", { length: 20 }).notNull(),
  secretHash: varchar("secret_hash", { length: 128 }).notNull(),
  hashAlgorithm: varchar("hash_algorithm", { length: 30 }).notNull().default("sha256"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  expiresAt: timestamp("expires_at", { withTimezone: true }),
  revokedAt: timestamp("revoked_at", { withTimezone: true }),
  lastUsedAt: timestamp("last_used_at", { withTimezone: true }),
}, (table) => [
  uniqueIndex("deployment_credentials_prefix_uq").on(table.keyPrefix),
  uniqueIndex("deployment_credentials_deployment_id_uq").on(table.deploymentId, table.id),
]);

export const activationTokens = pgTable("activation_tokens", {
  id: varchar("id", { length: 26 }).primaryKey(),
  deploymentId: varchar("deployment_id", { length: 26 }).notNull().references(() => deployments.id),
  tokenHash: varchar("token_hash", { length: 64 }).notNull(),
  tokenCiphertext: text("token_ciphertext"),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  usedAt: timestamp("used_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  uniqueIndex("activation_tokens_hash_uq").on(table.tokenHash),
  index("activation_tokens_deployment_idx").on(table.deploymentId, table.createdAt),
]);

export const entitlements = pgTable("entitlements", {
  id: varchar("id", { length: 26 }).primaryKey(),
  deploymentId: varchar("deployment_id", { length: 26 }).notNull().references(() => deployments.id),
  capability: capabilityEnum("capability").notNull(),
  enabled: boolean("enabled").notNull().default(true),
  monthlyLimit: integer("monthly_limit"), // NULL means unlimited.
  effectiveFrom: timestamp("effective_from", { withTimezone: true }).notNull().defaultNow(),
  effectiveUntil: timestamp("effective_until", { withTimezone: true }),
  ...timestamps,
}, (table) => [
  uniqueIndex("entitlements_one_current_uq").on(table.deploymentId, table.capability).where(sql`${table.effectiveUntil} is null`),
  index("entitlements_deployment_history_idx").on(table.deploymentId, table.capability, table.effectiveFrom),
  check("entitlements_nonnegative_limit_ck", sql`${table.monthlyLimit} is null or ${table.monthlyLimit} >= 0`),
  check("entitlements_valid_period_ck", sql`${table.effectiveUntil} is null or ${table.effectiveUntil} > ${table.effectiveFrom}`),
]);

export const scoringRuleVersions = pgTable("scoring_rule_versions", {
  id: varchar("id", { length: 26 }).primaryKey(),
  version: varchar("version", { length: 80 }).notNull(),
  lifecycle: lifecycleEnum("lifecycle").notNull().default("DRAFT"),
  clinicalUsePermitted: boolean("clinical_use_permitted").notNull().default(false),
  packageChecksum: varchar("package_checksum", { length: 128 }).notNull(),
  definition: jsonb("definition").notNull(),
  createdBy: varchar("created_by", { length: 26 }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  validatedAt: timestamp("validated_at", { withTimezone: true }),
  approvedAt: timestamp("approved_at", { withTimezone: true }),
  activatedAt: timestamp("activated_at", { withTimezone: true }),
  retiredAt: timestamp("retired_at", { withTimezone: true }),
}, (table) => [uniqueIndex("scoring_rule_versions_version_uq").on(table.version), uniqueIndex("scoring_rule_versions_checksum_uq").on(table.packageChecksum)]);

export const deploymentVersionAssignments = pgTable("deployment_version_assignments", {
  id: varchar("id", { length: 26 }).primaryKey(),
  deploymentId: varchar("deployment_id", { length: 26 }).notNull().references(() => deployments.id),
  mode: versionAssignmentModeEnum("mode").notNull(),
  scoringRuleVersionId: varchar("scoring_rule_version_id", { length: 26 }).references(() => scoringRuleVersions.id),
  effectiveFrom: timestamp("effective_from", { withTimezone: true }).notNull().defaultNow(),
  effectiveUntil: timestamp("effective_until", { withTimezone: true }),
  assignedBy: varchar("assigned_by", { length: 26 }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  uniqueIndex("version_assignments_one_current_uq").on(table.deploymentId).where(sql`${table.effectiveUntil} is null`),
  index("version_assignments_deployment_history_idx").on(table.deploymentId, table.effectiveFrom),
  check("version_assignment_mode_ck", sql`(${table.mode} = 'PINNED' and ${table.scoringRuleVersionId} is not null) or (${table.mode} = 'LATEST_APPROVED' and ${table.scoringRuleVersionId} is null)`),
  check("version_assignments_valid_period_ck", sql`${table.effectiveUntil} is null or ${table.effectiveUntil} > ${table.effectiveFrom}`),
]);

export const usageEvents = pgTable("usage_events", {
  id: varchar("id", { length: 26 }).primaryKey(),
  clientId: varchar("client_id", { length: 26 }).notNull(),
  deploymentId: varchar("deployment_id", { length: 26 }).notNull(),
  credentialId: varchar("credential_id", { length: 26 }),
  capability: capabilityEnum("capability").notNull(),
  scoringRuleVersionId: varchar("scoring_rule_version_id", { length: 26 }).references(() => scoringRuleVersions.id),
  requestId: varchar("request_id", { length: 128 }).notNull(),
  idempotencyKey: varchar("idempotency_key", { length: 128 }).notNull(),
  assessmentReference: varchar("assessment_reference", { length: 128 }).notNull(),
  outcome: usageOutcomeEnum("outcome").notNull(),
  billable: boolean("billable").notNull().default(false),
  responsePayload: jsonb("response_payload"),
  completedAt: timestamp("completed_at", { withTimezone: true }),
  occurredAt: timestamp("occurred_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  uniqueIndex("usage_deployment_idempotency_uq").on(table.deploymentId, table.capability, table.idempotencyKey),
  index("usage_deployment_capability_month_idx").on(table.deploymentId, table.capability, table.occurredAt),
  foreignKey({ columns: [table.clientId, table.deploymentId], foreignColumns: [deployments.clientId, deployments.id], name: "usage_authorized_deployment_client_fk" }),
  foreignKey({ columns: [table.deploymentId, table.credentialId], foreignColumns: [deploymentCredentials.deploymentId, deploymentCredentials.id], name: "usage_credential_deployment_fk" }),
]);

export const faceScanSessions = pgTable("face_scan_sessions", {
  id: varchar("id", { length: 26 }).primaryKey(),
  clientId: varchar("client_id", { length: 26 }).notNull(),
  deploymentId: varchar("deployment_id", { length: 26 }).notNull(),
  assessmentReference: varchar("assessment_reference", { length: 128 }).notNull(),
  provider: varchar("provider", { length: 40 }).notNull(),
  providerSessionReference: varchar("provider_session_reference", { length: 160 }),
  state: faceScanStateEnum("state").notNull().default("REQUESTED"),
  idempotencyKey: varchar("idempotency_key", { length: 128 }).notNull(),
  failureCode: varchar("failure_code", { length: 80 }),
  expiresAt: timestamp("expires_at", { withTimezone: true }),
  completedAt: timestamp("completed_at", { withTimezone: true }),
  ...timestamps,
}, (table) => [
  uniqueIndex("face_scan_deployment_idempotency_uq").on(table.deploymentId, table.idempotencyKey),
  foreignKey({ columns: [table.clientId, table.deploymentId], foreignColumns: [deployments.clientId, deployments.id], name: "face_scan_authorized_deployment_client_fk" }),
]);

export const auditEvents = pgTable("audit_events", {
  id: varchar("id", { length: 26 }).primaryKey(),
  clientId: varchar("client_id", { length: 26 }).references(() => clients.id),
  deploymentId: varchar("deployment_id", { length: 26 }).references(() => deployments.id),
  actorType: varchar("actor_type", { length: 40 }).notNull(),
  actorReference: varchar("actor_reference", { length: 128 }),
  action: varchar("action", { length: 120 }).notNull(),
  resourceType: varchar("resource_type", { length: 80 }).notNull(),
  resourceReference: varchar("resource_reference", { length: 128 }),
  requestId: varchar("request_id", { length: 128 }).notNull(),
  outcome: varchar("outcome", { length: 30 }).notNull(),
  metadata: jsonb("metadata").notNull().default({}),
  occurredAt: timestamp("occurred_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [index("audit_client_occurred_idx").on(table.clientId, table.occurredAt)]);

export const adminUsers = pgTable("admin_users", {
  id: varchar("id", { length: 26 }).primaryKey(),
  email: varchar("email", { length: 254 }).notNull().unique(),
  displayName: varchar("display_name", { length: 120 }).notNull(),
  passwordHash: varchar("password_hash", { length: 255 }).notNull(),
  enabled: boolean("enabled").notNull().default(true),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [check("admin_users_normalized_email_ck", sql`${table.email} = lower(trim(${table.email}))`)]);
export const adminInvitations = pgTable("admin_invitations", {
  id: varchar("id", { length: 26 }).primaryKey(),
  email: varchar("email", { length: 254 }).notNull().unique(),
  displayName: varchar("display_name", { length: 120 }).notNull(),
  tokenHash: varchar("token_hash", { length: 64 }).notNull().unique(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});
export const adminSessions = pgTable("admin_sessions", {
  tokenHash: varchar("token_hash", { length: 64 }).primaryKey(),
  userId: varchar("user_id", { length: 26 }).notNull().references(() => adminUsers.id),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
});
export const adminAuthAttempts = pgTable("admin_auth_attempts", {
  key: varchar("key", { length: 100 }).primaryKey(),
  count: integer("count").notNull(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
});
