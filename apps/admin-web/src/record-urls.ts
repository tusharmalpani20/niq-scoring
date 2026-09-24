import type { Overview } from "./Operations";

type Client = Overview["clients"][number];
type Deployment = Overview["deployments"][number];
type DetailTab = "overview" | "settings" | "tokens";

export function clientUrl(client: Client) {
  // Client names are unique; encoding the name avoids collisions from replacing punctuation.
  const name = client.name.trim().toLowerCase();
  return `/clients/${name === "." || name === ".." ? client.id : encodeURIComponent(name)}`;
}

export function deploymentUrl(data: Overview, deployment: Deployment, tab: DetailTab = "overview") {
  const client = data.clients.find(item => item.id === deployment.clientId);
  const clientSegment = client ? clientUrl(client).slice("/clients/".length) : "client";
  const base = `/deployments/${clientSegment}/${deployment.id}`;
  return tab === "overview" ? base : `${base}/${tab}`;
}

function resolveSegment<T extends { id: string }>(items: T[], value: string, canonical: (item: T) => string): T | undefined {
  const byId = items.find(item => item.id === value);
  if (byId) return byId;
  const exact = items.filter(item => canonical(item).split("/").at(-1) === value);
  if (exact.length === 1) return exact[0];
  if (exact.length > 1) return undefined;
  // An old readable link still resolves after a display name changes.
  const bySuffix = items.filter(item => value.endsWith(`-${item.id.slice(-10).toLowerCase()}`));
  return bySuffix.length === 1 ? bySuffix[0] : undefined;
}

export function resolveClient(data: Overview, value: string) {
  return resolveSegment(data.clients, value, clientUrl);
}

export function resolveDeployment(data: Overview, value: string) {
  return resolveSegment(data.deployments, value, item => deploymentUrl(data, item));
}
