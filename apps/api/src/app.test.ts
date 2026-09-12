import { describe, expect, test } from "bun:test";
import { createApp } from "./app";

const apiKey = "development-key-at-least-24-characters";
const app = createApp({ apiKey, allowedOrigins: ["http://localhost:4173"], region: "india", runtimeEnvironment: "test", provisionalScoringRequested: true, now: () => new Date("2026-09-13T00:00:00.000Z") });

describe("scoring API", () => {
  test("health is public and discloses no secrets", async () => {
    const response = await app.request("/health");
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ status: "ok", service: "niq-scoring-api", region: "india" });
  });

  test("metadata requires a credential", async () => {
    expect((await app.request("/v1/metadata")).status).toBe(401);
  });

  test("readiness fails closed when the schema is unavailable", async () => {
    const unavailable = createApp({ apiKey, allowedOrigins: [], region: "india", runtimeEnvironment: "test", provisionalScoringRequested: false, readinessCheck: async () => false });
    expect((await unavailable.request("/ready")).status).toBe(503);
  });

  test("provisional scoring requires an explicit runtime flag", async () => {
    const disabled = createApp({ apiKey, allowedOrigins: [], region: "india", runtimeEnvironment: "test", provisionalScoringRequested: false });
    const response = await disabled.request("/v1/provisional/calculate", {
      method: "POST",
      headers: { authorization: `Bearer ${apiKey}`, "content-type": "application/json" },
      body: "{}",
    });
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ error: "PROVISIONAL_SCORING_DISABLED" });
  });

  test("production cannot enable provisional scoring", async () => {
    const production = createApp({ apiKey, allowedOrigins: [], region: "india", runtimeEnvironment: "production", provisionalScoringRequested: true });
    const response = await production.request("/v1/provisional/calculate", {
      method: "POST",
      headers: { authorization: `Bearer ${apiKey}`, "content-type": "application/json" },
      body: "{}",
    });
    expect(response.status).toBe(503);
  });

  test("calculates only the explicit provisional version", async () => {
    const response = await app.request("/v1/provisional/calculate", {
      method: "POST",
      headers: { authorization: `Bearer ${apiKey}`, "content-type": "application/json" },
      body: JSON.stringify({
        idempotencyKey: "request-key-0001",
        input: {
          assessmentReference: "pseudonym-1",
          organizationId: "01ARZ3NDEKTSV4RRFFQ69G5FAV",
          heightCm: 170,
          weightKg: 70,
          weightTrend: "stable",
          weightChangePercent: null,
          intakeLevel: "normal",
          appetite: "good",
          functionalStatus: "fully_active",
          cancerStage: "Unknown",
          albumin: null,
          crp: null,
          fluidStatus: {},
          symptoms: {},
        },
      }),
    });
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ result: { versionStatus: "DRAFT_NON_CLINICAL", clinicalUsePermitted: false } });
  });
});
