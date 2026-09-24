export type DeploymentValues = { clientId: string; environment: string; label: string; hostingType: string; enabled: boolean; scoringEnabled: boolean; faceEnabled: boolean; scoringUnlimited: boolean; faceUnlimited: boolean; scoringLimit: string; faceLimit: string; ruleVersion: string; expiryPreset: string; expiryDate: string };
export const deploymentSteps = ["Deployment", "Settings & limits", "Review & create"] as const;
export function deploymentErrors(values: DeploymentValues, step: number): Partial<Record<keyof DeploymentValues, string>> {
  const errors: Partial<Record<keyof DeploymentValues, string>> = {};
  for (const name of (step === 0 ? ["clientId", "environment", "hostingType"] : ["ruleVersion"]) as Array<keyof DeploymentValues>) {
    if (!String(values[name]).trim()) errors[name] = "This field is required.";
  }
  if (step === 0 && values.label.trim() && (values.label.trim().length < 2 || values.label.trim().length > 120)) errors.label = "Use 2 to 120 characters, or leave blank for an automatic label.";
  if (step === 1) for (const [name, enabled, unlimited] of [["scoringLimit", values.scoringEnabled, values.scoringUnlimited], ["faceLimit", values.faceEnabled, values.faceUnlimited]] as const) {
    if (values.enabled && enabled && !unlimited && (!/^\d+$/.test(values[name]) || !Number.isSafeInteger(Number(values[name])) || Number(values[name]) > 2147483647)) errors[name] = "Enter a whole number from 0 to 2,147,483,647.";
  }
  return errors;
}
