ALTER TABLE "face_scan_workflows" ADD COLUMN "status_report_started_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "face_scan_workflows" ADD COLUMN "status_report_ciphertext" text;