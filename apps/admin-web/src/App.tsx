import { useEffect, useState } from "react";

interface Metadata {
  service: string;
  region: string;
  provisionalVersion: { version: string; status: string; clinicalUsePermitted: false };
  faceScanProvider: { configured: boolean; mode: string };
}

const sampleOrganizations = [
  { name: "No organizations configured", deployment: "Use the authenticated API onboarding flow", scoring: "Not enabled", limit: "—" },
];

export function App() {
  const [metadata, setMetadata] = useState<Metadata | null>(null);

  useEffect(() => {
    // The development key is never compiled into the UI. Authentication/session
    // integration will provide a short-lived token in the onboarding milestone.
    const controller = new AbortController();
    fetch("/api/health", { signal: controller.signal })
      .then((response) => response.json())
      .then((health) => setMetadata({
        service: health.service,
        region: health.region,
        provisionalVersion: { version: "NIQ-DRAFT-2026-09", status: "DRAFT_NON_CLINICAL", clinicalUsePermitted: false },
        faceScanProvider: { configured: false, mode: "contract-only" },
      }))
      .catch(() => setMetadata(null));
    return () => controller.abort();
  }, []);

  return (
    <div className="shell">
      <aside>
        <div className="brand"><span>NIQ</span><small>Scoring control</small></div>
        <nav aria-label="Administration"><a className="active" href="#overview">Overview</a><a href="#organizations">Organizations</a><a href="#versions">Versions</a><a href="#usage">Usage</a><a href="#audit">Audit</a></nav>
        <p className="privacy">No patient identity belongs in this console.</p>
      </aside>
      <main>
        <header><div><p className="eyebrow">India · Phase 1</p><h1>Scoring administration</h1><p>Foundation status for deployments, entitlements, versions and usage.</p></div><span className={metadata ? "status online" : "status"}>{metadata ? "API reachable" : "API unavailable"}</span></header>

        <section className="warning" aria-label="Clinical warning"><strong>Development-only scoring</strong><span>NIQ-DRAFT-2026-09 is unvalidated and must not be used for patient-care decisions.</span></section>

        <section className="cards" id="overview">
          <article><span>Region</span><strong>{metadata?.region ?? "India"}</strong><small>Prepared for future regional nodes</small></article>
          <article><span>Active version</span><strong>None</strong><small>Draft package available only</small></article>
          <article><span>Face scan</span><strong>Not configured</strong><small>Provider contract and states defined</small></article>
          <article><span>Default limit</span><strong>Unlimited</strong><small>Nullable monthly entitlement</small></article>
        </section>

        <section className="panel" id="organizations">
          <div className="panel-title"><div><p className="eyebrow">Customer controls</p><h2>Organizations and deployments</h2></div><button disabled title="Available after authenticated onboarding is implemented">Create organization</button></div>
          <div className="table-wrap"><table><thead><tr><th>Organization</th><th>Deployment</th><th>Scoring</th><th>Monthly limit</th></tr></thead><tbody>{sampleOrganizations.map((row) => <tr key={row.name}><td>{row.name}</td><td>{row.deployment}</td><td><span className="pill">{row.scoring}</span></td><td>{row.limit}</td></tr>)}</tbody></table></div>
        </section>

        <section className="split" id="versions">
          <article className="panel"><p className="eyebrow">Rule package</p><h2>NIQ-DRAFT-2026-09</h2><dl><div><dt>Status</dt><dd>DRAFT_NON_CLINICAL</dd></div><div><dt>Clinical use</dt><dd>Prohibited</dd></div><div><dt>Lifecycle</dt><dd>Draft</dd></div></dl></article>
          <article className="panel"><p className="eyebrow">Designed controls</p><h2>Release safeguards</h2><ul><li>Immutable published versions</li><li>Checksum and approval evidence</li><li>Per-organization assignments</li><li>Idempotent usage accounting</li></ul></article>
        </section>
      </main>
    </div>
  );
}
