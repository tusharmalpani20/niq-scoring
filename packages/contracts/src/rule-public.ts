import type { RuleDefinition, RuleQuestion } from "./rule-definition";

export type PublicQuestion = Pick<RuleQuestion, "id" | "label" | "type" | "help" | "unit" | "required" | "options" | "validation" | "visibleWhen">;
export type PublicQuestionnaire = {
  formatVersion: RuleDefinition["formatVersion"];
  sections: Array<{ id: string; title: string; description: string; questions: PublicQuestion[] }>;
};

/** Allowlist renderer data: adding an internal field must never expose it automatically. */
export function publicQuestionnaire(definition: RuleDefinition): PublicQuestionnaire {
  return {
    formatVersion: definition.formatVersion,
    sections: definition.sections.map(section => ({
      id: section.id,
      title: section.title,
      description: section.description,
      questions: section.questions.map(question => ({
        id: question.id,
        label: question.label,
        type: question.type,
        help: question.help,
        unit: question.unit,
        required: question.required,
        options: question.options.map(option => ({ id: option.id, label: option.label, help: option.help })),
        validation: {
          ...(question.validation.min !== undefined ? { min: question.validation.min } : {}),
          ...(question.validation.max !== undefined ? { max: question.validation.max } : {}),
          ...(question.validation.integer !== undefined ? { integer: question.validation.integer } : {}),
          ...(question.validation.maxLength !== undefined ? { maxLength: question.validation.maxLength } : {}),
          ...(question.validation.minDate !== undefined ? { minDate: question.validation.minDate } : {}),
          ...(question.validation.maxDate !== undefined ? { maxDate: question.validation.maxDate } : {}),
        },
        visibleWhen: question.visibleWhen === null ? null : {
          match: question.visibleWhen.match,
          tests: question.visibleWhen.tests.map(test => ({
            ref: { kind: test.ref.kind, id: test.ref.id },
            operator: test.operator,
            ...(test.value !== undefined ? { value: test.value } : {}),
          })),
        },
      })),
    })),
  };
}
