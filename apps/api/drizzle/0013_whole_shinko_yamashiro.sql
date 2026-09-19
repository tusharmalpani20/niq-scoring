CREATE TABLE "scoring_rule_name_aliases" (
	"name" text PRIMARY KEY NOT NULL,
	"rule_id" varchar(26) NOT NULL
);
--> statement-breakpoint
INSERT INTO scoring_rule_name_aliases (name, rule_id)
SELECT lower(btrim(version)), id FROM scoring_rule_versions;
