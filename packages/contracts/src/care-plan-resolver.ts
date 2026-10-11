import type { FinalAssessmentDefinition } from "./final-assessment";
import type { CarePlanGuidance, NutritionalStatus } from "./care-plan-guidance";
import { guidancePresentationText } from "./guidance-presentation";

type StatusModifier = CarePlanGuidance["oncology"]["statusModifiers"][number];
type Radiotherapy = CarePlanGuidance["oncology"]["radiotherapy"][number];
type ProductPlan = CarePlanGuidance["products"]["plans"][number];
type ProductNote = CarePlanGuidance["products"]["notes"][number];
type CoMorbidity = CarePlanGuidance["products"]["comorbidities"][number];
type PublicCoMorbidity = Omit<CoMorbidity, "sourceText">;
type PublicProductNote = Omit<ProductNote, "sourceText">;

export type CarePlanFacts = {
  riskCategoryId: string | null;
  treatmentTypeIds: string[];
  drugClassIds: string[];
  coMorbidityIds?: string[];
  cancerTypeId?: string | null;
  dietPreferenceId?: string | null;
  treatmentStatusId?: string | null;
  plannedTreatmentStartDate?: string | null;
  surgicalStatusId?: string | null;
  surgeryDate?: string | null;
  plannedSurgeryDate?: string | null;
  /** Explicit clinician choice when the version is configured to ask. */
  productStageChoice?: "surgical" | "treatment_stage" | null;
  /** Trusted evaluation date supplied by the API, YYYY-MM-DD. */
  asOfDate?: string;
};

type ProductSelection = {
  status: "none" | "selected" | "clinician_choice_required" | "facts_required";
  /** Only a confirmed single plan appears here; never combine two doses. */
  plans: ProductPlan[];
  choices?: ProductPlan[];
  notes: PublicProductNote[];
  reason?: string;
};

export type MatchedCarePlan = {
  nutritionalStatus: NutritionalStatus | null;
  statusModifiers: StatusModifier[];
  radiotherapy: Radiotherapy[];
  coMorbidities: PublicCoMorbidity[];
  products: ProductSelection;
};

const stageFromStatus: Record<string, ProductPlan["stage"] | null> = {
  treatment_status_newly_diagnosed: "pre_conditioning",
  treatment_status_under_treatment: "during_treatment",
  treatment_status_post_treatment: "post_treatment",
  // Palliative care does not establish a treatment phase by itself.
  treatment_status_palliative_care: null,
};

function daysBetween(first: string, second: string): number | null {
  const a = Date.parse(`${first}T00:00:00Z`);
  const b = Date.parse(`${second}T00:00:00Z`);
  return Number.isFinite(a) && Number.isFinite(b) ? Math.round((b - a) / 86_400_000) : null;
}

function reportNote(row: ProductNote): PublicProductNote {
  const { sourceText: _sourceText, ...safe } = row;
  return safe;
}

function reportCoMorbidity(row: CoMorbidity): PublicCoMorbidity {
  const { sourceText: _sourceText, ...safe } = row;
  return { ...safe, guidance: guidancePresentationText(safe.guidance) };
}

