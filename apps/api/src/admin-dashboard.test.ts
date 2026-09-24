import { expect, test } from "bun:test";
import { buildAdminDashboard } from "./admin-dashboard";

test("dashboard counts succeeded usage by UTC month and keeps limits distinct from failures", () => {
  const now = new Date("2026-09-01T00:30:00.000Z");
  const client = { id: "client", name: "Apollo", enabled: true };
  const deployments = [
    { id: "one", clientId: "client", name: "Production", environment: "production" as const, enabled: true, hostingType: null },
    { id: "two", clientId: "client", name: "Test", environment: "test" as const, enabled: true, hostingType: null },
  ];
  const result = buildAdminDashboard({
    now, clients: [client], deployments,
    entitlements: [
      { deploymentId: "one", capability: "SCORING", enabled: true, monthlyLimit: 10 },
      { deploymentId: "two", capability: "SCORING", enabled: true, monthlyLimit: 20 },
      { deploymentId: "one", capability: "FACE_SCAN", enabled: true, monthlyLimit: null },
    ],
    usage: [
      { clientId: "client", deploymentId: "one", capability: "SCORING", outcome: "SUCCEEDED", occurredAt: new Date("2026-08-31T23:59:00Z") },
      { clientId: "client", deploymentId: "one", capability: "SCORING", outcome: "SUCCEEDED", occurredAt: new Date("2026-09-01T00:01:00Z") },
      { clientId: "client", deploymentId: "one", capability: "FACE_SCAN", outcome: "SUCCEEDED", occurredAt: new Date("2026-09-01T00:02:00Z") },
      { clientId: "client", deploymentId: "one", capability: "SCORING", outcome: "FAILED", occurredAt: new Date("2026-09-01T00:03:00Z") },
      { clientId: "client", deploymentId: "one", capability: "SCORING", outcome: "PENDING", occurredAt: new Date("2026-09-01T00:04:00Z") },
      { clientId: "client", deploymentId: "one", capability: "SCORING", outcome: "SUCCEEDED", occurredAt: new Date("2026-09-01T01:00:00Z") },
    ],
    activations: [
      { deploymentId: "two", expiresAt: new Date("2026-09-07T00:00:00Z"), usedAt: null, revokedAt: null },
      { deploymentId: "one", expiresAt: new Date("2026-09-05T00:00:00Z"), usedAt: null, revokedAt: null },
      { deploymentId: "one", expiresAt: new Date("2026-09-06T00:00:00Z"), usedAt: null, revokedAt: null },
      { deploymentId: "one", expiresAt: new Date("2026-09-05T00:00:00Z"), usedAt: now, revokedAt: null },
      { deploymentId: "two", expiresAt: new Date("2026-09-10T00:00:00Z"), usedAt: null, revokedAt: null },
    ],
  });
  expect(result.period).toMatchObject({ current: "2026-09", previous: "2026-08" });
  expect(result.activity).toEqual({ current: { assessments: 1, faceScans: 1, failedRequests: 1 }, previous: { assessments: 1, faceScans: 0, failedRequests: 0 } });
  expect(result.monthlyUsage).toHaveLength(6);
  expect(result.clients[0]).toMatchObject({ assessments: 1, faceScans: 1, deployments: [
    { id: "one", assessments: { completed: 1, allowanceUsed: 2, limit: 10 }, faceScans: { completed: 1, allowanceUsed: 1, limit: null } },
    { id: "two", assessments: { completed: 0, allowanceUsed: 0, limit: 20 } },
  ] });
  expect(result.attention).toEqual({ failedScoring24h: 1, disabledDeployments: 0, expiringTokenDeployments: [{ deploymentId: "one", count: 2 }, { deploymentId: "two", count: 1 }], nearLimitDeployments: [] });
});

test("dashboard flags the deployment whose own entitlement is nearly exhausted", () => {
  const result = buildAdminDashboard({
    now: new Date("2026-09-24T12:00:00Z"),
    clients: [{ id: "client", name: "Apollo", enabled: true }],
    deployments: [
      { id: "one", clientId: "client", name: "Production", environment: "production", enabled: true, hostingType: null },
      { id: "two", clientId: "client", name: "Test", environment: "test", enabled: true, hostingType: null },
    ],
    entitlements: [
      { deploymentId: "one", capability: "SCORING", enabled: true, monthlyLimit: 10 },
      { deploymentId: "two", capability: "SCORING", enabled: true, monthlyLimit: 100 },
    ],
    usage: [], activations: [],
    limitUsage: [{ deploymentId: "one", capability: "SCORING", used: 8 }, { deploymentId: "two", capability: "SCORING", used: 1 }],
  });
  expect(result.attention.nearLimitDeployments).toEqual([{ deploymentId: "one", capability: "SCORING", used: 8, limit: 10 }]);
});
