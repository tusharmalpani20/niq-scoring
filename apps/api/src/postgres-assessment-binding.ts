import type postgres from "postgres";
import { isFinalAssessmentDefinition, versionedRuleDefinitionSchema } from "@niq-scoring/contracts/versioned-definition";
import { BindingError, type AssessmentBinding, type BindingInput, type BoundAssessment } from "./assessment-binding";
import type { RuleRecord } from "./rule-store";
import { createEntityId } from "./lib/id";
export async function postgresBindAssessment(database: ReturnType<typeof postgres>, input: BindingInput): Promise<BoundAssessment> {
  return database.begin(async tx => {
    if (!input.platformEnabled) throw new BindingError("PLATFORM_DISABLED");
    await tx`select pg_advisory_xact_lock(hashtext(${`version:${input.identity.deploymentId}`}))`;
    const [scope] = await tx<Array<{ clientEnabled: boolean; deploymentEnabled: boolean }>>`select c.enabled as "clientEnabled", d.enabled as "deploymentEnabled" from deployments d join clients c on c.id=d.client_id where d.id=${input.identity.deploymentId} and c.id=${input.identity.clientId}`;
    if (!scope) throw new BindingError("CLIENT_NOT_ALLOWED");
    if (!scope.clientEnabled) throw new BindingError("CLIENT_DISABLED");
    if (!scope.deploymentEnabled) throw new BindingError("DEPLOYMENT_DISABLED");
    const [entitlement] = await tx`select enabled from entitlements where deployment_id=${input.identity.deploymentId} and capability='SCORING' and effective_until is null`;
    if (!entitlement?.enabled) throw new BindingError("CAPABILITY_DISABLED");
    const [existing] = await tx<AssessmentBinding[]>`select id,deployment_id as "deploymentId",client_id as "clientId",assessment_reference as "assessmentReference",scoring_rule_version_id as "ruleVersionId",package_checksum as checksum,created_at as "createdAt" from assessment_bindings where deployment_id=${input.identity.deploymentId} and assessment_reference=${input.assessmentReference}`;
    if (!existing && !input.create) throw new BindingError("ASSESSMENT_NOT_FOUND");
    const [assignment] = await tx<Array<{ mode: string; versionId: string | null }>>`select mode,scoring_rule_version_id as "versionId" from deployment_version_assignments where deployment_id=${input.identity.deploymentId} and effective_until is null`;
    if (!existing && !assignment) throw new BindingError("VERSION_UNAVAILABLE");
    const selectedId = existing?.ruleVersionId ?? (assignment?.mode === "PINNED" ? assignment.versionId : null);
    const [raw] = await tx<RuleRecord[]>`select id,version,lifecycle,clinical_use_permitted as "clinicalUsePermitted",definition,package_checksum as "packageChecksum",revision,validated_revision as "validatedRevision",created_at as "createdAt",updated_at as "updatedAt",created_by as "createdBy",approved_at as "approvedAt" from scoring_rule_versions
      where (${selectedId}::varchar is null or id=${selectedId}) and (${Boolean(existing)} or (lifecycle in ('APPROVED','ACTIVE') and clinical_use_permitted=true))
      order by approved_at desc nulls last,id desc limit 1 for share`;
    if (!raw || !versionedRuleDefinitionSchema.safeParse(raw.definition).success || isFinalAssessmentDefinition(raw.definition) && (!raw.definition.provisional.clinicalUsePermitted || !existing && !raw.clinicalUsePermitted)) throw new BindingError("VERSION_UNAVAILABLE");
    if (existing && (existing.checksum !== raw.packageChecksum || !["APPROVED", "ACTIVE", "RETIRED"].includes(raw.lifecycle))) throw new BindingError("VERSION_UNAVAILABLE");
    const rule = { ...raw, createdAt: new Date(raw.createdAt).toISOString(), updatedAt: new Date(raw.updatedAt).toISOString(), approvedAt: raw.approvedAt ? new Date(raw.approvedAt).toISOString() : null };
    const binding = existing ?? { id: createEntityId(), deploymentId: input.identity.deploymentId, clientId: input.identity.clientId, assessmentReference: input.assessmentReference, ruleVersionId: rule.id, checksum: rule.packageChecksum, createdAt: new Date().toISOString() };
    if (!existing) await tx`insert into assessment_bindings (id,deployment_id,client_id,assessment_reference,scoring_rule_version_id,package_checksum,created_at) values (${binding.id},${binding.deploymentId},${binding.clientId},${binding.assessmentReference},${binding.ruleVersionId},${binding.checksum},${binding.createdAt})`;
    return { binding: { ...binding, createdAt: new Date(binding.createdAt).toISOString() }, rule };
  }) as Promise<BoundAssessment>;
}
