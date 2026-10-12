import type { Hono, Context } from "hono";
import { z } from "zod";
import { ulidSchema } from "@niq-scoring/contracts";
import { adminMutationAudit } from "./admin-mutation-audit";
import { ProductCatalogError, type ProductCatalog } from "./product-catalog";

const bodySchema = z.object({ name: z.string().trim().min(1).max(120) }).strict();

export function installProductRoutes(app: Hono, products: ProductCatalog) {
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
    return context.json(await products.create(parsed.data.name, adminMutationAudit(context)), 201);
  }));
  app.put("/admin/products/:id", guard(async context => {
    const id = ulidSchema.safeParse(context.req.param("id"));
    const parsed = bodySchema.safeParse(await context.req.json().catch(() => null));
    if (!id.success || !parsed.success) return context.json({ error: "INVALID_REQUEST" }, 400);
    return context.json(await products.rename(id.data, parsed.data.name, adminMutationAudit(context)));
  }));
  app.delete("/admin/products/:id", guard(async context => {
    const id = ulidSchema.safeParse(context.req.param("id"));
    if (!id.success) return context.json({ error: "INVALID_REQUEST" }, 400);
    if (!await products.delete(id.data, adminMutationAudit(context))) return context.json({ error: "PRODUCT_NOT_FOUND" }, 404);
    return context.json({ deleted: true });
  }));
}
