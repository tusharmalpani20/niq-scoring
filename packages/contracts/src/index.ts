import { z } from "zod";
import { PROVISIONAL_RULE_CHECKSUM, PROVISIONAL_SCORING_VERSION, PROVISIONAL_VERSION_STATUS } from "./metadata";

export { PROVISIONAL_RULE_CHECKSUM, PROVISIONAL_SCORING_VERSION, PROVISIONAL_VERSION_STATUS } from "./metadata";

// Canonical ULIDs are uppercase Crockford Base32. Keeping this shared prevents
// clients from accepting identifiers that the persistence layer cannot preserve.
export const ulidSchema = z.string().regex(/^[0-7][0-9A-HJKMNP-TV-Z]{25}$/, "Invalid ULID");

export const fluidStatusSchema = z.object({
  edema: z.boolean().default(false),
  ascites: z.boolean().default(false),
  pleuralEffusion: z.boolean().default(false),
  pericardialEffusion: z.boolean().default(false),
  hypoalbuminemia: z.boolean().default(false),
});

export const symptomFlagsSchema = z.object({
  nausea: z.boolean().default(false),
  vomiting: z.boolean().default(false),
  mucositis: z.boolean().default(false),
  dysphagia: z.boolean().default(false),
  earlySatiety: z.boolean().default(false),
  diarrhea: z.boolean().default(false),
  constipation: z.boolean().default(false),
  tasteChange: z.boolean().default(false),
  painWithEating: z.boolean().default(false),
  fatigue: z.boolean().default(false),
});

export const provisionalScoringInputSchema = z.object({
  assessmentReference: z.string().min(1).max(128),
  clientId: ulidSchema,
  requestedVersion: z.literal(PROVISIONAL_SCORING_VERSION).optional(),
  heightCm: z.number().positive().max(300).nullable(),
  weightKg: z.number().positive().max(500).nullable(),
  weightTrend: z.enum(["stable", "loss", "gain", "unknown"]),
  weightChangePercent: z.number().min(0).max(100).nullable(),
  intakeLevel: z.enum(["normal", "reduced_mild", "reduced_moderate", "reduced_severe", "nil_by_mouth"]),
  appetite: z.enum(["good", "fair", "poor", "none"]),
  functionalStatus: z.enum(["fully_active", "restricted_strenuous", "ambulatory_selfcare", "limited_selfcare", "disabled"]),
  cancerStage: z.enum(["Localized (Stage I–II)", "Locally Advanced (Stage III)", "Metastatic (Stage IV)", "Unknown"]),
  albumin: z.number().min(0).max(20).nullable(),
  crp: z.number().min(0).max(1000).nullable(),
  fluidStatus: fluidStatusSchema,
  symptoms: symptomFlagsSchema,
});

export const scoreComponentSchema = z.object({
  key: z.string(),
  points: z.number().int(),
  explanation: z.string(),
});

export const provisionalScoringResultSchema = z.object({
  assessmentReference: z.string(),
  version: z.literal(PROVISIONAL_SCORING_VERSION),
  ruleChecksum: z.literal(PROVISIONAL_RULE_CHECKSUM),
  versionStatus: z.literal(PROVISIONAL_VERSION_STATUS),
  clinicalUsePermitted: z.literal(false),
  calculatedAt: z.string().datetime(),
  bmi: z.number().nullable(),
  score: z.number().int().min(0).max(100),
  band: z.enum(["Low", "Moderate", "High", "Critical"]),
  components: z.array(scoreComponentSchema),
  disclaimer: z.string(),
});

export const calculateRequestSchema = z.object({
  idempotencyKey: z.string().min(8).max(128),
  input: provisionalScoringInputSchema,
});

export const faceScanSessionStateSchema = z.enum([
  "REQUESTED",
  "PROVIDER_SESSION_CREATED",
  "CAPTURE_IN_PROGRESS",
  "PROCESSING",
  "COMPLETED",
  "FAILED",
  "EXPIRED",
]);

export const createFaceScanSessionSchema = z.object({
  clientId: ulidSchema,
  assessmentReference: z.string().min(1).max(128),
  idempotencyKey: z.string().min(8).max(128),
});

export const updateEnabledSchema = z.object({ enabled: z.boolean() });

export const createClientSchema = z.object({
  name: z.string().trim().min(2).max(200),
});

export const createDeploymentSchema = z.object({
  name: z.string().trim().min(2).max(120),
  environment: z.enum(["development", "test", "staging", "production"]),
  clientId: ulidSchema,
});

export const entitlementInputSchema = z.object({
  capability: z.enum(["SCORING", "FACE_SCAN"]),
  enabled: z.boolean(),
  monthlyLimit: z.number().int().nonnegative().max(2147483647).nullable(),
});

export const versionAssignmentInputSchema = z.discriminatedUnion("mode", [
  z.object({ mode: z.literal("LATEST_APPROVED") }),
  z.object({ mode: z.literal("PINNED"), scoringRuleVersionId: ulidSchema }),
]);

export const deploymentConfigurationSchema = createDeploymentSchema.extend({
  hostingType: z.enum(["NIQ_HOSTED", "CLIENT_CLOUD", "ON_PREMISES"]),
  enabled: z.boolean(),
  scoring: entitlementInputSchema.omit({ capability: true }),
  faceScan: entitlementInputSchema.omit({ capability: true }),
  versionAssignment: versionAssignmentInputSchema,
});
export const activationTokenInputSchema = z.object({
  expiresInMinutes: z.number().int().min(1).max(518400).optional(),
  expiresAt: z.iso.datetime().nullable().optional(),
}).refine(value => value.expiresAt === undefined || value.expiresInMinutes === undefined, {
  message: "Choose one expiry option.",
});
// Admin callers choose configuration; display names are server-generated.
export const deploymentConfigurationRequestSchema = deploymentConfigurationSchema.omit({ name: true }).extend({
  tokenExpiry: activationTokenInputSchema.default({ expiresInMinutes: 10080 }),
});
export type DeploymentConfiguration = z.infer<typeof deploymentConfigurationSchema>;

export const activationExchangeSchema = z.object({
  activationToken: z.string().min(48).max(256),
});

export type CreateClient = z.infer<typeof createClientSchema>;
export type CreateDeployment = z.infer<typeof createDeploymentSchema>;
export type EntitlementInput = z.infer<typeof entitlementInputSchema>;
export type VersionAssignmentInput = z.infer<typeof versionAssignmentInputSchema>;

export type ProvisionalScoringInput = z.infer<typeof provisionalScoringInputSchema>;
export type ProvisionalScoringResult = z.infer<typeof provisionalScoringResultSchema>;
export type CalculateRequest = z.infer<typeof calculateRequestSchema>;
export type FaceScanSessionState = z.infer<typeof faceScanSessionStateSchema>;
