import { useState } from "react";
import { Link } from "react-router-dom";
import { Button } from "./components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "./components/ui/card";
import { Pagination, PaginationContent, PaginationItem } from "./components/ui/pagination";
import type { Overview } from "./Operations";
import { paginate } from "./pagination";
import { clientUrl } from "./record-urls";

type Usage = { completed: number; allowanceUsed: number; limit: number | null; available: boolean };
export type DashboardClient = {
  id: string;
  name: string;
  assessments: number;
  faceScans: number;
  deployments: Array<{ id: string; name: string; enabled: boolean; assessments: Usage; faceScans: Usage }>;
};

function Allowance({ usage, label }: { usage: Usage; label?: string }) {
  const limit = usage.limit;
  const percent = limit && limit > 0 ? Math.min(100, usage.allowanceUsed / limit * 100) : 0;
  const description = !usage.available ? "Assessment allowance unavailable" : limit === null
    ? "Unlimited monthly allowance"
    : `${usage.allowanceUsed.toLocaleString()} of ${limit.toLocaleString()} monthly allowance used`;
  return <div className="space-y-2">
    <div className="flex flex-wrap justify-between gap-x-3 gap-y-1 text-sm text-muted-foreground">{label && <span className="text-foreground">{label}</span>}<span>{description}</span></div>
    {usage.available && limit !== null && <div className="h-1.5 overflow-hidden rounded-full bg-secondary" role="progressbar" aria-label={`${label ?? "Assessments"} monthly allowance`} aria-valuenow={Math.min(usage.allowanceUsed, limit)} aria-valuemin={0} aria-valuemax={limit}><div className="h-full rounded-full bg-primary" style={{ width: `${percent}%` }} /></div>}
  </div>;
}

export function DashboardClientUsage({ clients, overview }: { clients: DashboardClient[]; overview: Overview }) {
  const [page, setPage] = useState(1);
  const clientPage = paginate(clients, page);
  return <div className="min-w-0 space-y-4"><Card><CardHeader className="flex-row items-center justify-between gap-2"><CardTitle>Clients by usage</CardTitle><span className="text-xs text-muted-foreground">This month</span></CardHeader><CardContent>
    {clients.length === 0 ? <p className="text-sm text-muted-foreground">No clients yet.</p> : <ul className="divide-y">{clientPage.rows.map(client => {
      const record = overview.clients.find(item => item.id === client.id);
      return <li key={client.id} className="space-y-2.5 py-4 first:pt-0 last:pb-0">
        <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1"><strong className="font-semibold">{record ? <Link to={clientUrl(record)} className="hover:text-primary hover:underline">{client.name}</Link> : client.name}</strong><strong className="font-semibold tabular-nums">{client.assessments.toLocaleString()} assessments</strong></div>
        {client.deployments.length === 0 ? <p className="text-sm text-muted-foreground">No deployment allowance</p>
          : client.deployments.length === 1 ? <Allowance usage={client.deployments[0]!.assessments} />
          : <div className="space-y-3">{client.deployments.map(deployment => {
            const record = overview.deployments.find(item => item.id === deployment.id);
            const label = record ? record.environment.charAt(0).toUpperCase() + record.environment.slice(1) : deployment.name;
            return <Allowance key={deployment.id} usage={deployment.assessments} label={label} />;
          })}</div>}
      </li>;
    })}</ul>}
  </CardContent></Card>
    {clientPage.pageCount > 1 && <Pagination aria-label="Dashboard clients pagination"><PaginationContent><PaginationItem><Button variant="outline" size="sm" disabled={clientPage.page === 1} onClick={() => setPage(clientPage.page - 1)}>Previous</Button></PaginationItem><PaginationItem><span className="px-2 text-xs text-muted-foreground" role="status">Page {clientPage.page} of {clientPage.pageCount} · {clientPage.total} total</span></PaginationItem><PaginationItem><Button variant="outline" size="sm" disabled={clientPage.page === clientPage.pageCount} onClick={() => setPage(clientPage.page + 1)}>Next</Button></PaginationItem></PaginationContent></Pagination>}
  </div>;
}
