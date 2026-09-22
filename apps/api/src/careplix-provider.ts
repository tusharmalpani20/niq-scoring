import type { FaceScanContext, FaceScanResult, FaceScanSignal } from "@niq-scoring/contracts/face-scan-session";
import { z } from "zod";
import { allowlistedFaceScanReceipt } from "./face-scan-receipt";

import { faceScanDiagnostic } from "./face-scan-diagnostic";

const record = z.record(z.string(), z.unknown());
const scanId = z.string().min(1).max(160);
export class CarePlixResponseError extends Error { constructor(readonly diagnostic?: ReturnType<typeof faceScanDiagnostic>) { super("PROVIDER_OUTCOME_UNCONFIRMED"); } }
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
const scalar = (value: unknown): number | string | null => {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value !== "string" || !value.trim() || value.trim() === "--") return null;
  return value.trim();
};
const block = (value: unknown): Record<string, unknown> => value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
/** Display mapping is independent of complete encrypted provider evidence. */
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
    additionalMetrics: {
      heartHealthScore: scalar(metadata.overall_heart_score),
      heartRateMax: scalar(block(metadata.heart_scores).HRMax),
      heartRateReserve: scalar(block(metadata.heart_scores).HRR),
      heartUtilisation: scalar(block(metadata.heart_scores).heart_utilized),
      targetHeartRateRange: scalar(block(metadata.heart_scores).THRR),
      rmssd: scalar(block(metadata.heart_scores).rmssd),
      sdnn: scalar(block(metadata.heart_scores).sdnn),
      pnn50: scalar(block(metadata.heart_scores).pNN50_per),
      stressIndex: scalar(block(metadata.heart_scores).stress_index),
      cardiacOutput: scalar(block(metadata.cardiovascular).cardiac_out),
      meanArterialPressure: scalar(block(metadata.cardiovascular).map),
      prq: scalar(block(metadata.cardiovascular).prq),
      hba1c: scalar(block(metadata.glucose_info).hba1c),
      diabetesControlScore: scalar(block(metadata.glucose_info).diabetes_control_score),
      vo2max: scalar(block(metadata.physiological_scores).vo2max),
      bmi: scalar(block(metadata.physiological_scores).bmi),
      intensity: scalar(block(metadata.physiological_scores).intensity),
      totalBodyWater: scalar(block(metadata.physiological_scores).tbw),
      bodyWaterPercent: scalar(block(metadata.physiological_scores).tbwp),
      bodyFat: scalar(block(metadata.physiological_scores).bodyfat),
      caloriesFat: scalar(block(metadata.physiological_scores).cal_fat),
      caloriesCarbohydrate: scalar(block(metadata.physiological_scores).cal_carb),
      bloodVolume: scalar(block(metadata.physiological_scores).bloodvolume),
    },
    physiologicalScore: numberOrNull(metadata.physiological_score, 100), mentalWellbeingScore: numberOrNull(metadata.mental_wellbeing_score, 100),
  };
  if (result.wellnessScore === null && Object.values(result.vitals).every(v => v === null)) throw new CarePlixResponseError();
  return result;
}
export type ScanStatusReport = { fireType: "on_success" | "on_error" | "on_halt"; reason: string; errorCode?: string; device?: FaceScanSignal["device"] };
export interface CarePlixProvider {
  updateStatus?(employeeId: string, token: string, report: ScanStatusReport): Promise<void>;
  createToken(context: FaceScanContext): Promise<{ scanId: string; token: string }>;
  submit(context: FaceScanContext, signal: FaceScanSignal, token: string, expectedId: string, retain?: (receipt: unknown) => Promise<void>): Promise<FaceScanResult>;
}
export class HttpCarePlixProvider implements CarePlixProvider {
  constructor(private settings: { baseUrl: string; apiKey: string; apiSecret: string }, private transport: typeof fetch = fetch) {}
  private async post(path: string, body: Record<string, unknown>, timeoutMs = 90_000, retain?: (receipt: unknown) => Promise<void>): Promise<Record<string, unknown>> {
    const sensitive = [this.settings.apiKey, this.settings.apiSecret,
      ...Object.values(body).filter((value): value is string => typeof value === "string")];
    let httpStatus: number | null = null;
    let data: Record<string, unknown> | undefined;
    let failure = "NETWORK_ERROR";
    try {
      const response = await this.transport(new URL(path, this.settings.baseUrl), {
        method: "POST", headers: { "content-type": "application/json", authorization: this.settings.apiSecret },
        body: JSON.stringify({ ...body, api_key: this.settings.apiKey }), signal: AbortSignal.timeout(timeoutMs), redirect: "error",
      });
      httpStatus = response.status;
      failure = "EMPTY_RESPONSE";
      const reader = response.body?.getReader(); if (!reader) throw new Error();
      let size = 0; const chunks: Uint8Array[] = [];
      for (;;) { const { done, value } = await reader.read(); if (done) break; size += value.length;
        if (size > 1024 * 1024) { failure = "RESPONSE_TOO_LARGE"; await reader.cancel(); throw new Error(); }
        chunks.push(value);
      }
      failure = "INVALID_JSON";
      data = record.parse(JSON.parse(Buffer.concat(chunks).toString("utf8")));
      // Response tokens can also occur inside an error message. Redact these before retaining it.
      for (const key of ["scan_token", "token", "api_key", "api_secret", "authorization"]) {
        if (typeof data[key] === "string") sensitive.push(data[key] as string);
      }
      // Save parsed responses before status validation or result extraction, including rejections.
      failure = "RESPONSE_STORAGE_ERROR";
      await retain?.(allowlistedFaceScanReceipt(data, [this.settings.apiKey, this.settings.apiSecret, typeof body.scan_token === "string" ? body.scan_token : ""]));
      failure = "HTTP_ERROR";
      if (!response.ok) throw new Error();
      failure = "PROVIDER_REJECTION";
      if (typeof data.statusCode !== "number" || data.statusCode < 200 || data.statusCode >= 300) throw new Error();
      return data;
    } catch (error) {
      if (error instanceof Error && ["TimeoutError", "AbortError"].includes(error.name)) failure = "TIMEOUT";
      throw new CarePlixResponseError(faceScanDiagnostic(path, httpStatus, data, sensitive, failure));
    }
  }

