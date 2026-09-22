import { z } from "zod";

export const FACE_SCAN_MAX_BODY_BYTES = 2 * 1024 * 1024;
export const FACE_SCAN_MAX_SAMPLES = 12_000;
const reference = z.string().min(1).max(128);
const finite = z.number().finite();
export const faceScanContextSchema = z.object({
  dob: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine(value => {
    const date = new Date(`${value}T00:00:00Z`);
    return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value && date <= new Date();
  }, "A valid date of birth is required"),
  gender: z.enum(["male", "female"]),
  heightCm: finite.positive().max(300), weightKg: finite.positive().max(700),
  posture: z.enum(["resting", "standing", "walking", "exercising"]), employeeId: reference,
}).strict();
export const faceScanCreateSchema = z.object({
  schemaVersion: z.literal(1).default(1), clientId: reference, organizationReference: reference,
  assessmentReference: reference, idempotencyKey: reference, context: faceScanContextSchema,
}).strict();
// These are conservative NIQ resource bounds, not vendor eligibility claims.
export const faceScanSignalSchema = z.object({
  schemaVersion: z.literal(1).default(1),
  raw_intensity: z.array(z.object({ r: finite.nonnegative(), g: finite.nonnegative(), b: finite.nonnegative() }).strict()).min(1).max(FACE_SCAN_MAX_SAMPLES),
  ppg_time: z.array(finite.nonnegative()).min(1).max(FACE_SCAN_MAX_SAMPLES),
  average_fps: finite.positive().max(240), device: z.enum(["RPPG_CAREPLIX_FACE_IOS", "RPPG_CAREPLIX_FACE_ANDROID"]).optional(),
  deviceModel: z.string().min(1).max(200).optional(),
}).strict().superRefine((value, ctx) => {
  if (value.raw_intensity.length !== value.ppg_time.length) ctx.addIssue({ code: "custom", message: "Signal and timing lengths differ" });
  if (value.ppg_time.some((time, index) => index > 0 && time <= value.ppg_time[index - 1]!)) ctx.addIssue({ code: "custom", message: "Timings must strictly increase" });
});
export type FaceScanCreate = z.infer<typeof faceScanCreateSchema>;
export type FaceScanContext = z.infer<typeof faceScanContextSchema>;
export type FaceScanSignal = z.infer<typeof faceScanSignalSchema>;
export type FaceScanState = "REQUESTED" | "UPLOAD_ACCEPTED" | "PROCESSING" | "COMPLETED" | "RECONCILIATION_REQUIRED" | "FAILED" | "EXPIRED" | "CANCELLED" | "PAUSED";
export type FaceScanResult = {
  schemaVersion: 1; providerScanId: string; providerCompletedAt: string | null; wellnessScore: number | null; healthRiskScore: number | null;
  vitals: { heartRate: number | null; oxygenSaturation: number | null; respiratoryRate: number | null; systolic: number | null; diastolic: number | null };
  additionalMetrics?: Record<string, number | string | null>;
  physiologicalScore: number | null; mentalWellbeingScore: number | null;
};
