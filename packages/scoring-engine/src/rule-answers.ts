import { type RuleAnswers, type RuleCondition, type RuleDefinition, type RuleQuestion, type RuleReference } from "@niq-scoring/contracts/rules";
export type RuntimeValue = string | number | boolean | string[] | null;
export type EvaluationIssue = { path: string; code: string; message: string };
export const present = (value: RuntimeValue | undefined) => value !== undefined && value !== null && !(typeof value === "string" && !value.trim()) && !(Array.isArray(value) && !value.length);

/** Three-valued conditions prevent absent input from matching `not equal`. */
export function evaluateCondition(condition: RuleCondition, resolve: (ref: RuleReference) => RuntimeValue | undefined): boolean | null {
  const results = condition.tests.map(test => {
    const actual = resolve(test.ref);
    if (test.operator === "answered") return present(actual);
    if (test.operator === "unanswered") return !present(actual);
    if (!present(actual)) return null;
    switch (test.operator) {
      case "eq": return actual === test.value;
      case "neq": return actual !== test.value;
      case "includes": return Array.isArray(actual) && typeof test.value === "string" && actual.includes(test.value);
      case "gt": return typeof actual === "number" && typeof test.value === "number" ? actual > test.value : null;
      case "gte": return typeof actual === "number" && typeof test.value === "number" ? actual >= test.value : null;
      case "lt": return typeof actual === "number" && typeof test.value === "number" ? actual < test.value : null;
      case "lte": return typeof actual === "number" && typeof test.value === "number" ? actual <= test.value : null;
    }
  });
  return condition.match === "all"
    ? results.includes(false) ? false : results.includes(null) ? null : true
    : results.includes(true) ? true : results.includes(null) ? null : false;
}

export function validateAnswer(question: RuleQuestion, value: RuntimeValue | undefined): string | null {
  if (!present(value)) return question.required ? "This answer is required." : null;
  const v = question.validation;
  switch (question.type) {
    case "text": case "long_text":
      if (typeof value !== "string") return "Enter text.";
      if (value.length > (v.maxLength ?? 20000)) return "Text exceeds the maximum length.";
      break;
    case "number":
      if (typeof value !== "number" || !Number.isFinite(value)) return "Enter a finite number.";
      if (v.integer && !Number.isInteger(value)) return "Enter a whole number.";
      if ((v.min !== undefined && value < v.min) || (v.max !== undefined && value > v.max)) return "Number is outside the allowed range.";
      break;
    case "boolean": if (typeof value !== "boolean") return "Choose yes or no."; break;
    case "date": {
      if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return "Enter a date in YYYY-MM-DD format.";
      const parsed = new Date(`${value}T00:00:00Z`);
      if (!Number.isFinite(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== value) return "Enter a valid calendar date.";
      if ((v.minDate && value < v.minDate) || (v.maxDate && value > v.maxDate)) return "Date is outside the allowed range.";
      break;
    }
    case "single_select":
      if (typeof value !== "string" || !question.options.some(o => o.id === value)) return "Choose an available option.";
      break;
    case "multi_select":
      if (!Array.isArray(value) || value.some(id => !question.options.some(o => o.id === id))) return "Choose available options.";
      if (new Set(value).size !== value.length) return "An option cannot be selected more than once.";
      break;
  }
  return null;
}

export function prepareAnswers(definition: RuleDefinition, answers: RuleAnswers) {
  const questions = new Map(definition.sections.flatMap(s => s.questions).map(q => [q.id, q]));
  // Stable IDs are data keys, including valid names such as "constructor".
  const visible: Record<string, boolean> = Object.create(null);
  const values: Record<string, RuntimeValue> = Object.create(null);
  const issues: EvaluationIssue[] = [];
  const visiting = new Set<string>();
  for (const id of Object.keys(answers)) if (!questions.has(id)) issues.push({ path: `answers.${id}`, code: "UNKNOWN_QUESTION", message: "This question is not part of the selected version." });
  const visit = (id: string): RuntimeValue | undefined => {
    if (id in visible) return values[id];
    const question = questions.get(id);
    if (!question || visiting.has(id)) return undefined;
    visiting.add(id);
    const shown = !question.visibleWhen || evaluateCondition(question.visibleWhen, ref => visit(ref.id)) === true;
    visible[id] = shown;
    if (shown) {
      const value = Object.hasOwn(answers, id) ? answers[id] : undefined;
      const error = validateAnswer(question, value);
      if (error) issues.push({ path: `answers.${id}`, code: "INVALID_ANSWER", message: error });
      else if (present(value)) values[id] = value!;
    }
    visiting.delete(id);
    return values[id];
  };
  questions.forEach((_, id) => visit(id));
  return { values, visible, issues };
}
