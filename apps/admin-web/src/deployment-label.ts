import type { Overview } from "./Operations";

type Deployment = Overview["deployments"][number];

export function deploymentDisplayLabel(deployment: Deployment) {
  const environment = deployment.environment.charAt(0).toUpperCase() + deployment.environment.slice(1);
  // Older deployments used a generated technical name; keep those readable without changing stored records.
  const legacySuffix = new RegExp(`-${deployment.environment}-(?:niq|client-cloud)-[a-f0-9]{8}$`, "i");
  return legacySuffix.test(deployment.name) ? environment : deployment.name;
}
