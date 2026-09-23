import { Input } from "./components/ui/input";
import { Field, FieldLabel } from "./components/ui/field";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "./components/ui/select";
import { useId } from "react";

export function tokenExpiry(preset: string, date: string) {
  if (preset === "never") return { expiresAt: null };
  if (preset !== "custom") return { expiresInMinutes: Number(preset) * 1440 };
  if (!date) throw new Error("Choose an expiry date.");
  const expiry = new Date(`${date}T23:59:59.999`);
  if (!Number.isFinite(expiry.getTime()) || expiry.getTime() <= Date.now()) throw new Error("Choose today or a future expiry date.");
  return { expiresAt: expiry.toISOString() };
}
export function TokenExpirySelect({ value, date, onValueChange, onDateChange, disabled = false }: { value: string; date: string; onValueChange: (value: string) => void; onDateChange: (value: string) => void; disabled?: boolean }) {
  const id = useId();
  const today = new Date();
  const minimum = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-${String(today.getDate()).padStart(2, "0")}`;
  return <div className="grid gap-3 sm:grid-cols-2">
    <Field><FieldLabel htmlFor={id}>Token expiry<span aria-hidden="true" className="ml-1 text-destructive">*</span></FieldLabel>
      <Select value={value} onValueChange={onValueChange} disabled={disabled}><SelectTrigger id={id}><SelectValue /></SelectTrigger><SelectContent>
        {[7, 30, 90, 180, 360].map(days => <SelectItem key={days} value={String(days)}>{days} days</SelectItem>)}
        <SelectItem value="custom">Custom date</SelectItem><SelectItem value="never">No expiry</SelectItem>
      </SelectContent></Select>
    </Field>
    {value === "custom" && <Field><FieldLabel htmlFor={`${id}-date`}>Expiry date<span aria-hidden="true" className="ml-1 text-destructive">*</span></FieldLabel><Input id={`${id}-date`} type="date" min={minimum} value={date} onChange={event => onDateChange(event.target.value)} required disabled={disabled} /></Field>}
  </div>;
}
