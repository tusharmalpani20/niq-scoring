import type postgres from "postgres";
import { createEntityId } from "./lib/id";
import { nextRuleState, RuleStoreError, type RuleAudit, type RuleCreate, type RuleRecord, type RuleSave, type RuleStore, type RuleTransition } from "./rule-store";

type Database = ReturnType<typeof postgres>;
type Transaction = import("postgres").TransactionSql;
type RawRecord = Omit<RuleRecord, "createdAt" | "updatedAt" | "approvedAt"> & { createdAt: Date | string; updatedAt: Date | string; approvedAt: Date | string | null };
const timestamp = (value: Date | string) => new Date(value).toISOString();
const record = (row: RawRecord): RuleRecord => ({ ...row, createdAt: timestamp(row.createdAt), updatedAt: timestamp(row.updatedAt), approvedAt: row.approvedAt ? timestamp(row.approvedAt) : null });

/** Mutations, optimistic revision checks, and their audit records commit together. */
export class PostgresRuleStore implements RuleStore {
  constructor(private readonly database: Database) {}

  private async read(sql: Database | Transaction, id?: string, lock = false): Promise<RuleRecord[]> {
    const rows = await sql<RawRecord[]>`select id, version, lifecycle, clinical_use_permitted as "clinicalUsePermitted", definition,
      package_checksum as "packageChecksum", revision, validated_revision as "validatedRevision", created_by as "createdBy",
      created_at as "createdAt", updated_at as "updatedAt", approved_at as "approvedAt"
      from scoring_rule_versions where (${id ?? null}::varchar is null or id=${id ?? null}) order by created_at desc, id desc ${lock ? sql`for update` : sql``}`;
    return rows.map(record);
  }
  async list() { return this.read(this.database); }
  async get(id: string) { return (await this.read(this.database, id))[0] ?? null; }

  async getByName(name: string) {
    const [alias] = await this.database<Array<{ ruleId: string }>>`select rule_id as "ruleId" from scoring_rule_name_aliases where name=lower(btrim(${name}))`;
    return alias ? this.get(alias.ruleId) : null;
  }
  private async claimName(sql: Transaction, name: string, id: string) {
    // Keep deleted names reserved so a bookmark never resolves to another version.
    const claimed = await sql`insert into scoring_rule_name_aliases (name,rule_id) values (lower(btrim(${name})),${id})
      on conflict (name) do update set rule_id=excluded.rule_id
      where scoring_rule_name_aliases.rule_id=excluded.rule_id returning name`;
    if (!claimed.length) throw new RuleStoreError("RULE_NAME_EXISTS");
  }
  private async locked(sql: Transaction, id: string, revision: number) {
    const row = (await this.read(sql, id, true))[0];
    if (!row) throw new RuleStoreError("RULE_NOT_FOUND");
    if (row.revision !== revision) throw new RuleStoreError("RULE_REVISION_CONFLICT");
    return row;
  }
  private async log(sql: Transaction, row: RuleRecord, actor: string, action: string, now: string, extra: Record<string, unknown> = {}) {
    await sql`insert into audit_events (id,actor_type,actor_reference,action,resource_type,resource_reference,request_id,outcome,metadata,occurred_at)
      values (${createEntityId()},'ADMIN',${actor},${action},'rule_version',${row.id},${crypto.randomUUID()},'SUCCEEDED',
      ${sql.json({ revision: row.revision, checksum: row.packageChecksum, ...extra })},${now})`;
  }
  private async write<T>(operation: (sql: Transaction) => Promise<T>): Promise<T> {
    try { return await this.database.begin(operation) as T; }
    catch (error) {
      if (typeof error === "object" && error !== null && "code" in error && error.code === "23505") throw new RuleStoreError("RULE_NAME_EXISTS");
      throw error;
    }
  }

  async replayCreate(requestId: string, fingerprint: string, actor: string): Promise<RuleRecord | null> {
    const [prior] = await this.database<Array<{ id: string; fingerprint: string; actor: string }>>`select resource_reference as id,
      metadata->>'createFingerprint' as fingerprint, actor_reference as actor from audit_events
      where resource_type='rule_version' and action='RULE_CREATED' and metadata->>'createRequestId'=${requestId} limit 1`;
    if (!prior) return null;
    if (prior.fingerprint !== fingerprint || prior.actor !== actor) throw new RuleStoreError("RULE_REQUEST_CONFLICT");
    const existing = await this.get(prior.id);
    if (!existing) throw new RuleStoreError("RULE_REQUEST_DELETED");
    return existing;
  }

