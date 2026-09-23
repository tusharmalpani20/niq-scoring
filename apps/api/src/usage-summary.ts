import type { Capability } from "@niq-scoring/entitlements";

export type UsageMonth = { month: string; assessments: number; vitalIq: number };
export type DeploymentUsage = { deploymentId: string; assessments: number; vitalIq: number; monthly: UsageMonth[] };
export type UsageCount = { deploymentId: string; capability: Capability; count: number; month?: string };

export function recentUtcMonths(now: Date): string[] {
  return Array.from({ length: 6 }, (_, index) => {
    const month = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 5 + index, 1));
    return month.toISOString().slice(0, 7);
  });
}

export function buildUsageSummary(deploymentIds: string[], totals: UsageCount[], monthly: UsageCount[], now: Date): DeploymentUsage[] {
  const months = recentUtcMonths(now);
  const summaries = new Map(deploymentIds.map(deploymentId => [deploymentId, { deploymentId, assessments: 0, vitalIq: 0, monthly: months.map(month => ({ month, assessments: 0, vitalIq: 0 })) }]));
  for (const row of totals) {
    const summary = summaries.get(row.deploymentId);
    if (summary) summary[row.capability === "SCORING" ? "assessments" : "vitalIq"] += row.count;
  }
  for (const row of monthly) {
    const month = summaries.get(row.deploymentId)?.monthly.find(item => item.month === row.month);
    if (month) month[row.capability === "SCORING" ? "assessments" : "vitalIq"] += row.count;
  }
  return [...summaries.values()];
}
