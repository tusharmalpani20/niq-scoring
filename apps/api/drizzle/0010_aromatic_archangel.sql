DROP INDEX "scoring_rule_versions_version_uq";--> statement-breakpoint
DROP INDEX "scoring_rule_versions_checksum_uq";--> statement-breakpoint
ALTER TABLE "scoring_rule_versions" ADD COLUMN "revision" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "scoring_rule_versions" ADD COLUMN "validated_revision" integer;--> statement-breakpoint
ALTER TABLE "scoring_rule_versions" ADD COLUMN "updated_at" timestamp with time zone DEFAULT now() NOT NULL;--> statement-breakpoint
ALTER TABLE "scoring_rule_versions" ADD COLUMN "create_request_id" varchar(128);--> statement-breakpoint
ALTER TABLE "scoring_rule_versions" ADD COLUMN "create_fingerprint" varchar(64);--> statement-breakpoint
CREATE UNIQUE INDEX "scoring_rule_versions_name_uq" ON "scoring_rule_versions" USING btree (lower(btrim("version")));--> statement-breakpoint
CREATE UNIQUE INDEX "scoring_rule_versions_create_request_uq" ON "scoring_rule_versions" USING btree ("create_request_id");--> statement-breakpoint
CREATE INDEX "scoring_rule_versions_checksum_idx" ON "scoring_rule_versions" USING btree ("package_checksum");