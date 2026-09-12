ALTER TABLE "deployment_credentials" ALTER COLUMN "hash_algorithm" SET DEFAULT 'sha256';
--> statement-breakpoint
CREATE TABLE "activation_tokens" (
  "id" varchar(26) PRIMARY KEY NOT NULL,
  "deployment_id" varchar(26) NOT NULL REFERENCES "deployments"("id"),
  "token_hash" varchar(64) NOT NULL,
  "expires_at" timestamptz NOT NULL,
  "used_at" timestamptz,
  "created_at" timestamptz DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "activation_tokens_hash_uq" ON "activation_tokens" ("token_hash");
CREATE INDEX "activation_tokens_deployment_idx" ON "activation_tokens" ("deployment_id", "created_at");
--> statement-breakpoint
ALTER TABLE "usage_events" ADD COLUMN "response_payload" jsonb;
ALTER TABLE "usage_events" ADD COLUMN "completed_at" timestamptz;
--> statement-breakpoint
INSERT INTO "scoring_rule_versions" (
  "id", "version", "lifecycle", "clinical_use_permitted", "package_checksum", "definition"
) VALUES (
  '01K4ZJ9QJ7F3TWHDW1B1T6A4YV',
  'NIQ-DRAFT-2026-09',
  'DRAFT',
  false,
  '2619f835f218cc09ab6f2e38919453a7eeaa984c4fabbda51ce53c3497263600',
  '{"status":"DRAFT_NON_CLINICAL","clinicalUsePermitted":false}'::jsonb
) ON CONFLICT ("version") DO NOTHING;
