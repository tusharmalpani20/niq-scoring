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
    externalReference: string;
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
    clientId: string;
    capability: string;
    enabled: boolean;
    monthlyLimit: number | null;
  }>;
  assignments: Array<{ clientId: string; mode: string }>;
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
  if (page === "clients")
    return (
      <>
        <Panel title="Clients">
          <div>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Client</TableHead>
                  <TableHead>Reference</TableHead>
                  <TableHead>Scoring limit</TableHead>
                  <TableHead>Face-scan limit</TableHead>
                  <TableHead>Version mode</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.clients.map((o) => (
                  <TableRow key={o.id}>
                    <TableCell>
                      <strong>{o.name}</strong>
                      <small>{o.id}</small>
                    </TableCell>
                    <TableCell>{o.externalReference}</TableCell>
                    {["SCORING", "FACE_SCAN"].map((cap) => {
                      const e = data.entitlements.find(
                        (e) =>
                          e.clientId === o.id && e.capability === cap,
                      );
                      return (
                        <TableCell key={cap}>
                          {!e?.enabled
                            ? "Disabled"
                            : (e.monthlyLimit ?? "Unlimited")}
                        </TableCell>
                      );
                    })}
                    <TableCell>
                      {data.assignments.find((a) => a.clientId === o.id)
                        ?.mode ?? "Not assigned"}
                    </TableCell>
                  </TableRow>
                ))}
                <Empty count={data.clients.length} columns={5} />
              </TableBody>
            </Table>
          </div>
        </Panel>
        <div className="page-grid">
          <DataForm
            title="Create client"
            fields={["name", "externalReference"]}
            onSubmit={(body) => save("/admin/clients", body)}
          />
          <DataForm
            title="Set monthly limit"
            fields={["clientId", "capability", "monthlyLimit"]}
            options={{ clientId: clientOptions }}
            defaults={{ capability: "SCORING" }}
            onSubmit={({ clientId, ...body }) =>
              save(
                `/admin/clients/${clientId}/entitlement`,
                {
                  ...body,
                  enabled: true,
                  monthlyLimit:
                    body.monthlyLimit == null || body.monthlyLimit === ""
                      ? null
                      : Number(body.monthlyLimit),
                },
                "PUT",
              )
            }
          />
        </div>
      </>
    );
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
                <Empty count={data.deployments.length} columns={6} />
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
        <div className="narrow">
          <DataForm
            title="Create deployment"
            fields={["clientId", "name", "environment", "region"]}
            options={{ clientId: clientOptions }}
            defaults={{ environment: "production", region: "india" }}
            onSubmit={(body) => save("/admin/deployments", body)}
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
