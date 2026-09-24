import type { Overview } from "./Operations";

type Deployment = Overview["deployments"][number];

function isLegacyName(deployment: Deployment) {
  return new RegExp(`-${deployment.environment}-(?:niq|client-cloud)-[a-f0-9]{8}$`, "i").test(deployment.name);
}

export function deploymentDisplayLabel(deployment: Deployment, deployments: Deployment[]) {
  if (!isLegacyName(deployment)) return deployment.name;
  const base = deployment.environment.charAt(0).toUpperCase() + deployment.environment.slice(1);
  const clientDeployments = deployments.filter(item => item.clientId === deployment.clientId);
  const occupied = new Set(clientDeployments.filter(item => !isLegacyName(item)).map(item => item.name.trim().toLowerCase()));
  const sameEnvironment = clientDeployments.filter(item => item.environment === deployment.environment);
  for (const [index, item] of sameEnvironment.entries()) {
    if (!isLegacyName(item)) continue;
    let number = index + 1;
    let label = number === 1 ? base : `${base} ${number}`;
    while (occupied.has(label.toLowerCase())) {
      number += 1;
      label = `${base} ${number}`;
    }
    occupied.add(label.toLowerCase());
    if (item.id === deployment.id) return label;
  }
  return base;
}
