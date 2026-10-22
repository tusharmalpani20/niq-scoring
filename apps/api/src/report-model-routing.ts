import type { ReportCall } from "./report-generation-store";

/** Provider adapters supply model IDs; clinical stage assignments stay shared. */
export function reportModelForStep(step: ReportCall["step"], clinicalModel: string, draftingModel: string): string {
  return ["manager", "reviewer", "coverage"].includes(step) ? clinicalModel : draftingModel;
}
