import { z } from "zod";

const optionalSetting = (schema: z.ZodString) => z.preprocess(
  (value) => typeof value === "string" && value.trim() === "" ? undefined : value,
  schema.optional(),
);

const environmentSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  PORT: z.coerce.number().int().min(1).max(65_535).default(4100),
  DATABASE_URL: z.string().min(1),
  LOG_LEVEL: z.enum(["debug", "info", "warn", "error"]).default("info"),
  CORS_ALLOWED_ORIGINS: z.string().default("http://localhost:4173"),
  DEPLOYMENT_REGION: z.string().min(1).default("india"),
  ACTIVATION_TOKEN_ENCRYPTION_KEY: z.string().regex(/^[a-fA-F0-9]{64}$/).optional(),
  ADMIN_BOOTSTRAP_TOKEN: z.string().min(32).optional(),
  SCORING_PLATFORM_ENABLED: z.enum(["true", "false"]).default("true").transform((value) => value === "true"),
  FACE_SCAN_PROVIDER: z.enum(["stub", "careplix"]).default("stub"),
  FACE_SCAN_ENABLED: z.enum(["true", "false"]).default("false").transform(v => v === "true"),
  CAREPLIX_CONTRACT_CONFIRMED: z.enum(["true", "false"]).default("false").transform(v => v === "true"),
  CAREPLIX_ACCOUNT_REFERENCE: optionalSetting(z.string().min(1).max(128)),
  FACE_SCAN_ENCRYPTION_KEY: optionalSetting(z.string().regex(/^[a-fA-F0-9]{64}$/)),
  FACE_SCAN_MIN_DISPATCH_INTERVAL_MS: z.coerce.number().int().min(1000).max(60_000).default(5000),
  FACE_SCAN_RETENTION_HOURS: z.coerce.number().int().min(1).max(168).default(24),
  FACE_SCAN_WEBHOOK_BEARER_CONFIRMED: z.enum(["true", "false"]).default("false").transform(v => v === "true"),
  CAREPLIX_API_BASE_URL: optionalSetting(z.string().url().startsWith("https://")),
  CAREPLIX_API_KEY: optionalSetting(z.string().min(1)),
  CAREPLIX_API_SECRET: optionalSetting(z.string().min(1)),
  FACE_SCAN_WEBHOOK_SECRET: optionalSetting(z.string().min(24)),
  ENABLE_PROVISIONAL_SCORING: z.enum(["true", "false"]).default("false").transform((value) => value === "true"),
});

export type Environment = z.infer<typeof environmentSchema>;

export function parseEnvironment(values: Record<string, string | undefined>): Environment {
  const result = environmentSchema.parse(values);
  if (result.FACE_SCAN_ENABLED && (!result.CAREPLIX_CONTRACT_CONFIRMED || result.FACE_SCAN_PROVIDER !== "careplix" || !result.CAREPLIX_API_BASE_URL || !result.CAREPLIX_API_KEY || !result.CAREPLIX_API_SECRET || !result.FACE_SCAN_ENCRYPTION_KEY || !result.CAREPLIX_ACCOUNT_REFERENCE)) throw new Error("Face scan enablement requires confirmed provider contract and complete server configuration");
  if (result.FACE_SCAN_WEBHOOK_BEARER_CONFIRMED && (!result.FACE_SCAN_WEBHOOK_SECRET || !result.FACE_SCAN_ENCRYPTION_KEY || !result.CAREPLIX_ACCOUNT_REFERENCE)) throw new Error("Confirmed webhook requires separate bearer secret, encryption key and account identity");
  return result;
}
