import { ArrowDownRight, ArrowUpRight, Minus } from "lucide-react";
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
  return <svg aria-label={`${label} over the last six months: ${values.map(value => value.toLocaleString()).join(", ")}`} role="img" viewBox={`0 0 ${width} ${height}`} className={`h-12 w-28 shrink-0 ${isFailure ? "text-destructive" : "text-primary"}`}>
    <polyline points={points} fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" vectorEffect="non-scaling-stroke" />
  </svg>;
}

export function DashboardMetricCard({ label, metric, current, previous, monthly, previousMonth }: {
  label: string;
  metric: Metric;
  current: number;
  previous: number | null;
  monthly: MetricCounts[];
  previousMonth: string;
}) {
  const difference = current - (previous ?? 0);
  const percentage = previous !== null && previous > 0 ? Math.round(Math.abs(difference) / previous * 100) : null;
  const isFailure = metric === "failedRequests";
  const color = difference === 0 ? "text-muted-foreground" : (isFailure ? difference > 0 : difference < 0) ? "text-destructive" : "text-primary";
  const Direction = difference > 0 ? ArrowUpRight : difference < 0 ? ArrowDownRight : Minus;
  const comparison = percentage === null && difference !== 0 ? `${difference > 0 ? "+" : "−"}${Math.abs(difference).toLocaleString()}` : `${percentage ?? 0}%`;
  return <Card><CardContent className="pt-5">
    <p className="text-sm text-muted-foreground">{label}</p>
    <div className="mt-2 flex items-center justify-between gap-2"><strong className="text-3xl font-semibold tabular-nums">{current.toLocaleString()}</strong><Sparkline values={monthly.map(item => item[metric])} label={label} isFailure={isFailure} /></div>
    {previous === null ? <p className="mt-2 text-xs text-muted-foreground">No equal-length period in {previousMonth}</p>
      : <div className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs"><span className={`inline-flex items-center gap-0.5 font-medium tabular-nums ${color}`}><Direction className="size-3.5" aria-hidden="true" />{comparison}</span><span className="text-muted-foreground">vs the same period in {previousMonth}{previous === 0 ? " (0)" : ""}</span></div>}
  </CardContent></Card>;
}
