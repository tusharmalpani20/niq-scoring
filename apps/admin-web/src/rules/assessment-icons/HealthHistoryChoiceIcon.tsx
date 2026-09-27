import type { ReactNode } from "react";
import { Brain, CircleMinus, Heart, HeartPulse, Scissors, UsersRound, type LucideIcon } from "lucide-react";
import { CancerTypeIcon } from "./CancerTypeIcon";

/** Decorative health-history cues; clinical meaning comes from each choice label. */
const icons: Record<string, LucideIcon> = {
  co_morbidities_hypertension: HeartPulse,
  co_morbidities_cardiac_disease: Heart,
  co_morbidities_psychological_disorders: Brain,
  previous_surgeries_yes: Scissors,
  previous_surgeries_no: CircleMinus,
  family_history_cancer_yes: UsersRound,
  family_history_cancer_no: CircleMinus,
  __none__: CircleMinus,
};

const drawings: Record<string, ReactNode> = {
  co_morbidities_diabetes: <><path d="M12 3c-3 4-6 7-6 10.5a6 6 0 0 0 12 0C18 10 15 7 12 3Z" /><circle cx="10" cy="13" r="1" /><circle cx="14" cy="12" r="1" /><circle cx="12" cy="16" r="1" /></>,
  co_morbidities_thyroid_disorder: <><path d="M11 3v4m2-4v4m-2 10v4m2-4v4" /><path d="M8.5 6.5C6 6 4.8 8 5 11c.1 3.4 1.8 6 3.8 6 1.5 0 2-1.5 3.2-1.5s1.7 1.5 3.2 1.5c2 0 3.7-2.6 3.8-6 .2-3-1-5-3.5-4.5-.9.2-1.8 1.5-3.5 1.5S9.4 6.7 8.5 6.5Z" /></>,
  co_morbidities_high_cholesterol: <><path d="M3 8c3-2 6-2 9 0s6 2 9 0v8c-3 2-6 2-9 0s-6-2-9 0Z" /><path d="M3 12c3-2 6-2 9 0s6 2 9 0" /><circle cx="8" cy="9" r=".8" /><circle cx="16" cy="15" r=".8" /></>,
};

const sharedOrganIcons: Record<string, string> = {
  co_morbidities_kidney_disease: "cancer_15",
  co_morbidities_liver_disease: "cancer_5",
};

export function HealthHistoryChoiceIcon({ type }: { type: string }) {
  const organ = sharedOrganIcons[type];
  if (organ) return <span data-health-history-icon={type} className="inline-flex [&>svg]:size-5" aria-hidden="true"><CancerTypeIcon type={organ} /></span>;
  const drawing = drawings[type];
  if (drawing) return <svg data-health-history-icon={type} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className="size-5 shrink-0" aria-hidden="true">{drawing}</svg>;
  const Icon = icons[type];
  return Icon ? <Icon data-health-history-icon={type} className="size-5 shrink-0" strokeWidth={1.8} aria-hidden="true" /> : null;
}
