import { ClipboardList, Cross, HeartPulse, History, Stethoscope, Utensils } from "lucide-react";

// Keep the scoring sections aligned with the assessment form's navigation.
export const assessmentSectionIcons: Record<string, typeof ClipboardList> = {
  disease_status: Cross,
  treatment: Stethoscope,
  health_history: History,
  clinical_gut_health: HeartPulse,
  dietary_details: Utensils,
};

export function sectionIcon(id: string) {
  return assessmentSectionIcons[id] ?? ClipboardList;
}
