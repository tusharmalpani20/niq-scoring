import { useEffect, useMemo, useState } from "react";
import { Pencil, Plus, Search, Trash2 } from "lucide-react";
import { request, message } from "./api";
import { ErrorNotice } from "./shared";
import { Button } from "./components/ui/button";
import { Card, CardContent } from "./components/ui/card";
import { Input } from "./components/ui/input";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "./components/ui/dialog";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "./components/ui/alert-dialog";

export type CatalogProduct = { id: string; name: string; createdAt: string; updatedAt: string };

export function Products() {
  const [products, setProducts] = useState<CatalogProduct[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [query, setQuery] = useState("");
  const [editing, setEditing] = useState<CatalogProduct | "new" | null>(null);
  const [name, setName] = useState("");
  const [formError, setFormError] = useState("");
  const [deleting, setDeleting] = useState<CatalogProduct | null>(null);
  const [busy, setBusy] = useState(false);
  const filtered = useMemo(() => products.filter(product => product.name.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase())), [products, query]);

  async function refresh() {
    setLoadError("");
    try {
      const result = await request<{ products: CatalogProduct[] }>("/admin/products");
      setProducts(result.products);
    } catch (cause) { setLoadError(message(cause)); }
    finally { setLoading(false); }
  }
  useEffect(() => { void refresh(); }, []);
  function open(product?: CatalogProduct) {
    setEditing(product ?? "new");
    setName(product?.name ?? "");
    setFormError("");
  }
  function close() { if (!busy) { setEditing(null); setFormError(""); } }
  async function save() {
    if (!editing || busy) return;
    const value = name.trim();
    if (!value) { setFormError("Enter a product name."); return; }
    setBusy(true); setFormError("");
    try {
      if (editing === "new") await request("/admin/products", { name: value });
      else await request(`/admin/products/${editing.id}`, { name: value }, "PUT");
      setEditing(null);
      await refresh();
    } catch (cause) { setFormError(message(cause)); }
    finally { setBusy(false); }
  }
  async function remove() {
    if (!deleting || busy) return;
    setBusy(true); setFormError("");
    try {
      await request(`/admin/products/${deleting.id}`, {}, "DELETE");
      setDeleting(null);
      await refresh();
    } catch (cause) { setFormError(message(cause)); }
    finally { setBusy(false); }
  }

  return <section className="space-y-5" aria-label="Products catalogue">
    <div className="flex flex-wrap items-center justify-between gap-3 border-b pb-3">
      <h2 className="text-lg font-semibold">Products {!loading && !loadError && <span className="ml-1 text-sm font-normal text-muted-foreground">{products.length}</span>}</h2>
      <div className="flex min-w-0 flex-1 items-center justify-end gap-2 sm:flex-none">
        <label className="relative block min-w-0 w-full max-w-xs sm:w-72"><span className="sr-only">Search products</span><Search className="pointer-events-none absolute left-3 top-3 size-4 text-muted-foreground" aria-hidden="true" /><Input className="pl-9" placeholder="Search products…" value={query} onChange={event => setQuery(event.target.value)} /></label>
        <Button size="icon" aria-label="Add product" title="Add product" disabled={loading || !!loadError} onClick={() => open()}><Plus aria-hidden="true" /></Button>
      </div>
    </div>
    {loadError && <div className="space-y-2"><ErrorNotice error={loadError} /><Button variant="outline" onClick={() => void refresh()}>Try again</Button></div>}
    {loading ? <p role="status" className="text-sm text-muted-foreground">Loading products…</p> : !loadError && <Card><CardContent className="divide-y px-0 py-0">{filtered.map(product => <div key={product.id} className="flex items-center justify-between gap-3 px-5 py-3"><span className="min-w-0 break-words font-medium">{product.name}</span><div className="flex shrink-0 gap-1"><Button variant="ghost" size="icon" aria-label={`Edit ${product.name}`} onClick={() => open(product)}><Pencil className="size-4" /></Button><Button variant="ghost" size="icon" className="text-destructive" aria-label={`Delete ${product.name}`} onClick={() => { setFormError(""); setDeleting(product); }}><Trash2 className="size-4" /></Button></div></div>)}{filtered.length === 0 && <p className="px-5 py-8 text-center text-sm text-muted-foreground">{products.length ? "No products match your search." : "No products yet. Add a name to use in product plans."}</p>}</CardContent></Card>}
    <Dialog open={editing !== null} onOpenChange={next => { if (!next) close(); }}><DialogContent><DialogHeader><DialogTitle>{editing === "new" ? "Add product" : "Edit product"}</DialogTitle><DialogDescription className="sr-only">Enter the product name.</DialogDescription></DialogHeader><form onSubmit={event => { event.preventDefault(); void save(); }} className="space-y-4"><label className="block space-y-1.5 text-sm"><span className="font-medium">Name</span><Input autoFocus maxLength={120} value={name} onChange={event => setName(event.target.value)} /></label>{formError && <p role="alert" className="text-sm text-destructive">{formError}</p>}<DialogFooter><Button type="button" variant="outline" disabled={busy} onClick={close}>Cancel</Button><Button type="submit" disabled={busy || !name.trim()}>{busy ? "Saving…" : "Save product"}</Button></DialogFooter></form></DialogContent></Dialog>
    <AlertDialog open={deleting !== null} onOpenChange={next => { if (!next && !busy) setDeleting(null); }}><AlertDialogContent><AlertDialogHeader><AlertDialogTitle>Delete {deleting?.name}?</AlertDialogTitle><AlertDialogDescription>The name will no longer be available for new product plans. Saved rules keep their existing product names.</AlertDialogDescription></AlertDialogHeader>{formError && <p role="alert" className="text-sm text-destructive">{formError}</p>}<AlertDialogFooter><AlertDialogCancel disabled={busy}>Cancel</AlertDialogCancel><AlertDialogAction variant="destructive" disabled={busy} onClick={event => { event.preventDefault(); void remove(); }}>Delete product</AlertDialogAction></AlertDialogFooter></AlertDialogContent></AlertDialog>
  </section>;
}