  async create(input: RuleCreate): Promise<RuleRecord> {
    return this.write(async sql => {
      // Serialize the request even after its draft has been deleted; the audit is the durable tombstone.
      await sql`select pg_advisory_xact_lock(hashtext(${`rule-create:${input.requestId}`}))`;
      const [prior] = await sql<Array<{ id: string; fingerprint: string; actor: string }>>`select resource_reference as id,
        metadata->>'createFingerprint' as fingerprint, actor_reference as actor from audit_events
        where resource_type='rule_version' and action='RULE_CREATED' and metadata->>'createRequestId'=${input.requestId} limit 1`;
      if (prior) {
        if (prior.fingerprint !== input.fingerprint || prior.actor !== input.actor) throw new RuleStoreError("RULE_REQUEST_CONFLICT");
        const existing = (await this.read(sql, prior.id))[0];
        if (!existing) throw new RuleStoreError("RULE_REQUEST_DELETED");
        return existing;
      }
      await this.claimName(sql, input.definition.name, input.id);
      await sql`insert into scoring_rule_versions (id,version,lifecycle,clinical_use_permitted,package_checksum,definition,created_by,created_at,updated_at,revision,create_request_id,create_fingerprint)
        values (${input.id},${input.definition.name.trim()},'DRAFT',false,${input.checksum},${sql.json(input.definition)},${input.actor},${input.now},${input.now},1,${input.requestId},${input.fingerprint})`;
      const created = (await this.read(sql, input.id))[0]!;
      await this.log(sql, created, input.actor, "RULE_CREATED", input.now, { createRequestId: input.requestId, createFingerprint: input.fingerprint });
      return created;
    });
  }

  async save(input: RuleSave): Promise<RuleRecord> {
    return this.write(async sql => {
      const current = await this.locked(sql, input.id, input.revision);
      if (current.lifecycle !== "DRAFT" && current.lifecycle !== "VALIDATED") throw new RuleStoreError("RULE_IMMUTABLE");
      await this.claimName(sql, current.version, input.id);
      await this.claimName(sql, input.definition.name, input.id);
      await sql`update scoring_rule_versions set version=${input.definition.name.trim()},definition=${sql.json(input.definition)},package_checksum=${input.checksum},
        revision=revision+1,lifecycle='DRAFT',clinical_use_permitted=false,validated_revision=null,validated_at=null,updated_at=${input.now} where id=${input.id}`;
      const saved = (await this.read(sql, input.id))[0]!;
      await this.log(sql, saved, input.actor, "RULE_SAVED", input.now);
      return saved;
    });
  }

  async transition(input: RuleTransition): Promise<RuleRecord> {
    return this.write(async sql => {
      const current = await this.locked(sql, input.id, input.revision);
      const lifecycle = nextRuleState(current, input.action);
      // Definition does not change in a transition, so validated evidence follows the event revision.
      const validatedRevision = input.action === "validate" || current.validatedRevision === current.revision ? current.revision + 1 : null;
      await sql`update scoring_rule_versions set lifecycle=${lifecycle},revision=revision+1,validated_revision=${validatedRevision},updated_at=${input.now},
        clinical_use_permitted=${lifecycle === "APPROVED" || lifecycle === "ACTIVE"},
        validated_at=case when ${input.action}='validate' then ${input.now}::timestamptz else validated_at end,
        approved_at=case when ${input.action}='approve' then ${input.now}::timestamptz else approved_at end,
        activated_at=case when ${input.action}='activate' then ${input.now}::timestamptz else activated_at end,
        retired_at=case when ${input.action}='retire' then ${input.now}::timestamptz else retired_at end where id=${input.id}`;
      const updated = (await this.read(sql, input.id))[0]!;
      await this.log(sql, updated, input.actor, `RULE_${lifecycle}`, input.now);
      return updated;
    });
  }

  async delete(id: string, revision: number, actor: string, now: string): Promise<void> {
    await this.write(async sql => {
      const current = await this.locked(sql, id, revision);
      if (current.lifecycle !== "DRAFT") throw new RuleStoreError("RULE_IMMUTABLE");
      const [usage] = await sql<Array<{ used: boolean }>>`select exists(select 1 from assessment_bindings where scoring_rule_version_id=${id}) or exists(select 1 from deployment_version_assignments where scoring_rule_version_id=${id})
        or exists(select 1 from usage_events where scoring_rule_version_id=${id}) as used`;
      if (usage?.used) throw new RuleStoreError("RULE_IN_USE");
      await this.log(sql, { ...current, revision: revision + 1 }, actor, "RULE_DELETED", now);
      await sql`delete from scoring_rule_versions where id=${id}`;
    }).catch(error => {
      // A concurrent FK reference must fail closed rather than erase a referenced draft.
      if (typeof error === "object" && error !== null && "code" in error && error.code === "23503") throw new RuleStoreError("RULE_IN_USE");
      throw error;
    });
  }

  async audit(id: string): Promise<RuleAudit[]> {
    const rows = await this.database<Array<Omit<RuleAudit, "at" | "actorName"> & { at: Date | string; actorName: string | null }>>`select e.id,e.actor_reference as actor,u.display_name as "actorName",e.action,e.occurred_at as at,
      (e.metadata->>'revision')::integer as revision,e.metadata->>'checksum' as checksum from audit_events e
      left join admin_users u on u.id=e.actor_reference
      where e.resource_type='rule_version' and e.resource_reference=${id} order by e.occurred_at,e.id`;
    // Keep the recorded actor ID even if the account is no longer available.
    return rows.map(({ actorName, ...row }) => ({ ...row, ...(actorName ? { actorName } : {}), at: timestamp(row.at) }));
  }
}
