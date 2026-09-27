import {
  CalendarClock, CalendarDays, CalendarPlus, CalendarRange, CircleMinus,
  ClipboardCheck, ClipboardPlus, Crosshair, Droplets, Ellipsis, FlaskConical,
  HandHeart, HeartHandshake, HeartPulse, Radiation, Scissors, ShieldPlus,
  ShieldX, Stethoscope, type LucideIcon,
} from "lucide-react";

/** Decorative cues for the short treatment choices; their labels remain authoritative. */
const icons: Record<string, LucideIcon> = {
  treatment_status_newly_diagnosed: ClipboardPlus,
  treatment_status_under_treatment: Stethoscope,
  treatment_status_post_treatment: ClipboardCheck,
  treatment_status_palliative_care: HandHeart,
  with_cancer: HeartPulse,
  post_treatment: HeartHandshake,
  within_6_months: CalendarDays,
  within_12_months: CalendarRange,
  post_12_months: CalendarClock,
  cancer_surgical_status_done: Scissors,
  cancer_surgical_status_planned: CalendarPlus,
  cancer_surgical_status_not_required: CircleMinus,
  cancer_surgical_status_not_fit: ShieldX,
  current_cancer_treatment_chemotherapy: FlaskConical,
  current_cancer_treatment_immunotherapy: ShieldPlus,
  current_cancer_treatment_radiation: Radiation,
  current_cancer_treatment_targeted: Crosshair,
  current_cancer_treatment_hormonal: Droplets,
  current_cancer_treatment_other: Ellipsis,
};

export function TreatmentChoiceIcon({ type }: { type: string }) {
  const Icon = icons[type];
  return Icon ? <Icon data-treatment-choice-icon={type} className="size-6 shrink-0" strokeWidth={1.75} aria-hidden="true" /> : null;
}
