import type { ReactNode } from "react";
import { CancerTypeIcon } from "./CancerTypeIcon";

/** Schematic visual cues only; the option label carries the clinical meaning. */
const drawings: Record<string, ReactNode> = {
  stage_localized: <><circle cx="12" cy="12" r="8" /><circle cx="12" cy="12" r="2.5" fill="currentColor" stroke="none" /></>,
  stage_locally_advanced: <><circle cx="9" cy="12" r="6" /><circle cx="9" cy="12" r="2" fill="currentColor" stroke="none" /><path d="M15 12h2" /><circle cx="19" cy="12" r="2" fill="currentColor" stroke="none" /></>,
  stage_metastatic: <><circle cx="6.5" cy="12" r="4.5" /><circle cx="6.5" cy="12" r="1.5" fill="currentColor" stroke="none" /><path d="m11 9 5-4m-5 10 5 4" /><circle cx="19" cy="4" r="2" /><circle cx="19" cy="20" r="2" /></>,
  relapse_status_first_diagnosis: <><path d="M8 4H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V6a2 2 0 0 0-2-2h-2" /><rect x="8" y="2" width="8" height="4" rx="1" /><path d="M12 10v8m-4-4h8" /></>,
  relapse_status_relapsed: <><path d="M20 9a8 8 0 1 0 0 6M20 4v5h-5" /><circle cx="12" cy="12" r="2" /></>,
  relapse_status_refractory: <><path d="M12 3 20 6v6c0 5-3 8-8 10-5-2-8-5-8-10V6Z" /><path d="m9 10 6 5m0-5-6 5" /></>,
};

// Metastasis sites share the organ drawings from the type-of-cancer picker.
const cancerSiteIcons: Record<string, string> = {
  brain: "cancer_9", liver: "cancer_5", lung: "cancer_2", bone: "cancer_17", others: "cancer_other",
};

export function DiseaseChoiceIcon({ type }: { type: string }) {
  if (cancerSiteIcons[type]) return <CancerTypeIcon type={cancerSiteIcons[type]} />;
  const drawing = drawings[type];
  if (!drawing) return null;
  return <svg data-disease-choice-icon={type} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" className="size-6 shrink-0" aria-hidden="true">{drawing}</svg>;
}
