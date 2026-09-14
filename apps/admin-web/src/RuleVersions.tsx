import { useState } from "react";
import { X } from "lucide-react";
import type { Overview } from "./Operations";
import { paginate } from "./pagination";
import { Badge } from "./components/ui/badge";
import { Button } from "./components/ui/button";
import { Card, CardContent } from "./components/ui/card";
import { Input } from "./components/ui/input";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "./components/ui/tabs";
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from "./components/ui/table";
import { Pagination, PaginationContent, PaginationItem } from "./components/ui/pagination";

export function RuleVersions({ data }: { data: Overview }) {
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const query = search.trim().toLowerCase();
  const versions = paginate(data.versions.filter(version => version.version.toLowerCase().includes(query)), page);
  return <Tabs defaultValue="versions" className="gap-5">
    <div className="flex items-center justify-between gap-3">
      <TabsList variant="line" aria-label="Rule version management" className="shrink-0 p-0">
        <TabsTrigger value="versions" className="rounded-none border-0 px-1 shadow-none data-[state=active]:text-primary after:bg-primary">Rule versions <Badge variant="secondary" className="px-1.5 py-0 text-xs tabular-nums">{data.versions.length}</Badge></TabsTrigger>
      </TabsList>
      <div className="relative min-w-0 w-full max-w-xs">
        <Input aria-label="Search rule versions" placeholder="Search versions…" value={search} onChange={event => { setSearch(event.target.value); setPage(1); }} className="pr-9" />
        {search && <Button type="button" variant="ghost" size="icon" aria-label="Clear search" className="absolute right-0 top-0 size-9 text-muted-foreground hover:text-foreground" onClick={() => { setSearch(""); setPage(1); }}><X className="size-4" aria-hidden="true" /></Button>}
      </div>
    </div>
    <TabsContent value="versions" className="space-y-5">
      <Card><CardContent className="pt-6"><Table>
        <TableHeader><TableRow><TableHead>Version</TableHead><TableHead>Status</TableHead><TableHead className="text-right">Clinical use</TableHead></TableRow></TableHeader>
        <TableBody>
          {versions.rows.map(version => <TableRow key={version.id}>
            <TableCell className="font-medium">{version.version}</TableCell>
            <TableCell><Badge variant={version.lifecycle === "APPROVED" || version.lifecycle === "ACTIVE" ? "default" : "secondary"}>{version.lifecycle.charAt(0) + version.lifecycle.slice(1).toLowerCase()}</Badge></TableCell>
            <TableCell className="text-right"><span className={version.clinicalUsePermitted ? "text-primary" : "text-destructive"}>{version.clinicalUsePermitted ? "Permitted" : "Prohibited"}</span></TableCell>
          </TableRow>)}
          {versions.total === 0 && <TableRow><TableCell colSpan={3} className="h-32 text-center text-muted-foreground">{data.versions.length ? "No rule versions match your search." : "No rule versions configured."}</TableCell></TableRow>}
        </TableBody>
      </Table></CardContent></Card>
      <Pagination aria-label="Rule versions pagination"><PaginationContent>
        <PaginationItem><Button variant="outline" size="sm" disabled={versions.page === 1} onClick={() => setPage(versions.page - 1)}>Previous</Button></PaginationItem>
        <PaginationItem><span className="flex flex-col items-center gap-1 px-2 text-xs text-muted-foreground sm:block sm:px-3 sm:text-sm" role="status"><span className="whitespace-nowrap">Page {versions.page} of {versions.pageCount}</span><span className="whitespace-nowrap"><span className="hidden sm:inline"> · </span>{versions.total} total</span></span></PaginationItem>
        <PaginationItem><Button variant="outline" size="sm" disabled={versions.page === versions.pageCount} onClick={() => setPage(versions.page + 1)}>Next</Button></PaginationItem>
      </PaginationContent></Pagination>
    </TabsContent>
  </Tabs>;
}
