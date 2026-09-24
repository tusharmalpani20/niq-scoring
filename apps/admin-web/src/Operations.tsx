import { Deployments } from "./Deployments";
import { Clients } from "./Clients";
import { RuleVersions } from "./RuleVersions";
import { Card, CardContent } from "./components/ui/card";
import { Link } from "react-router-dom";
import { RuleUsagePanel } from "./RuleUsagePanel";
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
  data,
  refresh,
}: {
  page: string;
  data: Overview;
  refresh: () => Promise<void>;
}) {
  if (page === "overview")
    return (
      <div className="space-y-5">
        <div className="metrics">
          {[
            ["Clients", data.clients.length, "clients"],
            ["Deployments", data.deployments.length, "deployments"],
            ["Rules", data.versions.length, "versions"],
          ].map(([label, count, path]) => (
            <Card key={label}>
            <CardContent className="pt-6">
            <Link to={`/${path}`} className="flex flex-col gap-3">
              <span className="text-sm text-muted-foreground">{label}</span>
              <strong className="text-4xl">{count}</strong>
              <small className="text-primary">View {String(label).toLowerCase()} →</small>
            </Link>
            </CardContent>
            </Card>
          ))}
        </div>
        <RuleUsagePanel />
      </div>
    );
  if (page === "clients") return <Clients data={data} refresh={refresh} />;
  if (page === "deployments") return <Deployments data={data} refresh={refresh} />;
  return <RuleVersions refresh={refresh} />;
}
