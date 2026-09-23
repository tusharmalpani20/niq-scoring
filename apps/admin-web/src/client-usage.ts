import { useEffect, useState } from "react";
import { message, request } from "./api";

export type UsageMonth = { month: string; assessments: number; vitalIq: number };
export type DeploymentUsage = { deploymentId: string; assessments: number; vitalIq: number; monthly: UsageMonth[] };

export function useClientUsage(clientId: string) {
  const [usage, setUsage] = useState<DeploymentUsage[] | null>(null);
  const [error, setError] = useState("");
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    let active = true;
    setUsage(null);
    setError("");
    void request<{ deployments: DeploymentUsage[] }>(`/admin/clients/${clientId}/usage`).then(result => {
      if (active) setUsage(result.deployments);
    }).catch(cause => { if (active) setError(message(cause)); });
    return () => { active = false; };
  }, [clientId, retry]);
  return { usage, error, retry: () => setRetry(value => value + 1) };
}
