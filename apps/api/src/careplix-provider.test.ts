import { expect, test } from "bun:test";
import { HttpCarePlixProvider, normalizeCarePlixResult } from "./careplix-provider";
import { faceScanCreateSchema, faceScanSignalSchema } from "@niq-scoring/contracts/face-scan-session";

const context = { dob: "1990-01-01", gender: "female" as const, heightCm: 170, weightKg: 70, posture: "resting" as const, employeeId: "deployment:operator" };
const signal = { schemaVersion: 1 as const, raw_intensity: [{ r: 1, g: 2, b: 3 }, { r: 2, g: 3, b: 4 }], ppg_time: [0, 1], average_fps: 29.8 };
const body = { statusCode: 200, scan_id: "scan-1", wellness_score: "78", health_risk_score: 22, vitals: { heart_rate: "70", oxy_sat_prcnt: "--", resp_rate: null }, metadata: { physiological_scores: { height: "170" }, physiological_score: "65", mental_wellbeing_score: 80 } };
test("documented adapter preserves RGB signal and raw authorization; token stays server-side", async () => {
  const calls: Array<{ url: string; body: Record<string, unknown>; auth: string | null }> = [];
  const transport = (async (url: URL | RequestInfo, init?: RequestInit) => {
    calls.push({ url: String(url), body: JSON.parse(String(init?.body)), auth: new Headers(init?.headers).get("authorization") });
    return Response.json(calls.length === 1 ? { statusCode: 200, scan_id: "scan-1", scan_token: "server-token" } : body);
  }) as typeof fetch;
  const provider = new HttpCarePlixProvider({ baseUrl: "https://example.invalid", apiKey: "key", apiSecret: "raw-secret" }, transport);
  const token = await provider.createToken(context);
  const result = await provider.submit(context, signal, token.token, token.scanId);
  expect(calls[0]?.auth).toBe("raw-secret");
  expect(calls[1]?.body).toMatchObject({ gender: "Female", scan_token: "server-token", metadata: { raw_intensity: signal.raw_intensity, ppg_time: signal.ppg_time, fps: 30, device: "RPPG_CAREPLIX_FACE_WEB", physiological_scores: { height: "170", weight: "70" } } });
  expect(result).toMatchObject({ wellnessScore: 78, healthRiskScore: 22, physiologicalScore: 65, vitals: { oxygenSaturation: null } });
});
test("normalization rejects invalid identity and malformed numeric values without zero fallback", () => {
  expect(() => normalizeCarePlixResult(body, "different")).toThrow();
  expect(() => normalizeCarePlixResult({ ...body, wellness_score: "bad" }, "scan-1")).toThrow();
  expect(normalizeCarePlixResult({ ...body, wellness_score: "--" }, "scan-1").wellnessScore).toBeNull();
  expect(normalizeCarePlixResult({ ...body, metadata: { physiological_scores: { physiological_score: 9 } } }, "scan-1").physiologicalScore).toBeNull();
});
test("contracts reject shape mismatches, invalid dates and nonmonotonic signal", () => {
  expect(faceScanSignalSchema.safeParse(signal).success).toBe(true);
  expect(faceScanSignalSchema.safeParse({ ...signal, ppg_time: [0, 0] }).success).toBe(false);
  expect(faceScanSignalSchema.safeParse({ ...signal, raw_intensity: [[1, 2, 3]] }).success).toBe(false);
  expect(faceScanSignalSchema.safeParse({ ...signal, average_fps: NaN }).success).toBe(false);
  expect(faceScanCreateSchema.safeParse({ clientId: "c", assessmentReference: "a", organizationReference: "o", idempotencyKey: "k", context: { ...context, dob: "1990-02-31" } }).success).toBe(false);
});

test("unsupported successful direct responses retain sanitized repair evidence only for the expected scan", async () => {
  const { CarePlixUnprocessableResultError } = await import("./careplix-provider");
  let response = { ...body, wellness_score: "unsupported-format", api_key: "secret-value", metadata: { physiological_score: "unsupported", raw_intensity: [1, 2, 3], arbitrary: "unapproved" } };
  const provider = new HttpCarePlixProvider({ baseUrl: "https://example.invalid", apiKey: "key", apiSecret: "secret" }, (async (_url: URL | RequestInfo, _init?: RequestInit) => Response.json(response)) as typeof fetch);
  try {
    await provider.submit(context, signal, "token", "scan-1");
    throw new Error("Expected an unprocessable direct result");
  } catch (error) {
    expect(error).toBeInstanceOf(CarePlixUnprocessableResultError);
    const retained = JSON.stringify((error as InstanceType<typeof CarePlixUnprocessableResultError>).receipt);
    expect(retained).toContain("unsupported-format");
    expect(retained).not.toContain("secret-value");
    expect(retained).not.toContain("raw_intensity");
    expect(retained).not.toContain("unapproved");
  }
  response = { ...response, scan_id: "another-scan" };
  try { await provider.submit(context, signal, "token", "scan-1"); }
  catch (error) { expect(error).not.toBeInstanceOf(CarePlixUnprocessableResultError); }
});
