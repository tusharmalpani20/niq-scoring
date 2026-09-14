import type { RuleRecord } from "./rule-store";
import type { DeploymentIdentity } from "./store";
export type AssessmentBinding = { id: string; deploymentId: string; clientId: string; assessmentReference: string; ruleVersionId: string; checksum: string; createdAt: string };
export type BindingInput = { identity: DeploymentIdentity; assessmentReference: string; platformEnabled: boolean; create: boolean };
export type BoundAssessment = { binding: AssessmentBinding; rule: RuleRecord };
export class BindingError extends Error { constructor(public code: string) { super(code); } }
export function eligibleRule(rule: RuleRecord) { return rule.clinicalUsePermitted && (rule.lifecycle === "APPROVED" || rule.lifecycle === "ACTIVE"); }
