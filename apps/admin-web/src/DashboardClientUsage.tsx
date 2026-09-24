import { useState } from "react";
import { Link } from "react-router-dom";
import { Button } from "./components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "./components/ui/card";
import { Pagination, PaginationContent, PaginationItem } from "./components/ui/pagination";
import type { Overview } from "./Operations";
import { paginate } from "./pagination";
import { clientUrl, deploymentUrl } from "./record-urls";

type Usage = { completed: number; allowanceUsed: number; limit: number | null; available: boolean };
export type DashboardClient = {
  id: string;
  name: string;
  assessments: number;
  faceScans: number;
  deployments: Array<{ id: string; name: string; enabled: boolean; assessments: Usage; faceScans: Usage }>;
};

function Allowance({ label, usage }: { label: string; usage: Usage }) {
  const value = usage.allowanceUsed.toLocaleString();
  const limit = usage.limit;
  const percent = limit && limit > 0 ? Math.min(100, usage.allowanceUsed / limit * 100) : 0;
  return <div className="space-y-1.5 text-xs">
    <div className="flex justify-between gap-2"><span className="text-muted-foreground">{label}</span><span className="tabular-nums">{usage.available ? limit === null ? `${value} used · Unlimited` : `${value} of ${limit.toLocaleString()} used` : "Unavailable"}</span></div>
    {usage.available && limit !== null && <div className="h-1.5 overflow-hidden rounded-full bg-secondary" role="progressbar" aria-label={`${label} monthly allowance`} aria-valuenow={usage.allowanceUsed} aria-valuemin={0} aria-valuemax={limit}><div className="h-full rounded-full bg-primary" style={{ width: `${percent}%` }} /></div>}
  </div>;
}

export function DashboardClientUsage({ clients, overview }: { clients: DashboardClient[]; overview: Overview }) {
  const [page, setPage] = useState(1);
  const clientPage = paginate(clients, page);
  return <Card className="min-w-0"><CardHeader className="flex-row items-center justify-between gap-2"><CardTitle>Clients by usage</CardTitle><span className="text-xs text-muted-foreground">This month</span></CardHeader><CardContent>
    {clients.length === 0 ? <p className="text-sm text-muted-foreground">No clients yet.</p> : <ul className="divide-y">{clientPage.rows.map(client => {
      const record = overview.clients.find(item => item.id === client.id);
      return <li key={client.id} className="space-y-3 py-4 first:pt-0 last:pb-0">
        <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1 text-sm"><strong>{record ? <Link to={clientUrl(record)} className="text-primary hover:underline">{client.name}</Link> : client.name}</strong><span className="tabular-nums">{client.assessments.toLocaleString()} assessments · {client.faceScans.toLocaleString()} scans</span></div>
        {client.deployments.length === 0 ? <p className="text-xs text-muted-foreground">No deployments.</p> : client.deployments.map(deployment => {
          const deploymentRecord = overview.deployments.find(item => item.id === deployment.id);
          return <div key={deployment.id} className="space-y-2.5 rounded-md bg-muted/40 px-3 py-2.5">
            <div className="flex justify-between gap-2 text-xs font-medium"><span>{deploymentRecord ? <Link to={deploymentUrl(overview, deploymentRecord)} className="hover:underline">{deployment.name}</Link> : deployment.name}</span>{!deployment.enabled && <span className="text-muted-foreground">Disabled</span>}</div>
            <Allowance label="Assessments" usage={deployment.assessments} />
            <Allowance label="Face scans" usage={deployment.faceScans} />
          </div>;
        })}
      </li>;
    })}</ul>}
    {clientPage.pageCount > 1 && <Pagination aria-label="Dashboard clients pagination" className="mt-5"><PaginationContent><PaginationItem><Button variant="outline" size="sm" disabled={clientPage.page === 1} onClick={() => setPage(clientPage.page - 1)}>Previous</Button></PaginationItem><PaginationItem><span className="px-2 text-xs text-muted-foreground" role="status">Page {clientPage.page} of {clientPage.pageCount} · {clientPage.total} total</span></PaginationItem><PaginationItem><Button variant="outline" size="sm" disabled={clientPage.page === clientPage.pageCount} onClick={() => setPage(clientPage.page + 1)}>Next</Button></PaginationItem></PaginationContent></Pagination>}
  </CardContent></Card>;
}
