import { useState } from "react";
import { Link } from "react-router-dom";
import { ArrowRight } from "lucide-react";
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

export function DashboardClientUsage({ clients, overview }: { clients: DashboardClient[]; overview: Overview }) {
  const [page, setPage] = useState(1);
  const clientPage = paginate(clients, page, 5);
  return <div className="min-w-0 space-y-3"><Card><CardHeader className="flex-row items-center justify-between gap-2"><CardTitle>Clients by usage</CardTitle><span className="text-xs text-muted-foreground">This month</span></CardHeader><CardContent>
    {clients.length === 0 ? <p className="text-sm text-muted-foreground">No clients yet.</p> : <ul className="divide-y">{clientPage.rows.map(client => {
      const record = overview.clients.find(item => item.id === client.id);
      return <li key={client.id} className="flex flex-wrap items-center gap-x-4 gap-y-2 py-4 first:pt-0 last:pb-0">
        <div className="min-w-0 flex-1"><p className="font-semibold">{record ? <Link to={clientUrl(record)} className="text-primary hover:underline">{client.name}</Link> : client.name}</p><p className="text-xs text-muted-foreground">{client.deployments.length} {client.deployments.length === 1 ? "deployment" : "deployments"}</p></div>
        <div className="flex flex-wrap gap-x-6 gap-y-1 text-sm"><span><strong className="tabular-nums">{client.assessments.toLocaleString()}</strong> <span className="text-muted-foreground">assessments scored</span></span><span><strong className="tabular-nums">{client.faceScans.toLocaleString()}</strong> <span className="text-muted-foreground">face scans completed</span></span></div>
        {record && <Link to={clientUrl(record)} className="text-sm text-primary hover:underline" aria-label={`View ${client.name} details`}>View <ArrowRight className="inline size-3" aria-hidden="true" /></Link>}
      </li>;
    })}</ul>}
  </CardContent></Card>
    {clientPage.pageCount > 1 && <Pagination aria-label="Dashboard clients pagination"><PaginationContent><PaginationItem><Button variant="outline" size="sm" disabled={clientPage.page === 1} onClick={() => setPage(clientPage.page - 1)}>Previous</Button></PaginationItem><PaginationItem><span className="px-2 text-xs text-muted-foreground" role="status">Page {clientPage.page} of {clientPage.pageCount} · {clientPage.total} clients</span></PaginationItem><PaginationItem><Button variant="outline" size="sm" disabled={clientPage.page === clientPage.pageCount} onClick={() => setPage(clientPage.page + 1)}>Next</Button></PaginationItem></PaginationContent></Pagination>}
  </div>;
}
