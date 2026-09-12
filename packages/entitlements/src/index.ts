export type Capability = "SCORING" | "FACE_SCAN";

export interface EntitlementSnapshot {
  platformEnabled: boolean;
  organizationEnabled: boolean;
  deploymentEnabled: boolean;
  versionActive: boolean;
  monthlyLimit: number | null;
  monthlyUsage: number;
}

export type EntitlementDecision =
  | { allowed: true; remaining: number | null }
  | { allowed: false; reason: "PLATFORM_DISABLED" | "ORGANIZATION_DISABLED" | "DEPLOYMENT_DISABLED" | "VERSION_INACTIVE" | "MONTHLY_LIMIT_REACHED" };

export function decideEntitlement(input: EntitlementSnapshot): EntitlementDecision {
  if (!input.platformEnabled) return { allowed: false, reason: "PLATFORM_DISABLED" };
  if (!input.organizationEnabled) return { allowed: false, reason: "ORGANIZATION_DISABLED" };
  if (!input.deploymentEnabled) return { allowed: false, reason: "DEPLOYMENT_DISABLED" };
  if (!input.versionActive) return { allowed: false, reason: "VERSION_INACTIVE" };
  if (input.monthlyLimit !== null && input.monthlyUsage >= input.monthlyLimit) {
    return { allowed: false, reason: "MONTHLY_LIMIT_REACHED" };
  }
  return {
    allowed: true,
    remaining: input.monthlyLimit === null ? null : input.monthlyLimit - input.monthlyUsage,
  };
}
