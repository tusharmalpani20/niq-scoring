import type { ReactNode } from "react";
import {
  Bandage, Bone, CircleMinus, Droplets, Fish, HeartPulse, Pill, type LucideIcon,
} from "lucide-react";

/** Small site or product cues; the adjacent option label remains the clinical meaning. */
const drawings: Record<string, ReactNode> = {
  current_medications_anti_diabetics: <><path d="M12 3c-3 4-6 7-6 10.5a6 6 0 0 0 12 0C18 10 15 7 12 3Z" /><circle cx="10" cy="13" r="1" /><circle cx="14" cy="12" r="1" /><circle cx="12" cy="16" r="1" /></>,
  current_medications_thyroid: <><path d="M11 3v4m2-4v4m-2 10v4m2-4v4" /><path d="M8.5 6.5C6 6 4.8 8 5 11c.1 3.4 1.8 6 3.8 6 1.5 0 2-1.5 3.2-1.5s1.7 1.5 3.2 1.5c2 0 3.7-2.6 3.8-6 .2-3-1-5-3.5-4.5-.9.2-1.8 1.5-3.5 1.5S9.4 6.7 8.5 6.5Z" /></>,
  current_medications_cholesterols: <><path d="M3 8c3-2 6-2 9 0s6 2 9 0v8c-3 2-6 2-9 0s-6-2-9 0Z" /><path d="M3 12c3-2 6-2 9 0s6 2 9 0" /><circle cx="8" cy="9" r=".8" /><circle cx="16" cy="15" r=".8" /></>,
  current_medications_steroids: <><path d="m3 8 3-2 3 2v4l-3 2-3-2Zm6 0 3-2 3 2v4l-3 2-3-2Zm6 0 3-2 3 2v4l-3 2-3-2Z" /><path d="m9 12 3 2 3-2m3 2 3 2-1 3-3 1-2-2v-4" /></>,
  current_medications_anti_histamines: <><circle cx="11" cy="11" r="3" /><path d="M11 3v2m0 12v2M3 11h2m12 0h2M5.4 5.4l1.4 1.4m8.4 8.4 1.4 1.4m0-11.2-1.4 1.4m-8.4 8.4-1.4 1.4" /><path d="m4 20 16-16" /></>,
  current_medications_antibiotics: <><path d="M5.5 19a4 4 0 0 1 0-5.7l7.8-7.8a4 4 0 0 1 5.7 5.7L11.2 19a4 4 0 0 1-5.7 0Z" /><path d="m9.4 9.4 5.2 5.2M16.5 7v4m-2-2h4" /></>,
  current_medications_antacid: <><path d="M10 3v4c0 1.7 1 2.8 2.8 2.8 1.2 0 2-.8 2-2.2 3.5.9 5.2 3.5 5.2 6.5 0 4-3 6.9-7 6.9-3 0-4.8-1.4-5.8-3.5-.4-.8-.8-1.2-1.3-1.2-1 0-1.6 1.3-1.6 3V21H3v-1.6c0-3.2 1.3-5.2 4.2-5.4 2.7-.2 4.2-2 4.2-4.5 0-1.4-.5-2.3-1.4-3V3" /><path d="M13 14h4" /></>,
  supplements_intake_protein: <><path d="M8 3h8m-7 0v3h6V3M7 6h10l1 3v10a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2V9Z" /><path d="M6 11h12m-9 5h6" /></>,
  supplements_intake_folic_acid: <><path d="M5.5 19a4 4 0 0 1 0-5.7l7.8-7.8a4 4 0 0 1 5.7 5.7L11.2 19a4 4 0 0 1-5.7 0Z" /><path d="m9.4 9.4 5.2 5.2M6.5 16.7c.3-2.2 1.8-3.4 4.4-3.5-.3 2.5-1.8 3.7-4.4 3.5Z" /><path d="m6.5 16.7 2.9-2.3" /></>,
  supplements_intake_multivitamins: <><path d="M5.5 19a4 4 0 0 1 0-5.7l7.8-7.8a4 4 0 0 1 5.7 5.7L11.2 19a4 4 0 0 1-5.7 0Z" /><path d="m9.4 9.4 5.2 5.2" /><circle cx="8" cy="15.5" r=".7" /><circle cx="11" cy="13" r=".7" /><circle cx="15.5" cy="9" r=".7" /></>,
};

const lucideIcons: Record<string, LucideIcon> = {
  current_medications_blood_thinners: Droplets,
  current_medications_anti_hypertensives: HeartPulse,
  current_medications_pain_medications: Bandage,
  supplements_intake_calcium: Bone,
  supplements_intake_iron: Pill,
  supplements_intake_omega_3: Fish,
  __none__: CircleMinus,
};

export function MedicationSupplementIcon({ type }: { type: string }) {
  const drawing = drawings[type];
  if (drawing) return <svg data-intake-choice-icon={type} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className="size-5 shrink-0" aria-hidden="true">{drawing}</svg>;
  const Icon = lucideIcons[type];
  return Icon ? <Icon data-intake-choice-icon={type} className="size-5 shrink-0" strokeWidth={1.8} aria-hidden="true" /> : null;
}
