CREATE TABLE "face_scan_reuses" (
  "id" varchar(26) PRIMARY KEY NOT NULL,
  "source_session_id" varchar(26) NOT NULL REFERENCES "face_scan_workflows"("session_id"),
  "source_assessment_reference" varchar(128) NOT NULL,
  "assessment_binding_id" varchar(26) NOT NULL REFERENCES "assessment_bindings"("id"),
  "client_id" varchar(26) NOT NULL REFERENCES "clients"("id"),
  "deployment_id" varchar(26) NOT NULL REFERENCES "deployments"("id"),
  "organization_reference" varchar(128) NOT NULL,
  "assessment_reference" varchar(128) NOT NULL,
  "context_ciphertext" text NOT NULL,
  "result" jsonb NOT NULL,
  "score" jsonb NOT NULL,
  "captured_at" timestamp with time zone NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "face_scan_reuse_distinct_assessment_ck" CHECK ("source_assessment_reference" <> "assessment_reference")
);
--> statement-breakpoint
CREATE UNIQUE INDEX "face_scan_reuse_destination_uq" ON "face_scan_reuses" ("deployment_id", "assessment_reference");
