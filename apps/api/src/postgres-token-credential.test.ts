import { expect, test } from "bun:test";
import postgres from "postgres";
import { createEntityId } from "./lib/id";
import { PostgresScoringStore } from "./postgres-store";

test.skipIf(process.env.RULE_DATABASE_TEST !== "1")("PostgreSQL links each used token to only its issued credential", async () => {
  const db = postgres(process.env.DATABASE_URL!, { max: 1 });
  const rollback = new Error("rollback token credential fixture");
  try {
    await db.begin(async tx => {
      // Nested store transactions use savepoints so the entire fixture rolls back.
      const scoped = new Proxy(tx, { get(target, key) { return key === "begin" ? (fn: (sql: typeof tx) => Promise<unknown>) => tx.savepoint(fn) : Reflect.get(target, key); } }) as unknown as ReturnType<typeof postgres>;
      const store = new PostgresScoringStore(scoped);
      const client = await store.createClient({ name: `Synthetic token access ${createEntityId()}` });
      const deployment = await store.createDeployment({ clientId: client.id, name: "Token access", environment: "test" });
      const other = await store.createDeployment({ clientId: client.id, name: "Other", environment: "test" });

      async function activate(suffix: string) {
        const tokenId = createEntityId();
        const credentialId = createEntityId();
        const tokenHash = suffix.repeat(64);
        const secretHash = suffix.toUpperCase().repeat(64);
        const keyPrefix = createEntityId().slice(0, 20);
        await store.storeActivationToken({ id: tokenId, deploymentId: deployment.id, tokenHash, tokenCiphertext: "fixture", expiresAt: null });
        expect(await store.exchangeActivation({ tokenHash, credentialId, keyPrefix, secretHash, now: new Date() })).toMatchObject({ deploymentId: deployment.id });
        expect((await store.listActivationTokens(deployment.id)).find(token => token.id === tokenId)?.credentialStatus).toBe("Active");
        return { tokenId, keyPrefix, secretHash };
      }

      const first = await activate("a");
      const second = await activate("b");
      expect(await store.revokeTokenCredential(other.id, first.tokenId, new Date())).toBe("UNAVAILABLE");
      expect(await store.revokeTokenCredential(deployment.id, first.tokenId, new Date())).toBe("REVOKED");
      expect(await store.revokeTokenCredential(deployment.id, first.tokenId, new Date())).toBe("ALREADY_REVOKED");
      expect(await store.authenticateDeployment(first.keyPrefix, first.secretHash)).toBeNull();
      expect(await store.authenticateDeployment(second.keyPrefix, second.secretHash)).toMatchObject({ deploymentId: deployment.id });
      expect((await store.listActivationTokens(deployment.id)).find(token => token.id === first.tokenId)?.credentialStatus).toBe("Revoked");

      const [secondCredential] = await tx<Array<{ id: string }>>`select credential_id as id from activation_tokens where id=${second.tokenId}`;
      await tx`update deployment_credentials set expires_at=now()-interval '1 second' where id=${secondCredential!.id}`;
      expect((await store.listActivationTokens(deployment.id)).find(token => token.id === second.tokenId)?.credentialStatus).toBe("Expired");
      expect(await store.authenticateDeployment(second.keyPrefix, second.secretHash)).toBeNull();
      throw rollback;
    });
  } catch (error) { if (error !== rollback) throw error; }
  finally { await db.end(); }
});
