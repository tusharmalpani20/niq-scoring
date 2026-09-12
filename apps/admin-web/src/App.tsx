import { type FormEvent, useState } from "react";

type Overview = {
  customers: Array<{ id: string; legalName: string; externalReference: string; enabled: boolean }>;
  organizations: Array<{ id: string; customerId: string; name: string; enabled: boolean }>;
  deployments: Array<{ id: string; customerId: string; name: string; environment: string; region: string; enabled: boolean; organizationIds: string[] }>;
  entitlements: Array<{ organizationId: string; capability: "SCORING" | "FACE_SCAN"; enabled: boolean; monthlyLimit: number | null }>;
  assignments: Array<{ organizationId: string; mode: string; scoringRuleVersionId?: string }>;
  versions: Array<{ id: string; version: string; lifecycle: string; clinicalUsePermitted: boolean }>;
};

export function App() {
  const [token, setToken] = useState("");
  const [overview, setOverview] = useState<Overview | null>(null);
  const [error, setError] = useState("");
  const auth = { authorization: `Bearer ${token}`, "content-type": "application/json" };

  async function request(path: string, init?: RequestInit) {
    setError("");
    const response = await fetch(`/api${path}`, { ...init, headers: { ...auth, ...init?.headers } });
    if (!response.ok) throw new Error((await response.json() as { error?: string }).error ?? "Request failed");
    return response.json();
  }
  async function refresh() { try { setOverview(await request("/admin/overview")); } catch (cause) { setError(cause instanceof Error ? cause.message : "Unable to load"); } }
  async function submit(path: string, body: unknown, method = "POST") { try { await request(path, { method, body: JSON.stringify(body) }); await refresh(); } catch (cause) { setError(cause instanceof Error ? cause.message : "Unable to save"); } }

  return (
    <div className="shell">
      <aside><div className="brand"><span>NIQ</span><small>Scoring control</small></div><nav><a href="#overview">Overview</a><a href="#customers">Customers</a><a href="#deployments">Deployments</a><a href="#versions">Versions</a></nav><p className="privacy">No patient identity belongs in this console.</p></aside>
      <main>
        <header><div><p className="eyebrow">India · Phase 1</p><h1>Scoring administration</h1><p>Customers, deployments, quotas and governed rule assignments.</p></div><span className={overview ? "status online" : "status"}>{overview ? "Connected" : "Locked"}</span></header>
        <section className="warning"><strong>Development-only scoring</strong><span>NIQ-DRAFT-2026-09 is unvalidated and prohibited for patient-care decisions.</span></section>
        <section className="panel login"><label><span>Development admin token</span><input type="password" value={token} onChange={(event) => setToken(event.target.value)} autoComplete="off" /></label><button onClick={refresh}>Unlock console</button><small>Held in memory only. This bootstrap access is disabled in production.</small>{error && <p className="error" role="alert">{error}</p>}</section>

        <section className="cards" id="overview"><article><span>Customers</span><strong>{overview?.customers.length ?? 0}</strong></article><article><span>Organizations</span><strong>{overview?.organizations.length ?? 0}</strong></article><article><span>Deployments</span><strong>{overview?.deployments.length ?? 0}</strong></article><article><span>Rule packages</span><strong>{overview?.versions.length ?? 0}</strong></article></section>

        <section className="grid" id="customers">
          <AdminForm title="Create customer" fields={["legalName", "externalReference"]} onSubmit={(body) => submit("/admin/customers", body)} />
          <AdminForm title="Create organization" fields={["customerId", "name", "externalReference"]} onSubmit={(body) => submit("/admin/organizations", body)} />
        </section>

        <section className="panel"><h2>Organizations</h2><div className="table-wrap" role="region" aria-label="Organizations table" tabIndex={0}><table><thead><tr><th>Name</th><th>Customer</th><th>Scoring limit</th><th>Face-scan limit</th><th>Version mode</th></tr></thead><tbody>{overview?.organizations.map((organization) => {
          const entitlement = (capability: "SCORING" | "FACE_SCAN") => overview.entitlements.find((item) => item.organizationId === organization.id && item.capability === capability);
          return <tr key={organization.id}><td><strong>{organization.name}</strong><small>{organization.id}</small></td><td>{organization.customerId}</td><td>{formatLimit(entitlement("SCORING"))}</td><td>{formatLimit(entitlement("FACE_SCAN"))}</td><td>{overview.assignments.find((item) => item.organizationId === organization.id)?.mode ?? "Not assigned"}</td></tr>;
        })}<EmptyRow show={!overview?.organizations.length} columns={5} /></tbody></table></div></section>

        <section className="grid" id="deployments">
          <AdminForm title="Create deployment" fields={["customerId", "name", "environment", "region", "organizationIds"]} defaults={{ environment: "production", region: "india" }} onSubmit={(body) => submit("/admin/deployments", { ...body, organizationIds: String(body.organizationIds).split(",").map((value) => value.trim()) })} />
          <AdminForm title="Set monthly limit" fields={["organizationId", "capability", "monthlyLimit"]} defaults={{ capability: "SCORING" }} onSubmit={({ organizationId, ...body }) => submit(`/admin/organizations/${organizationId}/entitlement`, { ...body, enabled: true, monthlyLimit: body.monthlyLimit === "" ? null : Number(body.monthlyLimit) }, "PUT")} />
        </section>

        <section className="panel"><h2>Deployments</h2><div className="table-wrap" role="region" aria-label="Deployments table" tabIndex={0}><table><thead><tr><th>Name</th><th>Environment</th><th>Region</th><th>Organizations</th><th>Status</th></tr></thead><tbody>{overview?.deployments.map((deployment) => <tr key={deployment.id}><td><strong>{deployment.name}</strong><small>{deployment.id}</small></td><td>{deployment.environment}</td><td>{deployment.region}</td><td>{deployment.organizationIds.length}</td><td><span className="pill">{deployment.enabled ? "Enabled" : "Disabled"}</span></td></tr>)}<EmptyRow show={!overview?.deployments.length} columns={5} /></tbody></table></div></section>

        <section className="panel" id="versions"><h2>Version status</h2>{overview?.versions.map((version) => <div className="version" key={version.id}><div><strong>{version.version}</strong><small>{version.id}</small></div><span className="pill">{version.lifecycle}</span><span className="danger">{version.clinicalUsePermitted ? "Clinical use permitted" : "Clinical use prohibited"}</span></div>) ?? <p>Unlock the console to view versions.</p>}</section>
      </main>
    </div>
  );
}

function formatLimit(value?: { enabled: boolean; monthlyLimit: number | null }) { if (!value?.enabled) return "Disabled"; return value.monthlyLimit === null ? "Unlimited" : value.monthlyLimit; }
function EmptyRow({ show, columns }: { show: boolean; columns: number }) { return show ? <tr><td colSpan={columns}>No records configured.</td></tr> : null; }

function AdminForm({ title, fields, defaults = {}, onSubmit }: { title: string; fields: string[]; defaults?: Record<string, string>; onSubmit: (body: Record<string, string>) => Promise<void> }) {
  const [values, setValues] = useState<Record<string, string>>(defaults);
  const handleSubmit = async (event: FormEvent) => { event.preventDefault(); await onSubmit(values); };
  return <form className="panel form" onSubmit={handleSubmit}><h2>{title}</h2>{fields.map((field) => <label key={field}><span>{field.replace(/([A-Z])/g, " $1")}</span><input required={field !== "monthlyLimit"} value={values[field] ?? ""} onChange={(event) => setValues({ ...values, [field]: event.target.value })} /></label>)}<button type="submit">Save</button></form>;
}
