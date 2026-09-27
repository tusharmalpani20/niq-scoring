import { ArrowDownRight, ArrowUpRight, ClipboardCheck, Minus, ScanFace, TriangleAlert } from "lucide-react";
import { Card, CardContent } from "./components/ui/card";

type Metric = "assessments" | "faceScans" | "failedRequests";
export type MetricCounts = Record<Metric, number>;

function Sparkline({ values, label, isFailure }: { values: number[]; label: string; isFailure: boolean }) {
  const width = 112;
  const height = 48;
  const padding = 3;
  const maximum = Math.max(...values, 0);
  const points = values.map((value, index) => {
    const x = padding + index * (width - 2 * padding) / Math.max(1, values.length - 1);
    const y = maximum === 0 ? height / 2 : height - padding - value / maximum * (height - 2 * padding);
    return `${x},${y}`;
  }).join(" ");
  return <svg aria-label={`${label}: monthly totals for the last six months, with the current month to date: ${values.map(value => value.toLocaleString()).join(", ")}`} role="img" viewBox={`0 0 ${width} ${height}`} className={`h-12 w-28 shrink-0 ${isFailure ? "text-destructive" : "text-primary"}`}>
    <polyline points={points} fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" vectorEffect="non-scaling-stroke" />
  </svg>;
}

export function DashboardMetricCard({ label, metric, current, previous, monthly, comparisonPeriod }: {
  label: string;
  metric: Metric;
  current: number;
  previous: number | null;
  monthly: MetricCounts[];
  comparisonPeriod: string;
}) {
  const difference = current - (previous ?? 0);
  const percentage = previous !== null && previous > 0 ? Math.round(Math.abs(difference) / previous * 100) : null;
  const isFailure = metric === "failedRequests";
  const Icon = metric === "assessments" ? ClipboardCheck : metric === "faceScans" ? ScanFace : TriangleAlert;
  const color = difference === 0 ? "text-muted-foreground" : (isFailure ? difference > 0 : difference < 0) ? "text-destructive" : "text-primary";
  const Direction = difference > 0 ? ArrowUpRight : difference < 0 ? ArrowDownRight : Minus;
  const comparison = percentage === null && difference !== 0 ? `${difference > 0 ? "+" : "−"}${Math.abs(difference).toLocaleString()}` : `${percentage ?? 0}%`;
  return <Card><CardContent className="flex items-center gap-4 py-5">
    <span className={`grid size-14 shrink-0 place-items-center rounded-2xl ${isFailure ? "bg-destructive/10 text-destructive" : "bg-primary/10 text-primary"}`}><Icon className="size-6" aria-hidden="true" /></span>
    <span className="min-w-0 flex-1 border-l pl-4">
      <span className="block text-sm text-muted-foreground">{label}</span>
      <span className="mt-1 flex flex-wrap items-center justify-between gap-2"><strong className="text-3xl font-semibold tabular-nums">{current.toLocaleString()}</strong><Sparkline values={monthly.map(item => item[metric])} label={label} isFailure={isFailure} /></span>
      {previous !== null && <span className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs"><span className={`inline-flex items-center gap-0.5 font-medium tabular-nums ${color}`}><Direction className="size-3.5" aria-hidden="true" />{comparison}</span><span className="text-muted-foreground">vs {comparisonPeriod}{previous === 0 ? " (0)" : ""}</span></span>}
    </span>
  </CardContent></Card>;
}
