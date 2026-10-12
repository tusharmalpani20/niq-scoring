import { expect, test } from "bun:test";
import { MemoryReportGenerationStore, REPORT_RUN_LEASE_MS, type NewReportRun, type ReportCall } from "./report-generation-store";

const input: NewReportRun = {
  clientId: "client", deploymentId: "deployment", assessmentReference: "assessment", resultReference: "result",
  ruleVersionId: "version", checksum: "checksum", idempotencyKey: "report-key", fingerprint: "fingerprint",
  model: "model", promptVersion: "prompt", schemaVersion: 1,
};
const call: ReportCall = {
  step: "writer", status: "SUCCEEDED", model: "model", provider: null, generationId: null,
  promptTokens: null, completionTokens: null, reasoningTokens: null, costUsd: null, latencyMs: 1, errorCode: null,
};

test("expired report reservations are reclaimed and old attempts are fenced", async () => {
  let time = new Date("2026-01-02T00:00:00Z");
  const store = new MemoryReportGenerationStore(() => time);
  const original = await store.reserve(input);
  expect(original.status).toBe("NEW");
  if (original.status !== "NEW") throw new Error("Expected new reservation");
  const originalAttemptId = original.run.attemptId;
  expect(await store.reserve(input)).toEqual({ status: "IN_PROGRESS" });
  time = new Date(time.getTime() + REPORT_RUN_LEASE_MS + 1);
  const retry = await store.reserve(input);
  expect(retry.status).toBe("NEW");
  if (retry.status !== "NEW") throw new Error("Expected reclaimed reservation");
  expect(retry.run.id).toBe(original.run.id);
  expect(retry.run.attemptId).not.toBe(originalAttemptId);
  expect(await store.appendCall(original.run.id, originalAttemptId, call)).toBe(false);
  expect(await store.finish(original.run.id, originalAttemptId, "READY", { stale: true })).toBe(false);
  expect(await store.appendCall(retry.run.id, retry.run.attemptId, call)).toBe(true);
  const response = { current: true };
  expect(await store.finish(retry.run.id, retry.run.attemptId, "READY", response)).toBe(true);
  const duplicate = await store.reserve(input);
  expect(duplicate.status).toBe("DUPLICATE");
  if (duplicate.status === "DUPLICATE") expect(duplicate.run.response).toEqual(response);
  expect(await store.reserve({ ...input, fingerprint: "changed" })).toEqual({ status: "CONFLICT" });
  expect((await store.list({ page: 1, pageSize: 10 })).items[0]?.calls).toHaveLength(1);
});

test("a run whose lease expired cannot complete before it is reclaimed", async () => {
  let time = new Date("2026-01-02T00:00:00Z");
  const store = new MemoryReportGenerationStore(() => time);
  const reservation = await store.reserve(input);
  if (reservation.status !== "NEW") throw new Error("Expected new reservation");
  time = new Date(time.getTime() + REPORT_RUN_LEASE_MS + 1);
  expect(await store.appendCall(reservation.run.id, reservation.run.attemptId, call)).toBe(false);
  expect(await store.finish(reservation.run.id, reservation.run.attemptId, "READY", { stale: true })).toBe(false);
  expect((await store.reserve(input)).status).toBe("NEW");
});
