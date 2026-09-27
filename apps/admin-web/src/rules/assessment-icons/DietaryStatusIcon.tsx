import { Bed, Droplet, Droplets, Flame, Footprints, Gauge, Leaf, TrendingDown, Waves, type LucideIcon } from "lucide-react";

/** Decorative cues for activity, stress and fluid choices; labels remain authoritative. */
const icons: Record<string, LucideIcon> = {
  functional_capacity_normal_activity: Footprints,
  functional_capacity_reduced_activity: TrendingDown,
  functional_capacity_bedridden: Bed,
  stress_level_high: Flame,
  stress_level_moderate: Gauge,
  stress_level_none_low: Leaf,
  fluid_intake_below_1_litre: Droplet,
  fluid_intake_one_to_two_litres: Droplets,
  fluid_intake_above_2_litres: Waves,
};

export function DietaryStatusIcon({ type }: { type: string }) {
  const Icon = icons[type];
  return Icon ? <Icon data-dietary-status-icon={type} className="size-6 shrink-0" strokeWidth={1.75} aria-hidden="true" /> : null;
}
