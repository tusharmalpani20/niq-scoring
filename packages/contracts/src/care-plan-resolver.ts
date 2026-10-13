import type { FinalAssessmentDefinition } from "./final-assessment";
import { RADIOTHERAPY_TREATMENT_ID, type CarePlanGuidance, type NutritionalStatus } from "./care-plan-guidance";
import { guidancePresentationText } from "./guidance-presentation";
import { defaultProductExceptionAction, defaultProductNoteMatch, productDurationDays, productIdentityName, productPlanItems, productPlanSnapshot, type ProductExceptionAction } from "./product-guidance";

type StatusModifier = CarePlanGuidance["oncology"]["statusModifiers"][number];
type TreatmentGuidance = CarePlanGuidance["oncology"]["radiotherapy"][number] & { treatmentTypeId: string };
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
  treatmentGuidance: TreatmentGuidance[];
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

function addDays(date: string, days: number): string | null {
  const start = Date.parse(`${date}T00:00:00Z`);
  return Number.isFinite(start) ? new Date(start + days * 86_400_000).toISOString().slice(0, 10) : null;
}

function reportPlan(plan: ProductPlan, facts: CarePlanFacts): ProductPlan {
  // Pinned older versions retain their original month wording. Editable drafts
  // convert the two reviewed defaults before they are saved as day-based rules.
  if (/\bmonths?\b/i.test(plan.duration)) return plan;
  const amount = productDurationDays(plan);
  if (amount === null) return plan;
  if (plan.stage === "pre_conditioning" && facts.plannedTreatmentStartDate) {
    const firstDay = addDays(facts.plannedTreatmentStartDate, -amount);
    return { ...plan, duration: `${amount} days before treatment${firstDay ? ` (${firstDay} to ${facts.plannedTreatmentStartDate})` : ""}` };
  }
  if (plan.stage === "surgical" && facts.surgeryDate) {
    const lastDay = addDays(facts.surgeryDate, amount);
    return { ...plan, duration: `${amount} days after surgery${lastDay ? ` (through ${lastDay})` : ""}` };
  }
  if (plan.stage === "during_treatment") return { ...plan, duration: `At least ${amount} days during treatment` };
  if (plan.stage === "post_treatment") return { ...plan, duration: `${amount} days or more after treatment` };
  return plan;
}

function reportNote(row: ProductNote): PublicProductNote {
  const { sourceText: _sourceText, ...safe } = row;
  const action = noteAction(row);
  return action ? { ...safe, action } : safe;
}

function reportCoMorbidity(row: CoMorbidity): PublicCoMorbidity {
  const { sourceText: _sourceText, ...safe } = row;
  return { ...safe, guidance: guidancePresentationText(safe.guidance) };
}

function planContainsProduct(plan: ProductPlan, name: string) {
  if (plan.items) return plan.items.some(item => productIdentityName(item.productName) === productIdentityName(name));
  if (plan.productNames) return plan.productNames.some(product => productIdentityName(product) === productIdentityName(name));
  // Historical versions only saved a display string.
  return plan.products.split(" + ").some(product => productIdentityName(product) === productIdentityName(name));
}

function noteAction(row: ProductNote): ProductExceptionAction | null {
  return row.action ?? defaultProductExceptionAction(row.kind);
}

function actionTargets(action: ProductExceptionAction): string[] {
  return action.type === "use_plan" ? ["plan"]
    : action.type === "replace" ? [action.productName, action.replacementProductName].map(productIdentityName)
      : [productIdentityName(action.productName)];
}

