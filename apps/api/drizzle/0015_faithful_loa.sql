CREATE TABLE "face_scan_receipts" (
	"id" varchar(26) PRIMARY KEY NOT NULL,
	"session_id" varchar(26) NOT NULL,
	"channel" text NOT NULL,
	"payload_hash" varchar(64) NOT NULL,
	"normalized_result" jsonb,
	"disposition" text NOT NULL,
	"received_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "face_scan_receipt_channel_ck" CHECK ("face_scan_receipts"."channel" in ('DIRECT','WEBHOOK')),
	CONSTRAINT "face_scan_receipt_disposition_ck" CHECK ("face_scan_receipts"."disposition" in ('ACCEPTED','DUPLICATE','CONFLICT','UNPROCESSABLE'))
);
--> statement-breakpoint
CREATE TABLE "face_scan_workflows" (
	"session_id" varchar(26) PRIMARY KEY NOT NULL,
	"usage_id" varchar(26) NOT NULL,
	"deployment_id" varchar(26) NOT NULL,
	"organization_reference" varchar(128) NOT NULL,
	"assessment_reference" varchar(128) NOT NULL,
	"request_fingerprint" varchar(64) NOT NULL,
	"context_ciphertext" text NOT NULL,
	"state" text DEFAULT 'REQUESTED' NOT NULL,
	"provider_account" text NOT NULL,
	"provider_scan_id" varchar(160),
	"token_ciphertext" text,
	"signal_ciphertext" text,
	"signal_checksum" varchar(64),
	"signal_bytes" integer,
	"mapping" jsonb,
	"result" jsonb,
	"score" jsonb,
	"dispatch_phase" text,
	"dispatch_started_at" timestamp with time zone,
	"fence" text,
	"failure_code" text,
	"capture_expires_at" timestamp with time zone NOT NULL,
	"completed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "face_scan_workflows_usage_id_unique" UNIQUE("usage_id"),
	CONSTRAINT "face_scan_workflow_state_ck" CHECK ("face_scan_workflows"."state" in ('REQUESTED','UPLOAD_ACCEPTED','PROCESSING','COMPLETED','RECONCILIATION_REQUIRED','FAILED','EXPIRED','CANCELLED','PAUSED')),
	CONSTRAINT "face_scan_signal_bytes_ck" CHECK ("face_scan_workflows"."signal_bytes" between 0 and 2097152),
	CONSTRAINT "face_scan_dispatch_phase_ck" CHECK ("face_scan_workflows"."dispatch_phase" in ('TOKEN','SUBMIT'))
);
--> statement-breakpoint
ALTER TABLE "face_scan_receipts" ADD CONSTRAINT "face_scan_receipts_session_id_face_scan_workflows_session_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."face_scan_workflows"("session_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "face_scan_workflows" ADD CONSTRAINT "face_scan_workflows_session_id_face_scan_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."face_scan_sessions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "face_scan_workflows" ADD CONSTRAINT "face_scan_workflows_usage_id_usage_events_id_fk" FOREIGN KEY ("usage_id") REFERENCES "public"."usage_events"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "face_scan_workflows" ADD CONSTRAINT "face_scan_workflows_deployment_id_deployments_id_fk" FOREIGN KEY ("deployment_id") REFERENCES "public"."deployments"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "face_scan_receipt_replay_uq" ON "face_scan_receipts" USING btree ("session_id","channel","payload_hash");--> statement-breakpoint
CREATE UNIQUE INDEX "face_scan_provider_identity_uq" ON "face_scan_workflows" USING btree ("provider_account","provider_scan_id");--> statement-breakpoint
CREATE UNIQUE INDEX "face_scan_one_active_uq" ON "face_scan_workflows" USING btree ("deployment_id","organization_reference","assessment_reference") WHERE "face_scan_workflows"."state" in ('REQUESTED','UPLOAD_ACCEPTED','PROCESSING','RECONCILIATION_REQUIRED','PAUSED');--> statement-breakpoint
CREATE INDEX "face_scan_workflows_pending_idx" ON "face_scan_workflows" USING btree ("state","created_at");