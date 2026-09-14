import type { RuleCondition, RuleDefinition, RuleQuestion } from '@niq-scoring/contracts/rules';

const types: Record<RuleQuestion['type'], string> = {
  text: 'Short text', long_text: 'Long text', number: 'Number', date: 'Date',
  boolean: 'Yes / no', single_select: 'Single choice', multi_select: 'Multiple choice',
};
const comparisons: Record<string, string> = {
  answered: 'has an answer', unanswered: 'has no answer', eq: 'equals', neq: 'does not equal',
  gt: 'is greater than', gte: 'is at least', lt: 'is less than', lte: 'is at most', includes: 'includes',
};

export function describeCondition(definition: RuleDefinition, condition: RuleCondition): string {
  const questions = definition.sections.flatMap(section => section.questions);
  return condition.tests.map(test => {
    const question = test.ref.kind === 'question' ? questions.find(item => item.id === test.ref.id) : undefined;
    const label = question?.label ?? definition.calculations.find(item => item.id === test.ref.id)?.label
      ?? definition.domains.find(item => item.id === test.ref.id)?.label
      ?? (test.ref.kind === 'total' ? 'Total score' : test.ref.kind === 'classification' ? 'Classification' : test.ref.id);
    const option = question?.options.find(item => item.id === test.value)
      ?? definition.classifications.find(item => item.id === test.value);
    const value = test.value === undefined ? '' : ` ${option?.label ?? (typeof test.value === 'boolean' ? test.value ? 'Yes' : 'No' : String(test.value))}`;
    return `${label} ${comparisons[test.operator] ?? test.operator}${value}`;
  }).join(condition.match === 'all' ? ' and ' : ' or ');
}

export function QuestionnaireEditor({ definition }: {
  definition: RuleDefinition;
  onChange: (definition: RuleDefinition) => void;
  disabled?: boolean;
}) {
  const labels = new Map([
    ...definition.sections.flatMap(section => section.questions.map(question => [question.id, question.label] as const)),
    ...definition.calculations.map(calculation => [calculation.id, calculation.label] as const),
  ]);
  return <div className="min-w-0 space-y-5">
    <p className="text-sm text-muted-foreground">Review the fixed fields and answer options. Configure points, thresholds and caps in Scoring.</p>
    {definition.sections.map(section => <section key={section.id} id={`rule-section-${section.id}`} className="overflow-hidden rounded-lg border">
      <div className="space-y-1 bg-muted/30 p-4"><h3 className="font-medium">{section.title}</h3>{section.description && section.id !== "dietary_assessment" && <p className="text-sm text-muted-foreground">{section.description}</p>}</div>
      <div className="divide-y">{section.questions.map(question => <details key={question.id} id={`rule-question-${question.id}`} className="p-4">
        <summary className="cursor-pointer font-medium">{question.label}<span className="ml-2 text-sm font-normal text-muted-foreground">{types[question.type]}{question.unit ? ` · ${question.unit}` : ''}{question.required ? ' · Required' : ''}</span></summary>
        <div className="mt-3 space-y-3 text-sm">
          {question.help && <p className="text-muted-foreground">{question.help}</p>}
          {!!question.options.length && <div><h4 className="mb-2 font-medium">Answer options</h4><ul className="divide-y rounded-md border">{question.options.map(option => <li key={option.id} className="px-3 py-2">{option.label}{option.help && <p className="text-muted-foreground">{option.help}</p>}</li>)}</ul></div>}
          {question.type === 'number' && <p>Accepted values: {question.validation.min ?? 'no minimum'} to {question.validation.max ?? 'no maximum'}{question.unit ? ` ${question.unit}` : ''}{question.validation.integer ? ' · Whole numbers only' : ''}.</p>}
          {question.validation.maxLength !== undefined && <p>Maximum length: {question.validation.maxLength} characters.</p>}
          {question.type === 'date' && (question.validation.minDate || question.validation.maxDate) && <p>Accepted dates: {question.validation.minDate ?? 'no earliest date'} to {question.validation.maxDate ?? 'no latest date'}.</p>}
          <p className="text-muted-foreground">{question.visibleWhen ? `Shown when ${describeCondition(definition, question.visibleWhen)}.` : 'Always shown.'}</p>
        </div>
      </details>)}</div>
    </section>)}
    {!!definition.calculations.length && <section className="space-y-3"><h3 className="font-medium">Calculated values</h3><p className="text-sm text-muted-foreground">These calculations are fixed and use the assessment answers.</p><dl className="divide-y rounded-lg border">{definition.calculations.map(calculation => <div key={calculation.id} id={`rule-calculations-${calculation.id}`} className="space-y-1 p-4"><dt className="font-medium">{calculation.label}{calculation.unit ? ` (${calculation.unit})` : ''}</dt><dd className="text-sm text-muted-foreground">{calculation.operation.replaceAll('_', ' ')} · {calculation.operands.map(operand => operand.kind === 'constant' ? String(operand.value) : labels.get(operand.id) ?? operand.id).join(', ')} · {calculation.precision} decimal places</dd></div>)}</dl></section>}
  </div>;
}
