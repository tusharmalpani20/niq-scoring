CREATE TYPE "scoring_rule_lifecycle" AS ENUM ('DRAFT', 'VALIDATED', 'APPROVED', 'ACTIVE', 'RETIRED');
--> statement-breakpoint
CREATE TYPE "entitlement_capability" AS ENUM ('SCORING', 'FACE_SCAN');
--> statement-breakpoint
CREATE TYPE "usage_outcome" AS ENUM ('SUCCEEDED', 'FAILED', 'REJECTED', 'PENDING');
--> statement-breakpoint
CREATE TYPE "face_scan_state" AS ENUM ('REQUESTED', 'PROVIDER_SESSION_CREATED', 'CAPTURE_IN_PROGRESS', 'PROCESSING', 'COMPLETED', 'FAILED', 'EXPIRED');
--> statement-breakpoint
CREATE TYPE "version_assignment_mode" AS ENUM ('LATEST_APPROVED', 'PINNED');
--> statement-breakpoint
CREATE TABLE "customers" (
  "id" varchar(26) PRIMARY KEY NOT NULL,
  "legal_name" varchar(200) NOT NULL,
  "external_reference" varchar(100) NOT NULL,
  "enabled" boolean DEFAULT true NOT NULL,
  "created_at" timestamptz DEFAULT now() NOT NULL,
  "updated_at" timestamptz DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "customers_external_reference_uq" ON "customers" ("external_reference");
--> statement-breakpoint
CREATE TABLE "organizations" (
  "id" varchar(26) PRIMARY KEY NOT NULL,
  "customer_id" varchar(26) NOT NULL REFERENCES "customers"("id"),
  "name" varchar(200) NOT NULL,
  "external_reference" varchar(100) NOT NULL,
  "enabled" boolean DEFAULT true NOT NULL,
  "created_at" timestamptz DEFAULT now() NOT NULL,
  "updated_at" timestamptz DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "organizations_customer_reference_uq" ON "organizations" ("customer_id", "external_reference");
CREATE UNIQUE INDEX "organizations_customer_id_uq" ON "organizations" ("customer_id", "id");
--> statement-breakpoint
CREATE TABLE "deployments" (
  "id" varchar(26) PRIMARY KEY NOT NULL,
  "customer_id" varchar(26) NOT NULL REFERENCES "customers"("id"),
  "name" varchar(120) NOT NULL,
  "environment" varchar(30) NOT NULL,
  "region" varchar(50) NOT NULL,
  "enabled" boolean DEFAULT true NOT NULL,
  "last_seen_at" timestamptz,
  "created_at" timestamptz DEFAULT now() NOT NULL,
  "updated_at" timestamptz DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "deployments_customer_name_uq" ON "deployments" ("customer_id", "name");
CREATE UNIQUE INDEX "deployments_customer_id_uq" ON "deployments" ("customer_id", "id");
--> statement-breakpoint
CREATE TABLE "deployment_organizations" (
  "customer_id" varchar(26) NOT NULL,
  "deployment_id" varchar(26) NOT NULL,
  "organization_id" varchar(26) NOT NULL,
  "created_at" timestamptz DEFAULT now() NOT NULL,
  PRIMARY KEY ("deployment_id", "organization_id"),
  CONSTRAINT "deployment_org_deployment_fk" FOREIGN KEY ("customer_id", "deployment_id") REFERENCES "deployments"("customer_id", "id"),
  CONSTRAINT "deployment_org_organization_fk" FOREIGN KEY ("customer_id", "organization_id") REFERENCES "organizations"("customer_id", "id")
);
--> statement-breakpoint
CREATE UNIQUE INDEX "deployment_org_customer_scope_uq" ON "deployment_organizations" ("customer_id", "deployment_id", "organization_id");
--> statement-breakpoint
CREATE TABLE "deployment_credentials" (
  "id" varchar(26) PRIMARY KEY NOT NULL,
  "deployment_id" varchar(26) NOT NULL REFERENCES "deployments"("id"),
  "key_prefix" varchar(20) NOT NULL,
  "secret_hash" varchar(128) NOT NULL,
  "hash_algorithm" varchar(30) DEFAULT 'argon2id' NOT NULL,
  "created_at" timestamptz DEFAULT now() NOT NULL,
  "expires_at" timestamptz,
  "revoked_at" timestamptz,
  "last_used_at" timestamptz
);
--> statement-breakpoint
CREATE UNIQUE INDEX "deployment_credentials_prefix_uq" ON "deployment_credentials" ("key_prefix");
CREATE UNIQUE INDEX "deployment_credentials_deployment_id_uq" ON "deployment_credentials" ("deployment_id", "id");
--> statement-breakpoint
CREATE TABLE "entitlements" (
  "id" varchar(26) PRIMARY KEY NOT NULL,
  "organization_id" varchar(26) NOT NULL REFERENCES "organizations"("id"),
  "capability" "entitlement_capability" NOT NULL,
  "enabled" boolean DEFAULT true NOT NULL,
  "monthly_limit" integer,
  "effective_from" timestamptz DEFAULT now() NOT NULL,
  "effective_until" timestamptz,
  "created_at" timestamptz DEFAULT now() NOT NULL,
  "updated_at" timestamptz DEFAULT now() NOT NULL,
  CONSTRAINT "entitlements_nonnegative_limit_ck" CHECK ("monthly_limit" IS NULL OR "monthly_limit" >= 0),
  CONSTRAINT "entitlements_valid_period_ck" CHECK ("effective_until" IS NULL OR "effective_until" > "effective_from")
);
--> statement-breakpoint
CREATE UNIQUE INDEX "entitlements_one_current_uq" ON "entitlements" ("organization_id", "capability") WHERE "effective_until" IS NULL;
CREATE INDEX "entitlements_org_history_idx" ON "entitlements" ("organization_id", "capability", "effective_from");
--> statement-breakpoint
CREATE TABLE "scoring_rule_versions" (
  "id" varchar(26) PRIMARY KEY NOT NULL,
  "version" varchar(80) NOT NULL,
  "lifecycle" "scoring_rule_lifecycle" DEFAULT 'DRAFT' NOT NULL,
  "clinical_use_permitted" boolean DEFAULT false NOT NULL,
  "package_checksum" varchar(128) NOT NULL,
  "definition" jsonb NOT NULL,
  "created_by" varchar(26),
  "created_at" timestamptz DEFAULT now() NOT NULL,
  "validated_at" timestamptz,
  "approved_at" timestamptz,
  "activated_at" timestamptz,
  "retired_at" timestamptz
);
--> statement-breakpoint
CREATE UNIQUE INDEX "scoring_rule_versions_version_uq" ON "scoring_rule_versions" ("version");
CREATE UNIQUE INDEX "scoring_rule_versions_checksum_uq" ON "scoring_rule_versions" ("package_checksum");
--> statement-breakpoint
CREATE TABLE "organization_version_assignments" (
  "id" varchar(26) PRIMARY KEY NOT NULL,
  "organization_id" varchar(26) NOT NULL REFERENCES "organizations"("id"),
  "mode" "version_assignment_mode" NOT NULL,
  "scoring_rule_version_id" varchar(26) REFERENCES "scoring_rule_versions"("id"),
  "effective_from" timestamptz DEFAULT now() NOT NULL,
  "effective_until" timestamptz,
  "assigned_by" varchar(26),
  "created_at" timestamptz DEFAULT now() NOT NULL,
  CONSTRAINT "version_assignment_mode_ck" CHECK (("mode" = 'PINNED' AND "scoring_rule_version_id" IS NOT NULL) OR ("mode" = 'LATEST_APPROVED' AND "scoring_rule_version_id" IS NULL)),
  CONSTRAINT "version_assignments_valid_period_ck" CHECK ("effective_until" IS NULL OR "effective_until" > "effective_from")
);
--> statement-breakpoint
CREATE UNIQUE INDEX "version_assignments_one_current_uq" ON "organization_version_assignments" ("organization_id") WHERE "effective_until" IS NULL;
CREATE INDEX "version_assignments_org_history_idx" ON "organization_version_assignments" ("organization_id", "effective_from");
--> statement-breakpoint
CREATE TABLE "usage_events" (
  "id" varchar(26) PRIMARY KEY NOT NULL,
  "customer_id" varchar(26) NOT NULL,
  "organization_id" varchar(26) NOT NULL,
  "deployment_id" varchar(26) NOT NULL,
  "credential_id" varchar(26),
  "capability" "entitlement_capability" NOT NULL,
  "scoring_rule_version_id" varchar(26) REFERENCES "scoring_rule_versions"("id"),
  "request_id" varchar(128) NOT NULL,
  "idempotency_key" varchar(128) NOT NULL,
  "assessment_reference" varchar(128) NOT NULL,
  "outcome" "usage_outcome" NOT NULL,
  "billable" boolean DEFAULT false NOT NULL,
  "occurred_at" timestamptz DEFAULT now() NOT NULL,
  CONSTRAINT "usage_authorized_deployment_org_fk" FOREIGN KEY ("customer_id", "deployment_id", "organization_id") REFERENCES "deployment_organizations"("customer_id", "deployment_id", "organization_id"),
  CONSTRAINT "usage_credential_deployment_fk" FOREIGN KEY ("deployment_id", "credential_id") REFERENCES "deployment_credentials"("deployment_id", "id")
);
--> statement-breakpoint
CREATE UNIQUE INDEX "usage_deployment_idempotency_uq" ON "usage_events" ("deployment_id", "capability", "idempotency_key");
CREATE INDEX "usage_org_capability_month_idx" ON "usage_events" ("organization_id", "capability", "occurred_at");
--> statement-breakpoint
CREATE TABLE "face_scan_sessions" (
  "id" varchar(26) PRIMARY KEY NOT NULL,
  "customer_id" varchar(26) NOT NULL,
  "organization_id" varchar(26) NOT NULL,
  "deployment_id" varchar(26) NOT NULL,
  "assessment_reference" varchar(128) NOT NULL,
  "provider" varchar(40) NOT NULL,
  "provider_session_reference" varchar(160),
  "state" "face_scan_state" DEFAULT 'REQUESTED' NOT NULL,
  "idempotency_key" varchar(128) NOT NULL,
  "failure_code" varchar(80),
  "expires_at" timestamptz,
  "completed_at" timestamptz,
  "created_at" timestamptz DEFAULT now() NOT NULL,
  "updated_at" timestamptz DEFAULT now() NOT NULL,
  CONSTRAINT "face_scan_authorized_deployment_org_fk" FOREIGN KEY ("customer_id", "deployment_id", "organization_id") REFERENCES "deployment_organizations"("customer_id", "deployment_id", "organization_id")
);
--> statement-breakpoint
CREATE UNIQUE INDEX "face_scan_deployment_idempotency_uq" ON "face_scan_sessions" ("deployment_id", "idempotency_key");
--> statement-breakpoint
CREATE TABLE "audit_events" (
  "id" varchar(26) PRIMARY KEY NOT NULL,
  "organization_id" varchar(26) REFERENCES "organizations"("id"),
  "deployment_id" varchar(26) REFERENCES "deployments"("id"),
  "actor_type" varchar(40) NOT NULL,
  "actor_reference" varchar(128),
  "action" varchar(120) NOT NULL,
  "resource_type" varchar(80) NOT NULL,
  "resource_reference" varchar(128),
  "request_id" varchar(128) NOT NULL,
  "outcome" varchar(30) NOT NULL,
  "metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "occurred_at" timestamptz DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "audit_org_occurred_idx" ON "audit_events" ("organization_id", "occurred_at");
--> statement-breakpoint
CREATE FUNCTION reject_audit_mutation() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'audit_events is append-only';
END;
$$;
--> statement-breakpoint
CREATE TRIGGER audit_events_append_only BEFORE UPDATE OR DELETE ON "audit_events"
FOR EACH ROW EXECUTE FUNCTION reject_audit_mutation();
--> statement-breakpoint
CREATE FUNCTION protect_published_scoring_rule() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' OR NEW.version <> OLD.version OR NEW.package_checksum <> OLD.package_checksum OR NEW.definition <> OLD.definition THEN
    RAISE EXCEPTION 'published scoring rule identity and definition are immutable';
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER scoring_rule_immutable BEFORE UPDATE OR DELETE ON "scoring_rule_versions"
FOR EACH ROW EXECUTE FUNCTION protect_published_scoring_rule();
