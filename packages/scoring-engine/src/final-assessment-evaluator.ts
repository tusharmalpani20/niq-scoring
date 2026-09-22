import { classifyScore } from "./score-classification";
import { weightLossInRange } from "./weight-loss-range";
import { inRange } from "@niq-scoring/contracts/rule-validation";
import type { DefinitionIssue } from "@niq-scoring/contracts/rules";
import { validateFinalAssessmentDefinition } from "@niq-scoring/contracts/final-assessment-validation";
import type { FinalAssessmentAnswers, FinalAssessmentDefinition, FinalAssessmentField } from "@niq-scoring/contracts/final-assessment";
import { FINAL_ASSESSMENT_FORMAT_VERSION, FINAL_ASSESSMENT_PROFILE, FINAL_ASSESSMENT_PROVISIONAL_STATUS } from "@niq-scoring/contracts/final-assessment";
import type { EvaluationIssue } from "./rule-answers";

type ComponentStatus = "answered" | "unanswered" | "pending";
export type FinalAssessmentComponent = { id: string; sectionId: string; label: string; points: number | null; status: ComponentStatus; reason?: string };
export type FinalAssessmentEvaluation = {
  formatVersion: 2;
  profile: typeof FINAL_ASSESSMENT_PROFILE;
  complete: boolean;
  score: number | null;
  classification: { id: string; label: string; interpretation: string } | null;
  components: FinalAssessmentComponent[];
  answerCoverage: { totalEntries: 19; answeredEntries: number; unansweredEntries: number; pendingEntries: number; allUnanswered: boolean };
  derived: { weightLossPercent: number | null; proteinAdequacy: "adequate" | "inadequate" | null };
  riskStatus: FinalAssessmentDefinition["provisional"]["status"];
  clinicalUsePermitted: boolean;
  interventions: { status: "NOT_APPLICABLE" };
  issues: EvaluationIssue[];
};

const hasValue = (value: unknown): boolean => value !== undefined && value !== null;
const asString = (value: unknown): string | null => typeof value === "string" ? value : null;
const asStringArray = (value: unknown): string[] | null => Array.isArray(value) && value.every(item => typeof item === "string") ? value : null;
const issueKey = (issue: EvaluationIssue) => `${issue.path}:${issue.code}`;

function baseResult(issues: EvaluationIssue[] = []): FinalAssessmentEvaluation {
  return {
    formatVersion: FINAL_ASSESSMENT_FORMAT_VERSION,
    profile: FINAL_ASSESSMENT_PROFILE,
    complete: false,
    score: null,
    classification: null,
    components: [],
    answerCoverage: { totalEntries: 19, answeredEntries: 0, unansweredEntries: 19, pendingEntries: 0, allUnanswered: true },
    derived: { weightLossPercent: null, proteinAdequacy: null },
    riskStatus: FINAL_ASSESSMENT_PROVISIONAL_STATUS,
    clinicalUsePermitted: false,
    interventions: { status: "NOT_APPLICABLE" },
    issues,
  };
}

