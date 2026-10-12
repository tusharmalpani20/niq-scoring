import { useState } from "react";
import { Plus, Search, Trash2 } from "lucide-react";
import { productPlanItems, type ProductPlan, type ProductPlanItem } from "@niq-scoring/contracts/product-guidance";
import { Button } from "../components/ui/button";
import { Input } from "../components/ui/input";

type CatalogProduct = { id: string; name: string };
type Props = {
  plan: ProductPlan;
  catalog: CatalogProduct[];
  catalogError: string;
  onRetry: () => void;
  onChange: (items: ProductPlanItem[]) => void;
};

const namesFromPlan = (plan: ProductPlan) => plan.productNames ?? plan.products.split(/\s+\+\s+/).map(name => name.trim()).filter(Boolean);

export function ProductPlanCart({ plan, catalog, catalogError, onRetry, onChange }: Props) {
  const [search, setSearch] = useState("");
  const [originalPreparation] = useState(() => !productPlanItems(plan).length ? plan.dose : "");
  const parsed = productPlanItems(plan);
  // Unrecognized older preparations stay visible until the editor has explicit entries.
  const legacyDose = !plan.items?.length && !parsed.length && !!plan.dose;
  const items: ProductPlanItem[] = parsed.length ? parsed : legacyDose
    ? namesFromPlan(plan).map(productName => ({ productName, quantityPerDay: undefined })) : [];
  const results = catalog.filter(product => product.name.toLocaleLowerCase().includes(search.trim().toLocaleLowerCase()));
  const selected = (name: string) => items.some(item => item.productName.toLocaleLowerCase() === name.toLocaleLowerCase());
  const change = (name: string, update: Partial<ProductPlanItem>) => onChange(items.map(item => item.productName === name ? { ...item, ...update } : item));

  return <div className="min-w-0 space-y-4">
    <section className="space-y-2" aria-label="Find products">
      <h3 className="text-sm font-medium">Add products</h3>
      <label className="relative block">
        <span className="sr-only">Search products to add</span>
        <Search className="pointer-events-none absolute left-3 top-2.5 size-4 text-muted-foreground" aria-hidden="true" />
        <Input className="pl-9" placeholder="Search products…" value={search} onChange={event => setSearch(event.target.value)} />
      </label>
      {catalogError ? <div className="space-y-2"><p role="alert" className="text-sm text-destructive">{catalogError}</p><Button type="button" variant="outline" size="sm" onClick={onRetry}>Retry</Button></div>
        : <div className="grid gap-2 sm:grid-cols-2" aria-label="Available products">
          {results.map(product => <div key={product.id} className="flex items-center justify-between gap-2 rounded-md border px-3 py-2 text-sm">
            <span className="min-w-0 break-words">{product.name}</span>
            <Button type="button" variant="outline" size="sm" className="shrink-0" disabled={selected(product.name) || items.length >= 20} aria-label={`Add ${product.name}`} onClick={() => onChange([...items, { productName: product.name, quantityPerDay: 1 }])}>
              {selected(product.name) ? "Added" : <><Plus className="size-4" aria-hidden="true" /> Add</>}
            </Button>
          </div>)}
          {!results.length && <p className="text-sm text-muted-foreground">{catalog.length ? "No products match your search." : "No products available."}</p>}
        </div>}
    </section>

    <section className="space-y-2" aria-label="Selected products">
      <h3 className="text-sm font-medium">Products in this rule</h3>
      {originalPreparation && <p className="rounded-md bg-muted/50 p-2 text-xs text-muted-foreground">Existing preparation: {originalPreparation}. Enter each product's stated dosage or preparation before converting this plan.</p>}
      <div className="divide-y rounded-md border">
        {items.map(item => <div key={item.productName} className="grid min-w-0 gap-2 p-3 sm:grid-cols-[minmax(7rem,1fr)_5rem_minmax(10rem,2fr)_2rem] sm:items-end">
          <div className="flex min-w-0 items-center justify-between gap-2 sm:self-center"><span className="min-w-0 break-words text-sm font-medium">{item.productName}</span>
            <Button type="button" variant="ghost" size="icon" className="size-8 shrink-0 text-destructive sm:hidden" aria-label={`Remove ${item.productName}`} onClick={() => onChange(items.filter(row => row.productName !== item.productName))}><Trash2 className="size-4" aria-hidden="true" /></Button>
          </div>
          <label className="block space-y-1 text-xs"><span>Qty</span><Input className="h-9" type="number" min={1} max={100} step={1} required aria-label={`${item.productName} quantity`} value={item.quantityPerDay ?? ""} onChange={event => change(item.productName, { quantityPerDay: event.target.value === "" ? undefined : Number(event.target.value) })} /></label>
          <label className="block min-w-0 space-y-1 text-xs"><span>Description (optional)</span><Input className="h-9" maxLength={500} aria-label={`${item.productName} description`} value={item.description ?? ""} onChange={event => change(item.productName, { description: event.target.value || undefined })} placeholder="Preparation or serving details" /></label>
          <Button type="button" variant="ghost" size="icon" className="hidden size-9 text-destructive sm:inline-flex" aria-label={`Remove ${item.productName}`} onClick={() => onChange(items.filter(row => row.productName !== item.productName))}><Trash2 className="size-4" aria-hidden="true" /></Button>
          {!catalog.some(product => product.name.toLocaleLowerCase() === item.productName.toLocaleLowerCase()) && <p className="text-xs text-muted-foreground sm:col-span-4">This name is no longer in Products.</p>}
        </div>)}
        {!items.length && <p className="p-3 text-sm text-muted-foreground">No products added yet.</p>}
      </div>
    </section>
  </div>;
}
