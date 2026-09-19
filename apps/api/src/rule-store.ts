import { isFinalAssessmentDefinition, type VersionedRuleDefinition } from "@niq-scoring/contracts/versioned-definition";
export type RuleState = "DRAFT" | "VALIDATED" | "APPROVED" | "ACTIVE" | "RETIRED";
export type RuleRecord = {
  id: string; version: string; lifecycle: RuleState; clinicalUsePermitted: boolean;
  definition: unknown; packageChecksum: string; revision: number;
  validatedRevision: number | null; createdAt: string; updatedAt: string;
  createdBy: string | null; approvedAt: string | null;
};
export type RuleAudit = { id: string; actor: string; actorName?: string; action: string; at: string; revision: number; checksum: string };
export class RuleStoreError extends Error { constructor(public code: string) { super(code); } }
export type RuleCreate = { id: string; definition: VersionedRuleDefinition; checksum: string; actor: string; requestId: string; fingerprint: string; now: string };
export type RuleSave = { id: string; revision: number; definition: VersionedRuleDefinition; checksum: string; actor: string; now: string };
export type RuleTransition = { id: string; revision: number; action: "validate" | "approve" | "activate" | "retire"; actor: string; now: string };
export interface RuleStore {
  list(): Promise<RuleRecord[]>;
  get(id: string): Promise<RuleRecord | null>;
  getByName(name: string): Promise<RuleRecord | null>;
  replayCreate(requestId: string, fingerprint: string, actor: string): Promise<RuleRecord | null>;
  create(input: RuleCreate): Promise<RuleRecord>;
  save(input: RuleSave): Promise<RuleRecord>;
  transition(input: RuleTransition): Promise<RuleRecord>;
  delete(id: string, revision: number, actor: string, now: string): Promise<void>;
  audit(id: string): Promise<RuleAudit[]>;
}
export function nextRuleState(record: RuleRecord, action: RuleTransition["action"]): RuleState {
  if ((action === "approve" || action === "activate") && isFinalAssessmentDefinition(record.definition) && !record.definition.provisional.clinicalUsePermitted) throw new RuleStoreError("PROVISIONAL_THRESHOLDS_UNCONFIRMED");
  if (action === "validate" && (record.lifecycle === "DRAFT" || record.lifecycle === "VALIDATED")) return "VALIDATED";
  if (action === "approve" && record.lifecycle === "VALIDATED" && record.validatedRevision === record.revision) return "APPROVED";
  if (action === "activate" && record.lifecycle === "APPROVED") return "ACTIVE";
  if (action === "retire" && (record.lifecycle === "APPROVED" || record.lifecycle === "ACTIVE")) return "RETIRED";
  throw new RuleStoreError("INVALID_RULE_TRANSITION");
}
export const normalizedRuleName = (name: string) => name.trim().toLowerCase();
