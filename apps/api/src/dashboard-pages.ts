import type { Client, Deployment } from "./store";
import type { buildAdminDashboard } from "./admin-dashboard";

export type DashboardClientRow = { id: string; name: string; assessments: number; faceScans: number; deploymentCount: number };
export type DashboardClientPage = { items: DashboardClientRow[]; page: number; pageSize: number; total: number; pageCount: number };

export function pageDashboardClients(rows: DashboardClientRow[], page: number, pageSize: number): DashboardClientPage {
  const ordered = [...rows].sort((a, b) => b.assessments + b.faceScans - a.assessments - a.faceScans || a.name.localeCompare(b.name) || a.id.localeCompare(b.id));
  return { items: ordered.slice((page - 1) * pageSize, page * pageSize), page, pageSize, total: ordered.length, pageCount: Math.max(1, Math.ceil(ordered.length / pageSize)) };
}

function deploymentLabel(deployment: Deployment, siblings: Deployment[]) {
  const legacy = (item: Deployment) => new RegExp(`-${item.environment}-(?:niq|client-cloud)-[a-f0-9]{8}$`, "i").test(item.name);
  if (!legacy(deployment)) return deployment.name;
  const base = deployment.environment.charAt(0).toUpperCase() + deployment.environment.slice(1);
  const occupied = new Set(siblings.filter(item => !legacy(item)).map(item => item.name.trim().toLowerCase()));
  for (const [index, item] of siblings.filter(item => item.environment === deployment.environment).entries()) {
    if (!legacy(item)) continue;
    let number = index + 1;
    let label = number === 1 ? base : `${base} ${number}`;
    while (occupied.has(label.toLowerCase())) { number++; label = `${base} ${number}`; }
    occupied.add(label.toLowerCase());
    if (item.id === deployment.id) return label;
  }
  return base;
}

export function dashboardSummary(dashboard: ReturnType<typeof buildAdminDashboard>, clients: Client[], deployments: Deployment[]) {
  const alertIds = new Set([
    ...dashboard.attention.expiringTokenDeployments.map(item => item.deploymentId),
    ...dashboard.attention.nearLimitDeployments.map(item => item.deploymentId),
  ]);
  const clientNames = new Map(clients.map(client => [client.id, client.name]));
  const siblingsByClient = new Map<string, Deployment[]>();
  for (const deployment of deployments) siblingsByClient.set(deployment.clientId, [...(siblingsByClient.get(deployment.clientId) ?? []), deployment]);
  return {
    period: dashboard.period,
    activity: dashboard.activity,
    monthlyUsage: dashboard.monthlyUsage,
    attention: {
      ...dashboard.attention,
      deployments: deployments.filter(item => alertIds.has(item.id)).map(item => ({
        id: item.id, clientId: item.clientId, clientName: clientNames.get(item.clientId) ?? "Client",
        name: item.name, displayLabel: deploymentLabel(item, siblingsByClient.get(item.clientId) ?? []),
        environment: item.environment, hostingType: item.hostingType, enabled: item.enabled,
      })),
    },
  };
}
