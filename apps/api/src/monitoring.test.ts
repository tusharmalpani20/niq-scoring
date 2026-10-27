import { expect, test } from "bun:test";
import * as Sentry from "@sentry/bun";
import { initializeMonitoring, captureOperationalFailure } from "./monitoring";

test("the real SDK sends only sanitized operational errors and stays disabled in tests", async () => {
  const envelopes: unknown[] = [];
  const transport = () => ({ send: async (envelope: unknown) => { envelopes.push(envelope); return { statusCode: 200 }; }, flush: async () => true });
  initializeMonitoring({ NODE_ENV: "test", SENTRY_DSN: "https://public@example.com/1" }, transport);
  expect(envelopes).toHaveLength(0);
  initializeMonitoring({ NODE_ENV: "development", SENTRY_DSN: "https://public@example.com/1" }, transport);
  try {
    const options = Sentry.getClient()!.getOptions();
    expect(options.dataCollection?.httpBodies).toEqual([]);
    expect(options.dataCollection?.genAI).toEqual({ inputs: false, outputs: false });
    for (const name of ["Http", "Fetch", "RequestData", "OpenAI", "Console"])
      expect(Sentry.getClient()!.getIntegrationByName(name)).toBeUndefined();
    expect(options.tracesSampleRate).toBe(0);
    Sentry.setUser({ email: "private-patient@example.com", ip_address: "192.0.2.100" });
    Sentry.setExtra("prompt", "PRIVATE_CLINICAL_TEXT");
    const repeated = new Error("PRIVATE_CLINICAL_TEXT");
    captureOperationalFailure("pdf_render", repeated);
    await Sentry.flush(1000);
    expect(envelopes.length).toBeGreaterThan(0);
    const sent = JSON.stringify(envelopes);
    for (const value of ["private-patient", "192.0.2.100", "PRIVATE_CLINICAL_TEXT"])
      expect(sent).not.toContain(value);
    expect(sent).toContain("pdf_render");
    captureOperationalFailure("pdf_render", repeated);
    await Sentry.flush(1000);
    expect(envelopes).toHaveLength(1);
  } finally { await Sentry.close(1000); }
});


test("different safe causes and technical locations are captured within the same minute", async () => {
  const envelopes: unknown[] = [];
  const transport = () => ({ send: async (envelope: unknown) => { envelopes.push(envelope); return { statusCode: 200 }; }, flush: async () => true });
  initializeMonitoring({ NODE_ENV: "development", SENTRY_DSN: "https://public@example.com/1" }, transport);
  const failure = (code: string, line: number) => Object.assign(new Error("PRIVATE_PATIENT_AND_PROMPT"), {
    code, stack: `Error: PRIVATE_PATIENT_AND_PROMPT\n    at run (/home/private-user/worker.ts:${line}:4)`,
  });
  try {
    captureOperationalFailure("report_generation", failure("MODEL_PAYMENT_REQUIRED", 10));
    captureOperationalFailure("report_generation", failure("FALLBACK_SOURCE_CONFLICT", 10));
    captureOperationalFailure("report_generation", failure("FALLBACK_SOURCE_CONFLICT", 20));
    captureOperationalFailure("report_generation", failure("FALLBACK_SOURCE_CONFLICT", 20));
    await Sentry.flush(1000);
    expect(envelopes).toHaveLength(3);
    const sent = JSON.stringify(envelopes);
    expect(sent).toContain("MODEL_PAYMENT_REQUIRED");
    expect(sent).toContain("FALLBACK_SOURCE_CONFLICT");
    expect(sent).not.toContain("PRIVATE_PATIENT");
    expect(sent).not.toContain("private-user");
  } finally { await Sentry.close(1000); }
});
