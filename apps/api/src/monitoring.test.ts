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
    captureOperationalFailure("pdf_render", new Error("PRIVATE_CLINICAL_TEXT"));
    await Sentry.flush(1000);
    expect(envelopes.length).toBeGreaterThan(0);
    const sent = JSON.stringify(envelopes);
    for (const value of ["private-patient", "192.0.2.100", "PRIVATE_CLINICAL_TEXT"])
      expect(sent).not.toContain(value);
    expect(sent).toContain("pdf_render");
    captureOperationalFailure("pdf_render", new Error("PRIVATE_CLINICAL_TEXT"));
    await Sentry.flush(1000);
    expect(envelopes).toHaveLength(1);
  } finally { await Sentry.close(1000); }
});
