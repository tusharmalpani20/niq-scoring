CREATE TABLE "scoring_rule_default" (
	"singleton" boolean PRIMARY KEY DEFAULT true NOT NULL,
	"rule_id" varchar(26),
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" text,
	CONSTRAINT "scoring_rule_default_singleton_ck" CHECK ("scoring_rule_default"."singleton"=true)
);
--> statement-breakpoint
ALTER TABLE "scoring_rule_default" ADD CONSTRAINT "scoring_rule_default_rule_id_scoring_rule_versions_id_fk" FOREIGN KEY ("rule_id") REFERENCES "public"."scoring_rule_versions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
-- Preserve the version previously selected for new assessments. Future changes are explicit.
INSERT INTO scoring_rule_default (singleton, rule_id)
VALUES (true, (SELECT id FROM scoring_rule_versions
  WHERE lifecycle IN ('APPROVED', 'ACTIVE') AND clinical_use_permitted=true
  ORDER BY approved_at DESC NULLS LAST, id DESC LIMIT 1));
