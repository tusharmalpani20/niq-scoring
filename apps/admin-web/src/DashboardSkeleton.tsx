import { Card, CardContent, CardHeader } from "./components/ui/card";
import { Skeleton } from "./components/ui/skeleton";

const shimmer = "motion-reduce:animate-none";

export function DashboardChartSkeleton() {
  return <Card role="status" aria-label="Loading usage chart"><CardHeader className="flex-row items-center justify-between gap-3"><strong className="text-sm">Usage over time</strong><span className="text-xs text-muted-foreground">Last 6 months</span></CardHeader><CardContent>
    <div className="mx-auto flex h-56 max-w-3xl items-end justify-around gap-2 border-b border-border px-10 pb-2" aria-hidden="true">{Array.from({ length: 6 }, (_, index) => <div className="flex h-full items-end gap-1" key={index}><Skeleton className={`w-3 sm:w-5 ${shimmer}`} style={{ height: `${42 + index % 3 * 12}%` }} /><Skeleton className={`w-3 sm:w-5 ${shimmer}`} style={{ height: `${54 + index % 2 * 14}%` }} /></div>)}</div>
    <div className="mt-3 flex justify-center gap-5" aria-hidden="true"><Skeleton className={`h-3 w-24 ${shimmer}`} /><Skeleton className={`h-3 w-20 ${shimmer}`} /></div>
  </CardContent></Card>;
}

export function DashboardClientUsageSkeleton() {
  return <Card role="status" aria-label="Loading clients by usage"><CardHeader className="flex-row items-center justify-between gap-3"><strong className="text-sm">Clients by usage</strong><span className="text-xs text-muted-foreground">This month</span></CardHeader><CardContent className="divide-y">{Array.from({ length: 5 }, (_, index) => <div className="flex flex-wrap items-center justify-between gap-3 py-4 first:pt-0 last:pb-0" key={index}><div className="grid gap-2"><Skeleton className={`h-4 w-32 ${shimmer}`} /><Skeleton className={`h-3 w-20 ${shimmer}`} /></div><div className="flex gap-4"><Skeleton className={`h-4 w-24 ${shimmer}`} /><Skeleton className={`hidden h-4 w-24 sm:block ${shimmer}`} /></div></div>)}</CardContent></Card>;
}

export function DashboardRuleSkeleton() {
  return <Card role="status" aria-label="Loading rule usage"><CardHeader className="flex-row items-center justify-between gap-3"><strong className="text-sm">Assessments by rule</strong><span className="text-xs text-muted-foreground">All time</span></CardHeader><CardContent><div className="grid gap-4" aria-hidden="true">{Array.from({ length: 4 }, (_, index) => <div className="flex items-center gap-3" key={index}><Skeleton className={`h-4 w-24 shrink-0 ${shimmer}`} /><Skeleton className={`h-5 ${shimmer}`} style={{ width: `${72 - index * 12}%` }} /></div>)}</div></CardContent></Card>;
}

export function DashboardSummarySkeleton() {
  return <div className="space-y-6" role="status" aria-label="Loading scoring overview">
    <section className="space-y-3"><div className="flex items-center justify-between gap-3"><h2 className="text-lg font-semibold">Needs attention</h2><span className="text-xs text-muted-foreground">Current checks</span></div><Card><CardContent className="py-6"><Skeleton className={`h-4 w-56 max-w-full ${shimmer}`} /></CardContent></Card></section>
    <section className="space-y-3"><div className="flex items-center justify-between gap-3"><h2 className="text-lg font-semibold">This month</h2><Skeleton className={`h-3 w-28 ${shimmer}`} /></div><div className="grid gap-3 sm:grid-cols-3">{Array.from({ length: 3 }, (_, index) => <Card key={index}><CardContent className="flex min-h-28 items-center gap-4 py-5"><Skeleton className={`size-14 shrink-0 rounded-2xl ${shimmer}`} /><div className="min-w-0 flex-1 border-l pl-4"><Skeleton className={`h-3 w-32 max-w-full ${shimmer}`} /><Skeleton className={`mt-3 h-8 w-16 ${shimmer}`} /><Skeleton className={`mt-2 h-3 w-24 max-w-full ${shimmer}`} /></div></CardContent></Card>)}</div></section>
    <DashboardChartSkeleton />
  </div>;
}
