import type { FaceScanContext, FaceScanResult, FaceScanSignal } from "@niq-scoring/contracts/face-scan-session";
import { z } from "zod";
import { allowlistedFaceScanReceipt } from "./face-scan-receipt";

const record = z.record(z.string(), z.unknown());
const scanId = z.string().min(1).max(160);
export class CarePlixResponseError extends Error { constructor() { super("PROVIDER_OUTCOME_UNCONFIRMED"); } }
/** Only a successful, correlated HTTP response can become repair evidence. */
export class CarePlixUnprocessableResultError extends CarePlixResponseError {
  constructor(readonly receipt: unknown) { super(); }
}
function numberOrNull(value: unknown, maximum = Number.MAX_SAFE_INTEGER): number | null {
  if (value === undefined || value === null || value === "--" || value === "") return null;
  const number = typeof value === "string" && value.trim() !== "" ? Number(value) : value;
  if (typeof number !== "number" || !Number.isFinite(number) || number < 0 || number > maximum) throw new CarePlixResponseError();
  return number;
}
/** Only supported fields reach patient displays; input echoes and beta glucose stay withheld. */
export function normalizeCarePlixResult(input: unknown, expectedId: string): FaceScanResult {
  const data = record.parse(input);
  if (scanId.parse(data.scan_id) !== expectedId) throw new CarePlixResponseError();
  const vitals = record.parse(data.vitals);
  const metadata = data.metadata === undefined ? {} : record.parse(data.metadata);
  const result: FaceScanResult = {
    schemaVersion: 1, providerScanId: expectedId,
    providerCompletedAt: data.scan_completion_time === undefined || data.scan_completion_time === null ? null : z.string().refine(v => Number.isFinite(Date.parse(v))).parse(data.scan_completion_time),
    wellnessScore: numberOrNull(data.wellness_score, 100), healthRiskScore: numberOrNull(data.health_risk_score, 100),
    vitals: { heartRate: numberOrNull(vitals.heart_rate), oxygenSaturation: numberOrNull(vitals.oxy_sat_prcnt, 100), respiratoryRate: numberOrNull(vitals.resp_rate), systolic: numberOrNull(vitals.bp_sys), diastolic: numberOrNull(vitals.bp_dia) },
    physiologicalScore: numberOrNull(metadata.physiological_score, 100), mentalWellbeingScore: numberOrNull(metadata.mental_wellbeing_score, 100),
  };
  if (result.wellnessScore === null && Object.values(result.vitals).every(v => v === null)) throw new CarePlixResponseError();
  return result;
}
export interface CarePlixProvider {
  createToken(context: FaceScanContext): Promise<{ scanId: string; token: string }>;
  submit(context: FaceScanContext, signal: FaceScanSignal, token: string, expectedId: string): Promise<FaceScanResult>;
}
export class HttpCarePlixProvider implements CarePlixProvider {
  constructor(private settings: { baseUrl: string; apiKey: string; apiSecret: string }, private transport: typeof fetch = fetch) {}
  private async post(path: string, body: Record<string, unknown>): Promise<Record<string, unknown>> {
    const response = await this.transport(new URL(path, this.settings.baseUrl), {
      method: "POST", headers: { "content-type": "application/json", authorization: this.settings.apiSecret },
      body: JSON.stringify({ ...body, api_key: this.settings.apiKey }), signal: AbortSignal.timeout(90_000), redirect: "error",
    });
    if (!response.ok) throw new CarePlixResponseError();
    // Provider responses are bounded too; never retain provider messages or credentials in errors.
    const reader = response.body?.getReader(); if (!reader) throw new CarePlixResponseError();
    let size = 0; const chunks: Uint8Array[] = [];
    for (;;) { const { done, value } = await reader.read(); if (done) break; size += value.length; if (size > 1024 * 1024) { await reader.cancel(); throw new CarePlixResponseError(); } chunks.push(value); }
    const bodyText = Buffer.concat(chunks).toString("utf8");
    const data = record.parse(JSON.parse(bodyText));
    if (typeof data.statusCode !== "number" || data.statusCode < 200 || data.statusCode >= 300) throw new CarePlixResponseError();
    return data;
  }
  async createToken(context: FaceScanContext) {
    const data = await this.post("/vitals/create-token", { employee_id: context.employeeId });
    return { scanId: scanId.parse(data.scan_id), token: z.string().min(1).max(8192).parse(data.scan_token) };
  }
  async submit(context: FaceScanContext, signal: FaceScanSignal, token: string, expectedId: string) {
    const data = await this.post("/vitals/add-scan", {
      scan_token: token, employee_id: context.employeeId, dob: context.dob, gender: context.gender === "male" ? "Male" : "Female", posture: context.posture,
      metadata: { physiological_scores: { height: String(context.heightCm), weight: String(context.weightKg) }, ppg_time: signal.ppg_time, raw_intensity: signal.raw_intensity, device: "RPPG_CAREPLIX_FACE_WEB", fps: Math.round(signal.average_fps) },
    });
    if (scanId.parse(data.scan_id) !== expectedId) throw new CarePlixResponseError();
    try { return normalizeCarePlixResult(data, expectedId); }
    catch { throw new CarePlixUnprocessableResultError(allowlistedFaceScanReceipt({ scan_id: expectedId, event_data: data })); }
  }
}
