import { TOXICITY_NON_SYMPTOM_OPTION_IDS, TOXICITY_SYMPTOM_FIELD_IDS, finalAssessmentDefinitionSchema, type FinalAssessmentDefinition, type FinalAssessmentField } from "./final-assessment";
import { createFinalAssessmentTemplate, createLegacyFinalAssessmentTemplate } from "./final-assessment-template";
import type { DefinitionIssue } from "./rule-definition";
import { cancerTypeIds } from "./cancer-type-ids";
import { RADIOTHERAPY_TREATMENT_ID } from "./care-plan-guidance";

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
  const actual = stable(fixedStructure(parsed.data));
  const expected = (parsed.data.provisional.status === "CLIENT_CONFIRMED" ? createFinalAssessmentTemplate : createLegacyFinalAssessmentTemplate)(parsed.data.name);
  if (actual === stable(fixedStructure(expected))) return true;
  if (parsed.data.provisional.status !== "CLIENT_CONFIRMED") return false;
  // Confirmed versions created before dietary stress was removed retain their
  // original question and score. They remain valid for pinned assessments.
  const previous = structuredClone(expected);
  const previousDiet = previous.sections.find(section => section.id === "dietary_details")!;
  const legacyDiet = createLegacyFinalAssessmentTemplate(parsed.data.name).sections.find(section => section.id === "dietary_details")!;
  previousDiet.description = legacyDiet.description;
  previousDiet.fields.splice(3, 0, structuredClone(legacyDiet.fields.find(field => field.id === "stress_level")!));
  return actual === stable(fixedStructure(previous));
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
  if (definition.drugClassConfig) {
    const { classes, suggestions } = definition.drugClassConfig;
    const classIds = new Set<string>();
    const classNames = new Set<string>();
    classes.forEach((drugClass, index) => {
      if (classIds.has(drugClass.id)) add(`drugClassConfig.classes.${index}.id`, "DUPLICATE_DRUG_CLASS_ID", "Drug class IDs must be unique.");
      classIds.add(drugClass.id);
      const name = drugClass.label.trim().replace(/\s+/g, " ").toLowerCase();
      if (classNames.has(name)) add(`drugClassConfig.classes.${index}.label`, "DUPLICATE_DRUG_CLASS_NAME", "Drug class names must be unique.");
      classNames.add(name);
      if (drugClass.id === "other" && drugClass.guidance?.trim()) add(`drugClassConfig.classes.${index}.guidance`, "OTHER_MUST_BE_GENERIC", "Other uses generic nutrition guidance only.");
    });
    const treatmentIds = new Set(definition.sections.flatMap(section => section.fields).filter(field => field.id === "current_cancer_treatment" && "options" in field).flatMap(field => "options" in field ? field.options.map(option => option.id) : []));
    const cancerIds = new Set<string>(cancerTypeIds);
    const triples = new Set<string>();
    suggestions.forEach((suggestion, index) => {
      const path = `drugClassConfig.suggestions.${index}`;
      if (!classIds.has(suggestion.classId)) add(`${path}.classId`, "UNKNOWN_DRUG_CLASS", "Suggestion references a drug class that is not configured.");
      if (suggestion.classId === "other") add(`${path}.classId`, "OTHER_MUST_BE_GENERIC", "Other cannot have class-specific suggestions.");
      if (!treatmentIds.has(suggestion.treatmentTypeId)) add(`${path}.treatmentTypeId`, "UNKNOWN_TREATMENT", "Suggestion references an unknown treatment option.");
      if (suggestion.cancerTypeId !== null && !cancerIds.has(suggestion.cancerTypeId)) add(`${path}.cancerTypeId`, "UNKNOWN_CANCER_TYPE", "Suggestion references an unknown cancer option.");
      const key = JSON.stringify([suggestion.cancerTypeId, suggestion.treatmentTypeId, suggestion.classId]);
      if (triples.has(key)) add(path, "DUPLICATE_DRUG_CLASS_SUGGESTION", "This cancer, treatment and drug class suggestion already exists.");
      triples.add(key);
    });
  }
  if (definition.reportGuidance) {
    const assessmentFields = new Map(definition.sections.flatMap(section => section.fields).map(field => [field.id, field]));
    const configuredClasses = new Set(definition.drugClassConfig?.classes.map(item => item.id) ?? []);
    const treatments = new Set(definition.sections.flatMap(section => section.fields)
      .filter(field => field.id === "current_cancer_treatment" && "options" in field)
      .flatMap(field => "options" in field ? field.options.map(option => option.id) : []));
    const risks = new Set(definition.riskCategories.map(item => item.id));
    const ids = new Set<string>();
    const nutritionRisks = new Set<string>();
    definition.reportGuidance.nutrition.forEach((rule, index) => {
      const path = `reportGuidance.nutrition.${index}`;
      if (ids.has(rule.id)) add(`${path}.id`, "DUPLICATE_GUIDANCE_ID", "Report guidance IDs must be unique.");
      ids.add(rule.id);
      if (rule.enabled && rule.riskCategoryId !== null && !risks.has(rule.riskCategoryId)) add(`${path}.riskCategoryId`, "UNKNOWN_RISK_CATEGORY", "Nutrition guidance refers to a missing risk category.");
      if (rule.enabled && rule.riskCategoryId !== null && nutritionRisks.has(rule.riskCategoryId)) add(path, "DUPLICATE_NUTRITION_RISK", "Only one active nutrition row may apply to a risk category.");
      if (rule.enabled && rule.riskCategoryId !== null) nutritionRisks.add(rule.riskCategoryId);
    });
    const toxicityKeys = new Set<string>();
    definition.reportGuidance.toxicity.forEach((rule, index) => {
      const path = `reportGuidance.toxicity.${index}`;
      if (ids.has(rule.id)) add(`${path}.id`, "DUPLICATE_GUIDANCE_ID", "Report guidance IDs must be unique.");
      ids.add(rule.id);
      if (rule.match?.mode === "assessment_answer") {
        const seenPairs = new Set<string>();
        const selectedSingleAnswers = new Map<string, string>();
        rule.match.anyOf.forEach((answer, answerIndex) => {
          const answerPath = `${path}.match.anyOf.${answerIndex}`;
          const pair = JSON.stringify([answer.fieldId, answer.optionId]);
          if (seenPairs.has(pair)) add(answerPath, "DUPLICATE_MATCH_ANSWER", "Use each assessment field and answer only once in this match.");
          seenPairs.add(pair);
          const field = assessmentFields.get(answer.fieldId);
          if (!field) add(`${answerPath}.fieldId`, "UNKNOWN_MATCH_FIELD", "Select an assessment field in this rule version.");
          else if (!TOXICITY_SYMPTOM_FIELD_IDS.some(id => id === field.id)) add(`${answerPath}.fieldId`, "UNSUPPORTED_MATCH_FIELD", "Choose a patient-reported symptom field.");
          else if (!("options" in field)) add(`${answerPath}.fieldId`, "UNSELECTABLE_MATCH_FIELD", "This assessment field has no selectable answers.");
          else if (!field.options.some(option => option.id === answer.optionId)) add(`${answerPath}.optionId`, "UNKNOWN_MATCH_OPTION", "Select an answer belonging to this assessment field.");
          else if (TOXICITY_NON_SYMPTOM_OPTION_IDS.some(id => id === answer.optionId)) add(`${answerPath}.optionId`, "NON_SYMPTOM_MATCH_OPTION", "Choose an answer that reports a symptom.");
          if (rule.match?.mode === "assessment_answer" && rule.match.operator === "all" && field?.kind === "select") {
            const previous = selectedSingleAnswers.get(field.id);
            if (previous && previous !== answer.optionId) add(`${answerPath}.optionId`, "IMPOSSIBLE_ALL_MATCH", "A single-choice field cannot have two answers at once.");
            selectedSingleAnswers.set(field.id, answer.optionId);
          }
        });
      }
      if (rule.match?.mode === "weight_change") {
        const weight = assessmentFields.get("weight_loss");
        if (weight?.kind !== "calculated" || weight.inputIds[0] !== "previous_weight_kg" || weight.inputIds[1] !== "current_weight_kg")
          add(`${path}.match`, "WEIGHT_CHANGE_UNAVAILABLE", "Weight change requires the configured previous and current weight inputs.");
      }
      if (!rule.enabled) return;
      if (Boolean(rule.classLevelToxicity) !== Boolean(rule.classLevelInterventions)) add(path, "INCOMPLETE_CLASS_LEVEL_GUIDANCE", "Class-level toxicity and intervention must be configured together.");
      if ((rule.classLevelToxicity || rule.classLevelInterventions) && !rule.requiresDrugConfirmation) add(path, "UNNECESSARY_CLASS_LEVEL_GUIDANCE", "Class-level alternatives require named drug confirmation on the source wording.");
      if (rule.classId === "other") add(`${path}.classId`, "OTHER_MUST_BE_GENERIC", "Other cannot have toxicity interventions.");
      if (!configuredClasses.has(rule.classId)) add(`${path}.classId`, "UNKNOWN_DRUG_CLASS", "Toxicity guidance refers to a missing drug class.");
      if (!treatments.has(rule.treatmentTypeId)) add(`${path}.treatmentTypeId`, "UNKNOWN_TREATMENT", "Toxicity guidance refers to a missing treatment type.");
      const key = JSON.stringify([rule.classId, rule.treatmentTypeId, rule.expectedToxicity.trim().toLowerCase()]);
      if (toxicityKeys.has(key)) add(path, "DUPLICATE_TOXICITY_GUIDANCE", "An active toxicity entry already exists for this class, treatment and toxicity.");
      toxicityKeys.add(key);
    });
  }
  if (definition.carePlanGuidance) {
    const carePlan = definition.carePlanGuidance;
    const configuredRisks = new Set(definition.riskCategories.map(item => item.id));
    const configuredClasses = new Set(definition.drugClassConfig?.classes.map(item => item.id) ?? []);
    const configuredTreatments = new Set(definition.sections.flatMap(section => section.fields)
      .filter(field => field.id === "current_cancer_treatment" && "options" in field)
      .flatMap(field => "options" in field ? field.options.map(option => option.id) : []));
    const configuredConditions = new Set(definition.sections.flatMap(section => section.fields)
      .filter(field => field.id === "co_morbidities" && "options" in field)
      .flatMap(field => "options" in field ? field.options.map(option => option.id) : []));
    const mappedRisks = new Set<string>();
    carePlan.riskStatusMapping.forEach((mapping, index) => {
      const path = `carePlanGuidance.riskStatusMapping.${index}`;
      if (!configuredRisks.has(mapping.riskCategoryId)) add(`${path}.riskCategoryId`, "UNKNOWN_RISK_CATEGORY", "Nutrition status mapping refers to a missing risk category.");
      if (mappedRisks.has(mapping.riskCategoryId)) add(path, "DUPLICATE_RISK_STATUS_MAPPING", "Each risk category can map to only one nutrition status.");
      mappedRisks.add(mapping.riskCategoryId);
    });
    for (const risk of configuredRisks) if (!mappedRisks.has(risk)) add("carePlanGuidance.riskStatusMapping", "MISSING_RISK_STATUS_MAPPING", "Map every risk category to a nutrition status before using care plan guidance.");
    const ids = new Set<string>();
    const unique = (id: string, path: string) => {
      if (ids.has(id)) add(`${path}.id`, "DUPLICATE_CARE_PLAN_ID", "Each care plan row needs a unique ID.");
      ids.add(id);
    };
    const modifiers = new Set<string>();
    carePlan.oncology.statusModifiers.forEach((row, index) => {
      const path = `carePlanGuidance.oncology.statusModifiers.${index}`;
      unique(row.id, path);
      if (!row.enabled) return;
      if (row.classId === "other" || !configuredClasses.has(row.classId)) add(`${path}.classId`, "UNKNOWN_DRUG_CLASS", "Status guidance must use a configured named drug class.");
      if (!configuredTreatments.has(row.treatmentTypeId)) add(`${path}.treatmentTypeId`, "UNKNOWN_TREATMENT", "Status guidance refers to a missing treatment type.");
      const key = JSON.stringify([row.classId, row.treatmentTypeId, row.nutritionalStatus]);
      if (modifiers.has(key)) add(path, "DUPLICATE_STATUS_GUIDANCE", "Only one active status rule may match this class, treatment and nutrition status.");
      modifiers.add(key);
    });
    const treatmentStatuses = new Set<string>();
    carePlan.oncology.radiotherapy.forEach((row, index) => {
      const path = `carePlanGuidance.oncology.radiotherapy.${index}`;
      unique(row.id, path);
      if (!row.enabled) return;
      const treatmentTypeId = row.treatmentTypeId ?? RADIOTHERAPY_TREATMENT_ID;
      if (!configuredTreatments.has(treatmentTypeId)) add(`${path}.treatmentTypeId`, "UNKNOWN_TREATMENT", "Treatment guidance refers to a missing treatment type.");
      const key = JSON.stringify([treatmentTypeId, row.nutritionalStatus]);
      if (treatmentStatuses.has(key)) add(path, "DUPLICATE_TREATMENT_GUIDANCE", "Only one active guidance rule may match a treatment and nutrition status.");
      treatmentStatuses.add(key);
    });
    const productKeys = new Set<string>();
    carePlan.products.plans.forEach((row, index) => {
      const path = `carePlanGuidance.products.plans.${index}`;
      unique(row.id, path);
      if (!row.enabled) return;
      const key = JSON.stringify([row.stage, row.nutritionalStatus]);
      if (productKeys.has(key)) add(path, "DUPLICATE_PRODUCT_PLAN", "Only one active product plan may match a stage and nutrition status.");
      productKeys.add(key);
    });
    const conditions = new Set<string>();
    carePlan.products.comorbidities.forEach((row, index) => {
      const path = `carePlanGuidance.products.comorbidities.${index}`;
      unique(row.id, path);
      if (!row.enabled) return;
      if (!configuredConditions.has(row.conditionId)) add(`${path}.conditionId`, "UNKNOWN_CO_MORBIDITY", "Co-morbidity guidance refers to a missing assessment option.");
      if (conditions.has(row.conditionId)) add(path, "DUPLICATE_CO_MORBIDITY_GUIDANCE", "Only one active guidance row may match a co-morbidity.");
      conditions.add(row.conditionId);
    });
    const noteKinds = new Set<string>();
    carePlan.products.notes.forEach((row, index) => {
      const path = `carePlanGuidance.products.notes.${index}`;
      unique(row.id, path);
      if (!row.enabled) return;
      if (noteKinds.has(row.kind)) add(path, "DUPLICATE_PRODUCT_NOTE", "Only one active product note may have this condition.");
      noteKinds.add(row.kind);
    });
  }
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
