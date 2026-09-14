import { ruleScoreBounds } from "./rule-score-bounds";
import { type DefinitionIssue, type RuleCondition, type RuleDefinition, type RuleRange, type RuleReference } from "./rule-definition";

export function inRange(value: number, range: RuleRange): boolean {
  return (range.min === null || (range.minInclusive ? value >= range.min : value > range.min)) &&
    (range.max === null || (range.maxInclusive ? value <= range.max : value < range.max));
}

/** Structural integrity errors reject saves. Blocking issues allow drafts, but prevent validation/approval. */
export function validateRuleDefinition(definition: RuleDefinition): DefinitionIssue[] {
  const issues: DefinitionIssue[] = [];
  const add = (path: string, code: string, message: string, severity: DefinitionIssue["severity"] = "error") => issues.push({ path, code, message, severity });
  const questions = definition.sections.flatMap(section => section.questions);
  const questionMap = new Map(questions.map(question => [question.id, question]));
  const calculationMap = new Map(definition.calculations.map(calculation => [calculation.id, calculation]));
  const domainIds = new Set(definition.domains.map(domain => domain.id));
  const classIds = new Set(definition.classifications.map(band => band.id));
  const interventionIds = new Set(definition.interventions.map(item => item.id));
  const ids = new Map<string, string>();
  const unique = (id: string, path: string) => {
    if (["total", "classification"].includes(id)) add(path, "RESERVED_ID", `${id} is reserved.`);
    if (ids.has(id)) add(path, "DUPLICATE_ID", `Identifier ${id} is already used at ${ids.get(id)}.`);
    else ids.set(id, path);
  };
  const reference = (ref: RuleReference, path: string, allowed: RuleReference["kind"][]) => {
    if (!allowed.includes(ref.kind)) { add(path, "REFERENCE_STAGE", `${ref.kind} is not available at this stage.`); return; }
    const exists = ref.kind === "question" ? questionMap.has(ref.id) : ref.kind === "calculation" ? calculationMap.has(ref.id) : ref.kind === "domain" ? domainIds.has(ref.id) : ref.id === ref.kind;
    if (!exists) add(path, "MISSING_REFERENCE", `Unknown ${ref.kind}: ${ref.id}.`);
  };
  const condition = (value: RuleCondition, path: string, allowed: RuleReference["kind"][]) => {
    value.tests.forEach((test, index) => {
      const p = `${path}.tests.${index}`;
      reference(test.ref, p, allowed);
      if (["answered", "unanswered"].includes(test.operator)) {
        if (test.value !== undefined) add(p, "UNEXPECTED_VALUE", "Presence checks do not take a comparison value.");
        return;
      }
      if (test.value === undefined) { add(p, "MISSING_VALUE", "Choose a comparison value."); return; }
      const question = test.ref.kind === "question" ? questionMap.get(test.ref.id) : undefined;
      const kind = question?.type ?? (test.ref.kind === "classification" ? "classification" : "number");
      if (["gt", "gte", "lt", "lte"].includes(test.operator) && (kind !== "number" || typeof test.value !== "number")) add(p, "COMPARISON_TYPE", "Numeric comparisons require a number field and numeric value.");
      if (test.operator === "includes" && kind !== "multi_select") add(p, "COMPARISON_TYPE", "Includes requires a multi-select question.");
      if (kind === "multi_select" && test.operator !== "includes") add(p, "COMPARISON_TYPE", "Use Includes for a multi-select answer.");
      if (kind === "number" && typeof test.value !== "number") add(p, "COMPARISON_TYPE", "Use a numeric comparison value.");
      if (kind === "boolean" && typeof test.value !== "boolean") add(p, "COMPARISON_TYPE", "Use a yes/no comparison value.");
      if (["text", "long_text", "date"].includes(kind) && typeof test.value !== "string") add(p, "COMPARISON_TYPE", "Use a text comparison value.");
      if (question && ["single_select", "multi_select"].includes(kind) && !question.options.some(option => option.id === test.value)) add(p, "MISSING_OPTION", "The comparison option does not belong to this question.");
      if (kind === "classification" && !classIds.has(String(test.value))) add(p, "MISSING_CLASSIFICATION", "The classification does not exist.");
    });
  };
  const numericInput = (ref: { kind: "question" | "calculation"; id: string }, path: string) => {
    reference(ref, path, ["question", "calculation"]);
    if (ref.kind === "question" && questionMap.get(ref.id)?.type !== "number") add(path, "NUMERIC_INPUT", "A numeric input is required.");
  };
  const ranges = (bands: Array<RuleRange & { id: string }>, path: string) => {
    bands.forEach((band, index) => {
      if (band.min !== null && band.max !== null && (band.min > band.max || (band.min === band.max && (!band.minInclusive || !band.maxInclusive)))) add(`${path}.${index}`, "EMPTY_RANGE", "This range contains no values.");
    });
    const sorted = [...bands].sort((a, b) => (a.min ?? -Infinity) - (b.min ?? -Infinity));
    for (let index = 1; index < sorted.length; index++) {
      const left = sorted[index - 1]!; const right = sorted[index]!;
      if (left.max === null || right.min === null || left.max > right.min || (left.max === right.min && left.maxInclusive && right.minInclusive)) add(path, "OVERLAPPING_RANGES", `Ranges ${left.id} and ${right.id} overlap.`, "blocking");
      else if (left.max < right.min || (left.max === right.min && !left.maxInclusive && !right.minInclusive)) add(path, "RANGE_GAP", `There is a gap between ${left.id} and ${right.id}.`, "blocking");
    }
  };
  if (questions.length > 500) add("sections", "QUESTION_LIMIT", "Use at most 500 questions.");
  definition.sections.forEach((section, si) => {
    unique(section.id, `sections.${si}`);
    if (!section.questions.length) add(`sections.${si}`, "EMPTY_SECTION", "Add questions or remove this empty section.", "blocking");
    section.questions.forEach((question, qi) => {
      const p = `sections.${si}.questions.${qi}`;
      unique(question.id, p);
      question.options.forEach((option, oi) => unique(option.id, `${p}.options.${oi}`));
      const selection = ["single_select", "multi_select"].includes(question.type);
      if (selection && !question.options.length) add(p, "MISSING_OPTIONS", "Add answer options.", "blocking");
      if (!selection && question.options.length) add(p, "UNEXPECTED_OPTIONS", "Only selection fields have options.");
      const v = question.validation;
      if (v.min !== undefined && v.max !== undefined && v.min > v.max) add(p, "INVALID_BOUNDS", "Minimum exceeds maximum.");
      if (v.minDate && v.maxDate && v.minDate > v.maxDate) add(p, "INVALID_BOUNDS", "Earliest date exceeds latest date.");
      if (question.type !== "number" && (v.min !== undefined || v.max !== undefined || v.integer !== undefined)) add(p, "VALIDATION_TYPE", "Numeric validation belongs to number fields.");
      if (question.type !== "date" && (v.minDate || v.maxDate)) add(p, "VALIDATION_TYPE", "Date bounds belong to date fields.");
      if (!["text", "long_text"].includes(question.type) && v.maxLength !== undefined) add(p, "VALIDATION_TYPE", "Text length belongs to text fields.");
      // Visibility reads questions only: derived values cannot introduce hidden calculation cycles.
      if (question.visibleWhen) condition(question.visibleWhen, `${p}.visibleWhen`, ["question"]);
    });
  });
  definition.calculations.forEach((calculation, index) => {
    const p = `calculations.${index}`; unique(calculation.id, p);
    if (["subtract", "divide", "bmi", "percentage_change"].includes(calculation.operation) && calculation.operands.length !== 2) add(p, "OPERAND_COUNT", "This calculation requires exactly two operands.");
    calculation.operands.forEach((operand, oi) => { if (operand.kind !== "constant") numericInput(operand, `${p}.operands.${oi}`); });
  });
  const detectCycles = (graph: Map<string, string[]>, path: string) => {
    const visiting = new Set<string>(); const visited = new Set<string>();
    const visit = (id: string) => {
      if (visiting.has(id)) { add(path, "CYCLE", `Circular dependency involving ${id}.`); return; }
      if (visited.has(id)) return;
      visiting.add(id); (graph.get(id) ?? []).forEach(visit); visiting.delete(id); visited.add(id);
    };
    graph.forEach((_, id) => visit(id));
  };
  detectCycles(new Map(questions.map(q => [q.id, q.visibleWhen?.tests.filter(t => t.ref.kind === "question").map(t => t.ref.id) ?? []])), "sections");
  detectCycles(new Map(definition.calculations.map(c => [c.id, c.operands.flatMap(o => o.kind === "calculation" ? [o.id] : [])])), "calculations");
  const domainNames = new Set<string>();
  definition.domains.forEach((domain, index) => {
    unique(domain.id, `domains.${index}`);
    const name = domain.label.trim().replace(/\s+/g, " ").toLowerCase();
    if (domainNames.has(name)) add(`domains.${index}.label`, "DUPLICATE_DOMAIN_NAME", "Each score group must have a unique name.");
    domainNames.add(name);
    if (domain.id !== "unassigned" && !definition.scoring.some(rule => rule.domainId === domain.id)) add(`domains.${index}`, "EMPTY_DOMAIN", "No scoring rules belong to this domain.", "blocking");
  });
  definition.scoring.forEach((rule, index) => {
    const p = `scoring.${index}`; unique(rule.id, p);
    if (rule.domainId === "unassigned") add(p, "UNASSIGNED_DOMAIN", "Choose a score group.", "blocking");
    if (!domainIds.has(rule.domainId)) add(p, "MISSING_DOMAIN", "Choose an existing score group.");
    if (rule.kind === "options") {
      const q = questionMap.get(rule.questionId);
      if (!q || !["single_select", "multi_select"].includes(q.type)) add(p, "OPTION_INPUT", "Choose a selection question.");
      const seen = new Set<string>();
      rule.points.forEach(mapping => {
        if (seen.has(mapping.optionId)) add(p, "DUPLICATE_MAPPING", "Each option can have only one point mapping.");
        seen.add(mapping.optionId);
        if (!q?.options.some(o => o.id === mapping.optionId)) add(p, "MISSING_OPTION", `Unknown option ${mapping.optionId}.`);
      });
      if (q?.options.some(o => !seen.has(o.id))) add(p, "UNMAPPED_OPTION", "Every option needs explicit points, including zero.", "blocking");
    } else if (rule.kind === "ranges") {
      numericInput(rule.input, `${p}.input`);
      rule.bands.forEach((band, bi) => unique(band.id, `${p}.bands.${bi}`)); ranges(rule.bands, `${p}.bands`);
      const q = rule.input.kind === "question" ? questionMap.get(rule.input.id) : undefined;
      const lower = q?.validation.min ?? -Infinity; const upper = q?.validation.max ?? Infinity;
      if (!rule.bands.some(b => inRange(lower, b)) || !rule.bands.some(b => inRange(upper, b))) add(p, "RANGE_COVERAGE", "Ranges must cover the input bounds (or be unbounded).", "blocking");
    } else condition(rule.when, `${p}.when`, ["question", "calculation"]);
  });
  definition.classifications.forEach((band, index) => unique(band.id, `classifications.${index}`));
  ranges(definition.classifications, "classifications");
  const scoreBounds = ruleScoreBounds(definition);
  if (scoreBounds && definition.classifications.length &&
    (!definition.classifications.some(b => inRange(scoreBounds.min, b)) || !definition.classifications.some(b => inRange(scoreBounds.max, b)))) {
    add("classifications", "CLASSIFICATION_COVERAGE", `Classifications must cover the configured score bounds (${scoreBounds.min} to ${scoreBounds.max}), including both endpoints.`, "blocking");
  }
  if (!definition.sections.length) add("sections", "NO_QUESTIONS", "Add questionnaire sections.", "blocking");
  if (!definition.scoring.length) add("scoring", "NO_SCORING", "Define scoring rules.", "blocking");
  if (!definition.classifications.length) add("classifications", "NO_CLASSIFICATIONS", "Define score classifications.", "blocking");
  definition.interventions.forEach((item, index) => {
    const p = `interventions.${index}`; unique(item.id, p);
    condition(item.when, `${p}.when`, ["question", "calculation", "domain", "total", "classification"]);
    if (item.exclusiveGroup && definition.interventions.some(other => other.id !== item.id && other.exclusiveGroup === item.exclusiveGroup && other.priority === item.priority)) add(p, "AMBIGUOUS_PRIORITY", "Exclusive recommendations need distinct priorities.", "blocking");
  });
  definition.issues.forEach((issue, index) => {
    unique(issue.id, `issues.${index}`);
    if (issue.resolved && !issue.resolution.trim()) add(`issues.${index}`, "MISSING_RESOLUTION", "Explain how this issue was resolved.");
    if (issue.blocking && !issue.resolved) add(issue.path || `issues.${index}`, "UNRESOLVED", issue.message, "blocking");
  });
  definition.samples.forEach((sample, index) => {
    const p = `samples.${index}`; unique(sample.id, p);
    Object.keys(sample.answers).forEach(id => { if (!questionMap.has(id)) add(p, "SAMPLE_REFERENCE", `Unknown question ${id}.`); });
    if (sample.expected.classificationId && !classIds.has(sample.expected.classificationId)) add(p, "SAMPLE_REFERENCE", "Expected classification does not exist.");
    sample.expected.interventionIds.forEach(id => { if (!interventionIds.has(id)) add(p, "SAMPLE_REFERENCE", `Unknown intervention ${id}.`); });
    Object.keys(sample.expected.domains).forEach(id => { if (!domainIds.has(id)) add(p, "SAMPLE_REFERENCE", `Unknown domain ${id}.`); });
    Object.keys(sample.expected.calculations).forEach(id => { if (!calculationMap.has(id)) add(p, "SAMPLE_REFERENCE", `Unknown calculation ${id}.`); });
  });
  return issues;
}
