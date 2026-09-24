import type { Client, Deployment } from "./store";

type Capability = "SCORING" | "FACE_SCAN";
export type DashboardUsageEvent = {
  clientId: string;
  deploymentId: string;
  capability: Capability;
  outcome: "SUCCEEDED" | "FAILED" | "REJECTED" | "PENDING";
  occurredAt: Date;
  count?: number;
};
export type DashboardEntitlement = { deploymentId: string; capability: Capability; enabled: boolean; monthlyLimit: number | null };
export type DashboardActivation = { expiresAt: Date | null; usedAt: Date | null; revokedAt: Date | null };
export type DashboardAudit = {
  id: string;
  action: string;
  resourceType: string;
  resourceReference: string | null;
  clientId: string | null;
  deploymentId: string | null;
  occurredAt: Date;
};

const monthKey = (date: Date) => date.toISOString().slice(0, 7);
const startOfMonth = (date: Date, offset = 0) => new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + offset, 1));
const counts = () => ({ assessments: 0, faceScans: 0, failedRequests: 0 });

export function buildAdminDashboard(input: {
  now: Date;
  clients: Client[];
  deployments: Deployment[];
  entitlements: DashboardEntitlement[];
  usage: DashboardUsageEvent[];
  activations: DashboardActivation[];
  audit: DashboardAudit[];
  recentFailedScoringCount?: number;
  limitUsage?: Array<{ deploymentId: string; capability: Capability; used: number }>;
}) {
  const { now, clients, deployments, entitlements, usage, activations, audit } = input;
  const months = Array.from({ length: 6 }, (_, index) => monthKey(startOfMonth(now, index - 5)));
  const monthlyUsage = months.map(month => ({ month, ...counts() }));
  const monthByKey = new Map(monthlyUsage.map(item => [item.month, item]));
  const clientCounts = new Map(clients.map(client => [client.id, { assessments: 0, faceScans: 0 }]));
  let failedScoring24h = 0;
  const lastDay = new Date(now.getTime() - 24 * 60 * 60 * 1000);
  for (const event of usage) {
    if (event.occurredAt > now) continue;
    const count = event.count ?? 1;
    const bucket = monthByKey.get(monthKey(event.occurredAt));
    if (bucket) {
      if (event.outcome === "SUCCEEDED") {
        if (event.capability === "SCORING") bucket.assessments += count;
        else bucket.faceScans += count;
        if (monthKey(event.occurredAt) === monthKey(now)) {
          const client = clientCounts.get(event.clientId);
          if (client) {
            if (event.capability === "SCORING") client.assessments += count;
            else client.faceScans += count;
          }
        }
      } else if (event.outcome === "FAILED") bucket.failedRequests += count;
    }
    if (event.capability === "SCORING" && event.outcome === "FAILED" && event.occurredAt >= lastDay) failedScoring24h += count;
  }
  const limit = (clientId: string, capability: Capability) => {
    const activeIds = new Set(deployments.filter(item => item.clientId === clientId && item.enabled).map(item => item.id));
    const active = entitlements.filter(item => activeIds.has(item.deploymentId) && item.capability === capability && item.enabled);
    if (active.some(item => item.monthlyLimit === null)) return null;
    return active.reduce((sum, item) => sum + (item.monthlyLimit ?? 0), 0);
  };
  const sevenDays = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);
  const limitUsage = input.limitUsage ?? (() => {
    const counts = new Map<string, { deploymentId: string; capability: Capability; used: number }>();
    for (const event of usage) {
      if (monthKey(event.occurredAt) !== monthKey(now) || event.occurredAt > now || !["SUCCEEDED", "PENDING"].includes(event.outcome)) continue;
      const key = `${event.deploymentId}:${event.capability}`;
      const item = counts.get(key) ?? { deploymentId: event.deploymentId, capability: event.capability, used: 0 };
      item.used += event.count ?? 1;
      counts.set(key, item);
    }
    return [...counts.values()];
  })();
  const nearLimitDeployments = entitlements.flatMap(item => {
    const deployment = deployments.find(deployment => deployment.id === item.deploymentId);
    if (!deployment?.enabled || !item.enabled || item.monthlyLimit === null || item.monthlyLimit <= 0) return [];
    const used = limitUsage.find(count => count.deploymentId === item.deploymentId && count.capability === item.capability)?.used ?? 0;
    return used / item.monthlyLimit >= 0.8 ? [{ deploymentId: item.deploymentId, capability: item.capability, used, limit: item.monthlyLimit }] : [];
  }).sort((a, b) => b.used / b.limit - a.used / a.limit);
  return {
    period: { current: monthKey(now), previous: monthKey(startOfMonth(now, -1)), asOf: now.toISOString() },
    activity: {
      current: { assessments: monthlyUsage[5]!.assessments, faceScans: monthlyUsage[5]!.faceScans, failedRequests: monthlyUsage[5]!.failedRequests },
      previous: { assessments: monthlyUsage[4]!.assessments, faceScans: monthlyUsage[4]!.faceScans, failedRequests: monthlyUsage[4]!.failedRequests },
    },
    monthlyUsage,
    clients: clients.map(client => ({
      id: client.id,
      name: client.name,
      assessments: { used: clientCounts.get(client.id)?.assessments ?? 0, limit: limit(client.id, "SCORING") },
      faceScans: { used: clientCounts.get(client.id)?.faceScans ?? 0, limit: limit(client.id, "FACE_SCAN") },
    })).sort((a, b) => (b.assessments.used + b.faceScans.used) - (a.assessments.used + a.faceScans.used) || a.name.localeCompare(b.name)),
    attention: {
      failedScoring24h: input.recentFailedScoringCount ?? failedScoring24h,
      disabledDeployments: deployments.filter(item => !item.enabled).length,
      expiringActivationTokens: activations.filter(item => !item.usedAt && !item.revokedAt && item.expiresAt && item.expiresAt > now && item.expiresAt <= sevenDays).length,
      nearLimitDeployments,
    },
    recentActivity: audit.slice(0, 5).map(item => ({ ...item, occurredAt: item.occurredAt.toISOString() })),
  };
}