  async updateStatus(employeeId: string, token: string, report: ScanStatusReport) {
    await this.post("/vitals/update-scan-status", {
      employee_id: employeeId, scan_token: token, device_model: report.device ?? "RPPG_CAREPLIX_FACE_WEB",
      fire_type: report.fireType, fire_reason: report.reason,
      error_list: report.errorCode ? [{ code: report.errorCode }] : [],
    }, 15_000);
  }
  async createToken(context: FaceScanContext) {
    const data = await this.post("/vitals/create-token", { employee_id: context.employeeId });
    try { return { scanId: scanId.parse(data.scan_id), token: z.string().min(1).max(8192).parse(data.scan_token) }; }
    catch { throw new CarePlixResponseError(faceScanDiagnostic("/vitals/create-token", 200, data,
      [this.settings.apiKey, this.settings.apiSecret, context.employeeId, typeof data.scan_token === "string" ? data.scan_token : ""], "INVALID_TOKEN_RESPONSE")); }
  }
  async submit(context: FaceScanContext, signal: FaceScanSignal, token: string, expectedId: string, retain?: (receipt: unknown) => Promise<void>) {
    const data = await this.post("/vitals/add-scan", {
      scan_token: token, employee_id: context.employeeId, dob: context.dob, gender: context.gender === "male" ? "Male" : "Female", posture: context.posture,
      metadata: { physiological_scores: { height: String(context.heightCm), weight: String(context.weightKg) }, ppg_time: signal.ppg_time, raw_intensity: signal.raw_intensity, device: signal.device ?? "RPPG_CAREPLIX_FACE_WEB", fps: Math.round(signal.average_fps) },
    }, 90_000, retain);
    if (!scanId.safeParse(data.scan_id).success || data.scan_id !== expectedId) throw new CarePlixResponseError(faceScanDiagnostic("/vitals/add-scan", 200, data, [this.settings.apiKey, this.settings.apiSecret, token, context.employeeId, context.dob], "SCAN_ID_MISMATCH"));
    try { return normalizeCarePlixResult(data, expectedId); }
    catch { throw new CarePlixUnprocessableResultError(allowlistedFaceScanReceipt({ scan_id: expectedId, event_data: data }, [this.settings.apiKey, this.settings.apiSecret, token])); }
  }
}
