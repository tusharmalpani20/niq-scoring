import type { CSSProperties, ReactElement } from "react";
import { ResponsiveContainer, Tooltip, type TooltipContentProps } from "recharts";
import { cn } from "@/lib/utils";

export type ChartConfig = Record<string, { label: string; color: string }>;

export function ChartContainer({ config, children, className }: { config: ChartConfig; children: ReactElement; className?: string }) {
  const colors = Object.fromEntries(Object.entries(config).map(([key, value]) => [`--color-${key}`, value.color])) as CSSProperties;
  return <div className={cn("h-56 w-full min-w-0", className)} style={colors}><ResponsiveContainer width="100%" height="100%">{children}</ResponsiveContainer></div>;
}

export const ChartTooltip = Tooltip;

export function ChartTooltipContent({ active, payload, label }: TooltipContentProps) {
  if (!active || !payload?.length) return null;
  return <div className="min-w-36 space-y-1 rounded-lg border bg-background p-2 text-xs shadow-sm"><p className="font-medium">{label}</p>{payload.map(item => <div key={String(item.dataKey)} className="flex items-center justify-between gap-4"><span className="flex items-center gap-2 text-muted-foreground"><span className="size-2 rounded-sm" style={{ backgroundColor: item.color }} />{item.name}</span><strong className="tabular-nums text-foreground">{Number(item.value).toLocaleString()}</strong></div>)}</div>;
}
