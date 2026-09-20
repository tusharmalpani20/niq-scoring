import { expect, test } from "bun:test";
import { boundedFaceScanJson, validWebhookBearer } from "./face-scan-routes";
import { parseEnvironment } from "@niq-scoring/config";
test("body bound works without content length and callbacks fail closed", async () => {
  await expect(boundedFaceScanJson(new Request("https://example.invalid", { method: "POST", body: "x".repeat(100) }), 20)).rejects.toThrow("PAYLOAD_TOO_LARGE");
  expect(validWebhookBearer(undefined, "secret")).toBe(false);
  expect(validWebhookBearer("Bearer secret", undefined)).toBe(false);
  expect(validWebhookBearer("secret", "secret")).toBe(false);
  expect(validWebhookBearer("Bearer secret", "secret")).toBe(true);
});
test("normal startup is disabled; enabling needs explicit contract confirmation", () => {
  expect(parseEnvironment({ DATABASE_URL: "postgres://unused" }).FACE_SCAN_ENABLED).toBe(false);
  expect(() => parseEnvironment({ DATABASE_URL: "postgres://unused", FACE_SCAN_ENABLED: "true" })).toThrow();
  expect(() => parseEnvironment({ DATABASE_URL: "postgres://unused", FACE_SCAN_WEBHOOK_BEARER_CONFIRMED: "true" })).toThrow();
});

test("HTTP scan and webhook gates reject unauthorized callers and never expose stub results", async () => {
  const { Hono } = await import("hono");
  const { installFaceScanRoutes } = await import("./face-scan-routes");
  const app = new Hono();
  let authenticated = false;
  installFaceScanRoutes(app, { authenticate: async () => authenticated ? { clientId: "c", deploymentId: "d", credentialId: "k" } : null });
  expect((await app.request("/v1/face-scans", { method: "POST", body: "{}" })).status).toBe(401);
  authenticated = true;
  const disabled = await app.request("/v1/face-scans", { method: "POST", body: "{}" });
  expect(disabled.status).toBe(503);
  expect(disabled.headers.get("cache-control")).toBe("no-store");
  expect((await app.request("/webhooks/careplix", { method: "POST", body: JSON.stringify({ api_key: "not-authentication" }) })).status).toBe(503);
});
