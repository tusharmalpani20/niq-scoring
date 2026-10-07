import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { ArrowRight } from "lucide-react";
import { message, request } from "./api";
import { Button } from "./components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "./components/ui/card";
import { Pagination, PaginationContent, PaginationItem } from "./components/ui/pagination";
import { DashboardClientUsageSkeleton } from "./DashboardSkeleton";

type Usage = { completed: number; allowanceUsed: number; limit: number | null; available: boolean };
export type DashboardClient = {
  id: string;
  name: string;
  assessments: number;
  faceScans: number;
  deployments: Array<{ id: string; name: string; enabled: boolean; assessments: Usage; faceScans: Usage }>;
};

type ClientRow = { id: string; name: string; assessments: number; faceScans: number; deploymentCount: number };
type ClientPage = { items: ClientRow[]; page: number; pageSize: number; total: number; pageCount: number };

export function DashboardClientUsage() {
  const [page, setPage] = useState(1);
  const [result, setResult] = useState<ClientPage | null>(null);
  const [error, setError] = useState("");
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let current = true;
    void request<ClientPage>(`/admin/dashboard/clients?page=${page}&pageSize=5`).then(next => {
      if (current) { setResult(next); setError(""); }
    }).catch(cause => { if (current) setError(message(cause)); });
    return () => { current = false; };
  }, [page, attempt]);

  if (!result && !error) return <DashboardClientUsageSkeleton />;
  return <div className="min-w-0 space-y-3"><Card><CardHeader className="flex-row items-center justify-between gap-2"><CardTitle>Clients by usage</CardTitle><span className="text-xs text-muted-foreground">This month</span></CardHeader><CardContent>
    {error ? <div role="alert" className="flex flex-wrap items-center gap-3 text-sm text-destructive">Could not load clients by usage. {error}<Button variant="outline" size="sm" onClick={() => setAttempt(value => value + 1)}>Retry</Button></div>
      : result?.items.length === 0 ? <p className="text-sm text-muted-foreground">No clients yet.</p>
      : <ul className="divide-y">{result?.items.map(client => <li key={client.id} className="flex flex-wrap items-center gap-x-4 gap-y-2 py-4 first:pt-0 last:pb-0">
        <div className="min-w-0 flex-1"><p className="font-semibold"><Link to={`/clients/${encodeURIComponent(client.id)}`} className="text-primary hover:underline">{client.name}</Link></p><p className="text-xs text-muted-foreground">{client.deploymentCount} {client.deploymentCount === 1 ? "deployment" : "deployments"}</p></div>
        <div className="flex flex-wrap gap-x-6 gap-y-1 text-sm"><span><strong className="tabular-nums">{client.assessments.toLocaleString()}</strong> <span className="text-muted-foreground">assessments scored</span></span><span><strong className="tabular-nums">{client.faceScans.toLocaleString()}</strong> <span className="text-muted-foreground">Vital IQ scans completed</span></span></div>
        <Link to={`/clients/${encodeURIComponent(client.id)}`} className="text-sm text-primary hover:underline" aria-label={`View ${client.name} details`}>View <ArrowRight className="inline size-3" aria-hidden="true" /></Link>
      </li>)}</ul>}
  </CardContent></Card>
    {!error && result && result.pageCount > 1 && <Pagination aria-label="Dashboard clients pagination"><PaginationContent><PaginationItem><Button variant="outline" size="sm" disabled={page === 1} onClick={() => { setResult(null); setPage(page - 1); }}>Previous</Button></PaginationItem><PaginationItem><span className="px-2 text-xs text-muted-foreground" role="status">Page {result.page} of {result.pageCount}</span></PaginationItem><PaginationItem><Button variant="outline" size="sm" disabled={page === result.pageCount} onClick={() => { setResult(null); setPage(page + 1); }}>Next</Button></PaginationItem></PaginationContent></Pagination>}
  </div>;
}
