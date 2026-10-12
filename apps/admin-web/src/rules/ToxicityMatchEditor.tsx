import { TOXICITY_NON_SYMPTOM_OPTION_IDS, TOXICITY_SYMPTOM_FIELD_IDS, type FinalAssessmentDefinition } from "@niq-scoring/contracts/final-assessment";
import { Button } from "../components/ui/button";
import { NativeSelect } from "../components/ui/native-select";

type Toxicity = NonNullable<FinalAssessmentDefinition["reportGuidance"]>["toxicity"][number];
type Match = NonNullable<Toxicity["match"]>;
type Pair = Extract<Match, { mode: "assessment_answer" }>["anyOf"][number];

function answerFields(definition: FinalAssessmentDefinition) {
  return definition.sections.map(section => ({
    id: section.id,
    label: section.title,
    fields: section.fields.filter(field => TOXICITY_SYMPTOM_FIELD_IDS.some(id => id === field.id) && (field.kind === "select" || field.kind === "multi_select")),
  })).filter(section => section.fields.length > 0);
}

export function toxicityMatchLabel(definition: FinalAssessmentDefinition, match: Toxicity["match"]): string {
  if (!match) return "Needs mapping";
  if (match.mode === "clinician_confirmation") return "Clinician confirmation";
  if (match.mode === "weight_change") return match.direction === "gain" ? "Measured weight gain (current > previous)" : "Measured weight loss (current < previous)";
  const fields = definition.sections.flatMap(section => section.fields);
  const joiner = match.operator === "all" ? " AND " : " OR ";
  return match.anyOf.map(pair => {
    const field = fields.find(item => item.id === pair.fieldId);
    const option = field && "options" in field ? field.options.find(item => item.id === pair.optionId) : undefined;
    return field && option ? `${field.label}: ${option.label}` : "Incomplete answer match";
  }).join(joiner);
}

export function ToxicityMatchEditor({ definition, match, onChange }: {
  definition: FinalAssessmentDefinition;
  match: Toxicity["match"];
  onChange: (match: Toxicity["match"]) => void;
}) {
  const sections = answerFields(definition);
  const fields = sections.flatMap(section => section.fields);
  const pairs: Pair[] = match?.mode === "assessment_answer" ? match.anyOf : [];
  const updatePairs = (next: Pair[]) => onChange({ mode: "assessment_answer", anyOf: next, ...(match?.mode === "assessment_answer" && match.operator ? { operator: match.operator } : {}) });

  return <fieldset className="space-y-3 rounded-lg border p-4">
    <legend className="px-1 text-sm font-medium">When should this guidance apply?</legend>
    <p className="text-sm text-muted-foreground">Match a directly reported answer, or require a clinician to confirm the effect. Treatment and drug class must also match. The text of the expected toxicity alone never confirms that the patient has it.</p>
    <label className="block space-y-1 text-sm">
      <span className="font-medium">Confirmation method</span>
      <NativeSelect value={match?.mode ?? ""} onChange={event => {
        if (event.target.value === "assessment_answer") onChange({ mode: "assessment_answer", anyOf: [{ fieldId: "", optionId: "" }] });
        else if (event.target.value === "weight_change") onChange({ mode: "weight_change", direction: "gain" });
        else if (event.target.value === "clinician_confirmation") onChange({ mode: "clinician_confirmation" });
        else onChange(undefined);
      }}>
        <option value="">Needs mapping</option>
        <option value="assessment_answer">Patient reported an assessment answer</option>
        <option value="weight_change">Measured weight change</option>
        <option value="clinician_confirmation">Clinician confirms this effect</option>
      </NativeSelect>
    </label>
    {match?.mode === "weight_change" && <div className="grid gap-2 sm:grid-cols-2">
      <label className="block space-y-1 text-sm"><span>Assessment field</span><NativeSelect value="weight_loss" disabled><option value="weight_loss">Weight change (two weights)</option></NativeSelect></label>
      <label className="block space-y-1 text-sm"><span>Measured value</span><NativeSelect value={match.direction} onChange={event => onChange({ ...match, direction: event.target.value as "gain" | "loss" })}>
        <option value="gain">Gain: current weight is higher</option>
        <option value="loss">Loss: current weight is lower</option>
      </NativeSelect></label>
      <p className="text-xs text-muted-foreground sm:col-span-2">Both weights must be present and greater than zero. A weight change does not establish why it happened.</p>
    </div>}
    {match?.mode === "assessment_answer" && <div className="space-y-3">
      <p className="text-xs text-muted-foreground">Choose the field first, then its answer. Select whether any one answer or all answers are required.</p>
      <label className="block space-y-1 text-sm"><span className="font-medium">Required answers</span><NativeSelect value={match.operator ?? "any"} onChange={event => onChange({ ...match, operator: event.target.value as "any" | "all" })}>
        <option value="any">Any one of the selected answers</option>
        <option value="all">All of the selected answers</option>
      </NativeSelect></label>
      {pairs.map((pair, index) => {
        const field = fields.find(item => item.id === pair.fieldId);
        return <div key={index} className="grid items-end gap-2 rounded-md bg-muted/30 p-3 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto]">
          <label className="block min-w-0 space-y-1 text-sm"><span>Assessment field</span><NativeSelect value={pair.fieldId} aria-label={`Assessment field ${index + 1}`} onChange={event => updatePairs(pairs.map((item, at) => at === index ? { fieldId: event.target.value, optionId: "" } : item))}>
            <option value="">Select field</option>
            {sections.map(section => <optgroup key={section.id} label={section.label}>{section.fields.map(item => <option key={item.id} value={item.id}>{item.label}</option>)}</optgroup>)}
          </NativeSelect></label>
          <label className="block min-w-0 space-y-1 text-sm"><span>Answer value</span><NativeSelect value={pair.optionId} disabled={!field} aria-label={`Answer value ${index + 1}`} onChange={event => updatePairs(pairs.map((item, at) => at === index ? { ...item, optionId: event.target.value } : item))}>
            <option value="">Select answer</option>
            {field && "options" in field && field.options.filter(option => !TOXICITY_NON_SYMPTOM_OPTION_IDS.some(id => id === option.id)).map(option => <option key={option.id} value={option.id}>{option.label}</option>)}
          </NativeSelect></label>
          <Button type="button" variant="outline" disabled={pairs.length <= 1} onClick={() => updatePairs(pairs.filter((_, at) => at !== index))}>Remove</Button>
        </div>;
      })}
      <Button type="button" variant="outline" disabled={pairs.length >= 10} onClick={() => updatePairs([...pairs, { fieldId: "", optionId: "" }])}>Add another answer</Button>
    </div>}
    {match?.mode === "clinician_confirmation" && <p className="rounded-md bg-muted/40 p-3 text-xs text-muted-foreground">This row will not be selected automatically from questionnaire answers. A clinician must confirm the effect separately.</p>}
    {!match && <p className="text-xs text-amber-700">This row needs a matching method before it can be considered reviewed.</p>}
  </fieldset>;
}
