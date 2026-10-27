ALTER TABLE "activation_tokens" ADD COLUMN "exchange_request_hash" varchar(64);
--> statement-breakpoint
ALTER TABLE "usage_events" ADD COLUMN "lease_token" varchar(26);
--> statement-breakpoint
ALTER TABLE "usage_events" ADD COLUMN "lease_expires_at" timestamp with time zone;
--> statement-breakpoint
ALTER TABLE "activation_tokens" ADD COLUMN "exchange_client_reference" varchar(26);
