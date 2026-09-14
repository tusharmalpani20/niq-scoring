import { z } from "zod";

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
  FACE_SCAN_WEBHOOK_SECRET: z.string().min(24),
  ENABLE_PROVISIONAL_SCORING: z.enum(["true", "false"]).default("false").transform((value) => value === "true"),
});

export type Environment = z.infer<typeof environmentSchema>;

export function parseEnvironment(values: Record<string, string | undefined>): Environment {
  return environmentSchema.parse(values);
}
