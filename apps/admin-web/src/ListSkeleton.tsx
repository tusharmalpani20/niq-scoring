import { Card, CardContent } from "./components/ui/card";
import { Skeleton } from "./components/ui/skeleton";

/** Mirrors the table and card layouts used by record lists at the 700px breakpoint. */
export function ListSkeleton({ label, columns = 4, rows = 5 }: { label: string; columns?: number; rows?: number }) {
  return <div role="status" aria-label={`Loading ${label}`}>
    <Card className="hidden min-[701px]:block"><CardContent className="pt-6">
      <div className="grid gap-0" aria-hidden="true">
        <div className="flex gap-6 border-b bg-muted/40 px-2 py-3">{Array.from({ length: columns }, (_, index) => <Skeleton key={index} className="h-3 min-w-0 flex-1" />)}</div>
        {Array.from({ length: rows }, (_, row) => <div key={row} className="flex gap-6 border-b px-2 py-5 last:border-0">{Array.from({ length: columns }, (_, column) => <Skeleton key={column} className={`h-4 min-w-0 flex-1 ${column === 0 ? "max-w-48" : "max-w-32"}`} />)}</div>)}
      </div>
    </CardContent></Card>
    <div className="grid gap-3 min-[701px]:hidden" aria-hidden="true">{Array.from({ length: Math.min(rows, 4) }, (_, row) => <Card key={row}><CardContent className="space-y-4 py-5">
      <Skeleton className="h-5 w-2/3" />
      <div className="border-t pt-4 space-y-3">{Array.from({ length: Math.min(columns - 1, 4) }, (_, column) => <div key={column} className="flex items-center justify-between gap-6"><Skeleton className="h-3 w-20" /><Skeleton className="h-4 w-24" /></div>)}</div>
    </CardContent></Card>)}</div>
  </div>;
}
