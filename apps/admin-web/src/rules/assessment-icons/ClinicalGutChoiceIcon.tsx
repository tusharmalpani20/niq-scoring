import type { ReactNode } from "react";
import {
  ArrowLeftRight, CircleCheck,
  Bubbles, CalendarDays, CircleMinus, Clock3,
  Utensils, type LucideIcon,
} from "lucide-react";

/** Decorative cues for appetite and gut choices; the labels carry the clinical meaning. */
const appetiteUtensils = <>
  <path d="M3 2v7c0 1.1.9 2 2 2h4a2 2 0 0 0 2-2V2" />
  <path d="M7 2v20" />
  <path d="M21 15V2a5 5 0 0 0-5 5v6c0 1.1.9 2 2 2h3Zm0 0v7" />
</>;

const icons: Record<string, LucideIcon> = {
  appetite_status_normal: Utensils,
  gastrointestinal_symptoms_bloating: Bubbles,
  normal: CircleCheck,
  constipation: Clock3,
  alternating: ArrowLeftRight,
  daily: CalendarDays,
  __none__: CircleMinus,
};

const drawings: Record<string, ReactNode> = {
  diarrhoea: <>
    <path d="M4 5v7a3 3 0 0 0 3 3h2M20 5v7a3 3 0 0 1-3 3h-2" />
    <path d="M4 5h5v4H7M20 5h-5v4h2" />
    <path d="M12 12v9m-3-3 3 3 3-3" />
  </>,
  gastrointestinal_symptoms_acidity_reflux: <>
    <path d="M8 3v5c0 1.6-.8 2.4-2.2 3.3A5.2 5.2 0 0 0 3.5 16c0 3 2.3 5 5.5 5 4 0 7-3 7-6v-4c0-2-1.4-3-3-3h-2V3" />
    <path d="M20 14V5m-3 3 3-3 3 3" />
  </>,
  gastrointestinal_symptoms_nausea: <>
    <circle cx="11" cy="12" r="8" />
    <path d="m7 9 2 1m4 0 2-1M7 16l2-1 2 1 2-1 2 1" />
    <path d="M20 6c0 1.2-.7 2-1.5 2S17 7.2 17 6c0-.8 1.5-3 1.5-3S20 5.2 20 6Z" />
  </>,
  gastrointestinal_symptoms_early_satiety: <>
    <circle cx="13" cy="12" r="8" />
    <ellipse cx="13" cy="11" rx="2.5" ry="1.5" />
    <path d="m11 16 1.5 1.5 3-3M3 5v7m2-7v7m-1 0v8" />
  </>,
  appetite_status_reduced: <>
    <g transform="translate(0 2) scale(.72)">{appetiteUtensils}</g>
    <path d="M20 5v14m-3-3 3 3 3-3" />
  </>,
  appetite_status_no_appetite: <>
    {appetiteUtensils}
    <path d="M2 22 22 2" />
  </>,
  below_3_week: <>
    <rect x="3" y="5" width="18" height="16" rx="2" />
    <path d="M7 3v4M17 3v4M3 9h18" />
    <circle cx="9" cy="12.5" r="1.25" fill="currentColor" stroke="none" />
    <circle cx="15" cy="16.5" r="1.25" fill="currentColor" stroke="none" />
  </>,
  above_3_week: <>
    <rect x="3" y="5" width="18" height="16" rx="2" />
    <path d="M7 3v4M17 3v4M3 9h18" />
    {[[8, 12.5], [12, 12.5], [16, 12.5], [8, 16.5], [12, 16.5]].map(([cx, cy]) => <circle key={`${cx}-${cy}`} cx={cx} cy={cy} r="1.1" fill="currentColor" stroke="none" />)}
  </>,
  gastrointestinal_symptoms_vomiting: <>
    <path d="M3 20v-4a7 7 0 1 1 11.8-5.1L16 12l-2.5 1.5v2A2.5 2.5 0 0 1 11 18H9v2" />
    <circle cx="11.5" cy="9" r="0.7" fill="currentColor" stroke="none" />
    <path d="M14 15.5c1 0 1.3 1 2.5 1s1.5 1 2.5 1 1.5 1 2 2" />
    <path d="M16 19c1 .2 1.5 1 2 1.5" />
  </>,
  gastrointestinal_symptoms_taste_changes: <>
    <path d="M3 12c2.5-2.6 5.5-3.8 9-3.8s6.5 1.2 9 3.8c-2.5 3-5.5 4.8-9 4.8S5.5 15 3 12Z" />
    <path d="M3 12c4 1.8 14 1.8 18 0" />
    <path d="m18 3 .5 1.5L20 5l-1.5.5L18 7" />
  </>,
  gastrointestinal_symptoms_dysphagia: <>
    <path d="M4 21v-5a8 8 0 0 1 13.5-5.8L20 13l-2.5 1.5V17a2 2 0 0 1-2 2H13v2" />
    <path d="M11 10h1" />
    <circle cx="17" cy="19" r="3" />
    <circle cx="17" cy="19" r="1" fill="currentColor" stroke="none" />
  </>,
  gastrointestinal_symptoms_pain_while_eating: <>
    <path d="M4 3v6m3-6v6M4 9h3m-1.5 0v12" />
    <path d="m17 3-5 9h5l-3 9 7-11h-5l1-7Z" />
  </>,
  gastrointestinal_symptoms_mouth_ulcers: <>
    <path d="M3 11.5C5.5 9 8.5 8 12 8s6.5 1 9 3.5C19 15.4 16 18 12 18s-7-2.6-9-6.5Z" />
    <path d="M3 11.5c4.5 2.1 13.5 2.1 18 0" />
    <circle cx="14.5" cy="15.4" r="2" />
    <circle cx="14.5" cy="15.4" r="0.65" fill="currentColor" stroke="none" />
  </>,
};

export function ClinicalGutChoiceIcon({ type }: { type: string }) {
  if (drawings[type]) return <svg data-clinical-gut-choice-icon={type} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" className="size-6 shrink-0" aria-hidden="true">{drawings[type]}</svg>;
  const Icon = icons[type];
  return Icon ? <Icon data-clinical-gut-choice-icon={type} className="size-6 shrink-0" strokeWidth={1.75} aria-hidden="true" /> : null;
}
