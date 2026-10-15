import type { Hono, Context } from "hono";
import { bodyLimit } from "hono/body-limit";
import { z } from "zod";
import { ulidSchema } from "@niq-scoring/contracts";
import { adminMutationAudit } from "./admin-mutation-audit";
import { ProductCatalogError, type ProductCatalog } from "./product-catalog";

const maxImageBytes = 5 * 1024 * 1024;
// Restrict uploads to inert raster formats and verify their signatures instead
// of trusting the browser-provided MIME type. SVG/HTML are never accepted.
const imageDataUrlSchema = z.string().max(Math.ceil(maxImageBytes / 3) * 4 + 40).refine(value => {
  const match = /^data:image\/(png|jpeg|webp);base64,([A-Za-z0-9+/]+={0,2})$/.exec(value);
  if (!match) return false;
  const bytes = Buffer.from(match[2]!, "base64");
  if (!bytes.length || bytes.length > maxImageBytes || bytes.toString("base64") !== match[2]) return false;
  if (match[1] === "png") return bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
  if (match[1] === "jpeg") return bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255;
  return bytes.toString("ascii", 0, 4) === "RIFF" && bytes.toString("ascii", 8, 12) === "WEBP";
}, "Upload a PNG, JPEG, or WebP image up to 5 MiB.");

const bodySchema = z.object({
  name: z.string().trim().min(1).max(120),
  description: z.string().trim().max(2000).nullable().optional(),
  aliases: z.array(z.string().trim().min(1).max(120)).max(20).optional(),
  benefits: z.array(z.string().trim().min(1).max(500)).max(20).optional(),
  imageDataUrl: imageDataUrlSchema.nullable().optional(),
}).strict();

export function installProductRoutes(app: Hono, products: ProductCatalog) {
  const limit = bodyLimit({ maxSize: 8 * 1024 * 1024, onError: context => context.json({ error: "PRODUCT_IMAGE_TOO_LARGE" }, 413) });
  app.use("/admin/products", limit);
  app.use("/admin/products/:id", limit);
  const guard = (handler: (context: Context) => Promise<Response>) => async (context: Context) => {
    try { return await handler(context); }
    catch (error) {
      if (error instanceof ProductCatalogError) return context.json({ error: error.code }, error.code === "PRODUCT_NOT_FOUND" ? 404 : 409);
      throw error;
    }
  };
  app.get("/admin/products", guard(async context => context.json({ products: await products.list() })));
  app.post("/admin/products", guard(async context => {
    const parsed = bodySchema.safeParse(await context.req.json().catch(() => null));
    if (!parsed.success) return context.json({ error: "INVALID_REQUEST", issues: parsed.error.issues }, 400);
    return context.json(await products.create({ name: parsed.data.name, description: parsed.data.description ?? null, aliases: parsed.data.aliases ?? [], benefits: parsed.data.benefits ?? [], imageDataUrl: parsed.data.imageDataUrl ?? null }, adminMutationAudit(context)), 201);
  }));
  app.put("/admin/products/:id", guard(async context => {
    const id = ulidSchema.safeParse(context.req.param("id"));
    const parsed = bodySchema.safeParse(await context.req.json().catch(() => null));
    if (!id.success || !parsed.success) return context.json({ error: "INVALID_REQUEST" }, 400);
    const existing = (await products.list()).find(row => row.id === id.data);
    if (!existing) return context.json({ error: "PRODUCT_NOT_FOUND" }, 404);
    return context.json(await products.update(id.data, { name: parsed.data.name,
      description: parsed.data.description === undefined ? existing.description : parsed.data.description,
      aliases: parsed.data.aliases ?? existing.aliases, ...(parsed.data.benefits === undefined ? {} : { benefits: parsed.data.benefits }),
      ...(parsed.data.imageDataUrl === undefined ? {} : { imageDataUrl: parsed.data.imageDataUrl }) }, adminMutationAudit(context)));
  }));
  app.delete("/admin/products/:id", guard(async context => {
    const id = ulidSchema.safeParse(context.req.param("id"));
    if (!id.success) return context.json({ error: "INVALID_REQUEST" }, 400);
    if (!await products.delete(id.data, adminMutationAudit(context))) return context.json({ error: "PRODUCT_NOT_FOUND" }, 404);
    return context.json({ deleted: true });
  }));
}
