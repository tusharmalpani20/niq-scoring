import { useState } from "react";
import { Link } from "react-router-dom";
import { request, message } from "./api";
import { Button } from "./components/ui/button";
import { DataForm, Panel, Secret, ErrorNotice } from "./shared";
export type Overview = {
  customers: Array<{
    id: string;
    legalName: string;
    externalReference: string;
    enabled: boolean;
  }>;
  organizations: Array<{
    id: string;
    customerId: string;
    name: string;
    enabled: boolean;
  }>;
  deployments: Array<{
    id: string;
    customerId: string;
    name: string;
    environment: string;
    region: string;
    enabled: boolean;
    organizationIds: string[];
  }>;
  entitlements: Array<{
    organizationId: string;
    capability: string;
    enabled: boolean;
    monthlyLimit: number | null;
  }>;
  assignments: Array<{ organizationId: string; mode: string }>;
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
  const customer = (id: string) =>
    data.customers.find((c) => c.id === id)?.legalName ?? id;
  if (page === "overview")
    return (
      <>
        <div className="metrics">
          {[
            ["Customers", data.customers.length, "customers"],
            ["Organizations", data.organizations.length, "organizations"],
            ["Deployments", data.deployments.length, "deployments"],
            ["Rule versions", data.versions.length, "versions"],
          ].map(([label, count, path]) => (
            <Link to={`/${path}`} className="metric" key={label}>
              <span>{label}</span>
              <strong>{count}</strong>
              <small>View {String(label).toLowerCase()} →</small>
            </Link>
          ))}
        </div>
        <Panel
          title="Start with your team"
          description="Give your NIQ colleagues access before setting up customer operations."
        >
          <Button asChild>
            <Link to="/users">Manage administrators</Link>
          </Button>
        </Panel>
        <Panel title="Central scoring administration">
          <p className="muted">
            Use the navigation to manage customers, organization limits,
            deployment activation and rule versions. Patient records and
            clinical workflows remain in the NIQ application.
          </p>
        </Panel>
      </>
    );
  if (page === "customers")
    return (
      <>
        <Panel title="Customers">
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Customer</th>
                  <th>Reference</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {data.customers.map((c) => (
                  <tr key={c.id}>
                    <td>
                      <strong>{c.legalName}</strong>
                      <small>{c.id}</small>
                    </td>
                    <td>{c.externalReference}</td>
                    <td>{c.enabled ? "Enabled" : "Disabled"}</td>
                  </tr>
                ))}
                <Empty count={data.customers.length} columns={3} />
              </tbody>
            </table>
          </div>
        </Panel>
        <div className="narrow">
          <DataForm
            title="Create customer"
            fields={["legalName", "externalReference"]}
            onSubmit={(body) => save("/admin/customers", body)}
          />
        </div>
      </>
    );
  if (page === "organizations")
    return (
      <>
        <Panel title="Organizations">
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Organization</th>
                  <th>Customer</th>
                  <th>Scoring limit</th>
                  <th>Face-scan limit</th>
                  <th>Version mode</th>
                </tr>
              </thead>
              <tbody>
                {data.organizations.map((o) => (
                  <tr key={o.id}>
                    <td>
                      <strong>{o.name}</strong>
                      <small>{o.id}</small>
                    </td>
                    <td>{customer(o.customerId)}</td>
                    {["SCORING", "FACE_SCAN"].map((cap) => {
                      const e = data.entitlements.find(
                        (e) =>
                          e.organizationId === o.id && e.capability === cap,
                      );
                      return (
                        <td key={cap}>
                          {!e?.enabled
                            ? "Disabled"
                            : (e.monthlyLimit ?? "Unlimited")}
                        </td>
                      );
                    })}
                    <td>
                      {data.assignments.find((a) => a.organizationId === o.id)
                        ?.mode ?? "Not assigned"}
                    </td>
                  </tr>
                ))}
                <Empty count={data.organizations.length} columns={5} />
              </tbody>
            </table>
          </div>
        </Panel>
        <div className="page-grid">
          <DataForm
            title="Create organization"
            fields={["customerId", "name", "externalReference"]}
            onSubmit={(body) => save("/admin/organizations", body)}
          />
          <DataForm
            title="Set monthly limit"
            fields={["organizationId", "capability", "monthlyLimit"]}
            defaults={{ capability: "SCORING" }}
            onSubmit={({ organizationId, ...body }) =>
              save(
                `/admin/organizations/${organizationId}/entitlement`,
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
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Deployment</th>
                  <th>Environment</th>
                  <th>Region</th>
                  <th>Status</th>
                  <th>Activation</th>
                </tr>
              </thead>
              <tbody>
                {data.deployments.map((d) => (
                  <tr key={d.id}>
                    <td>
                      <strong>{d.name}</strong>
                      <small>{d.id}</small>
                    </td>
                    <td>{d.environment}</td>
                    <td>{d.region}</td>
                    <td>{d.enabled ? "Enabled" : "Disabled"}</td>
                    <td>
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
                    </td>
                  </tr>
                ))}
                <Empty count={data.deployments.length} columns={5} />
              </tbody>
            </table>
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
            fields={[
              "customerId",
              "name",
              "environment",
              "region",
              "organizationIds",
            ]}
            defaults={{ environment: "production", region: "india" }}
            onSubmit={(body) =>
              save("/admin/deployments", {
                ...body,
                organizationIds: String(body.organizationIds)
                  .split(",")
                  .map((v) => v.trim())
                  .filter(Boolean),
              })
            }
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
            <span className="pill">{v.lifecycle}</span>
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
    <tr>
      <td className="empty" colSpan={columns}>
        No records configured.
      </td>
    </tr>
  ) : null;
}
