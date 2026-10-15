import type { ReactNode } from "react";
import type { ProductExceptionAction, ProductGuidance, ProductNoteMatch, ProductStage } from "@niq-scoring/contracts/product-guidance";
import { defaultProductExceptionAction, defaultProductNoteMatch } from "@niq-scoring/contracts/product-guidance";
import { cancerTypeOptions } from "./application-cancer-options";
import { Input } from "../components/ui/input";
import { NativeSelect } from "../components/ui/native-select";
import { Textarea } from "../components/ui/textarea";

type Exception = ProductGuidance["notes"][number];
type Option = { id: string; label: string };
type CatalogProduct = { id: string; name: string };
type ActionType = ProductExceptionAction["type"];

const fieldLabels: Record<ProductNoteMatch["fieldId"], string> = {
  cancer_type: "Type of cancer",
  cancer_surgical_status: "Cancer surgical status",
  diet_preference: "Diet preference",
};
const actionLabels: Record<ActionType, string> = {
  recommend: "Recommend a product",
  remove: "Remove a product",
  limit: "Limit daily quantity",
  replace: "Replace a product",
  delay: "Delay until surgery",
  use_plan: "Use another product plan",
};
const dietOptions: Option[] = [
  { id: "vegetarian", label: "Vegetarian" },
  { id: "non_vegetarian", label: "Non-vegetarian" },
  { id: "jain", label: "Jain" },
  { id: "eggetarian", label: "Eggetarian" },
];
const stageOptions = [
  { id: "pre_conditioning", label: "Before treatment" },
  { id: "during_treatment", label: "During treatment" },
  { id: "post_treatment", label: "After treatment" },
  { id: "surgical", label: "After surgery" },
] as const;

export function exceptionMatch(row: Exception): ProductNoteMatch {
  return row.match ?? (row.kind === "custom" ? { fieldId: "cancer_type", optionId: "" } : defaultProductNoteMatch(row.kind));
}

export function exceptionAction(row: Exception): ProductExceptionAction | null {
  return row.action ?? defaultProductExceptionAction(row.kind);
}

export function exceptionOptions(fieldId: ProductNoteMatch["fieldId"], surgeryOptions: Option[]): Option[] {
  if (fieldId === "cancer_type") return cancerTypeOptions;
  if (fieldId === "diet_preference") return dietOptions;
  return surgeryOptions.filter(option => ["cancer_surgical_status_done", "cancer_surgical_status_planned"].includes(option.id));
}

function actionProducts(action: ProductExceptionAction): string[] {
  if (action.type === "use_plan") return ["__product_plan__"];
  if (action.type === "replace") return [action.productName, action.replacementProductName].filter(Boolean).map(name => name.trim().toLocaleLowerCase());
  return [action.productName.trim().toLocaleLowerCase()];
}

export function conflictingException(row: Exception, others: Exception[]): Exception | undefined {
  if (!row.enabled) return undefined;
  const match = exceptionMatch(row);
  const action = exceptionAction(row);
  if (!match.optionId || !action) return undefined;
  const targets = actionProducts(action);
  return others.find(other => {
    if (other.id === row.id || !other.enabled) return false;
    const otherMatch = exceptionMatch(other);
    const otherAction = exceptionAction(other);
    return otherAction && otherMatch.fieldId === match.fieldId && otherMatch.optionId === match.optionId
      && actionProducts(otherAction).some(target => targets.includes(target));
  });
}

