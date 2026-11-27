import { useEffect, useRef, useState } from "react";
import { Pencil, Plus, Search, Trash2 } from "lucide-react";
import type { ToxicityWorkbook } from "@niq-scoring/contracts/toxicity-workbook";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "../components/ui/alert-dialog";
import { Button } from "../components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "../components/ui/dialog";
import { Input } from "../components/ui/input";
import { Textarea } from "../components/ui/textarea";

type Reference = ToxicityWorkbook["references"][number];
type Props = {
  workbook: ToxicityWorkbook;
  selectedReferenceId: string | null;
  disabled: boolean;
  onChange: (workbook: ToxicityWorkbook) => void;
};

export function ToxicityWorkbookReferences({ workbook, selectedReferenceId, disabled, onChange }: Props) {
  const [search, setSearch] = useState("");
  const [editing, setEditing] = useState<(Reference & { isNew: boolean }) | null>(null);
  const [deleting, setDeleting] = useState<Reference | null>(null);
  const selectedRow = useRef<HTMLLIElement>(null);

  useEffect(() => {
    selectedRow.current?.focus({ preventScroll: true });
    selectedRow.current?.scrollIntoView?.({ block: "nearest" });
  }, [selectedReferenceId]);

  const usedIds = new Set(workbook.rules.flatMap(rule =>
    Object.values(rule.variants).flatMap(variant => variant.referenceIds)));
  const nextId = 1 + Math.max(0, ...workbook.references.map(({ id }) => id === "P" ? 0 : Number(id)));
  const mayAdd = nextId <= 999 && workbook.references.length < 100;
  const query = search.trim().toLocaleLowerCase();
  const visibleReferences = workbook.references.filter(ref => ref.id === selectedReferenceId ||
    ref.id.toLocaleLowerCase().includes(query) || ref.text.toLocaleLowerCase().includes(query));

  function saveReference() {
    if (disabled || !editing?.text.trim()) return;
    const reference = { id: editing.id, text: editing.text };
    if (editing.isNew && (!mayAdd || workbook.references.some(ref => ref.id === reference.id))) return;
    const references = editing.isNew
      ? [...workbook.references, reference]
      : workbook.references.map(ref => ref.id === reference.id ? reference : ref);
    onChange({ ...workbook, references });
    if (editing.isNew) setSearch("");
    setEditing(null);
  }

  function deleteReference() {
    if (!disabled && deleting && !usedIds.has(deleting.id)) {
      onChange({ ...workbook, references: workbook.references.filter(ref => ref.id !== deleting.id) });
    }
    setDeleting(null);
  }

  return <section className="min-w-0 space-y-4 rounded-2xl bg-card p-4 shadow-sm sm:p-6" aria-label="References">
    <div className="flex flex-wrap items-center justify-between gap-3">
      <h2 className="text-lg font-medium">References</h2>
      {!disabled && <Button type="button" disabled={!mayAdd} onClick={() => setEditing({ id: String(nextId), text: "", isNew: true })}>
        <Plus aria-hidden="true" /> Add reference
      </Button>}
    </div>
    <div className="relative max-w-sm">
      <Search className="pointer-events-none absolute top-2.5 left-3 size-4 text-muted-foreground" aria-hidden="true" />
      <Input className="pl-9" aria-label="Search references" placeholder="Search references…" value={search} onChange={event => setSearch(event.target.value)} />
    </div>
    {visibleReferences.length ? <ul className="divide-y overflow-hidden rounded-lg border">
      {visibleReferences.map(reference => {
        const selected = reference.id === selectedReferenceId;
        const inUse = usedIds.has(reference.id);
        return <li key={reference.id} ref={selected ? selectedRow : undefined} tabIndex={-1} aria-current={selected || undefined}
          className={`flex scroll-m-3 items-start gap-3 p-3 focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset ${selected ? "bg-primary/10" : ""}`}>
          <span className="min-w-10 shrink-0 rounded-md bg-muted px-2 py-1 text-center text-xs font-semibold">[{reference.id}]</span>
          <p className="min-w-0 flex-1 text-sm break-words whitespace-pre-wrap">{reference.text}</p>
          {!disabled && <div className="flex shrink-0 gap-1">
            <Button type="button" variant="ghost" size="icon" aria-label={`Edit reference ${reference.id}`} title="Edit reference"
              onClick={() => setEditing({ ...reference, isNew: false })}><Pencil aria-hidden="true" /></Button>
            <Button type="button" variant="ghost" size="icon" aria-label={`Delete reference ${reference.id}`} title="Delete reference"
              disabled={inUse} onClick={() => setDeleting(reference)}><Trash2 aria-hidden="true" /></Button>
            {inUse && <span className="sr-only">This reference is linked to drug-class guidance.</span>}
          </div>}
        </li>;
      })}
    </ul> : <p className="rounded-lg border p-4 text-sm text-muted-foreground">
      {query ? "No references match your search." : "No references have been added."}
    </p>}
    {!disabled && !mayAdd && <p className="text-sm text-muted-foreground">The reference limit has been reached.</p>}

    <Dialog open={Boolean(editing) && !disabled} onOpenChange={open => { if (!open) setEditing(null); }}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{editing?.isNew ? "Add reference" : "Edit reference"}</DialogTitle>
          <DialogDescription>Reference [{editing?.id}]</DialogDescription>
        </DialogHeader>
        <label className="grid gap-2 text-sm font-medium">Citation
          <Textarea autoFocus rows={6} maxLength={12000} value={editing?.text ?? ""}
            onChange={event => setEditing(current => current && { ...current, text: event.target.value })} />
        </label>
        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => setEditing(null)}>Cancel</Button>
          <Button type="button" disabled={!editing?.text.trim()} onClick={saveReference}>{editing?.isNew ? "Add reference" : "Apply changes"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>

    <AlertDialog open={Boolean(deleting) && !disabled} onOpenChange={open => { if (!open) setDeleting(null); }}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Delete reference [{deleting?.id}]?</AlertDialogTitle>
          <AlertDialogDescription>This removes the reference from the current rule draft.</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <AlertDialogAction variant="destructive" onClick={deleteReference}>Delete reference</AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  </section>;
}
