import { GlassWater, Sandwich, TrendingDown, TrendingUp, Utensils, type LucideIcon } from "lucide-react";

/** Decorative cues only; the choice labels carry the dietary meaning. */
const icons: Record<string, LucideIcon> = {
  dietary_intake_normal: Utensils,
  dietary_intake_more_than_usual: TrendingUp,
  dietary_intake_reduced: TrendingDown,
  dietary_intake_liquid: GlassWater,
  dietary_intake_little_solid: Sandwich,
};

export function DietaryIntakeIcon({ type }: { type: string }) {
  if (type === "dietary_intake_tube_feeding") return <svg data-dietary-intake-icon={type} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" className="size-6 shrink-0" aria-hidden="true">
    <path d="M3 3h7v7H3zM6.5 1v2M5 6h3M6.5 10v4c0 2 1.5 3 3.5 3h3" />
    <path d="M18 8c-2.8 0-5 2.2-5 5v3c0 2.2 1.8 4 4 4h.5c2 0 3.5-1.5 3.5-3.5V13c0-1.7-1.2-3-3-3" />
    <path d="M13 17h4" />
  </svg>;
  const Icon = icons[type];
  return Icon ? <Icon data-dietary-intake-icon={type} className="size-6 shrink-0" strokeWidth={1.75} aria-hidden="true" /> : null;
}
