import { expect, test } from "bun:test";
import postgres from "postgres";
import { blankRuleDefinition } from "@niq-scoring/contracts/rules";
import { PostgresRuleStore } from "./postgres-rule-store";
import { createEntityId } from "./lib/id";
import { ruleChecksum } from "./rule-routes";

// Explicit opt-in: uses disposable rule IDs only and retains append-only audit evidence.
test.skipIf(process.env.RULE_DATABASE_TEST !== "1")("PostgreSQL drafts are atomic, conflict-safe and retain deletion tombstones", async () => {
  const sql = postgres(process.env.DATABASE_URL!, { max: 4 });
  const store = new PostgresRuleStore(sql);
  const ids = [createEntityId(), createEntityId()];
  try {
    const [actor] = await sql<Array<{ id: string }>>`select id from admin_users where enabled=true limit 1`;
    if (!actor) throw new Error("Integration test requires an existing enabled administrator");
    const definition = blankRuleDefinition(`Synthetic persistence ${ids[0]}`);
    const input = { id: ids[0]!, definition, checksum: ruleChecksum(definition), actor: actor.id, requestId: crypto.randomUUID(), fingerprint: crypto.randomUUID(), now: new Date().toISOString() };
    const created = await Promise.all([store.create(input), store.create(input)]);
    expect(created[0]?.id).toBe(created[1]?.id);
    expect(await store.audit(input.id)).toHaveLength(1);
    const duplicate = { ...input, id: ids[1]!, requestId: crypto.randomUUID(), definition: { ...definition, name: ` ${definition.name.toUpperCase()} ` } };
    await expect(store.create(duplicate)).rejects.toThrow("RULE_NAME_EXISTS");
    expect(await store.get(ids[1]!)).toBeNull();
    const changed = { ...definition, description: "Edited synthetic draft" };
    const save = { ...input, definition: changed, checksum: ruleChecksum(changed), revision: 1 };
    const saves = await Promise.allSettled([store.save(save), store.save(save)]);
    expect(saves.filter(result => result.status === "fulfilled")).toHaveLength(1);
    expect(saves.filter(result => result.status === "rejected")).toHaveLength(1);
    expect((await store.get(input.id))?.revision).toBe(2);
    expect(await store.audit(input.id)).toHaveLength(2);
    await store.delete(input.id, 2, actor.id, input.now);
    expect(await store.get(input.id)).toBeNull();
    expect((await store.audit(input.id)).map(event => event.action)).toEqual(["RULE_CREATED", "RULE_SAVED", "RULE_DELETED"]);
    await expect(store.create(input)).rejects.toThrow("RULE_REQUEST_DELETED");
  } finally {
    await sql`delete from scoring_rule_versions where id in ${sql(ids)}`;
    await sql.end();
  }
});
