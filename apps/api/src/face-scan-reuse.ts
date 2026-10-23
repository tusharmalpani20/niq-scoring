import type postgres from "postgres";
import type { FaceScanContext, FaceScanResult, FaceScanReuse } from "@niq-scoring/contracts/face-scan-session";
import { faceScanScoringConfigSchema } from "@niq-scoring/contracts/face-scan-scoring";
import { stressScoringConfigSchema } from "@niq-scoring/contracts/stress-scoring";
import { calculateFaceScanScore } from "@niq-scoring/scoring-engine/face-scan-scoring";
import { FaceScanError, publicFaceScanScore, scoringInput } from "./face-scan-outcome";
import { decryptActivationToken } from "./lib/activation-secret";
import { createEntityId } from "./lib/id";
import type { DeploymentIdentity } from "./store";

type Database = ReturnType<typeof postgres>;
type ReuseRow = {
  id: string; source_session_id: string; source_assessment_reference: string;
  organization_reference: string; assessment_reference: string; context_ciphertext: string;
  result: FaceScanResult; score: ReturnType<typeof calculateFaceScanScore>; captured_at: Date; created_at: Date;
};
function envelope(row: ReuseRow, encryptionKey: string) {
  return { session: {
    id: row.id, state: "COMPLETED" as const, organizationReference: row.organization_reference,
    assessmentReference: row.assessment_reference,
    context: JSON.parse(decryptActivationToken(row.context_ciphertext, encryptionKey)) as FaceScanContext,
    createdAt: row.created_at.toISOString(), updatedAt: row.created_at.toISOString(),
    completedAt: row.captured_at.toISOString(), failureCode: null, result: row.result,
    score: publicFaceScanScore(row.score),
    historicalSource: { sessionId: row.source_session_id, assessmentReference: row.source_assessment_reference, capturedAt: row.captured_at.toISOString() },
  }, providerConfigured: true };
}
export async function getFaceScanReuse(sql: Database, key: string, identity: DeploymentIdentity, id: string, organization: string) {
  const [row] = await sql<ReuseRow[]>`select * from face_scan_reuses where id=${id}
    and deployment_id=${identity.deploymentId} and client_id=${identity.clientId} and organization_reference=${organization}`;
  return row ? envelope(row, key) : null;
}
/** Reuses accepted measurements only. It neither reserves provider usage nor creates a capture session. */
export async function createFaceScanReuse(sql: Database, key: string, identity: DeploymentIdentity, sourceId: string, input: FaceScanReuse) {
  if (input.sourceAssessmentReference === input.assessmentReference) throw new FaceScanError("SELF_REUSE_NOT_ALLOWED", 400);
  const row = await sql.begin(async tx => {
    await tx`select pg_advisory_xact_lock(hashtext(${`${identity.deploymentId}:reuse:${input.assessmentReference}`}))`;
    const [source] = await tx<{ state: string; result: FaceScanResult | null; completed_at: Date | null; context_ciphertext: string }[]>`
      select w.state,w.result,w.completed_at,w.context_ciphertext from face_scan_workflows w join face_scan_sessions s on s.id=w.session_id
      where w.session_id=${sourceId} and s.deployment_id=${identity.deploymentId} and s.client_id=${identity.clientId}
        and w.organization_reference=${input.organizationReference} and w.assessment_reference=${input.sourceAssessmentReference}`;
    if (!source) throw new FaceScanError("NOT_FOUND", 404);
    if (source.state !== "COMPLETED" || !source.result || !source.completed_at) throw new FaceScanError("HISTORICAL_MEASUREMENT_UNAVAILABLE");
    // The destination binding is immutable and has already selected its rule. Never use the original score or today's default.
    const [binding] = await tx<{ id: string; rule_id: string; package_checksum: string; configuration: unknown; stress_configuration: unknown }[]>`
      select b.id,r.id as rule_id,r.package_checksum,r.definition->'faceScanScoring' as configuration,r.definition->'stressScoring' as stress_configuration
      from assessment_bindings b join scoring_rule_versions r on r.id=b.scoring_rule_version_id and r.package_checksum=b.package_checksum
      where b.deployment_id=${identity.deploymentId} and b.client_id=${identity.clientId} and b.assessment_reference=${input.assessmentReference}
        and (r.lifecycle='RETIRED' or r.lifecycle in ('APPROVED','ACTIVE') and r.clinical_use_permitted=true)`;
    if (!binding) throw new FaceScanError("FACE_SCAN_MAPPING_UNAVAILABLE");
    const [old] = await tx<ReuseRow[]>`select * from face_scan_reuses where deployment_id=${identity.deploymentId} and assessment_reference=${input.assessmentReference}`;
    if (old) {
      if (old.source_session_id !== sourceId || old.organization_reference !== input.organizationReference || old.source_assessment_reference !== input.sourceAssessmentReference) throw new FaceScanError("HISTORICAL_MEASUREMENT_CONFLICT");
      return old;
    }
    const configuration = faceScanScoringConfigSchema.safeParse(binding.configuration);
    const stress = binding.stress_configuration == null ? null : stressScoringConfigSchema.safeParse(binding.stress_configuration);
    if (!configuration.success || stress !== null && !stress.success) throw new FaceScanError("FACE_SCAN_MAPPING_UNAVAILABLE");
    let score: ReturnType<typeof calculateFaceScanScore>;
    try { score = calculateFaceScanScore(scoringInput(source.result), configuration.data, binding.rule_id, stress?.success ? stress.data : undefined); }
    catch { throw new FaceScanError("HISTORICAL_MEASUREMENT_UNAVAILABLE"); }
    if (score.status !== "SCORED" || score.points === null || !Number.isSafeInteger(score.points) || score.points < 0) throw new FaceScanError("HISTORICAL_MEASUREMENT_UNAVAILABLE");
    const id = createEntityId();
    const [created] = await tx<ReuseRow[]>`insert into face_scan_reuses(id,source_session_id,source_assessment_reference,assessment_binding_id,
      client_id,deployment_id,organization_reference,assessment_reference,context_ciphertext,result,score,captured_at)
      values(${id},${sourceId},${input.sourceAssessmentReference},${binding.id},${identity.clientId},${identity.deploymentId},
        ${input.organizationReference},${input.assessmentReference},${source.context_ciphertext},${tx.json(source.result)},${tx.json(score)},${source.completed_at}) returning *`;
    await tx`insert into audit_events(id,client_id,deployment_id,actor_type,actor_reference,action,resource_type,resource_reference,request_id,outcome,metadata)
      values(${createEntityId()},${identity.clientId},${identity.deploymentId},'DEPLOYMENT',${identity.credentialId},'FACE_SCAN_MEASUREMENT_REUSED',
        'face_scan_reuse',${id},${id},'SUCCEEDED',${tx.json({ sourceSessionId: sourceId, sourceAssessmentReference: input.sourceAssessmentReference,
          assessmentReference: input.assessmentReference, capturedAt: source.completed_at.toISOString(), ruleVersionId: binding.rule_id })})`;
    return created!;
  });
  return envelope(row, key);
}
