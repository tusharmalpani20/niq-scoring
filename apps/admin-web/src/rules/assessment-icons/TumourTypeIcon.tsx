import type { ReactNode } from "react";

/** Small schematic cues for the four tumour choices; the text remains the clinical label. */
export function TumourTypeIcon({ type }: { type: string }) {
  let drawing: ReactNode;
  switch (type) {
    case "tumour_type_solid":
      drawing = <><circle cx="12" cy="12" r="8" /><circle cx="9" cy="10" r="1.5" /><circle cx="14.5" cy="9.5" r="1.5" /><circle cx="12.5" cy="14.5" r="2" /></>;
      break;
    case "tumour_type_haematological":
      drawing = <><path d="M12 3C9.5 6.7 6 10.1 6 14a6 6 0 0 0 12 0c0-3.9-3.5-7.3-6-11Z" /><circle cx="10" cy="12.5" r="1.3" /><circle cx="14" cy="15.5" r="1.3" /></>;
      break;
    case "tumour_type_metastatic_secondary":
      drawing = <><circle cx="6" cy="12" r="3" /><circle cx="18" cy="12" r="3" /><path d="M9.5 12h4.5m-2-2 2 2-2 2" /><circle cx="6" cy="12" r=".5" fill="currentColor" stroke="none" /><circle cx="18" cy="12" r=".5" fill="currentColor" stroke="none" /></>;
      break;
    case "tumour_type_in_situ":
      drawing = <><path d="M3 17h18M3 20h18M5 14V7a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2v7" /><circle cx="9" cy="10" r="1.4" /><circle cx="14.5" cy="10.5" r="1.4" /></>;
      break;
    default:
      return null;
  }
  return <svg data-tumour-icon={type} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" className="size-6 shrink-0" aria-hidden="true">{drawing}</svg>;
}
