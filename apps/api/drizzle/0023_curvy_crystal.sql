CREATE TABLE "report_generation_calls" (
	"id" varchar(26) PRIMARY KEY NOT NULL,
	"run_id" varchar(26) NOT NULL,
	"step" varchar(20) NOT NULL,
	"status" varchar(20) NOT NULL,
	"model" varchar(80) NOT NULL,
	"provider" varchar(80),
	"generation_id" varchar(160),
	"prompt_tokens" integer,
	"completion_tokens" integer,
	"reasoning_tokens" integer,
	"cost_usd" numeric(18, 9),
	"latency_ms" integer NOT NULL,
	"error_code" varchar(80),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "report_call_step_ck" CHECK ("report_generation_calls"."step" in ('writer','reviewer','revision')),
	CONSTRAINT "report_call_status_ck" CHECK ("report_generation_calls"."status" in ('SUCCEEDED','FAILED'))
);
--> statement-breakpoint
CREATE TABLE "report_generation_runs" (
	"id" varchar(26) PRIMARY KEY NOT NULL,
	"client_id" varchar(26) NOT NULL,
	"deployment_id" varchar(26) NOT NULL,
	"assessment_reference" varchar(128) NOT NULL,
	"result_reference" varchar(128) NOT NULL,
	"rule_version_id" varchar(26) NOT NULL,
	"checksum" varchar(128) NOT NULL,
	"idempotency_key" varchar(128) NOT NULL,
	"fingerprint" varchar(128) NOT NULL,
	"model" varchar(80) NOT NULL,
	"prompt_version" varchar(128) NOT NULL,
	"schema_version" integer NOT NULL,
	"status" varchar(30) NOT NULL,
	"response" jsonb,
	"error_code" varchar(80),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"completed_at" timestamp with time zone,
	CONSTRAINT "report_run_status_ck" CHECK ("report_generation_runs"."status" in ('PROCESSING','READY','REVIEW_REQUIRED','FAILED'))
);
--> statement-breakpoint
ALTER TABLE "report_generation_calls" ADD CONSTRAINT "report_generation_calls_run_id_report_generation_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."report_generation_runs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "report_generation_runs" ADD CONSTRAINT "report_generation_runs_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "report_generation_runs" ADD CONSTRAINT "report_generation_runs_deployment_id_deployments_id_fk" FOREIGN KEY ("deployment_id") REFERENCES "public"."deployments"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "report_generation_runs" ADD CONSTRAINT "report_generation_runs_rule_version_id_scoring_rule_versions_id_fk" FOREIGN KEY ("rule_version_id") REFERENCES "public"."scoring_rule_versions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "report_generation_runs" ADD CONSTRAINT "report_run_authorized_deployment_client_fk" FOREIGN KEY ("client_id","deployment_id") REFERENCES "public"."deployments"("client_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "report_calls_run_created_idx" ON "report_generation_calls" USING btree ("run_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "report_run_deployment_idempotency_uq" ON "report_generation_runs" USING btree ("deployment_id","idempotency_key");--> statement-breakpoint
CREATE INDEX "report_run_client_created_idx" ON "report_generation_runs" USING btree ("client_id","created_at");