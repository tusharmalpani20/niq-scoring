import { Bar, BarChart, CartesianGrid, XAxis, YAxis } from "recharts";
import type { RuleUsage } from "./rule-usage";
import { Card, CardContent, CardHeader } from "./components/ui/card";
import { ChartContainer, ChartTooltip, ChartTooltipContent, type ChartConfig } from "./components/ui/chart";

const config = { count: { label: "Assessments", color: "var(--chart-1)" } } satisfies ChartConfig;

export function RuleUsageChart({ rules }: { rules: RuleUsage[] | null }) {
  const rows = rules?.filter(rule => rule.count > 0).sort((a, b) => b.count - a.count || a.name.localeCompare(b.name)) ?? [];
  return <Card><CardHeader className="flex flex-row items-center justify-between gap-3"><h2 className="font-semibold leading-none tracking-tight">Assessments by rule</h2><span className="text-xs text-muted-foreground">All time</span></CardHeader><CardContent>
    {rules === null ? <p role="status" className="py-12 text-center text-sm text-muted-foreground">Loading rule usage…</p>
      : rows.length === 0 ? <p className="py-12 text-center text-sm text-muted-foreground">No assessments scored yet.</p>
      : rows.length === 1 ? <div className="flex flex-wrap items-baseline justify-between gap-2 py-5"><span className="font-medium break-words">{rows[0]!.name}</span><strong className="text-3xl tabular-nums">{rows[0]!.count.toLocaleString()}</strong></div>
      : <ChartContainer config={config} style={{ height: Math.max(176, rows.length * 48) }}>
        <BarChart accessibilityLayer data={rows} layout="vertical" margin={{ left: 0, right: 24 }}>
          <CartesianGrid horizontal={false} stroke="var(--border)" />
          <XAxis type="number" allowDecimals={false} tickLine={false} axisLine={false} />
          <YAxis type="category" dataKey="name" width={180} tickLine={false} axisLine={false} tickFormatter={value => String(value).length > 25 ? `${String(value).slice(0, 22)}…` : String(value)} />
          <ChartTooltip content={props => <ChartTooltipContent {...props} />} />
          <Bar name="Assessments" dataKey="count" fill="var(--color-count)" radius={[0, 4, 4, 0]} />
        </BarChart>
      </ChartContainer>}
  </CardContent></Card>;
}