export function evaluateFinalAssessment(definition: FinalAssessmentDefinition, answers: FinalAssessmentAnswers): FinalAssessmentEvaluation {
  const structural = validateFinalAssessmentDefinition(definition);
  const issues: EvaluationIssue[] = structural.map((issue: DefinitionIssue) => ({ path: issue.path, code: "INVALID_CONFIGURATION", message: issue.message }));
  const result = baseResult(issues);
  result.riskStatus = definition.provisional.status;
  result.clinicalUsePermitted = definition.provisional.clinicalUsePermitted;
  if (issues.length) return result;

  const fields = definition.sections.flatMap(section => section.fields.map(field => ({ sectionId: section.id, field })));
  const fieldMap = new Map(fields.map(item => [item.field.id, item.field]));
  const invalidIds = new Set<string>();
  const known = new Set([...fieldMap.keys(), ...definition.supportingInputs.map(input => input.id)]);
  const add = (path: string, code: string, message: string) => {
    const issue = { path, code, message } satisfies EvaluationIssue;
    if (!issues.some(existing => issueKey(existing) === issueKey(issue))) issues.push(issue);
  };
  for (const id of Object.keys(answers)) {
    if (!known.has(id)) {
      add(`answers.${id}`, /name|contact|age|gender|family|relation|date/i.test(id) ? "IDENTITY_FIELD_NOT_ALLOWED" : "UNKNOWN_ANSWER", "This answer is not accepted by the final assessment profile.");
    }
  }
  const raw = (id: string) => answers[id];
  const validateChoice = (id: string, options: Array<{ id: string }>) => {
    const value = raw(id);
    if (!hasValue(value)) return;
    const allowed = new Set(options.map(option => option.id));
    if (typeof value !== "string" || !allowed.has(value)) { invalidIds.add(id); add(`answers.${id}`, "INVALID_ANSWER", "Choose one of the fixed options."); }
  };
  const validateMulti = (id: string, options: Array<{ id: string }>) => {
    const value = raw(id);
    if (!hasValue(value)) return;
    const selected = asStringArray(value);
    const allowed = new Set(options.map(option => option.id));
    if (!selected || new Set(selected).size !== selected.length || selected.some(option => !allowed.has(option))) { invalidIds.add(id); add(`answers.${id}`, "INVALID_ANSWER", "Choose unique fixed options."); }
    return selected;
  };
  const validateNumber = (id: string) => {
    const value = raw(id);
    if (!hasValue(value)) return;
    if (typeof value !== "number" || !Number.isFinite(value)) { invalidIds.add(id); add(`answers.${id}`, "INVALID_ANSWER", "Enter a finite number."); }
  };

  for (const { field } of fields) {
    if (field.kind === "select" || field.kind === "yes_no" || field.kind === "conditional" || field.kind === "count") validateChoice(field.id, field.options);
    else if (field.kind === "multi_select") validateMulti(field.id, field.options);
    else if ((field.kind === "calculated" || field.kind === "derived") && hasValue(raw(field.id))) { invalidIds.add(field.id); add(`answers.${field.id}`, "DERIVED_ANSWER_NOT_ALLOWED", "Calculated values cannot be submitted."); }
  }
  for (const input of definition.supportingInputs) {
    if (input.kind === "number") {
      validateNumber(input.id);
      if ((input.id === "previous_weight_kg" || input.id === "current_weight_kg") && hasValue(raw(input.id)) && typeof raw(input.id) === "number" && (raw(input.id) as number) <= 0) {
        invalidIds.add(input.id); add(`answers.${input.id}`, "INVALID_WEIGHT", "Weight must be greater than zero.");
      }
    }
    else validateChoice(input.id, input.options);
  }
  const dietarySymptoms = fieldMap.get("dietary_symptoms");
  const symptomAnswer = dietarySymptoms?.kind === "multi_select" ? asStringArray(raw("dietary_symptoms")) : null;
  if (symptomAnswer?.includes("dietary_symptoms_no_problem") && symptomAnswer.length > 1) {
    invalidIds.add("dietary_symptoms");
    add("answers.dietary_symptoms", "CONTRADICTORY_ANSWER", "No problem while eating cannot be selected with other symptoms.");
  }
  const treatment = raw("treatment_status");
  const palliativeStatus = raw("palliative_status");
  const palliativeTiming = raw("palliative_timing");
  if (hasValue(palliativeStatus) && treatment !== "treatment_status_palliative_care") { invalidIds.add("palliative_status"); add("answers.palliative_status", "INACTIVE_DEPENDENCY", "Clear the palliative path when treatment status changes."); }
  if (hasValue(palliativeTiming) && (treatment !== "treatment_status_palliative_care" || palliativeStatus !== "post_treatment")) { invalidIds.add("palliative_timing"); add("answers.palliative_timing", "INACTIVE_DEPENDENCY", "Clear the palliative timing when its parent path is inactive."); }
  const surgery = raw("previous_surgeries");
  if (hasValue(raw("previous_surgery_count")) && surgery !== "previous_surgeries_yes") { invalidIds.add("previous_surgery_count"); add("answers.previous_surgery_count", "INACTIVE_DEPENDENCY", "A surgery count is only valid when previous surgeries is Yes."); }
  const components: FinalAssessmentComponent[] = [];
  let weightLossPercent: number | null = null;
  let proteinAdequacy: "adequate" | "inadequate" | null = null;

  const push = (sectionId: string, field: FinalAssessmentField, points: number | null, status: ComponentStatus, reason?: string) => {
    components.push({ id: field.id, sectionId, label: field.label, points, status, ...(reason ? { reason } : {}) });
  };
  const mapPoints = (mapping: Array<{ optionId: string; points: number }>, ids: string[]) => ids.reduce((sum, id) => sum + (mapping.find(item => item.optionId === id)?.points ?? 0), 0);
  for (const { sectionId, field } of fields) {
    const answer = raw(field.id);
    if (field.kind === "select" || field.kind === "yes_no" || field.kind === "multi_select") {
      if (!hasValue(answer)) { push(sectionId, field, null, "unanswered"); continue; }
      if (invalidIds.has(field.id)) { push(sectionId, field, null, "unanswered", "Invalid answer"); continue; }
      const ids = field.kind === "multi_select" ? (asStringArray(answer) ?? []) : [asString(answer)!];
      push(sectionId, field, mapPoints(field.scoring.points, ids), "answered");
      continue;
    }
    if (field.kind === "conditional") {
      if (!hasValue(answer)) { push(sectionId, field, null, "unanswered"); continue; }
      if (invalidIds.has(field.id)) { push(sectionId, field, null, "unanswered", "Invalid answer"); continue; }
      if (answer !== field.scoring.palliative.optionId) {
        const points = field.scoring.normalPoints.find(item => item.optionId === answer)?.points ?? null;
        push(sectionId, field, points, points === null ? "pending" : "answered", points === null ? "Treatment point mapping is unavailable." : undefined);
        continue;
      }
      if (!hasValue(palliativeStatus)) { push(sectionId, field, null, "pending", "Choose a palliative treatment path."); continue; }
      if (palliativeStatus === "with_cancer") { push(sectionId, field, field.scoring.palliative.paths.find(path => path.id === "with_cancer")!.points, "answered"); continue; }
      if (palliativeStatus === "post_treatment") {
        if (!hasValue(palliativeTiming)) { push(sectionId, field, null, "pending", "Choose the post-treatment timing."); continue; }
        const branch = field.scoring.palliative.paths.find(path => path.id === "post_treatment");
        const leaf = branch?.children.find(child => child.id === palliativeTiming);
        push(sectionId, field, leaf?.points ?? null, leaf ? "answered" : "pending", leaf ? undefined : "Choose a fixed palliative timing.");
        continue;
      }
      push(sectionId, field, null, "pending", "Choose a fixed palliative treatment path.");
      continue;
    }
    if (field.kind === "count") {
      if (!hasValue(answer)) { push(sectionId, field, null, "unanswered"); continue; }
      if (invalidIds.has(field.id)) { push(sectionId, field, null, "unanswered", "Invalid answer"); continue; }
      if (answer === "previous_surgeries_no") { push(sectionId, field, 0, "answered"); continue; }
      const count = raw(field.countInputId);
      if (!hasValue(count)) { push(sectionId, field, null, "pending", "Enter the number of previous surgeries."); continue; }
      if (typeof count !== "number" || !Number.isSafeInteger(count) || count <= 0) { invalidIds.add(field.countInputId); add(`answers.${field.countInputId}`, "INVALID_COUNT", "Use a positive safe integer for surgery count."); push(sectionId, field, null, "unanswered", "Invalid surgery count"); continue; }
      const points = count * field.scoring.pointsPerCount;
      if (!Number.isFinite(points) || definition.provisional.status === "CLIENT_CONFIRMED" && !Number.isSafeInteger(points)) { add(`answers.${field.id}`, "INVALID_ARITHMETIC", "The surgery count result is outside the supported numeric range."); push(sectionId, field, null, "unanswered", "Invalid surgery calculation"); continue; }
      push(sectionId, field, points, "answered");
      continue;
    }
    if (field.kind === "calculated") {
      const previous = raw(field.inputIds[0]);
      const current = raw(field.inputIds[1]);
      if (!hasValue(previous) || !hasValue(current)) { push(sectionId, field, null, "pending", "Enter both weights to calculate weight loss."); continue; }
      if (invalidIds.has(field.inputIds[0]) || invalidIds.has(field.inputIds[1])) {
        if (typeof previous === "number" && previous <= 0 || typeof current === "number" && current <= 0) add("answers.weight", "INVALID_WEIGHT", "Weights must be finite and greater than zero.");
        push(sectionId, field, null, "unanswered", "Invalid weight input"); continue;
      }
      if (typeof previous !== "number" || typeof current !== "number" || previous <= 0 || current <= 0) { add("answers.weight", "INVALID_WEIGHT", "Weights must be finite and greater than zero."); push(sectionId, field, null, "unanswered", "Invalid weight input"); continue; }
      weightLossPercent = (previous - current) / previous * 100;
      if (!Number.isFinite(weightLossPercent)) { add("answers.weight", "INVALID_ARITHMETIC", "Weight-loss calculation is outside the supported numeric range."); push(sectionId, field, null, "unanswered", "Invalid weight calculation"); continue; }
      const match = field.scoring.bands.filter(band => definition.provisional.status === "CLIENT_CONFIRMED" ? weightLossInRange(previous, current, band) : inRange(weightLossPercent!, band));
      push(sectionId, field, match.length === 1 ? match[0]!.points : null, match.length === 1 ? "answered" : "pending", match.length === 1 ? undefined : "Weight-loss bands do not define one result.");
      continue;
    }
    if (field.kind === "derived") {
      const intake = raw(field.sourceInputId);
      if (!hasValue(intake)) { push(sectionId, field, null, "pending", "Choose dietary intake to derive protein adequacy."); continue; }
      if (invalidIds.has(field.sourceInputId)) { push(sectionId, field, null, "unanswered", "Invalid dietary intake"); continue; }
      const mapping = field.scoring.mapping.find(item => item.inputOptionId === intake);
      const outcome = field.scoring.outcomes.find(item => item.id === mapping?.outcomeId);
      if (!mapping || !outcome) { push(sectionId, field, null, "pending", "Protein mapping is unavailable."); continue; }
      proteinAdequacy = outcome.id === "adequate" ? "adequate" : "inadequate";
      push(sectionId, field, outcome.points, "answered");
    }
  }
  result.components = components;
  result.derived = { weightLossPercent, proteinAdequacy };
  result.issues = issues;
  const answeredEntries = components.filter(component => component.status === "answered").length;
  const pendingEntries = components.filter(component => component.status === "pending").length;
  const unansweredEntries = components.filter(component => component.status === "unanswered").length;
  result.answerCoverage = { totalEntries: 19, answeredEntries, unansweredEntries, pendingEntries, allUnanswered: answeredEntries === 0 };
  if (issues.length || answeredEntries === 0) return result;
  const score = components.filter(component => component.points !== null).reduce((sum, component) => sum + component.points!, 0);
  if (!Number.isFinite(score) || definition.provisional.status === "CLIENT_CONFIRMED" && !Number.isSafeInteger(score)) { add("score", "INVALID_ARITHMETIC", "The score is outside the supported numeric range."); return result; }
  result.score = score;
  const classification = classifyScore(definition, score);
  if (!classification) { add("riskCategories", "UNMATCHED_CLASSIFICATION", "Score must match exactly one provisional risk category."); return result; }
  result.classification = classification;
  result.complete = true;
  return result;
}

