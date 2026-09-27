import type { ReactNode } from "react";
import { CancerTypeIcon } from "./CancerTypeIcon";
import { ClinicalGutChoiceIcon } from "./ClinicalGutChoiceIcon";
import { DietaryIntakeIcon } from "./DietaryIntakeIcon";
import { DietaryStatusIcon } from "./DietaryStatusIcon";
import { DietarySymptomIcon } from "./DietarySymptomIcon";
import { DiseaseChoiceIcon } from "./DiseaseChoiceIcon";
import { HealthHistoryChoiceIcon } from "./HealthHistoryChoiceIcon";
import { MedicationSupplementIcon } from "./MedicationSupplementIcon";
import { TreatmentChoiceIcon } from "./TreatmentChoiceIcon";
import { TumourTypeIcon } from "./TumourTypeIcon";

/** Reuse the form's visual cues when showing a selected answer for verification. */
export function assessmentOptionIcon(fieldId: string, optionId: string): ReactNode {
  if (fieldId === "tumour_type") return <TumourTypeIcon type={optionId} />;
  if (fieldId === "cancer_type") return <CancerTypeIcon type={optionId} />;
  if (["stage", "metastasis_site", "relapse_status"].includes(fieldId)) return <DiseaseChoiceIcon type={optionId} />;
  if (["treatment_status", "palliative_status", "palliative_timing", "cancer_surgical_status", "current_cancer_treatment"].includes(fieldId)) return <TreatmentChoiceIcon type={optionId} />;
  if (["previous_surgeries", "family_history_cancer", "co_morbidities"].includes(fieldId)) return <HealthHistoryChoiceIcon type={optionId} />;
  if (["current_medications", "supplements_intake"].includes(fieldId)) return <MedicationSupplementIcon type={optionId} />;
  if (["appetite_status", "bowel_pattern", "stool_frequency", "gastrointestinal_symptoms"].includes(fieldId)) return <ClinicalGutChoiceIcon type={optionId} />;
  if (fieldId === "dietary_intake") return <DietaryIntakeIcon type={optionId} />;
  if (["functional_capacity", "stress_level", "fluid_intake"].includes(fieldId)) return <DietaryStatusIcon type={optionId} />;
  if (fieldId === "dietary_symptoms") return <DietarySymptomIcon type={optionId} />;
  return null;
}
