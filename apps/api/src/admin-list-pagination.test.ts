import { expect, test } from "bun:test";
import { createApp } from "./app";
import { MemoryAdminAuthStore } from "./admin-auth-store";
import { MemoryScoringStore } from "./store";
import { createEntityId } from "./lib/id";
import { createSpreadsheetTemplate } from "@niq-scoring/contracts/rule-template";

const headers = { cookie: "niq_scoring_session=list-session", origin: "http://localhost:4173" };
function fixture() {
  const store = new MemoryScoringStore();
  const authStore = new MemoryAdminAuthStore();
  authStore.state.users.push({ id: createEntityId(), email: "admin@example.test", displayName: "Admin", enabled: true, createdAt: "2026-09-01T00:00:00Z", passwordHash: "unused" });
  authStore.state.sessions.push({ userId: authStore.state.users[0]!.id, tokenHash: new Bun.CryptoHasher("sha256").update("list-session").digest("hex"), expiresAt: "2027-01-01T00:00:00Z" });
  const app = createApp({ store, authStore, allowedOrigins: [headers.origin], region: "india", runtimeEnvironment: "test", provisionalScoringRequested: false, now: () => new Date("2026-10-08T00:00:00Z") });
  const get = (path: string) => app.request(path, { headers });
  return { store, authStore, get };
}

test("client and deployment lists paginate and filter before sending rows", async () => {
  const { store, get } = fixture();
  const apollo = await store.createClient({ name: "Apollo" });
  await store.createClient({ name: "Beta" });
  await store.createClient({ name: "Gamma" });
  await store.createDeployment({ clientId: apollo.id, name: "Production", environment: "production" });
  await store.createDeployment({ clientId: apollo.id, name: "Development", environment: "development" });
  const clients = await (await get("/admin/clients?page=2&pageSize=1")).json();
  expect(clients).toMatchObject({ total: 3, pageCount: 3, page: 2 });
  expect(clients.items.map((item: { name: string }) => item.name)).toEqual(["Beta"]);
  expect((await (await get("/admin/clients?search=apollo")).json()).items).toEqual([expect.objectContaining({ id: apollo.id, deploymentCount: 2 })]);
  expect((await (await get("/admin/clients/apollo")).json()).client).toMatchObject({ id: apollo.id, deploymentCount: 2 });
  const deployments = await (await get(`/admin/deployments?clientId=${apollo.id}&environment=production&pageSize=1`)).json();
  expect(deployments).toMatchObject({ total: 1, pageCount: 1 });
  expect(deployments.items).toEqual([expect.objectContaining({ name: "Production", clientName: "Apollo", displayLabel: "Production" })]);
  expect((await (await get("/admin/clients?page=99&pageSize=1")).json()).page).toBe(3);
  expect((await (await get(`/admin/deployments?clientId=${apollo.id}&page=99&pageSize=1`)).json()).page).toBe(2);
  expect((await get("/admin/deployments?pageSize=51")).status).toBe(400);
});

test("users and invitations have independent bounded pages and counts", async () => {
  const { authStore, get } = fixture();
  authStore.state.users.push({ id: createEntityId(), email: "second@example.test", displayName: "Second", enabled: true, createdAt: "2026-09-02T00:00:00Z", passwordHash: "unused" });
  authStore.state.invitations.push({ id: createEntityId(), email: "invite@example.test", displayName: "Invite", tokenHash: "secret", createdAt: "2026-10-01T00:00:00Z", expiresAt: "2026-10-09T00:00:00Z" });
  const users = await (await get("/admin/users?kind=users&pageSize=1&page=2")).json();
  expect(users).toMatchObject({ userTotal: 2, invitationTotal: 1, pageCount: 2 });
  expect(users.users).toHaveLength(1);
  expect(users.users[0].passwordHash).toBeUndefined();
  expect(users.invitations).toEqual([]);
  const invitations = await (await get("/admin/users?kind=invitations&pageSize=1")).json();
  expect(invitations.invitations).toHaveLength(1);
  expect(invitations.invitations[0].tokenHash).toBeUndefined();
  expect(invitations.users).toEqual([]);
});

test("rules filter and paginate in the store before metadata response", async () => {
  const { store, get } = fixture();
  for (const name of ["Alpha", "Beta", "Gamma"]) {
    const definition = createSpreadsheetTemplate(name);
    await store.rules.create({ id: createEntityId(), definition, checksum: "test", actor: "admin", requestId: crypto.randomUUID(), fingerprint: name, now: "2026-10-08T00:00:00Z" });
  }
  const page = await (await get("/admin/rules?page=2&pageSize=1")).json();
  expect(page).toMatchObject({ total: 3, pageCount: 3 });
  expect(page.versions).toHaveLength(1);
  const filtered = await (await get("/admin/rules?search=beta&status=DRAFT")).json();
  expect(filtered.versions).toEqual([expect.objectContaining({ version: "Beta" })]);
  expect(filtered.total).toBe(1);
  expect((await get("/admin/rules?pageSize=100")).status).toBe(400);
});