/** Assemble guidance from the pinned rule version using explicit, confirmed facts. */
export function resolveCarePlanGuidance(definition: FinalAssessmentDefinition, facts: CarePlanFacts): MatchedCarePlan {
  const empty: MatchedCarePlan = { nutritionalStatus: null, statusModifiers: [], treatmentGuidance: [], coMorbidities: [], products: { status: "none", plans: [], notes: [] } };
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
  const treatmentGuidance = config.oncology.radiotherapy
    .filter(row => row.enabled && row.nutritionalStatus === nutritionalStatus && treatments.has(row.treatmentTypeId ?? RADIOTHERAPY_TREATMENT_ID))
    .map(row => ({ ...row, treatmentTypeId: row.treatmentTypeId ?? RADIOTHERAPY_TREATMENT_ID }));
  const coMorbidities = config.products.comorbidities.filter(row => row.enabled && conditions.has(row.conditionId)).map(reportCoMorbidity);

  const allNotes = config.products.notes.filter(row => row.enabled);
  const treatmentStage = facts.treatmentStatusId ? stageFromStatus[facts.treatmentStatusId] : null;
  const planFor = (stage: ProductPlan["stage"]) => config.products.plans.find(row => row.enabled && row.stage === stage && row.nutritionalStatus === nutritionalStatus);
  const preTreatmentPlan = planFor("pre_conditioning");
  const surgicalPlan = planFor("surgical");
  const preTreatmentDays = preTreatmentPlan ? productDurationDays(preTreatmentPlan) : null;
  const surgicalDays = surgicalPlan ? productDurationDays(surgicalPlan) : null;
  const untilTreatment = facts.asOfDate && facts.plannedTreatmentStartDate ? daysBetween(facts.asOfDate, facts.plannedTreatmentStartDate) : null;
  const applicableTreatmentStage = treatmentStage === "pre_conditioning" && (untilTreatment === null || preTreatmentDays === null || untilTreatment < 0 || untilTreatment > preTreatmentDays)
    ? null : treatmentStage === "during_treatment" && !facts.treatmentTypeIds.length ? null : treatmentStage;
  const sinceSurgery = facts.asOfDate && facts.surgeryDate ? daysBetween(facts.surgeryDate, facts.asOfDate) : null;
  const untilSurgery = facts.asOfDate && facts.plannedSurgeryDate ? daysBetween(facts.asOfDate, facts.plannedSurgeryDate) : null;
  const recentSurgery = facts.surgicalStatusId === "cancer_surgical_status_done" && sinceSurgery !== null && surgicalDays !== null && sinceSurgery >= 0 && sinceSurgery <= surgicalDays;
  const matchesNote = (row: ProductNote) => {
    const match = row.match ?? (row.kind === "custom" ? null : defaultProductNoteMatch(row.kind));
    if (!match) return false;
    const answer = match.fieldId === "cancer_type" ? facts.cancerTypeId
      : match.fieldId === "diet_preference" ? facts.dietPreferenceId : facts.surgicalStatusId;
    if (answer !== match.optionId) return false;
    if (match.withinDays === undefined) return true;
    const days = match.optionId === "cancer_surgical_status_done" ? sinceSurgery : untilSurgery;
    return days !== null && days >= 0 && days <= match.withinDays;
  };

  const stages = [applicableTreatmentStage, recentSurgery ? "surgical" : null].filter((stage): stage is ProductPlan["stage"] => Boolean(stage));
  const candidates = config.products.plans.filter(row => row.enabled && row.nutritionalStatus === nutritionalStatus && stages.includes(row.stage));
  const selectedStage = facts.productStageChoice === "surgical" ? "surgical" : facts.productStageChoice === "treatment_stage" ? applicableTreatmentStage : null;
  const chosenCandidates = candidates.length > 1 && config.surgicalOverlapPolicy === "surgical_priority"
    ? [candidates.find(row => row.stage === "surgical") ?? candidates[0]!]
    : candidates.length > 1 && config.surgicalOverlapPolicy === "clinician_choice" && selectedStage && candidates.some(row => row.stage === selectedStage)
      ? [candidates.find(row => row.stage === selectedStage)!] : candidates;
  const hasLissPlan = chosenCandidates.some(row => planContainsProduct(row, "Liss WH"));
  const relevantToCandidate = (row: ProductNote) => {
    const action = noteAction(row);
    if (!action) return false;
    if (row.kind === "surgery_done_liss") return recentSurgery && chosenCandidates.length === 1
      && chosenCandidates[0]?.stage === "surgical" && facts.dietPreferenceId === "non_vegetarian";
    if (row.kind === "surgery_planned_liss") return facts.dietPreferenceId === "non_vegetarian";
    if (action.type === "recommend") return chosenCandidates.length > 0;
    if (action.type === "use_plan") return chosenCandidates.some(plan => plan.stage === action.stage);
    return chosenCandidates.some(plan => planContainsProduct(plan, action.productName));
  };
  const selectedNotes = allNotes.filter(row => matchesNote(row) && relevantToCandidate(row));
  const visibleNotes = selectedNotes.map(reportNote);
  const base = { nutritionalStatus, statusModifiers, treatmentGuidance, coMorbidities };
  if (facts.surgicalStatusId === "cancer_surgical_status_done" && !facts.surgeryDate) {
    return { ...base, products: { status: "facts_required", plans: [], notes: visibleNotes, reason: "Surgery date is needed to check the Surgical plan window." } };
  }
  if (treatmentStage === "pre_conditioning" && !facts.plannedTreatmentStartDate && !recentSurgery) {
    return { ...base, products: { status: "facts_required", plans: [], notes: visibleNotes, reason: "Planned treatment start date is needed to check the pre-treatment product window." } };
  }
  if (!candidates.length) return { ...base, products: { status: "none", plans: [], notes: visibleNotes } };

  // An unknown assessment answer could hide a product change. Do not release
  // the base dose until all relevant exception conditions can be evaluated.
  const unresolvedMatch = allNotes.find(row => relevantToCandidate(row) && (() => {
    const match = row.match ?? (row.kind === "custom" ? null : defaultProductNoteMatch(row.kind));
    if (!match) return false;
    if (match.fieldId === "cancer_type") return !facts.cancerTypeId;
    if (match.fieldId === "diet_preference") return !facts.dietPreferenceId;
    return !facts.surgicalStatusId || match.withinDays !== undefined &&
      (match.optionId === "cancer_surgical_status_done" ? !facts.surgeryDate : !facts.plannedSurgeryDate)
      && facts.surgicalStatusId === match.optionId;
  })());
  if (unresolvedMatch) {
    const match = unresolvedMatch.match ?? defaultProductNoteMatch(unresolvedMatch.kind);
    const reason = match.fieldId === "cancer_type" ? "Cancer type is needed to check product exceptions."
      : match.fieldId === "diet_preference" ? "Diet preference is needed to check product exceptions."
        : "Surgery status and its date are needed to check product exceptions.";
    return { ...base, products: { status: "facts_required", plans: [], notes: visibleNotes, reason } };
  }
  if (hasLissPlan && !facts.dietPreferenceId) {
    return { ...base, products: { status: "facts_required", plans: [], notes: visibleNotes, reason: "Diet preference is needed to check the Liss WH substitution." } };
  }
  if (chosenCandidates.length > 1 && config.surgicalOverlapPolicy === "clinician_choice") {
    const hasProductChange = selectedNotes.some(row => noteAction(row)?.type !== "use_plan");
    return { ...base, products: { status: "clinician_choice_required", plans: [],
      ...(hasProductChange ? {} : { choices: chosenCandidates.map(row => reportPlan(row, facts)) }),
      notes: visibleNotes, reason: hasProductChange
        ? "Both treatment-stage and Surgical plans match with product exceptions; a clinician must choose and review the adjusted plan."
        : "Both treatment-stage and Surgical plans match; a clinician must choose one. Do not combine doses." } };
  }
  const selected = chosenCandidates[0]!;
  const unresolved = (reason: string): MatchedCarePlan => ({ ...base, products: {
    status: "clinician_choice_required", plans: [], notes: visibleNotes, reason,
  } });
  if (hasLissPlan && facts.dietPreferenceId !== "non_vegetarian" &&
    !selectedNotes.some(row => {
      const action = noteAction(row);
      return action && ["replace", "remove", "delay"].includes(action.type)
        && "productName" in action && productIdentityName(action.productName) === "liss wh";
    })) {
    return unresolved("No Liss WH dose is confirmed for this diet preference; a clinician must choose an appropriate plan.");
  }
  const seenTargets = new Set<string>();
  for (const row of selectedNotes) {
    const action = noteAction(row);
    if (!action) continue;
    for (const target of actionTargets(action)) {
      if (seenTargets.has(target)) return unresolved("Matched product exceptions conflict; a clinician must choose the plan.");
      seenTargets.add(target);
    }
  }
  let items = productPlanItems(selected);
  let adjusted = false;
  for (const row of selectedNotes) {
    const action = noteAction(row);
    if (!action || action.type === "use_plan") continue;
    const source = productIdentityName(action.productName);
    const hasSource = planContainsProduct(selected, action.productName);
    if (action.type !== "recommend" && !hasSource) continue;
    if (action.type === "replace" && !action.matchSourceQuantity && action.replacementQuantityPerDay === undefined)
      return unresolved(`${row.label} requires ${action.replacementProductName} instead of ${action.productName}, but no replacement quantity is specified.`);
    if (!items.length) return unresolved(`The ${selected.stage} plan has no structured daily quantities to adjust for ${row.label}.`);
    const index = items.findIndex(item => productIdentityName(item.productName) === source);
    if (action.type === "remove" || action.type === "delay") {
      items = items.filter(item => productIdentityName(item.productName) !== source);
      if (!items.length) return unresolved(`${row.label} removes the only product in this plan; a clinician must choose another plan.`);
      adjusted = true;
    } else if (action.type === "limit") {
      if (index >= 0 && items[index]!.quantityPerDay === undefined) {
        return unresolved(`${row.label} needs a known daily quantity for ${action.productName} before it can be limited.`);
      }
      if (index >= 0 && items[index]!.quantityPerDay! > action.maxQuantityPerDay) {
        items[index] = { ...items[index]!, quantityPerDay: action.maxQuantityPerDay };
        adjusted = true;
      }
    } else if (action.type === "replace") {
      const replacementQuantity = action.matchSourceQuantity ? items[index]?.quantityPerDay : action.replacementQuantityPerDay;
      if (replacementQuantity === undefined) return unresolved(`${row.label} needs a known daily quantity for ${action.productName} before it can be replaced.`);
      items = items.filter(item => productIdentityName(item.productName) !== source);
      const destination = items.findIndex(item => productIdentityName(item.productName) === productIdentityName(action.replacementProductName));
      const replacement = { productName: action.replacementProductName, quantityPerDay: replacementQuantity,
        ...(action.description ? { description: action.description } : {}) };
      if (destination >= 0) items[destination] = replacement;
      else items.push(replacement);
      adjusted = true;
    } else if (action.type === "recommend") {
      if (index >= 0) {
        items[index] = { ...items[index]!, quantityPerDay: action.quantityPerDay,
          ...(action.description ? { description: action.description } : {}) };
        adjusted = true;
      } else {
        items.push({ productName: action.productName, quantityPerDay: action.quantityPerDay,
          ...(action.description ? { description: action.description } : {}) });
        adjusted = true;
      }
    }
  }
  const finalPlan = adjusted ? { ...selected, ...productPlanSnapshot(items) } : selected;
  return { ...base, products: { status: "selected", plans: [reportPlan(finalPlan, facts)], notes: visibleNotes } };
}
