import { Alert, AlertDescription } from "./components/ui/alert";
import { Textarea } from "./components/ui/textarea";
import { zodResolver } from "@hookform/resolvers/zod";
import {
  Controller,
  useForm,
  type Control,
  type FieldValues,
  type Path,
} from "react-hook-form";
import {
  Field as ShadcnField,
  FieldLabel,
  FieldDescription,
  FieldError,
} from "./components/ui/field";
import { dataFormSchema } from "./form-validation";
import { useId, useState, type ReactNode } from "react";
import { Button } from "./components/ui/button";
import { NativeSelect, NativeSelectOption } from "./components/ui/native-select";
import { Input } from "./components/ui/input";
import { PasswordInput } from "./components/ui/password-input";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from "./components/ui/card";
import { message } from "./api";
export function Panel({
  title,
  description,
  children,
}: {
  title: string;
  description?: string | undefined;
  children: ReactNode;
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>{title}</CardTitle>
        {description && <CardDescription>{description}</CardDescription>}
      </CardHeader>
      <CardContent>{children}</CardContent>
    </Card>
  );
}
export function ErrorNotice({ error }: { error: string }) {
  return error ? (
    <Alert variant="destructive"><AlertDescription>{error}</AlertDescription></Alert>
  ) : null;
}
export function FormInput<T extends FieldValues>({
  control,
  name,
  label,
  description,
  ...props
}: Omit<
  React.ComponentProps<typeof Input>,
  "name" | "value" | "defaultValue" | "onChange"
> & {
  control: Control<T>;
  name: Path<T>;
  label: string;
  description?: string | undefined;
}) {
  const id = useId();
  const InputControl = props.type === "password" ? PasswordInput : Input;
  return (
    <Controller
      control={control}
      name={name}
      render={({ field, fieldState }) => (
        <ShadcnField data-invalid={fieldState.invalid}>
          <FieldLabel htmlFor={id}>{label}</FieldLabel>
          <InputControl
            {...props}
            {...field}
            {...(props.type === "password"
              ? { visibilityLabel: label.toLowerCase() }
              : {})}
            id={id}
            aria-invalid={fieldState.invalid}
            aria-describedby={
              [
                description ? `${id}-description` : "",
                fieldState.error ? `${id}-error` : "",
              ]
                .filter(Boolean)
                .join(" ") || undefined
            }
          />
          {description && (
            <FieldDescription id={`${id}-description`}>
              {description}
            </FieldDescription>
          )}
          {fieldState.error && (
            <FieldError id={`${id}-error`} errors={[fieldState.error]} />
          )}
        </ShadcnField>
      )}
    />
  );
}
export function Secret({
  label,
  value,
  expiresAt,
  onDismiss,
}: {
  label: string;
  value: string;
  expiresAt: string;
  onDismiss: () => void;
}) {
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState("");
  return (
    <ShadcnField className="min-w-0">
      <FieldLabel>{label}</FieldLabel>
      <FieldDescription>
        Expires {new Date(expiresAt).toLocaleString()}.
      </FieldDescription>
      <Textarea className="min-w-0 max-w-full resize-none field-sizing-fixed break-all" rows={4} aria-label={label} readOnly value={value} />
      <div className="actions">
        <Button
          type="button"
          onClick={async () => {
            try {
              await navigator.clipboard.writeText(value);
              setCopied(true);
            } catch {
              setError("Copy was unavailable. Select and copy the text above.");
            }
          }}
        >
          {copied ? "Copied" : "Copy"}
        </Button>
        <Button variant="outline" type="button" onClick={onDismiss}>
          Dismiss
        </Button>
      </div>
      <ErrorNotice error={error} />
    </ShadcnField>
  );
}
export function DataForm({
  title,
  fields,
  defaults = {},
  options = {},
  onSubmit,
}: {
  title: string;
  fields: string[];
  defaults?: Record<string, string>;
  options?: Record<string, Array<{ value: string; label: string }>>;
  onSubmit: (body: Record<string, string>) => Promise<void>;
}) {
  const form = useForm<Record<string, string>>({
    resolver: zodResolver(dataFormSchema(fields, title)),
    defaultValues: Object.fromEntries(
      fields.map((name) => [name, defaults[name] ?? ""]),
    ),
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [saved, setSaved] = useState(false);
  async function submit(values: Record<string, string>) {
    setBusy(true);
    setError("");
    setSaved(false);
    try {
      await onSubmit(values);
      setSaved(true);
    } catch (c) {
      setError(message(c));
    } finally {
      setBusy(false);
    }
  }
  return (
    <Panel title={title}>
      <form
        noValidate
        onSubmit={form.handleSubmit(submit)}
        className="form-stack"
      >
        {fields.map((f) => options[f] ? (
          <Controller
            key={f}
            control={form.control}
            name={f}
            render={({ field, fieldState }) => (
              <ShadcnField data-invalid={fieldState.invalid}>
                <FieldLabel htmlFor={`${f}-select`}>{f === "clientId" ? "Client" : f}</FieldLabel>
                <NativeSelect
                  {...field}
                  id={`${f}-select`}
                  aria-invalid={fieldState.invalid}
                  aria-describedby={fieldState.error ? `${f}-error` : undefined}
                >
                  <NativeSelectOption value="">Select a client</NativeSelectOption>
                  {options[f]?.map((option) => (
                    <NativeSelectOption key={option.value} value={option.value}>{option.label}</NativeSelectOption>
                  ))}
                </NativeSelect>
                {fieldState.error && <FieldError id={`${f}-error`} errors={[fieldState.error]} />}
              </ShadcnField>
            )}
          />
        ) : (
          <FormInput
            control={form.control}
            name={f}
            key={f}
            label={f
              .replace(/([A-Z])/g, " $1")
              .replace(/^./, (s) => s.toUpperCase())}
            required={f !== "monthlyLimit"}
            type={f === "monthlyLimit" ? "number" : "text"}
            min={f === "monthlyLimit" ? 0 : undefined}
            description={
              f === "monthlyLimit"
                ? "Leave empty for unlimited usage."
                : undefined
            }
          />
        ))}
        <ErrorNotice error={error} />
        {saved && <p role="status">Saved successfully.</p>}
        <Button disabled={busy}>{busy ? "Saving…" : "Save"}</Button>
      </form>
    </Panel>
  );
}
