import type { RuleDefinition } from "@niq-scoring/contracts/rules";
export type RuleMetadata = {
  id: string; version: string; lifecycle: "DRAFT" | "VALIDATED" | "APPROVED" | "ACTIVE" | "RETIRED";
  clinicalUsePermitted: boolean; revision: number; packageChecksum: string; editable: boolean;
};
export type RuleDetail = RuleMetadata & { definition: unknown; audit?: Array<{ id: string; actor: string; action: string; at: string; revision: number; checksum: string }> };
export type EditableRule = Omit<RuleDetail, "definition"> & { definition: RuleDefinition };
