import { PROVISIONAL_SCORING_VERSION, type VersionAssignmentInput } from "@niq-scoring/contracts";
import { RuleStoreError } from "./rule-store";
export async function assertAssignmentEligible(tx: import("postgres").TransactionSql, deploymentId: string, policy: VersionAssignmentInput) {
  if (policy.mode !== "PINNED") return;
  const [current] = await tx`select scoring_rule_version_id from deployment_version_assignments where deployment_id=${deploymentId} and effective_until is null`;
  // Preserve an existing retired pin when editing unrelated deployment settings.
  if (current?.scoring_rule_version_id === policy.scoringRuleVersionId) return;
  const [rule] = await tx`select version,lifecycle,clinical_use_permitted from scoring_rule_versions where id=${policy.scoringRuleVersionId} for share`;
  if (!rule || !(rule.version === PROVISIONAL_SCORING_VERSION || rule.clinical_use_permitted && ["APPROVED", "ACTIVE"].includes(rule.lifecycle))) throw new RuleStoreError("VERSION_UNAVAILABLE");
}
