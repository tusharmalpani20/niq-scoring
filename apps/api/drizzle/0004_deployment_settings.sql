-- Do not silently discard settings for clients that have no deployment.
DO $$ BEGIN
 IF EXISTS (SELECT 1 FROM clients c WHERE NOT EXISTS (SELECT 1 FROM deployments d WHERE d.client_id=c.id) AND
 (EXISTS (SELECT 1 FROM entitlements e WHERE e.client_id=c.id) OR EXISTS (SELECT 1 FROM client_version_assignments a WHERE a.client_id=c.id))) THEN
 RAISE EXCEPTION 'Create a deployment for clients with existing settings before migrating';
 END IF;
END $$;
--> statement-breakpoint
CREATE TABLE deployment_entitlements_new (
 id varchar(26) PRIMARY KEY,
 deployment_id varchar(26) NOT NULL REFERENCES deployments(id),
 capability entitlement_capability NOT NULL,
 enabled boolean NOT NULL DEFAULT true,
 monthly_limit integer,
 effective_from timestamptz NOT NULL DEFAULT now(),
 effective_until timestamptz,
 created_at timestamptz NOT NULL DEFAULT now(),
 updated_at timestamptz NOT NULL DEFAULT now(),
 CONSTRAINT entitlements_nonnegative_limit_ck CHECK(monthly_limit IS NULL OR monthly_limit>=0),
 CONSTRAINT entitlements_valid_period_ck CHECK(effective_until IS NULL OR effective_until>effective_from)
);
INSERT INTO deployment_entitlements_new
SELECT '0'||upper(substr(md5(e.id||d.id),1,25)), d.id, e.capability,e.enabled,e.monthly_limit,e.effective_from,e.effective_until,e.created_at,e.updated_at
FROM entitlements e JOIN deployments d ON d.client_id=e.client_id;
DROP TABLE entitlements;
ALTER TABLE deployment_entitlements_new RENAME TO entitlements;
CREATE UNIQUE INDEX entitlements_one_current_uq ON entitlements(deployment_id,capability) WHERE effective_until IS NULL;
CREATE INDEX entitlements_deployment_history_idx ON entitlements(deployment_id,capability,effective_from);
--> statement-breakpoint
CREATE TABLE deployment_version_assignments (
 id varchar(26) PRIMARY KEY,
 deployment_id varchar(26) NOT NULL REFERENCES deployments(id),
 mode version_assignment_mode NOT NULL,
 scoring_rule_version_id varchar(26) REFERENCES scoring_rule_versions(id),
 effective_from timestamptz NOT NULL DEFAULT now(),
 effective_until timestamptz,
 assigned_by varchar(26),
 created_at timestamptz NOT NULL DEFAULT now(),
 CONSTRAINT version_assignment_mode_ck CHECK((mode='PINNED' AND scoring_rule_version_id IS NOT NULL) OR (mode='LATEST_APPROVED' AND scoring_rule_version_id IS NULL)),
 CONSTRAINT version_assignments_valid_period_ck CHECK(effective_until IS NULL OR effective_until>effective_from)
);
INSERT INTO deployment_version_assignments
SELECT '0'||upper(substr(md5(a.id||d.id),1,25)),d.id,a.mode,a.scoring_rule_version_id,a.effective_from,a.effective_until,a.assigned_by,a.created_at
FROM client_version_assignments a JOIN deployments d ON d.client_id=a.client_id;
DROP TABLE client_version_assignments;
CREATE UNIQUE INDEX version_assignments_one_current_uq ON deployment_version_assignments(deployment_id) WHERE effective_until IS NULL;
CREATE INDEX version_assignments_deployment_history_idx ON deployment_version_assignments(deployment_id,effective_from);
--> statement-breakpoint
ALTER TABLE clients DROP COLUMN external_reference;
DROP INDEX usage_client_capability_month_idx;
CREATE INDEX usage_deployment_capability_month_idx ON usage_events(deployment_id,capability,occurred_at);
