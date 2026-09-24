import { Bar, BarChart, CartesianGrid, XAxis, YAxis } from "recharts";
import type { UsageMonth } from "./client-usage";
import { Card, CardContent, CardHeader, CardTitle } from "./components/ui/card";
import { ChartContainer, ChartTooltip, ChartTooltipContent, type ChartConfig } from "./components/ui/chart";

const config = {
  assessments: { label: "Assessments", color: "var(--chart-1)" },
  vitalIq: { label: "Vital IQ", color: "var(--chart-2)" },
} satisfies ChartConfig;

export function UsageChart({ monthly, title = "Usage over time" }: { monthly: UsageMonth[] | null; title?: string }) {
  const rows = monthly?.map(item => ({ ...item, label: new Date(`${item.month}-01T00:00:00Z`).toLocaleDateString(undefined, { month: "short", year: "numeric", timeZone: "UTC" }) })) ?? [];
  return <Card><CardHeader className="flex flex-row items-center justify-between gap-3"><CardTitle>{title}</CardTitle><span className="text-xs text-muted-foreground">Last 6 months</span></CardHeader><CardContent>
    {monthly === null ? <p role="status" className="py-16 text-center text-sm text-muted-foreground">Loading usage…</p> : rows.length === 0 ? <p className="py-16 text-center text-sm text-muted-foreground">No usage data is available.</p> : <>
      <ChartContainer config={config}>
        <BarChart accessibilityLayer data={rows} margin={{ left: 0, right: 10 }}>
          <CartesianGrid vertical={false} stroke="var(--border)" />
          <XAxis dataKey="label" tickLine={false} axisLine={false} tickMargin={8} tickFormatter={value => String(value).slice(0, 3)} />
          <YAxis allowDecimals={false} width={32} tickLine={false} axisLine={false} />
          <ChartTooltip content={props => <ChartTooltipContent {...props} />} />
          <Bar name="Assessments" dataKey="assessments" fill="var(--color-assessments)" maxBarSize={20} radius={4} />
          <Bar name="Vital IQ" dataKey="vitalIq" fill="var(--color-vitalIq)" maxBarSize={20} radius={4} />
        </BarChart>
      </ChartContainer>
      <div className="mt-3 flex flex-wrap justify-center gap-5 text-xs text-muted-foreground"><span className="flex items-center gap-2"><span className="size-2 rounded-sm bg-primary" />Assessments</span><span className="flex items-center gap-2"><span className="size-2 rounded-sm" style={{ backgroundColor: config.vitalIq.color }} />Vital IQ</span></div>
    </>}
  </CardContent></Card>;
}
