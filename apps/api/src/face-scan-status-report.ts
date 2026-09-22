import type postgres from "postgres";
import { CarePlixResponseError, type CarePlixProvider, type ScanStatusReport } from "./careplix-provider";
import { encryptActivationToken } from "./lib/activation-secret";

/** Best-effort telemetry, separate from the scan outcome. Never retries an ambiguous delivery. */
export async function reportFaceScanStatus(sql: ReturnType<typeof postgres>, provider: CarePlixProvider,
  encryptionKey: string, sessionId: string, employeeId: string, token: string, report: ScanStatusReport) {
  if (!provider.updateStatus) return;
  const encrypt = (value: unknown) => encryptActivationToken(JSON.stringify(value), encryptionKey);
  // Claim before making the request so concurrent workers cannot report twice.
  const [claimed] = await sql`update face_scan_workflows
    set status_report_started_at=now(),status_report_ciphertext=${encrypt({ ...report, delivery: "UNCONFIRMED" })}
    where session_id=${sessionId} and status_report_started_at is null returning session_id`;
  if (!claimed) return;
  let evidence: unknown;
  try {
    await provider.updateStatus(employeeId, token, report);
    evidence = { ...report, delivery: "ACCEPTED" };
  } catch (error) {
    evidence = { ...report, delivery: "UNCONFIRMED",
      diagnostic: error instanceof CarePlixResponseError ? error.diagnostic ?? null : { failure: "STATUS_REPORT_ERROR" } };
  }
  await sql`update face_scan_workflows set status_report_ciphertext=${encrypt(evidence)} where session_id=${sessionId}`;
}
