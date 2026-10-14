CREATE TABLE "report_content_jobs" (
  "id" varchar(26) PRIMARY KEY NOT NULL,
  "credential_id" varchar(26) NOT NULL,
  "client_id" varchar(26) NOT NULL,
  "deployment_id" varchar(26) NOT NULL,
  "idempotency_key" varchar(128) NOT NULL,
  "fingerprint" varchar(128) NOT NULL,
  "input" jsonb NOT NULL,
  "status" varchar(30) NOT NULL,
  "response" jsonb,
  "error_code" varchar(80),
  "attempt_id" varchar(26),
  "attempts" integer NOT NULL DEFAULT 0,
  "lease_expires_at" timestamp with time zone,
  "created_at" timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT "report_content_jobs_status_ck" CHECK ("status" in ('QUEUED','PROCESSING','READY','REVIEW_REQUIRED','FAILED')),
  CONSTRAINT "report_content_jobs_client_deployment_fk" FOREIGN KEY ("client_id","deployment_id") REFERENCES "public"."deployments"("client_id","id")
);--> statement-breakpoint
CREATE UNIQUE INDEX "report_content_jobs_idempotency_uq" ON "report_content_jobs" ("deployment_id","idempotency_key");--> statement-breakpoint
CREATE INDEX "report_content_jobs_queue_idx" ON "report_content_jobs" ("status","created_at");
