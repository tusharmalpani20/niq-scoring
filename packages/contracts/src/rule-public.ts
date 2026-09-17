import type { RuleDefinition, RuleQuestion } from "./rule-definition";
import { isFinalAssessmentDefinition } from "./versioned-definition";
import type { FinalAssessmentDefinition } from "./final-assessment";

export type PublicQuestion = Pick<RuleQuestion, "id" | "label" | "type" | "help" | "unit" | "required" | "options" | "validation" | "visibleWhen">;
export type PublicQuestionnaire = {
  formatVersion: 1;
  sections: Array<{ id: string; title: string; description: string; questions: PublicQuestion[] }>;
};

export type PublicFinalAssessment = {
  formatVersion: 2;
  profile: "NIQ_FINAL_ASSESSMENT";
  sections: Array<{ id: string; title: string; description: string; fields: Array<{ id: string; label: string; type: string; help: string; unit: string; options: Array<{ id: string; label: string; help: string }>; dependencies: string[] }> }>;
  supportingInputs: Array<{ id: string; label: string; kind: string; unit?: string; required: boolean; options?: Array<{ id: string; label: string; help: string }> }>;
};

/** Allowlist renderer data: adding an internal field must never expose it automatically. */
export function publicQuestionnaire(definition: RuleDefinition | FinalAssessmentDefinition): PublicQuestionnaire | PublicFinalAssessment {
  if (isFinalAssessmentDefinition(definition)) return {
    formatVersion: 2,
    profile: definition.profile,
    sections: definition.sections.map(section => ({
      id: section.id,
      title: section.title,
      description: section.description,
      fields: section.fields.map(field => ({
        id: field.id,
        label: field.label,
        type: field.kind,
        help: field.help,
        unit: field.unit,
        options: "options" in field ? field.options.map(option => ({ id: option.id, label: option.label, help: option.help })) : [],
        dependencies: field.kind === "count" ? [field.countInputId] : field.kind === "calculated" ? [...field.inputIds] : field.kind === "derived" ? [field.sourceInputId] : field.kind === "conditional" ? ["palliative_status", "palliative_timing"] : [],
      })),
    })),
    supportingInputs: definition.supportingInputs.map(input => ({
      id: input.id,
      label: input.label,
      kind: input.kind,
      ...(input.kind === "number" ? { unit: input.unit } : {}),
      required: input.required,
      ...(input.kind === "select" ? { options: input.options.map(option => ({ id: option.id, label: option.label, help: option.help })) } : {}),
    })),
  };
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
