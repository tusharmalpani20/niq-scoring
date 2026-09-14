ALTER TABLE "activation_tokens" ALTER COLUMN "expires_at" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "activation_tokens" ADD COLUMN "revoked_at" timestamp with time zone;