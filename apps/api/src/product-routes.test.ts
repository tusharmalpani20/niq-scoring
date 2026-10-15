import { describe, expect, test } from "bun:test";
import { createApp } from "./app";
import { MemoryAdminAuthStore } from "./admin-auth-store";
import { MemoryScoringStore } from "./store";

// Actual 1×1 PNG fixture, rather than arbitrary bytes with an image MIME label.
const png = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=";
type ProductDetails = { id: string; name: string; description: string | null; aliases: string[]; benefits: string[]; imageDataUrl: string | null };

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

  test("roundtrips benefit bullets and images, preserving omitted fields and allowing explicit removal", async () => {
    const { request } = setup();
    const created = await request("", "POST", {
      name: "Nutrition Support", description: "Shared product description", aliases: ["Old Support"],
      benefits: ["Supports daily nutrition", "Supports protein intake"], imageDataUrl: png,
    });
    expect(created.status).toBe(201);
    const product = await created.json() as ProductDetails;
    const expected = { description: "Shared product description", aliases: ["Old Support"],
      benefits: ["Supports daily nutrition", "Supports protein intake"], imageDataUrl: png };
    expect(product).toMatchObject(expected);
    const listed = await (await request()).json() as { products: ProductDetails[] };
    expect(listed.products.find(row => row.id === product.id)).toMatchObject(expected);

    const renamed = await request(`/${product.id}`, "PUT", { name: "Updated Support" });
    expect(renamed.status).toBe(200);
    expect(await renamed.json()).toMatchObject({ id: product.id, name: "Updated Support", ...expected });

    const benefitsUpdated = await request(`/${product.id}`, "PUT", { name: "Updated Support", benefits: ["Updated benefit"] });
    expect(benefitsUpdated.status).toBe(200);
    expect(await benefitsUpdated.json()).toMatchObject({ benefits: ["Updated benefit"], imageDataUrl: png });
    const removed = await request(`/${product.id}`, "PUT", { name: "Updated Support", imageDataUrl: null });
    expect(removed.status).toBe(200);
    expect(await removed.json()).toMatchObject({ benefits: ["Updated benefit"], imageDataUrl: null });
    const cleared = await request(`/${product.id}`, "PUT", { name: "Updated Support", benefits: [] });
    expect(cleared.status).toBe(200);
    expect(await cleared.json()).toMatchObject({ benefits: [], imageDataUrl: null });
    const restored = await request(`/${product.id}`, "PUT", { name: "Updated Support", imageDataUrl: png });
    expect(restored.status).toBe(200);
    expect(await restored.json()).toMatchObject({ benefits: [], imageDataUrl: png });
  });

  test("rejects invalid raster images and benefit bullets without changing the saved product", async () => {
    const { request } = setup();
    const product = await (await request("", "POST", { name: "Stable Product", benefits: ["Retained benefit"], imageDataUrl: png })).json() as ProductDetails;
    const invalidImages = [
      "data:image/svg+xml;base64," + Buffer.from("<svg/>").toString("base64"),
      png.replace("image/png", "image/jpeg"),
      "data:image/png;base64," + Buffer.from("not a PNG image").toString("base64"),
      png.replace(/=+$/, ""),
    ];
    for (const imageDataUrl of invalidImages) {
      expect((await request(`/${product.id}`, "PUT", { name: product.name, imageDataUrl })).status).toBe(400);
    }
    for (const benefits of [[""], ["x".repeat(501)], Array.from({ length: 21 }, (_, index) => `Benefit ${index}`)]) {
      expect((await request(`/${product.id}`, "PUT", { name: product.name, benefits })).status).toBe(400);
    }
    const listed = await (await request()).json() as { products: ProductDetails[] };
    expect(listed.products.find(row => row.id === product.id)).toMatchObject({ benefits: ["Retained benefit"], imageDataUrl: png });
  });

  test("rejects images over the decoded size limit and requests over the body limit", async () => {
    const { request } = setup();
    const bytes = Buffer.alloc(5 * 1024 * 1024 + 1);
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]).copy(bytes);
    const imageDataUrl = `data:image/png;base64,${bytes.toString("base64")}`;
    expect((await request("", "POST", { name: "Oversized Image", imageDataUrl })).status).toBe(400);
    const overBodyLimit = await request("", "POST", { name: "Oversized Body", imageDataUrl: "x".repeat(8 * 1024 * 1024) });
    expect(overBodyLimit.status).toBe(413);
    expect(await overBodyLimit.json()).toEqual({ error: "PRODUCT_IMAGE_TOO_LARGE" });
    const listed = await (await request()).json() as { products: ProductDetails[] };
    expect(listed.products).toHaveLength(5);
  });

});
