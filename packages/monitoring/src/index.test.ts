import { expect, test } from "bun:test";
import { sanitizeMonitoringEvent } from "./index";

test("only technical locations and named operations survive monitoring", () => {
  const event = sanitizeMonitoringEvent({ event_id: "a".repeat(32), timestamp: 123,
    environment: "development", release: "niq@abc123", tags: { operation: "pdf_render", patient: "Jane" },
    user: { email: "jane@example.com" }, request: { data: { diagnosis: "private" }, cookies: "secret" },
    contexts: { trace: { data: { prompt: "private" } } }, extra: { apiKey: "secret" },
    breadcrumbs: [{ message: "Jane" }], message: "Private patient text", server_name: "private-host",
    exception: { values: [{ value: "Jane private secret", type: "PatientError", stacktrace: {
      frames: [{ filename: "/home/private-user/src/report.ts?token=secret", lineno: 21, colno: 4,
        vars: { patient: "Jane" }, pre_context: ["private"], function: "private" }],
    } }] },
  });
  const body = JSON.stringify(event);
  for (const secret of ["Jane", "jane@", "private", "secret", "diagnosis", "prompt", "PatientError"])
    expect(body).not.toContain(secret);
  expect(event.exception.values[0]!.stacktrace.frames[0]).toEqual({ filename: "report.ts", lineno: 21, colno: 4 });
  expect(event.tags).toEqual({ operation: "pdf_render" });
});
test("untrusted messages and arbitrary tags are never used as labels", () => {
  const event = sanitizeMonitoringEvent({ message: "Patient Name", tags: { operation: "Patient Name" },
    exception: { values: [{ value: "Patient Name", stacktrace: { frames: [{ filename: "report.pdf", vars: { secret: true } }] } }] } });
  expect(JSON.stringify(event)).not.toContain("Patient Name");
  expect(event.tags.operation).toBe("unexpected_error");
});

test("only known technical failure codes survive", () => {
  const good = sanitizeMonitoringEvent({ tags: { operation: "report_generation", failure_code: "MODEL_PAYMENT_REQUIRED" } });
  const bad = sanitizeMonitoringEvent({ tags: { operation: "report_generation", failure_code: "PATIENT_JANE" } });
  expect(good.tags.failure_code).toBe("MODEL_PAYMENT_REQUIRED");
  expect(JSON.stringify(bad)).not.toContain("PATIENT_JANE");
});


test("safe terminal causes remain distinguishable without exposing arbitrary codes", () => {
  const codes = ["AUTOMATIC_REVIEW_RECOVERY_EXHAUSTED", "AUTOMATIC_REVIEW_RECOVERY_FAILED", "APPROVAL_SOURCE_INVALID", "GENERATION_INTERRUPTED", "GENERATION_FAILED", "REPORT_GENERATION_FAILED"];
  const fingerprints = codes.map(failure_code => {
    const event = sanitizeMonitoringEvent({ tags: { operation: "report_retry_exhausted", failure_code } });
    expect(event.tags.failure_code).toBe(failure_code);
    return event.fingerprint.join(":");
  });
  expect(new Set(fingerprints).size).toBe(codes.length);
});
