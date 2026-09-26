import { finalAssessmentDefinitionSchema, type FinalAssessmentDefinition, type FinalAssessmentField } from "./final-assessment";
import { createFinalAssessmentTemplate, createLegacyFinalAssessmentTemplate } from "./final-assessment-template";
import type { DefinitionIssue } from "./rule-definition";

function stable(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stable).join(",")}]`;
  if (value && typeof value === "object") return `{${Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => `${JSON.stringify(key)}:${stable(item)}`).join(",")}}`;
  return JSON.stringify(value);
}

function fixedStructure(definition: FinalAssessmentDefinition) {
  return {
    profile: definition.profile,
    sections: definition.sections.map(section => ({
      id: section.id,
      title: section.title,
      description: section.description,
      accent: section.accent,
      fields: section.fields.map(field => ({
        id: field.id,
        label: field.label,
        kind: field.kind,
        help: field.help,
        unit: field.unit,
        options: "options" in field ? field.options.map(option => ({ id: option.id, label: option.label, help: option.help })) : [],
        dependencies: field.kind === "count" ? { countInputId: field.countInputId } : field.kind === "calculated" ? { inputIds: field.inputIds, formula: field.formula, bandIds: field.scoring.bands.map(band => band.id) } : field.kind === "derived" ? { sourceInputId: field.sourceInputId, outcomeIds: field.scoring.outcomes.map(outcome => ({ id: outcome.id, label: outcome.label })), mapping: field.scoring.mapping } : field.kind === "conditional" ? { palliative: { optionId: field.scoring.palliative.optionId, paths: field.scoring.palliative.paths.map(path => ({ id: path.id, label: path.label, children: path.children.map(child => ({ id: child.id, label: child.label })) })) } } : null,
        sources: field.sources,
      })),
    })),
    supportingInputs: definition.supportingInputs,
    provisional: definition.provisional,
    interventions: definition.interventions,
  };
}

export function isFixedFinalAssessmentDefinition(value: unknown): value is FinalAssessmentDefinition {
  const parsed = finalAssessmentDefinitionSchema.safeParse(value);
  if (!parsed.success) return false;
  return stable(fixedStructure(parsed.data)) === stable(fixedStructure((parsed.data.provisional.status === "CLIENT_CONFIRMED" ? createFinalAssessmentTemplate : createLegacyFinalAssessmentTemplate)(parsed.data.name)));
}

function rangesAreComplete(bands: Array<{ min: number | null; max: number | null; minInclusive: boolean; maxInclusive: boolean }>) {
  const sorted = [...bands].sort((a, b) => (a.min ?? -Infinity) - (b.min ?? -Infinity));
  if (!sorted.length || sorted[0]!.min !== null || sorted.at(-1)!.max !== null) return false;
  for (const band of sorted) if (band.min !== null && band.max !== null && (band.min > band.max || band.min === band.max && (!band.minInclusive || !band.maxInclusive))) return false;
  for (let index = 1; index < sorted.length; index++) {
    const previous = sorted[index - 1]!;
    const current = sorted[index]!;
    if (previous.max === null || current.min === null) return false;
    if (previous.max > current.min || previous.max === current.min && previous.maxInclusive && current.minInclusive) return false;
    if (previous.max < current.min || previous.max === current.min && !previous.maxInclusive && !current.minInclusive) return false;
  }
  return true;
}

function optionIds(field: Extract<FinalAssessmentField, { kind: "select" | "multi_select" | "yes_no" | "conditional" | "count" }>) {
  return field.options.map(option => option.id);
}

function validateOptionPoints(field: Extract<FinalAssessmentField, { kind: "select" | "multi_select" | "yes_no" }>, path: string, add: (path: string, code: string, message: string, severity?: DefinitionIssue["severity"]) => void) {
  const expected = new Set(optionIds(field));
  const seen = new Set<string>();
  for (const [index, mapping] of field.scoring.points.entries()) {
    if (seen.has(mapping.optionId)) add(`${path}.scoring.points.${index}`, "DUPLICATE_MAPPING", "Each fixed option needs one point mapping.");
    seen.add(mapping.optionId);
    if (!expected.has(mapping.optionId)) add(`${path}.scoring.points.${index}`, "UNKNOWN_OPTION", "Point mapping references an unknown fixed option.");
    if (!Number.isFinite(mapping.points) || mapping.points < 0) add(`${path}.scoring.points.${index}`, "INVALID_POINTS", "Points must be finite and non-negative.");
  }
  if (seen.size !== expected.size || [...expected].some(id => !seen.has(id))) add(path, "MISSING_OPTION_POINTS", "Every fixed option needs an explicit point value, including zero.", "blocking");
}

export function validateFinalAssessmentDefinition(definition: FinalAssessmentDefinition, options: { requireRiskCategoryColors?: boolean } = {}): DefinitionIssue[] {
  const issues: DefinitionIssue[] = [];
  const add = (path: string, code: string, message: string, severity: DefinitionIssue["severity"] = "error") => issues.push({ path, code, message, severity });
  if (!isFixedFinalAssessmentDefinition(definition)) add("profile", "FIXED_PROFILE_REQUIRED", "The final assessment fields, options and dependencies are fixed.", "blocking");
  if (!(definition.provisional.status === "CLIENT_CONFIRMED" ? integerRangesAreComplete(definition.riskCategories) : rangesAreComplete(definition.riskCategories))) add("riskCategories", "RISK_RANGE_COVERAGE", "Risk categories must cover every possible non-negative total without gaps or overlaps.", "blocking");
  const categoryNames = new Set<string>();
  definition.riskCategories.forEach((category, index) => {
    const normalized = category.label.trim().replace(/\s+/g, " ").toLowerCase();
    if (categoryNames.has(normalized)) add(`riskCategories.${index}.label`, "DUPLICATE_CATEGORY_NAME", "Risk category names must be unique ignoring case and repeated spaces.");
    categoryNames.add(normalized);
    if (options.requireRiskCategoryColors && !category.color) add(`riskCategories.${index}.color`, "RISK_COLOR_REQUIRED", "Choose a color for every risk category.");
  });
  if (definition.provisional.status === "CLIENT_CONFIRMED") {
    const checkPoints = (value: unknown, path: string) => {
      if (!value || typeof value !== "object") return;
      for (const [key, item] of Object.entries(value)) {
        const next = `${path}.${key}`;
        if ((key === "points" || key === "pointsPerCount") && typeof item === "number" && !Number.isSafeInteger(item)) add(next, "INTEGER_POINTS_REQUIRED", "Points must be a whole number within the supported range.");
        else if (item && typeof item === "object") checkPoints(item, next);
      }
    };
    checkPoints(definition.sections, "sections");
  }
  definition.sections.forEach((section, sectionIndex) => section.fields.forEach((field, fieldIndex) => {
    const path = `sections.${sectionIndex}.fields.${fieldIndex}`;
    if (field.kind === "select" || field.kind === "multi_select" || field.kind === "yes_no") validateOptionPoints(field, path, add);
    if (field.kind === "conditional") {
      const normalIds = new Set(field.options.filter(option => option.id !== field.scoring.palliative.optionId).map(option => option.id));
      const mapped = new Set<string>();
      field.scoring.normalPoints.forEach((mapping, index) => {
        if (mapped.has(mapping.optionId)) add(`${path}.scoring.normalPoints.${index}`, "DUPLICATE_MAPPING", "Each ordinary treatment option needs one point mapping.");
        mapped.add(mapping.optionId);
        if (!normalIds.has(mapping.optionId)) add(`${path}.scoring.normalPoints.${index}`, "UNKNOWN_OPTION", "Ordinary treatment mapping references an unknown option.");
        if (mapping.points < 0 || !Number.isFinite(mapping.points)) add(`${path}.scoring.normalPoints.${index}`, "INVALID_POINTS", "Points must be finite and non-negative.");
      });
      if (mapped.size !== normalIds.size) add(`${path}.scoring.normalPoints`, "MISSING_OPTION_POINTS", "Every ordinary treatment option needs an explicit point value.", "blocking");
      const paths = new Set<string>();
      field.scoring.palliative.paths.forEach((branch, branchIndex) => {
        if (paths.has(branch.id)) add(`${path}.scoring.palliative.paths.${branchIndex}`, "DUPLICATE_BRANCH", "Palliative branches must be unique.");
        paths.add(branch.id);
        if (branch.points < 0 || !Number.isFinite(branch.points)) add(`${path}.scoring.palliative.paths.${branchIndex}`, "INVALID_POINTS", "Points must be finite and non-negative.");
        const children = new Set<string>();
        branch.children.forEach((child, childIndex) => {
          if (children.has(child.id)) add(`${path}.scoring.palliative.paths.${branchIndex}.children.${childIndex}`, "DUPLICATE_BRANCH", "Palliative child choices must be unique.");
          children.add(child.id);
          if (child.points < 0 || !Number.isFinite(child.points)) add(`${path}.scoring.palliative.paths.${branchIndex}.children.${childIndex}`, "INVALID_POINTS", "Points must be finite and non-negative.");
        });
      });
    }
    if (field.kind === "count" && (field.scoring.pointsPerCount < 0 || !Number.isFinite(field.scoring.pointsPerCount))) add(`${path}.scoring.pointsPerCount`, "INVALID_POINTS", "The surgery point rate must be finite and non-negative.");
    if (field.kind === "calculated" && !rangesAreComplete(field.scoring.bands)) add(`${path}.scoring.bands`, "RANGE_COVERAGE", "Weight-loss bands must cover the full derived percentage domain without gaps or overlaps.", "blocking");
    if (field.kind === "calculated") field.scoring.bands.forEach((band, index) => { if (band.points < 0 || !Number.isFinite(band.points)) add(`${path}.scoring.bands.${index}`, "INVALID_POINTS", "Points must be finite and non-negative."); });
    if (field.kind === "derived") {
      const outcomes = new Set(field.scoring.outcomes.map(outcome => outcome.id));
      field.scoring.outcomes.forEach((outcome, index) => { if (outcome.points < 0 || !Number.isFinite(outcome.points)) add(`${path}.scoring.outcomes.${index}`, "INVALID_POINTS", "Points must be finite and non-negative."); });
      field.scoring.mapping.forEach((mapping, index) => { if (!outcomes.has(mapping.outcomeId)) add(`${path}.scoring.mapping.${index}`, "UNKNOWN_OUTCOME", "Protein mapping references an unknown outcome."); });
    }
  }));
  return issues;
}

function integerRangesAreComplete(ranges: FinalAssessmentDefinition["riskCategories"]): boolean {
  const intervals = ranges.map(range => ({ min: range.min === null ? 0 : range.minInclusive ? Math.ceil(range.min) : Math.floor(range.min) + 1, max: range.max === null ? Infinity : range.maxInclusive ? Math.floor(range.max) : Math.ceil(range.max) - 1 })).sort((a, b) => a.min - b.min);
  if (intervals[0]?.min !== 0 || intervals.at(-1)?.max !== Infinity) return false;
  return intervals.every((range, index) => range.max >= range.min && (!index || intervals[index - 1]!.max + 1 === range.min));
}