export function validateFinalAssessmentSamples(definition: FinalAssessmentDefinition): EvaluationIssue[] {
  const issues: EvaluationIssue[] = [];
  if (!definition.samples.length) issues.push({ path: "samples", code: "NO_SAMPLES", message: "Add independently specified synthetic sample cases before validation." });
  if (definition.samples.length && !definition.samples.some(sample => sample.expected.complete)) issues.push({ path: "samples", code: "NO_COMPLETE_SAMPLE", message: "Include a complete synthetic sample case." });
  for (const sample of definition.samples) {
    const actual = evaluateFinalAssessment(definition, sample.answers);
    const expected = sample.expected;
    if (actual.complete !== expected.complete) issues.push({ path: `samples.${sample.id}.complete`, code: "SAMPLE_MISMATCH", message: `Sample ${sample.name}: complete result does not match the independently specified expectation.` });
    if (actual.score !== expected.score) issues.push({ path: `samples.${sample.id}.score`, code: "SAMPLE_MISMATCH", message: `Sample ${sample.name}: score does not match the independently specified expectation.` });
    if (expected.classificationId !== undefined && (actual.classification?.id ?? null) !== expected.classificationId) issues.push({ path: `samples.${sample.id}.classificationId`, code: "SAMPLE_MISMATCH", message: `Sample ${sample.name}: risk category does not match the independently specified expectation.` });
  }
  return issues;
}