export function exceptionPreview(row: Exception, surgeryOptions: Option[]): string {
  const match = exceptionMatch(row);
  const answer = exceptionOptions(match.fieldId, surgeryOptions).find(option => option.id === match.optionId)?.label ?? "an answer";
  const surgeryWindow = match.fieldId === "cancer_surgical_status" && match.withinDays !== undefined
    ? match.optionId === "cancer_surgical_status_done" ? ` and surgery was within the last ${match.withinDays} days`
      : ` and surgery is within the next ${match.withinDays} days`
    : "";
  const when = `${fieldLabels[match.fieldId]} is ${answer}${surgeryWindow}`;
  const action = exceptionAction(row);
  if (!action) return `When ${when}, choose a product action.`;
  const product = (name: string) => name || "a product";
  let result: string;
  switch (action.type) {
    case "recommend": result = `recommend ${product(action.productName)} at ${action.quantityPerDay || "a specified"} per day`; break;
    case "remove": result = `remove ${product(action.productName)} from the selected plan`; break;
    case "limit": result = `limit ${product(action.productName)} to ${action.maxQuantityPerDay || "a specified maximum"} per day`; break;
    case "replace": result = `replace ${product(action.productName)} with ${product(action.replacementProductName)}${action.matchSourceQuantity ? ` at the same daily quantity as ${product(action.productName)}` : action.replacementQuantityPerDay ? ` at ${action.replacementQuantityPerDay} per day` : "; ask the clinician to set the replacement quantity"}`; break;
    case "delay": result = `delay ${product(action.productName)} until the planned surgery`; break;
    case "use_plan": result = `use the ${stageOptions.find(stage => stage.id === action.stage)?.label ?? action.stage} product plan for the matched nutritional status`; break;
  }
  return `When ${when}, ${result}.`;
}

export function validateException(row: Exception, catalog: CatalogProduct[], surgeryOptions: Option[]): string | null {
  const match = exceptionMatch(row);
  const action = exceptionAction(row);
  if (!row.label.trim()) return "Enter a rule name.";
  if (!exceptionOptions(match.fieldId, surgeryOptions).some(option => option.id === match.optionId)) return "Choose a valid assessment answer.";
  if (match.fieldId === "cancer_surgical_status" && (match.withinDays === undefined || !Number.isInteger(match.withinDays) || match.withinDays < 0 || match.withinDays > 3650)) return "Enter a whole-number surgery window in days.";
  if (!action) return "Choose a product action.";
  const known = (name: string) => catalog.some(item => item.name.toLocaleLowerCase() === name.trim().toLocaleLowerCase());
  const validQuantity = (quantity: number) => Number.isInteger(quantity) && quantity >= 1 && quantity <= 100;
  if (action.type !== "use_plan" && !action.productName.trim()) return "Choose a product.";
  if (action.type !== "use_plan" && catalog.length && !known(action.productName)) return "Choose a product from the shared Products list.";
  if (action.type === "recommend" && !validQuantity(action.quantityPerDay)) return "Enter a daily quantity from 1 to 100.";
  if (action.type === "limit" && !validQuantity(action.maxQuantityPerDay)) return "Enter a maximum daily quantity from 1 to 100.";
  if (action.type === "replace") {
    if (!action.replacementProductName.trim() || (catalog.length && !known(action.replacementProductName))) return "Choose a replacement from the shared Products list.";
    if (action.productName.toLocaleLowerCase() === action.replacementProductName.toLocaleLowerCase()) return "Choose a different replacement product.";
    if (action.matchSourceQuantity && action.replacementQuantityPerDay !== undefined) return "Choose matching or fixed replacement quantity.";
    if (!action.matchSourceQuantity && !validQuantity(action.replacementQuantityPerDay ?? 0)) return "Enter a replacement daily quantity from 1 to 100.";
  }
  if ((action.type === "recommend" || action.type === "replace") && (action.description?.length ?? 0) > 500) return "Keep the product description under 500 characters.";
  if (action.type === "delay" && (match.fieldId !== "cancer_surgical_status" || match.optionId !== "cancer_surgical_status_planned")) return "Delay until surgery requires Cancer surgical status → Planned.";
  if (row.kind !== "custom" && !row.guidance.trim()) return "Add an explanation for this existing rule.";
  return null;
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return <label className="block min-w-0 space-y-1.5 text-sm"><span className="font-medium">{label}</span>{children}</label>;
}

