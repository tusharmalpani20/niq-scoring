import { Clients } from "./Clients";
import { Badge } from "./components/ui/badge";
import { Card, CardContent } from "./components/ui/card";
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from "./components/ui/table";
import { useState } from "react";
import { Link } from "react-router-dom";
import { request, message } from "./api";
import { Button } from "./components/ui/button";
import { DataForm, Panel, Secret, ErrorNotice } from "./shared";
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
    region: string;
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
  const [activation, setActivation] = useState<{
    value: string;
    expiresAt: string;
  } | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  async function save(path: string, body: unknown, method = "POST") {
    await request(path, body, method);
    await refresh();
  }
  const client = (id: string) =>
    data.clients.find((c) => c.id === id)?.name ?? id;
  const clientOptions = data.clients.map((c) => ({ value: c.id, label: c.name }));
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
  if (page === "deployments")
    return (
      <>
        <ErrorNotice error={error} />
        <Panel title="Deployments">
          <div>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Deployment</TableHead>
                  <TableHead>Client</TableHead>
                  <TableHead>Environment</TableHead>
                  <TableHead>Region</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Scoring limit</TableHead>
                  <TableHead>Face-scan limit</TableHead>
                  <TableHead>Rule version</TableHead>
                  <TableHead>Activation</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.deployments.map((d) => (
                  <TableRow key={d.id}>
                    <TableCell>
                      <strong>{d.name}</strong>
                      <small>{d.id}</small>
                    </TableCell>
                    <TableCell>{client(d.clientId)}</TableCell>
                    <TableCell>{d.environment}</TableCell>
                    <TableCell>{d.region}</TableCell>
                    <TableCell>{d.enabled ? "Enabled" : "Disabled"}</TableCell>
                    {["SCORING", "FACE_SCAN"].map(capability => {
                      const entitlement = data.entitlements.find(item => item.deploymentId === d.id && item.capability === capability);
                      return <TableCell key={capability}>{!entitlement?.enabled ? "Disabled" : entitlement.monthlyLimit ?? "Unlimited"}</TableCell>;
                    })}
                    <TableCell>{(() => {
                      const assignment = data.assignments.find(item => item.deploymentId === d.id);
                      return assignment?.mode === "LATEST_APPROVED" ? "Latest approved" : assignment?.mode === "PINNED" ? data.versions.find(version => version.id === assignment.scoringRuleVersionId)?.version ?? "Pinned" : "Not assigned";
                    })()}</TableCell>
                    <TableCell>
                      <Button
                        variant="outline"
                        size="sm"
                        disabled={busy}
                        onClick={async () => {
                          setError("");
                          setBusy(true);
                          try {
                            const r = await request<{
                              activationToken: string;
                              expiresAt: string;
                            }>(`/admin/deployments/${d.id}/activation-token`, {
                              expiresInMinutes: 30,
                            });
                            setActivation({
                              value: r.activationToken,
                              expiresAt: r.expiresAt,
                            });
                          } catch (c) {
                            setError(message(c));
                          } finally {
                            setBusy(false);
                          }
                        }}
                      >
                        Generate token
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
                <Empty count={data.deployments.length} columns={9} />
              </TableBody>
            </Table>
          </div>
        </Panel>
        {activation && (
          <Secret
            label="One-time activation token"
            {...activation}
            onDismiss={() => setActivation(null)}
          />
        )}
        <div className="page-grid">
          <DataForm
            title="Create deployment"
            fields={["clientId", "name", "environment", "region"]}
            options={{ clientId: clientOptions }}
            defaults={{ environment: "production", region: "india" }}
            onSubmit={(body) => save("/admin/deployments", body)}
          />
          <DataForm
            title="Set deployment limit"
            fields={["deploymentId", "capability", "enabled", "monthlyLimit"]}
            options={{ deploymentId: data.deployments.map(d => ({ value: d.id, label: `${client(d.clientId)} · ${d.name}` })), capability: [{ value: "SCORING", label: "Scoring" }, { value: "FACE_SCAN", label: "Face scan" }], enabled: [{ value: "true", label: "Enabled" }, { value: "false", label: "Disabled" }] }}
            defaults={{ capability: "SCORING", enabled: "true" }}
            onSubmit={({ deploymentId, capability, enabled, monthlyLimit }) => save(`/admin/deployments/${deploymentId}/entitlement`, { capability, enabled: enabled === "true", monthlyLimit: monthlyLimit === "" ? null : Number(monthlyLimit) }, "PUT")}
          />
          <DataForm
            title="Set deployment rule version"
            fields={["deploymentId", "ruleVersion"]}
            options={{ deploymentId: data.deployments.map(d => ({ value: d.id, label: `${client(d.clientId)} · ${d.name}` })), ruleVersion: [{ value: "LATEST_APPROVED", label: "Latest approved" }, ...data.versions.map(v => ({ value: v.id, label: `${v.version} (${v.lifecycle.toLowerCase()})` }))] }}
            defaults={{ ruleVersion: "LATEST_APPROVED" }}
            onSubmit={({ deploymentId, ruleVersion }) => save(`/admin/deployments/${deploymentId}/version-assignment`, ruleVersion === "LATEST_APPROVED" ? { mode: ruleVersion } : { mode: "PINNED", scoringRuleVersionId: ruleVersion }, "PUT")}
          />
        </div>
      </>
    );
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
function Empty({ count, columns }: { count: number; columns: number }) {
  return count === 0 ? (
    <TableRow>
      <TableCell className="empty" colSpan={columns}>
        No records configured.
      </TableCell>
    </TableRow>
  ) : null;
}