/** Assemble guidance from the pinned rule version using explicit, confirmed facts. */
export function resolveCarePlanGuidance(definition: FinalAssessmentDefinition, facts: CarePlanFacts): MatchedCarePlan {
  const empty: MatchedCarePlan = { nutritionalStatus: null, statusModifiers: [], radiotherapy: [], coMorbidities: [], products: { status: "none", plans: [], notes: [] } };
  const config = definition.carePlanGuidance;
  // The client approved Other as exclusive: only generic nutrition guidance may be used.
  if (!config || facts.drugClassIds.includes("other")) return empty;

  const nutritionalStatus = config.riskStatusMapping.find(row => row.riskCategoryId === facts.riskCategoryId)?.nutritionalStatus ?? null;
  if (!nutritionalStatus) return empty;
  const classes = new Set(facts.drugClassIds);
  const treatments = new Set(facts.treatmentTypeIds);
  const conditions = new Set(facts.coMorbidityIds ?? []);
  const statusModifiers = config.oncology.statusModifiers.filter(row => row.enabled && classes.has(row.classId)
    && treatments.has(row.treatmentTypeId) && row.nutritionalStatus === nutritionalStatus);
  const radiotherapy = treatments.has("current_cancer_treatment_radiation")
    ? config.oncology.radiotherapy.filter(row => row.enabled && row.nutritionalStatus === nutritionalStatus) : [];
  const coMorbidities = config.products.comorbidities.filter(row => row.enabled && conditions.has(row.conditionId)).map(reportCoMorbidity);

  const allNotes = config.products.notes.filter(row => row.enabled);
  const note = (kind: ProductNote["kind"]) => allNotes.find(row => row.kind === kind);
  const selectedNotes: ProductNote[] = [];
  const addNote = (kind: ProductNote["kind"]) => { const row = note(kind); if (row) selectedNotes.push(row); };
  const treatmentStage = facts.treatmentStatusId ? stageFromStatus[facts.treatmentStatusId] : null;
  const untilTreatment = facts.asOfDate && facts.plannedTreatmentStartDate ? daysBetween(facts.asOfDate, facts.plannedTreatmentStartDate) : null;
  const applicableTreatmentStage = treatmentStage === "pre_conditioning" && (untilTreatment === null || untilTreatment < 0 || untilTreatment > 15)
    ? null : treatmentStage === "during_treatment" && !facts.treatmentTypeIds.length ? null : treatmentStage;
  const sinceSurgery = facts.asOfDate && facts.surgeryDate ? daysBetween(facts.surgeryDate, facts.asOfDate) : null;
  const untilSurgery = facts.asOfDate && facts.plannedSurgeryDate ? daysBetween(facts.asOfDate, facts.plannedSurgeryDate) : null;
  const recentSurgery = facts.surgicalStatusId === "cancer_surgical_status_done" && sinceSurgery !== null && sinceSurgery >= 0 && sinceSurgery <= 30;
  const soonSurgery = facts.surgicalStatusId === "cancer_surgical_status_planned" && untilSurgery !== null && untilSurgery >= 0 && untilSurgery <= 7;

  const stages = [applicableTreatmentStage, recentSurgery ? "surgical" : null].filter((stage): stage is ProductPlan["stage"] => Boolean(stage));
  const candidates = config.products.plans.filter(row => row.enabled && row.nutritionalStatus === nutritionalStatus && stages.includes(row.stage));
  const selectedStage = facts.productStageChoice === "surgical" ? "surgical" : facts.productStageChoice === "treatment_stage" ? applicableTreatmentStage : null;
  const chosenCandidates = candidates.length > 1 && config.surgicalOverlapPolicy === "surgical_priority"
    ? [candidates.find(row => row.stage === "surgical") ?? candidates[0]!]
    : candidates.length > 1 && config.surgicalOverlapPolicy === "clinician_choice" && selectedStage && candidates.some(row => row.stage === selectedStage)
      ? [candidates.find(row => row.stage === selectedStage)!] : candidates;
  const hasNourishPlan = chosenCandidates.some(row => /\bNourish\b/i.test(row.products));
  const hasLissPlan = chosenCandidates.some(row => /\bLiss WH\b/i.test(row.products));
  if (facts.cancerTypeId === "cancer_6" && hasNourishPlan) addNote("pancreatic_nourish_exclusion");
  if (facts.cancerTypeId === "cancer_5" && hasNourishPlan) addNote("liver_nourish_once_daily");
  if (facts.dietPreferenceId === "vegetarian" && hasLissPlan) addNote("vegetarian_liss_substitution");
  // A surgery note recommends Liss WH, so expose it only when that plan is
  // selected and the diet is confirmed compatible with the workbook note.
  if (recentSurgery && sinceSurgery !== null && sinceSurgery <= 7 && chosenCandidates.length === 1
    && chosenCandidates[0]?.stage === "surgical" && facts.dietPreferenceId === "non_vegetarian") addNote("surgery_done_liss");
  if (soonSurgery && facts.dietPreferenceId === "non_vegetarian") addNote("surgery_planned_liss");
  const visibleNotes = selectedNotes.map(reportNote);
  const base = { nutritionalStatus, statusModifiers, radiotherapy, coMorbidities };
  if (facts.surgicalStatusId === "cancer_surgical_status_done" && !facts.surgeryDate) {
    return { ...base, products: { status: "facts_required", plans: [], notes: visibleNotes, reason: "Surgery date is needed to check the Surgical plan window." } };
  }
  if (treatmentStage === "pre_conditioning" && !facts.plannedTreatmentStartDate && !recentSurgery) {
    return { ...base, products: { status: "facts_required", plans: [], notes: visibleNotes, reason: "Planned treatment start date is needed to check the 15-day pre-treatment plan." } };
  }
  if (!candidates.length) return { ...base, products: { status: "none", plans: [], notes: visibleNotes } };

  // A missing cancer/diet fact could hide a workbook exception. Withhold the
  // affected product plan until those facts are known, never infer a dose.
  if (hasNourishPlan && !facts.cancerTypeId) {
    return { ...base, products: { status: "facts_required", plans: [], notes: visibleNotes, reason: "Cancer type is needed to check Nourish restrictions." } };
  }
  if (hasLissPlan && !facts.dietPreferenceId) {
    return { ...base, products: { status: "facts_required", plans: [], notes: visibleNotes, reason: "Diet preference is needed to check the Liss WH substitution." } };
  }
  if (facts.cancerTypeId === "cancer_6" && hasNourishPlan) {
    return { ...base, products: { status: "clinician_choice_required", plans: [], notes: visibleNotes, reason: "Nourish is excluded for pancreatic cancer; the listed plan needs an adjusted dose." } };
  }
  if (facts.cancerTypeId === "cancer_5" && chosenCandidates.some(row => /\b(?:2|3)\s+Nourish\b/i.test(row.dose))) {
    return { ...base, products: { status: "clinician_choice_required", plans: [], notes: visibleNotes, reason: "Nourish is limited to once daily for liver cancer; the listed dose needs adjustment." } };
  }
  if (hasLissPlan && facts.dietPreferenceId !== "non_vegetarian") {
    const reason = facts.dietPreferenceId === "vegetarian"
      ? "Vegetarian patients need Invigour instead of Liss WH, but no replacement dose is specified."
      : "No Liss WH dose is confirmed for this diet preference; a clinician must choose an appropriate plan.";
    return { ...base, products: { status: "clinician_choice_required", plans: [], notes: visibleNotes, reason } };
  }

  if (chosenCandidates.length > 1 && config.surgicalOverlapPolicy === "clinician_choice") {
    return { ...base, products: { status: "clinician_choice_required", plans: [], choices: chosenCandidates, notes: visibleNotes, reason: "Both treatment-stage and Surgical plans match; a clinician must choose one. Do not combine doses." } };
  }
  const selected = chosenCandidates[0]!;
  return { ...base, products: { status: "selected", plans: [selected], notes: visibleNotes } };
}
