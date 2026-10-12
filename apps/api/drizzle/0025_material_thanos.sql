ALTER TABLE "report_generation_runs" ADD COLUMN "attempt_id" varchar(26);--> statement-breakpoint
ALTER TABLE "report_generation_runs" ADD COLUMN "lease_expires_at" timestamp with time zone;--> statement-breakpoint
UPDATE "report_generation_runs" SET "attempt_id" = "id", "lease_expires_at" = clock_timestamp() - interval '1 second';--> statement-breakpoint
ALTER TABLE "report_generation_runs" ALTER COLUMN "attempt_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "report_generation_runs" ALTER COLUMN "lease_expires_at" SET NOT NULL;
