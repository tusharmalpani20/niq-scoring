import { useId } from "react";
import type { RuleAnswers, RuleDefinition } from "@niq-scoring/contracts/rules";
import { prepareAnswers } from "@niq-scoring/scoring-engine/answers";
import { Input } from "../components/ui/input";
import { Textarea } from "../components/ui/textarea";
import { NativeSelect } from "../components/ui/native-select";
import { Label } from "../components/ui/label";
export function QuestionnaireFields({ definition, answers, onChange, disabled = false }: { definition: RuleDefinition; answers: RuleAnswers; onChange: (answers: RuleAnswers) => void; disabled?: boolean }) {
  const prefix = useId();
  const prepared = prepareAnswers(definition, answers);
  const answer = (id: string, value: RuleAnswers[string]) => onChange({ ...answers, [id]: value });
  return <div className="space-y-4">
    {definition.sections.map(section => <fieldset key={section.id} disabled={disabled} className="space-y-4 rounded-lg border p-4"><legend className="px-2 font-medium">{section.title}</legend>{section.description && <p className="text-sm text-muted-foreground">{section.description}</p>}
      {section.questions.filter(q => prepared.visible[q.id]).map(q => { const value = answers[q.id]; const id = `${prefix}-${q.id}`; return <div key={q.id} className="space-y-2"><Label htmlFor={id}>{q.label}{q.required ? " *" : ""}{q.unit ? ` (${q.unit})` : ""}</Label>
        {q.type === "boolean" || q.type === "single_select" ? <NativeSelect id={id} value={value == null ? "" : String(value)} onChange={e => answer(q.id, e.target.value === "" ? null : q.type === "boolean" ? e.target.value === "true" : e.target.value)}><option value="">Select an answer</option>{q.type === "boolean" ? <><option value="true">Yes</option><option value="false">No</option></> : q.options.map(o => <option key={o.id} value={o.id}>{o.label}</option>)}</NativeSelect>
        : q.type === "multi_select" ? <fieldset id={id} className="grid gap-2 sm:grid-cols-2" aria-label={q.label}>{q.options.map(o => <Label key={o.id} className="flex gap-2 font-normal"><input type="checkbox" checked={Array.isArray(value) && value.includes(o.id)} onChange={e => { const selected = Array.isArray(value) ? value : []; answer(q.id, e.target.checked ? [...selected, o.id] : selected.filter(v => v !== o.id)); }} />{o.label}</Label>)}</fieldset>
        : q.type === "long_text" ? <Textarea id={id} value={typeof value === "string" ? value : ""} maxLength={q.validation.maxLength} onChange={e => answer(q.id, e.target.value)} />
        : <Input id={id} type={q.type === "number" || q.type === "date" ? q.type : "text"} step={q.validation.integer ? 1 : "any"} min={q.type === "date" ? q.validation.minDate : q.validation.min} max={q.type === "date" ? q.validation.maxDate : q.validation.max} maxLength={q.validation.maxLength} value={typeof value === "number" || typeof value === "string" ? value : ""} onChange={e => answer(q.id, q.type === "number" ? e.target.value === "" ? null : Number(e.target.value) : e.target.value)} />}
        {q.help && <p className="text-sm text-muted-foreground">{q.help}</p>}
      </div>; })}</fieldset>)}
  </div>;
}
