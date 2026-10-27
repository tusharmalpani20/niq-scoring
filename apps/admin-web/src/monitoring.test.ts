import assert from "node:assert/strict";
import { test } from "node:test";
import * as Sentry from "@sentry/react";
import { initializeMonitoring, captureReactError } from "./monitoring";

test("admin React error callback sends a sanitized envelope using its real browser SDK", async () => {
  const envelopes: unknown[] = [];
  const transport = () => ({ send: async (envelope: unknown) => { envelopes.push(envelope); return { statusCode: 200 }; }, flush: async () => true });
  initializeMonitoring({ MODE: "test", VITE_SENTRY_DSN: "https://public@example.com/1" }, transport);
  assert.equal(envelopes.length, 0);
  initializeMonitoring({ MODE: "development", VITE_SENTRY_DSN: "https://public@example.com/1" }, transport);
  try {
    Sentry.setUser({ email: "PRIVATE_PATIENT@example.com", ip_address: "192.0.2.1" });
    Sentry.setExtra("assessment", { diagnosis: "PRIVATE_DIAGNOSIS" });
    const options = Sentry.getClient()!.getOptions();
    assert.equal(options.tracesSampleRate, 0);
    assert.equal(options.maxBreadcrumbs, 0);
    for (const name of ["Breadcrumbs", "BrowserTracing", "Replay", "HttpContext"])
      assert.equal(Sentry.getClient()!.getIntegrationByName(name), undefined);
    captureReactError(Object.assign(new Error("PRIVATE_PATIENT PRIVATE_DIAGNOSIS PRIVATE_TOKEN"), {
      stack: "Error: PRIVATE_PATIENT\n at render (https://admin.example/assets/index.js?token=PRIVATE_TOKEN:10:4)",
    }));
    await Sentry.flush(1000);
    assert.equal(envelopes.length, 1);
    const sent = JSON.stringify(envelopes);
    assert.ok(sent.includes("browser_error"));
    for (const secret of ["PRIVATE_", "192.0.2.1", "diagnosis", "admin.example"])
      assert.ok(!sent.includes(secret));
  } finally { await Sentry.close(1000); }
});