function emptyAction(type: ActionType): ProductExceptionAction {
  switch (type) {
    case "recommend": return { type, productName: "", quantityPerDay: 0 };
    case "remove": return { type, productName: "" };
    case "limit": return { type, productName: "", maxQuantityPerDay: 0 };
    case "replace": return { type, productName: "", replacementProductName: "", matchSourceQuantity: true };
    case "delay": return { type, productName: "", until: "planned_surgery" };
    case "use_plan": return { type, stage: "surgical" };
  }
}

function ProductSelect({ label, value, catalog, onChange }: { label: string; value: string; catalog: CatalogProduct[]; onChange: (value: string) => void }) {
  const names = catalog.map(item => item.name);
  if (value && !names.some(name => name.toLocaleLowerCase() === value.toLocaleLowerCase())) names.unshift(value);
  return <Field label={label}><NativeSelect value={value} onChange={event => onChange(event.target.value)}><option value="">Select a product</option>{names.map(name => <option key={name} value={name}>{name}</option>)}</NativeSelect></Field>;
}

export function ProductExceptionEditor({ row, catalog, catalogError, onRetry, surgeryOptions, others, isNew, onChange }: {
  row: Exception;
  catalog: CatalogProduct[];
  catalogError: string;
  onRetry: () => void;
  surgeryOptions: Option[];
  others: Exception[];
  isNew: boolean;
  onChange: (row: Exception) => void;
}) {
  const match = exceptionMatch(row);
  const action = exceptionAction(row);
  const conflict = conflictingException(row, others);
  const patch = (change: Partial<Exception>) => onChange({ ...row, ...change });
  const updateAction = (next: ProductExceptionAction) => patch({ action: next, guidance: action?.type !== next.type ? "" : row.guidance });
  const options = exceptionOptions(match.fieldId, surgeryOptions);
  return <div className="space-y-4">
    <Field label="Rule name"><Input value={row.label} maxLength={200} onChange={event => patch({ label: event.target.value })} /></Field>
    <section className="space-y-3 rounded-lg border p-3" aria-label="When this rule applies">
      <h3 className="font-medium">When this rule applies</h3>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Assessment field"><NativeSelect value={match.fieldId} onChange={event => { const fieldId = event.target.value as ProductNoteMatch["fieldId"]; patch({ match: { fieldId, optionId: "" }, guidance: "" }); }}>{Object.entries(fieldLabels).map(([id, label]) => <option key={id} value={id}>{label}</option>)}</NativeSelect></Field>
        <Field label="Answer"><NativeSelect value={match.optionId} onChange={event => patch({ match: { ...match, optionId: event.target.value }, guidance: "" })}><option value="">Select an answer</option>{options.map(option => <option key={option.id} value={option.id}>{option.label}</option>)}</NativeSelect></Field>
      </div>
      {match.fieldId === "cancer_surgical_status" && <Field label="Within days of surgery"><Input type="number" min={0} max={3650} step={1} value={match.withinDays ?? ""} onChange={event => patch({ match: { ...match, withinDays: event.target.value === "" ? undefined : Number(event.target.value) } })} /></Field>}
    </section>
    <section className="space-y-3 rounded-lg border p-3" aria-label="Product change">
      <h3 className="font-medium">Product change</h3>
      {catalogError && <div className="flex flex-wrap items-center gap-2 text-sm text-destructive"><span>Products could not load: {catalogError}</span><button type="button" className="underline" onClick={onRetry}>Try again</button></div>}
      <Field label="Action"><NativeSelect value={action?.type ?? ""} onChange={event => updateAction(emptyAction(event.target.value as ActionType))}><option value="">Select an action</option>{Object.entries(actionLabels).filter(([type]) => type !== "use_plan" || (!isNew && row.kind === "surgery_done_liss")).map(([type, label]) => <option key={type} value={type}>{label}</option>)}</NativeSelect></Field>
      {action && action.type !== "use_plan" && <ProductSelect label={action.type === "replace" ? "Product to replace" : "Product"} value={action.productName} catalog={catalog} onChange={productName => updateAction({ ...action, productName })} />}
      {action?.type === "recommend" && <><Field label="Quantity per day"><Input type="number" min={1} max={100} step={1} value={action.quantityPerDay || ""} onChange={event => updateAction({ ...action, quantityPerDay: Number(event.target.value) })} /></Field><Field label="Product description (optional)"><Textarea rows={2} maxLength={500} placeholder="Preparation or serving details" value={action.description ?? ""} onChange={event => updateAction({ ...action, description: event.target.value || undefined })} /></Field></>}
      {action?.type === "limit" && <Field label="Maximum quantity per day"><Input type="number" min={1} max={100} step={1} value={action.maxQuantityPerDay || ""} onChange={event => updateAction({ ...action, maxQuantityPerDay: Number(event.target.value) })} /></Field>}
      {action?.type === "replace" && <><ProductSelect label="Replacement product" value={action.replacementProductName} catalog={catalog} onChange={replacementProductName => updateAction({ ...action, replacementProductName })} /><label className="flex items-center gap-2 text-sm"><input type="checkbox" className="size-4 accent-primary" checked={action.matchSourceQuantity ?? false} onChange={event => updateAction({ ...action, matchSourceQuantity: event.target.checked, replacementQuantityPerDay: undefined })} />Match the replaced product's daily quantity</label>{!action.matchSourceQuantity && <Field label="Replacement quantity per day"><Input type="number" min={1} max={100} step={1} value={action.replacementQuantityPerDay ?? ""} onChange={event => updateAction({ ...action, replacementQuantityPerDay: event.target.value === "" ? undefined : Number(event.target.value) })} /></Field>}<Field label="Replacement times per day"><Input type="number" min={1} max={100} step={1} value={action.timesPerDay ?? ""} onChange={event => updateAction({ ...action, timesPerDay: event.target.value === "" ? undefined : Number(event.target.value) })}/></Field><Field label="Replacement timing with meals"><Input maxLength={500} value={action.mealTiming ?? ""} onChange={event => updateAction({ ...action, mealTiming: event.target.value || undefined })}/></Field><Field label="Replacement preparation"><Input maxLength={500} value={action.preparation ?? ""} onChange={event => updateAction({ ...action, preparation: event.target.value || undefined })}/></Field><Field label="Replacement description (optional)"><Textarea rows={2} maxLength={500} placeholder="Preparation or serving details" value={action.description ?? ""} onChange={event => updateAction({ ...action, description: event.target.value || undefined })} /></Field>{action.matchSourceQuantity && <p className="text-xs text-muted-foreground">The replacement uses the selected plan's quantity for {action.productName || "the replaced product"}. If that quantity is unknown, clinician review is required.</p>}</>}
      {action?.type === "remove" && <p className="text-xs text-muted-foreground">The product will be removed from the selected plan when this rule matches.</p>}
      {action?.type === "delay" && <p className="text-xs text-muted-foreground">Use Cancer surgical status → Planned and a surgery window above. The product is delayed until that date.</p>}
      {action?.type === "use_plan" && <Field label="Plan to use"><NativeSelect value={action.stage} onChange={event => updateAction({ ...action, stage: event.target.value as ProductStage })}>{stageOptions.map(stage => <option key={stage.id} value={stage.id}>{stage.label}</option>)}</NativeSelect></Field>}
    </section>
    <Field label="Additional explanation (optional)"><Textarea rows={3} value={row.guidance} onChange={event => patch({ guidance: event.target.value })} /></Field>
    <div className="rounded-lg bg-muted/50 p-3 text-sm"><p className="font-medium">Rule preview</p><p className="mt-1">{exceptionPreview(row, surgeryOptions)}</p>{row.guidance.trim() && <p className="mt-1 text-muted-foreground">{row.guidance.trim()}</p>}</div>
    {conflict && <p role="alert" className="text-sm text-destructive">Conflicts with “{conflict.label}”: both rules change the same product for this assessment answer.</p>}
  </div>;
}
