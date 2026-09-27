import { BicepsFlexed, CircleCheck, DropletOff, MoonStar, Wind, type LucideIcon } from "lucide-react";
import { ClinicalGutChoiceIcon } from "./ClinicalGutChoiceIcon";

// Shared symptoms keep the same pictogram wherever they appear in the assessment.
const sharedSymptoms: Record<string, string> = {
  dietary_symptoms_no_appetite: "appetite_status_no_appetite",
  dietary_symptoms_nausea: "gastrointestinal_symptoms_nausea",
  dietary_symptoms_vomiting: "gastrointestinal_symptoms_vomiting",
  dietary_symptoms_constipation: "constipation",
  dietary_symptoms_diarrhoea: "diarrhoea",
  dietary_symptoms_mouth_sores: "gastrointestinal_symptoms_mouth_ulcers",
  dietary_symptoms_taste_funny: "gastrointestinal_symptoms_taste_changes",
  dietary_symptoms_swallowing_problems: "gastrointestinal_symptoms_dysphagia",
  dietary_symptoms_feel_full_quickly: "gastrointestinal_symptoms_early_satiety",
};

const icons: Record<string, LucideIcon> = {
  dietary_symptoms_no_problem: CircleCheck,
  dietary_symptoms_dry_mouth: DropletOff,
  dietary_symptoms_smells_bother: Wind,
  dietary_symptoms_fatigue: MoonStar,
  dietary_symptoms_muscle_loss: BicepsFlexed,
};

export function DietarySymptomIcon({ type }: { type: string }) {
  const shared = sharedSymptoms[type];
  if (shared) return <ClinicalGutChoiceIcon type={shared} />;
  const Icon = icons[type];
  return Icon ? <Icon data-dietary-symptom-icon={type} className="size-6 shrink-0" strokeWidth={1.75} aria-hidden="true" /> : null;
}
