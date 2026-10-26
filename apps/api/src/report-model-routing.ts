import type { ReportCall } from "./report-generation-store";

/** The manager may use Pro; every other stage uses the worker model. */
export function reportModelForStep(step: ReportCall["step"], managerModel: string, workerModel: string): string {
  return step === "manager" ? managerModel : workerModel;
}
