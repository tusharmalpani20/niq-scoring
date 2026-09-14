import { nextRuleState, normalizedRuleName, RuleStoreError, type RuleAudit, type RuleCreate, type RuleRecord, type RuleSave, type RuleStore, type RuleTransition } from "./rule-store";
import { createEntityId } from "./lib/id";

export class MemoryRuleStore implements RuleStore {
  records: RuleRecord[] = [];
  events: Array<RuleAudit & { ruleId: string }> = [];
  private requests = new Map<string, { fingerprint: string; id: string; actor: string }>();
  constructor(private readonly referenced: (id: string) => boolean = () => false) {}
  async list() { return structuredClone(this.records); }
  async get(id: string) { return structuredClone(this.records.find(r => r.id === id) ?? null); }
  private row(id: string, revision: number) {
    const row = this.records.find(r => r.id === id);
    if (!row) throw new RuleStoreError("RULE_NOT_FOUND");
    if (row.revision !== revision) throw new RuleStoreError("RULE_REVISION_CONFLICT");
    return row;
  }
  private name(name: string, exclude?: string) {
    if (this.records.some(r => r.id !== exclude && normalizedRuleName(r.version) === normalizedRuleName(name))) throw new RuleStoreError("RULE_NAME_EXISTS");
  }
  private log(row: RuleRecord, actor: string, action: string, now: string) {
    this.events.push({ id: createEntityId(), ruleId: row.id, actor, action, at: now, revision: row.revision, checksum: row.packageChecksum });
  }
  private replay(requestId: string, fingerprint: string, actor: string) {
    const prior = this.requests.get(requestId);
    if (!prior) return null;
    if (prior.fingerprint !== fingerprint || prior.actor !== actor) throw new RuleStoreError("RULE_REQUEST_CONFLICT");
    const record = this.records.find(r => r.id === prior.id);
    if (!record) throw new RuleStoreError("RULE_REQUEST_DELETED");
    return structuredClone(record);
  }
  async replayCreate(requestId: string, fingerprint: string, actor: string) { return this.replay(requestId, fingerprint, actor); }
  async create(input: RuleCreate) {
    const prior = this.replay(input.requestId, input.fingerprint, input.actor);
    if (prior) return prior;
    this.name(input.definition.name);
    const record: RuleRecord = { id: input.id, version: input.definition.name, lifecycle: "DRAFT", clinicalUsePermitted: false, definition: structuredClone(input.definition), packageChecksum: input.checksum, revision: 1, validatedRevision: null, createdAt: input.now, updatedAt: input.now, createdBy: input.actor, approvedAt: null };
    this.records.push(record); this.requests.set(input.requestId, { fingerprint: input.fingerprint, id: input.id, actor: input.actor }); this.log(record, input.actor, "RULE_CREATED", input.now);
    return structuredClone(record);
  }
  async save(input: RuleSave) {
    const row = this.row(input.id, input.revision);
    if (!["DRAFT", "VALIDATED"].includes(row.lifecycle)) throw new RuleStoreError("RULE_IMMUTABLE");
    this.name(input.definition.name, row.id);
    Object.assign(row, { definition: structuredClone(input.definition), version: input.definition.name, packageChecksum: input.checksum, revision: row.revision + 1, lifecycle: "DRAFT", clinicalUsePermitted: false, validatedRevision: null, updatedAt: input.now });
    this.log(row, input.actor, "RULE_SAVED", input.now); return structuredClone(row);
  }
  async transition(input: RuleTransition) {
    const row = this.row(input.id, input.revision); const state = nextRuleState(row, input.action);
    const validated = input.action === "validate" || row.validatedRevision === row.revision;
    row.lifecycle = state; row.revision++; row.updatedAt = input.now;
    row.validatedRevision = validated ? row.revision : null;
    if (input.action === "approve") row.approvedAt = input.now;
    row.clinicalUsePermitted = state === "APPROVED" || state === "ACTIVE";
    this.log(row, input.actor, `RULE_${state}`, input.now); return structuredClone(row);
  }
  async delete(id: string, revision: number, actor: string, now: string) {
    const row = this.row(id, revision);
    if (row.lifecycle !== "DRAFT") throw new RuleStoreError("RULE_IMMUTABLE");
    if (this.referenced(id)) throw new RuleStoreError("RULE_IN_USE");
    this.log({ ...row, revision: revision + 1 }, actor, "RULE_DELETED", now); this.records = this.records.filter(r => r.id !== id);
  }
  async audit(id: string) { return structuredClone(this.events.filter(event => event.ruleId === id)); }
}
