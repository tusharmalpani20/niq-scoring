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

test("all documented postures survive validation and reach CarePlix unchanged", async () => {
  for (const posture of ["resting", "standing", "walking", "exercising"] as const) {
    const parsed = faceScanCreateSchema.parse({clientId:"client",assessmentReference:"assessment",organizationReference:"org",idempotencyKey:"key",context:{...context,posture}});
    let sent: any;
    const provider = new HttpCarePlixProvider({baseUrl:"https://example.invalid",apiKey:"key",apiSecret:"secret"}, (async (_url: URL | RequestInfo, init?: RequestInit) => { sent = JSON.parse(String(init?.body)); return Response.json(body); }) as typeof fetch);
    await provider.submit(parsed.context, signal, "token", "scan-1");
    expect(sent.posture).toBe(posture);
  }
});

test("retains redacted provider rejection diagnostics without tokens or signal", async () => {
  const provider = new HttpCarePlixProvider({baseUrl:"https://example.invalid",apiKey:"private-key",apiSecret:"private-secret"}, (async (_url: URL | RequestInfo, _init?: RequestInit) => Response.json({statusCode:400,message:"Invalid employee deployment:operator private-key private-secret response-token",scan_token:"response-token",raw_intensity:[1,2,3]}, {status:401})) as typeof fetch);
  try { await provider.createToken(context); throw new Error("Expected rejection"); }
  catch (error) {
    const { CarePlixResponseError } = await import("./careplix-provider");
    expect(error).toBeInstanceOf(CarePlixResponseError);
    const diagnostic = (error as InstanceType<typeof CarePlixResponseError>).diagnostic!;
    expect(diagnostic.httpStatus).toBe(401);
    expect(diagnostic.statusCode).toBe(400);
    expect(diagnostic.message).toContain("Invalid employee");
    const text = JSON.stringify(diagnostic);
    for (const secret of ["private-key", "private-secret", "response-token", "deployment:operator", "[1,2,3]"]) expect(text).not.toContain(secret);
  }
});
test("retains malformed token response and timeout classifications without raw bodies", async () => {
  const { CarePlixResponseError } = await import("./careplix-provider");
  for (const [transport, failure] of [
    [async () => Response.json({statusCode:200,scan_token:"private-token"}), "INVALID_TOKEN_RESPONSE"],
    [async () => { throw new DOMException("private endpoint details", "TimeoutError"); }, "TIMEOUT"],
  ] as const) {
    const provider = new HttpCarePlixProvider({baseUrl:"https://example.invalid",apiKey:"key",apiSecret:"secret"}, transport as unknown as typeof fetch);
    try { await provider.createToken(context); throw new Error("Expected error"); }
    catch (error) {
      expect(error).toBeInstanceOf(CarePlixResponseError);
      expect((error as InstanceType<typeof CarePlixResponseError>).diagnostic?.failure).toBe(failure);
      expect(JSON.stringify((error as InstanceType<typeof CarePlixResponseError>).diagnostic)).not.toContain("private-token");
    }
  }
});

test("status reporting uses documented telemetry fields without scan or patient data", async () => {
  const calls: Array<{path:string; body:any; auth:string|null}> = [];
  const provider = new HttpCarePlixProvider({baseUrl:"https://example.invalid",apiKey:"key",apiSecret:"secret"}, (async (url: URL | RequestInfo, init?: RequestInit) => {
    calls.push({path:String(url),body:JSON.parse(String(init?.body)),auth:new Headers(init?.headers).get("authorization")});
    return Response.json({statusCode:200,message:"saved"});
  }) as typeof fetch);
  for (const fireType of ["on_success","on_error","on_halt"] as const)
    await provider.updateStatus("operator", "private-token", {fireType,reason:"Scan event",...(fireType === "on_error" ? {errorCode:"SCAN_REQUEST_ERROR"} : {})});
  expect(calls[0]).toEqual({path:"https://example.invalid/vitals/update-scan-status",auth:"secret",body:{api_key:"key",employee_id:"operator",scan_token:"private-token",device_model:"RPPG_CAREPLIX_FACE_WEB",fire_type:"on_success",fire_reason:"Scan event",error_list:[]}});
  expect(calls[1]!.body.error_list).toEqual([{code:"SCAN_REQUEST_ERROR"}]);
  expect(calls[2]!.body.fire_type).toBe("on_halt");
  for (const call of calls) expect(Object.keys(call.body).sort()).toEqual(["api_key","device_model","employee_id","error_list","fire_reason","fire_type","scan_token"]);
});

test("browser device survives validation and is shared by submission and telemetry", async () => {
  for (const device of ["RPPG_CAREPLIX_FACE_IOS", "RPPG_CAREPLIX_FACE_ANDROID"] as const) {
    const calls: any[] = [];
    const provider = new HttpCarePlixProvider({baseUrl:"https://example.invalid",apiKey:"key",apiSecret:"secret"}, (async (_url: unknown, init?: RequestInit) => {
      calls.push(JSON.parse(String(init?.body))); return Response.json(body);
    }) as typeof fetch);
    await provider.submit(context, faceScanSignalSchema.parse({...signal, device}), "token", "scan-1");
    await provider.updateStatus("operator", "token", {fireType:"on_success",reason:"Done",device});
    expect(calls[0].metadata.device).toBe(device);
    expect(calls[1].device_model).toBe(device);
  }
  expect(faceScanSignalSchema.safeParse({...signal,device:"arbitrary"}).success).toBe(false);
});
