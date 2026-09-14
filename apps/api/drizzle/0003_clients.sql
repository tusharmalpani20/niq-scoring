-- Collapse the commercial-parent/tenant model into clients without changing tenant IDs.
-- A multi-tenant deployment needs an explicit ownership decision before migration.
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM deployments d LEFT JOIN deployment_organizations l ON l.deployment_id=d.id GROUP BY d.id HAVING count(l.organization_id) <> 1) THEN
    RAISE EXCEPTION 'Each existing deployment must have exactly one organization before migrating to clients';
  END IF;
END $$;
--> statement-breakpoint
ALTER TABLE deployments ADD COLUMN client_id varchar(26);
UPDATE deployments d SET client_id=l.organization_id FROM deployment_organizations l WHERE l.deployment_id=d.id;
ALTER TABLE deployments ALTER COLUMN client_id SET NOT NULL;
--> statement-breakpoint
ALTER TABLE usage_events DROP CONSTRAINT usage_authorized_deployment_org_fk;
ALTER TABLE face_scan_sessions DROP CONSTRAINT face_scan_authorized_deployment_org_fk;
DROP TABLE deployment_organizations;
--> statement-breakpoint
-- Keep disabled parent accounts disabled in the unified model.
UPDATE organizations o SET enabled=o.enabled AND c.enabled FROM customers c WHERE c.id=o.customer_id;
-- Preserve standalone customer records as clients too.
INSERT INTO organizations (id, customer_id, name, external_reference, enabled, created_at, updated_at)
SELECT c.id, c.id, c.legal_name, c.external_reference, c.enabled, c.created_at, c.updated_at
FROM customers c WHERE NOT EXISTS (SELECT 1 FROM organizations o WHERE o.customer_id=c.id);
--> statement-breakpoint
ALTER TABLE organizations DROP COLUMN customer_id;
ALTER TABLE organizations RENAME TO clients;
CREATE UNIQUE INDEX clients_external_reference_uq ON clients(external_reference);
ALTER TABLE deployments DROP COLUMN customer_id;
ALTER TABLE deployments ADD CONSTRAINT deployments_client_id_clients_id_fk FOREIGN KEY (client_id) REFERENCES clients(id);
CREATE UNIQUE INDEX deployments_client_name_uq ON deployments(client_id,name);
CREATE UNIQUE INDEX deployments_client_id_uq ON deployments(client_id,id);
--> statement-breakpoint
ALTER TABLE entitlements RENAME COLUMN organization_id TO client_id;
ALTER TABLE organization_version_assignments RENAME TO client_version_assignments;
ALTER TABLE client_version_assignments RENAME COLUMN organization_id TO client_id;
ALTER TABLE usage_events DROP COLUMN customer_id;
ALTER TABLE usage_events RENAME COLUMN organization_id TO client_id;
ALTER TABLE face_scan_sessions DROP COLUMN customer_id;
ALTER TABLE face_scan_sessions RENAME COLUMN organization_id TO client_id;
ALTER TABLE audit_events RENAME COLUMN organization_id TO client_id;
ALTER TABLE usage_events ADD CONSTRAINT usage_authorized_deployment_client_fk FOREIGN KEY (client_id,deployment_id) REFERENCES deployments(client_id,id);
ALTER TABLE face_scan_sessions ADD CONSTRAINT face_scan_authorized_deployment_client_fk FOREIGN KEY (client_id,deployment_id) REFERENCES deployments(client_id,id);
DROP TABLE customers;
--> statement-breakpoint
ALTER INDEX entitlements_org_history_idx RENAME TO entitlements_client_history_idx;
ALTER INDEX version_assignments_org_history_idx RENAME TO version_assignments_client_history_idx;
ALTER INDEX usage_org_capability_month_idx RENAME TO usage_client_capability_month_idx;
ALTER INDEX audit_org_occurred_idx RENAME TO audit_client_occurred_idx;
