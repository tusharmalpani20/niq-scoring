import { Deployments } from "./Deployments";
import { Clients } from "./Clients";
import { Badge } from "./components/ui/badge";
import { Card, CardContent } from "./components/ui/card";
import { Link } from "react-router-dom";
import { Panel } from "./shared";
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
      <>
        <div className="metrics">
          {[
            ["Clients", data.clients.length, "clients"],
            ["Deployments", data.deployments.length, "deployments"],
            ["Rule versions", data.versions.length, "versions"],
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
      </>
    );
  if (page === "clients") return <Clients data={data} refresh={refresh} />;
  if (page === "deployments") return <Deployments data={data} refresh={refresh} />;
  return (
    <Panel
      title="Rule versions"
      description="Review the lifecycle and clinical-use status of each scoring rule package."
    >
      {data.versions.length === 0 ? (
        <p className="empty">No rule versions configured.</p>
      ) : (
        data.versions.map((v) => (
          <div className="version" key={v.id}>
            <div>
              <strong>{v.version}</strong>
              <small>{v.id}</small>
            </div>
            <Badge variant="secondary">{v.lifecycle}</Badge>
            <span className={v.clinicalUsePermitted ? "success" : "danger"}>
              {v.clinicalUsePermitted
                ? "Clinical use permitted"
                : "Clinical use prohibited"}
            </span>
          </div>
        ))
      )}
    </Panel>
  );
}