CREATE TABLE "assessment_bindings" (
	"id" varchar(26) PRIMARY KEY NOT NULL,
	"deployment_id" varchar(26) NOT NULL,
	"client_id" varchar(26) NOT NULL,
	"assessment_reference" varchar(128) NOT NULL,
	"scoring_rule_version_id" varchar(26) NOT NULL,
	"package_checksum" varchar(64) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "usage_events" ADD COLUMN "request_fingerprint" varchar(64);--> statement-breakpoint
ALTER TABLE "assessment_bindings" ADD CONSTRAINT "assessment_bindings_deployment_id_deployments_id_fk" FOREIGN KEY ("deployment_id") REFERENCES "public"."deployments"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "assessment_bindings" ADD CONSTRAINT "assessment_bindings_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "assessment_bindings" ADD CONSTRAINT "assessment_bindings_scoring_rule_version_id_scoring_rule_versions_id_fk" FOREIGN KEY ("scoring_rule_version_id") REFERENCES "public"."scoring_rule_versions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "assessment_binding_reference_uq" ON "assessment_bindings" USING btree ("deployment_id","assessment_reference");