import { describe, expect, test } from "bun:test";
import { createApp } from "./app";
import { MemoryAdminAuthStore } from "./admin-auth-store";
import { MemoryScoringStore } from "./store";

const now = "2026-09-13T00:00:00.000Z";
const headers = { cookie: "niq_scoring_session=product-test-session", origin: "http://localhost:4173", "content-type": "application/json" };

function setup() {
  const store = new MemoryScoringStore();
  const authStore = new MemoryAdminAuthStore();
  const actorId = "01J00000000000000000000001";
  authStore.state.users.push({ id: actorId, email: "products@niq.test", displayName: "Product administrator", enabled: true, createdAt: now, passwordHash: "unused" });
  authStore.state.sessions.push({ userId: actorId, tokenHash: new Bun.CryptoHasher("sha256").update("product-test-session").digest("hex"), expiresAt: "2027-01-01T00:00:00.000Z" });
  const app = createApp({ store, authStore, allowedOrigins: [headers.origin], region: "india", runtimeEnvironment: "test", provisionalScoringRequested: false, now: () => new Date(now) });
  const request = (path = "", method = "GET", body?: unknown) => app.request(`/admin/products${path}`, { method, headers, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
  return { app, store, request };
}

describe("shared product catalog", () => {
  test("requires admin authentication and starts with the five reviewed names", async () => {
    const { app, request } = setup();
    expect((await app.request("/admin/products")).status).toBe(401);
    const response = await request();
    expect(response.status).toBe(200);
    const body = await response.json() as { products: Array<{ id: string; name: string; createdAt: string; updatedAt: string }> };
    expect(body.products.map(product => product.name)).toEqual(["Invigour", "Liss WH", "Nourish", "Protect", "Recover"]);
    expect(body.products.every(product => product.id.length === 26 && product.createdAt && product.updatedAt)).toBe(true);
  });

  test("creates, renames, and deletes names while rejecting blank and duplicate names", async () => {
    const { request } = setup();
    expect((await request("", "POST", { name: "  " })).status).toBe(400);
    expect((await request("", "POST", { name: " nourish " })).status).toBe(409);
    const created = await request("", "POST", { name: "  New Product  " });
    expect(created.status).toBe(201);
    const product = await created.json() as { id: string; name: string };
    expect(product.name).toBe("New Product");
    expect(await (await request("", "POST", { name: "NEW PRODUCT" })).json()).toEqual({ error: "PRODUCT_NAME_EXISTS" });
    const renamed = await request(`/${product.id}`, "PUT", { name: "Other Product" });
    expect(renamed.status).toBe(200);
    expect((await renamed.json() as { name: string }).name).toBe("Other Product");
    expect((await request(`/${product.id}`, "PUT", { name: "  PROTECT  " })).status).toBe(409);
    expect((await request(`/${product.id}`, "DELETE")).status).toBe(200);
    expect(await (await request(`/${product.id}`, "DELETE")).json()).toEqual({ error: "PRODUCT_NOT_FOUND" });
    expect((await request(`/${product.id}`, "PUT", { name: "Gone" })).status).toBe(404);
    expect((await request()).json().then((body: { products: Array<{ name: string }> }) => body.products.some(row => row.name === "Other Product"))).resolves.toBe(false);
  });

  test("rejects malformed requests and origins", async () => {
    const { app, request } = setup();
    expect((await request("", "POST", { name: "Okay", active: true })).status).toBe(400);
    expect((await request("/invalid", "PUT", { name: "Okay" })).status).toBe(400);
    expect((await app.request("/admin/products", { method: "POST", headers: { ...headers, origin: "https://other.example" }, body: JSON.stringify({ name: "Okay" }) })).status).toBe(403);
  });

  test("stores a verified catalogue description and historical name without changing the product ID", async () => {
    const { request } = setup();
    const invigour = (await (await request()).json() as { products: Array<{ id: string; name: string }> }).products.find(row => row.name === "Invigour")!;
    const changed = await request(`/${invigour.id}`, "PUT", { name: "Es Invigour", description: "Nutrition support described in the supplied report.", aliases: ["Invigour"] });
    expect(changed.status).toBe(200);
    expect(await changed.json()).toMatchObject({ id: invigour.id, name: "Es Invigour", description: "Nutrition support described in the supplied report.", aliases: ["Invigour"] });
    expect((await request("", "POST", { name: "Invigour" })).status).toBe(409);
    expect((await request(`/${invigour.id}`, "PUT", { name: "Es Invigour", aliases: ["Protect"] })).status).toBe(409);
  });
});
