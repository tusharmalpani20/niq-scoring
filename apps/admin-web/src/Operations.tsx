import { Deployments } from "./Deployments";
import { Clients } from "./Clients";
import { RuleVersions } from "./RuleVersions";
export type Overview = {
  clients: Array<{
    id: string;
    name: string;
    enabled: boolean;
  }>;
  deployments: Array<{
    id: string;
    clientId: string;
    name: string;
    environment: string;
    hostingType: "NIQ_HOSTED" | "CLIENT_CLOUD" | "ON_PREMISES" | null;
    enabled: boolean;
  }>;
  entitlements: Array<{
    deploymentId: string;
    capability: string;
    enabled: boolean;
    monthlyLimit: number | null;
  }>;
  assignments: Array<{ deploymentId: string; mode: string; scoringRuleVersionId?: string }>;
  versions: Array<{
    id: string;
    version: string;
    lifecycle: string;
    clinicalUsePermitted: boolean;
    isDefault?: boolean;
  }>;
};
export function Operations({
  page,
}: {
  page: string;
}) {
  if (page === "clients") return <Clients />;
  if (page === "deployments") return <Deployments />;
  return <RuleVersions />;
}
