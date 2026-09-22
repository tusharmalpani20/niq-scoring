ALTER TABLE "face_scan_receipts" DROP CONSTRAINT "face_scan_receipt_disposition_ck";
--> statement-breakpoint
ALTER TABLE "face_scan_receipts" ADD CONSTRAINT "face_scan_receipt_disposition_ck" CHECK ("face_scan_receipts"."disposition" in ('RECEIVED','ACCEPTED','DUPLICATE','CONFLICT','UNPROCESSABLE'));
