import { useEffect, useMemo, useState } from "react";
import { Pencil, Plus, Search, Trash2 } from "lucide-react";
import { request, message } from "./api";
import { ErrorNotice } from "./shared";
import { Button } from "./components/ui/button";
import { Card, CardContent } from "./components/ui/card";
import { Input } from "./components/ui/input";
import { Textarea } from "./components/ui/textarea";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "./components/ui/dialog";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "./components/ui/alert-dialog";

export type CatalogProduct = {
  id: string;
  name: string;
  description: string | null;
  aliases: string[];
  benefits: string[];
  imageDataUrl: string | null;
  createdAt: string;
  updatedAt: string;
};

function readImage(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => typeof reader.result === "string" ? resolve(reader.result) : reject(new Error("Could not read this image. Please choose it again."));
    reader.onerror = () => reject(new Error("Could not read this image. Please choose it again."));
    reader.readAsDataURL(file);
  });
}

export function Products() {
  const [products, setProducts] = useState<CatalogProduct[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [query, setQuery] = useState("");
  const [editing, setEditing] = useState<CatalogProduct | "new" | null>(null);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [benefits, setBenefits] = useState<string[]>([]);
  const [imageUrl, setImageUrl] = useState<string | null>(null);
  const [imageLoading, setImageLoading] = useState(false);
  const [formError, setFormError] = useState("");
  const [deleting, setDeleting] = useState<CatalogProduct | null>(null);
  const [busy, setBusy] = useState(false);
  const locked = busy || imageLoading;
  const filtered = useMemo(() => products.filter(product =>
    [product.name, ...product.aliases, product.description ?? "", ...(product.benefits ?? [])].some(value => value.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase()))), [products, query]);

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
    setDescription(product?.description ?? "");
    setBenefits(product?.benefits ?? []);
    setImageUrl(product?.imageDataUrl ?? null);
    setFormError("");
  }
  function close() { if (!locked) { setEditing(null); setFormError(""); } }
  async function selectImage(file?: File) {
    if (!file || locked) return;
    if (!["image/jpeg", "image/png", "image/webp"].includes(file.type)) {
      setFormError("Choose a JPEG, PNG, or WebP image."); return;
    }
    if (file.size > 5 * 1024 * 1024) { setFormError("Choose an image up to 5 MB."); return; }
    setImageLoading(true); setFormError("");
    try { setImageUrl(await readImage(file)); }
    catch (cause) { setFormError(message(cause)); }
    finally { setImageLoading(false); }
  }
  async function save() {
    if (!editing || locked) return;
    const value = name.trim();
    if (!value) { setFormError("Enter a product name."); return; }
    // Hidden legacy aliases are deliberately omitted so editing does not erase rule-name matching.
    const body = { name: value, description: description.trim() || null, benefits: benefits.map(benefit => benefit.trim()).filter(Boolean), imageDataUrl: imageUrl };
    setBusy(true); setFormError("");
    try {
      if (editing === "new") await request("/admin/products", body);
      else await request(`/admin/products/${editing.id}`, body, "PUT");
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
    {loading ? <p role="status" className="text-sm text-muted-foreground">Loading products…</p> : !loadError && <Card><CardContent className="divide-y px-0 py-0">
      {filtered.map(product => <div key={product.id} className="flex items-start justify-between gap-3 px-5 py-3">
        <div className="flex min-w-0 items-start gap-4">
          {product.imageDataUrl && <img src={product.imageDataUrl} alt={product.name} loading="lazy" className="size-20 shrink-0 rounded-md border bg-white object-contain p-1" />}
          <div className="min-w-0"><p className="break-words font-medium">{product.name}</p>
            {product.description && <p className="mt-1 text-sm text-muted-foreground">{product.description}</p>}
            {!!product.benefits?.length && <ul aria-label={`${product.name} benefits`} className="mt-2 list-disc space-y-1 pl-5 text-sm text-muted-foreground">{product.benefits.map((benefit, index) => <li key={index} className="break-words">{benefit}</li>)}</ul>}
          </div>
        </div>
        <div className="flex shrink-0 gap-1"><Button variant="ghost" size="icon" aria-label={`Edit ${product.name}`} onClick={() => open(product)}><Pencil className="size-4" /></Button><Button variant="ghost" size="icon" className="text-destructive" aria-label={`Delete ${product.name}`} onClick={() => { setFormError(""); setDeleting(product); }}><Trash2 className="size-4" /></Button></div>
      </div>)}
      {filtered.length === 0 && <p className="px-5 py-8 text-center text-sm text-muted-foreground">{products.length ? "No products match your search." : "No products yet. Add a name to use in product plans."}</p>}
    </CardContent></Card>}
    <Dialog open={editing !== null} onOpenChange={next => { if (!next) close(); }}><DialogContent className="max-h-[90dvh] overflow-y-auto" showCloseButton={!locked}>
      <DialogHeader><DialogTitle>{editing === "new" ? "Add product" : "Edit product"}</DialogTitle><DialogDescription>Maintain product details, benefits, and an image. Put dose and timing in the rule plan.</DialogDescription></DialogHeader>
      <form onSubmit={event => { event.preventDefault(); void save(); }} className="space-y-4">
        <fieldset disabled={locked} className="space-y-4">
          <label className="block space-y-1.5 text-sm"><span className="font-medium">Name</span><Input autoFocus maxLength={120} value={name} onChange={event => setName(event.target.value)} /></label>
          <label className="block space-y-1.5 text-sm"><span className="font-medium">Description</span><Textarea maxLength={2000} rows={3} value={description} onChange={event => setDescription(event.target.value)} placeholder="Verified product purpose from supplied material" /></label>
          <fieldset className="space-y-2"><legend className="mb-1.5 text-sm font-medium">Benefits</legend>
            {benefits.map((benefit, index) => <div key={index} className="flex items-start gap-2">
              <span aria-hidden="true" className="pt-2">•</span>
              <Textarea aria-label={`Benefit ${index + 1}`} rows={2} maxLength={500} value={benefit} onChange={event => setBenefits(current => current.map((value, position) => position === index ? event.target.value : value))} className="min-w-0 flex-1" />
              <Button type="button" variant="ghost" size="icon" aria-label={`Remove benefit ${index + 1}`} onClick={() => setBenefits(current => current.filter((_, position) => position !== index))}><Trash2 className="size-4" /></Button>
            </div>)}
            <Button type="button" variant="outline" size="sm" disabled={benefits.length >= 20} onClick={() => setBenefits(current => [...current, ""])}><Plus className="size-4" />Add benefit</Button>
          </fieldset>
          <fieldset className="space-y-2"><legend className="mb-1.5 text-sm font-medium">Product image</legend>
            {imageUrl && <img src={imageUrl} alt={`${name || "Product"} preview`} className="h-36 w-full rounded-md border bg-white object-contain p-2" />}
            <label className="block space-y-1.5 text-sm"><span>{imageUrl ? "Replace image" : "Upload image"}</span><Input type="file" accept="image/jpeg,image/png,image/webp" onChange={event => { const file = event.target.files?.[0]; event.target.value = ""; void selectImage(file); }} /></label>
            <p className="text-xs text-muted-foreground">JPEG, PNG, or WebP, up to 5 MB. Changes are applied when you save the product.</p>
            {imageUrl && <Button type="button" variant="outline" size="sm" onClick={() => setImageUrl(null)}><Trash2 className="size-4" />Remove image</Button>}
          </fieldset>
        </fieldset>
        {formError && <p role="alert" className="text-sm text-destructive">{formError}</p>}
        <DialogFooter><Button type="button" variant="outline" disabled={locked} onClick={close}>Cancel</Button><Button type="submit" disabled={locked || !name.trim()}>{imageLoading ? "Reading image…" : busy ? "Saving…" : "Save product"}</Button></DialogFooter>
      </form>
    </DialogContent></Dialog>
    <AlertDialog open={deleting !== null} onOpenChange={next => { if (!next && !busy) setDeleting(null); }}><AlertDialogContent><AlertDialogHeader><AlertDialogTitle>Delete {deleting?.name}?</AlertDialogTitle><AlertDialogDescription>The name will no longer be available for new product plans. Saved rules keep their existing product names.</AlertDialogDescription></AlertDialogHeader>{formError && <p role="alert" className="text-sm text-destructive">{formError}</p>}<AlertDialogFooter><AlertDialogCancel disabled={busy}>Cancel</AlertDialogCancel><AlertDialogAction variant="destructive" disabled={busy} onClick={event => { event.preventDefault(); void remove(); }}>Delete product</AlertDialogAction></AlertDialogFooter></AlertDialogContent></AlertDialog>
  </section>;
}
