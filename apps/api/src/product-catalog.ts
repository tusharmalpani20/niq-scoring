import type postgres from "postgres";
import { createEntityId } from "./lib/id";
import { recordAdminMutation, type AdminMutationAudit } from "./admin-mutation-audit";

export type Product = { id: string; name: string; description: string | null; aliases: string[]; createdAt: string; updatedAt: string };
export type ProductInput = Pick<Product, "name" | "description" | "aliases">;
export const initialProductNames = ["Invigour", "Nourish", "Protect", "Recover", "Liss WH"] as const;

export class ProductCatalogError extends Error {
  constructor(readonly code: "PRODUCT_NAME_EXISTS" | "PRODUCT_NOT_FOUND") { super(code); }
}

export interface ProductCatalog {
  list(): Promise<Product[]>;
  create(input: ProductInput, audit?: AdminMutationAudit): Promise<Product>;
  update(id: string, input: ProductInput, audit?: AdminMutationAudit): Promise<Product>;
  delete(id: string, audit?: AdminMutationAudit): Promise<boolean>;
}

const normalizedName = (name: string) => name.trim().toLowerCase();
const normalizedInput = (input: ProductInput): ProductInput => ({
  name: input.name.trim(), description: input.description?.trim() || null,
  aliases: [...new Set(input.aliases.map(alias => alias.trim()).filter(Boolean))],
});
function collides(rows: Product[], input: ProductInput, ownId?: string): boolean {
  const names = [input.name, ...input.aliases].map(normalizedName);
  if (new Set(names).size !== names.length) return true;
  return rows.some(row => row.id !== ownId && [row.name, ...row.aliases].some(name => names.includes(normalizedName(name))));
}

export class MemoryProductCatalog implements ProductCatalog {
  readonly records: Product[];
  constructor(private readonly now: () => Date = () => new Date()) {
    const timestamp = this.now().toISOString();
    this.records = initialProductNames.map(name => ({ id: createEntityId(), name, description: null, aliases: [], createdAt: timestamp, updatedAt: timestamp }));
  }
  async list() { return [...this.records].sort((a, b) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id)); }
  async create(raw: ProductInput) {
    const input = normalizedInput(raw);
    if (collides(this.records, input)) throw new ProductCatalogError("PRODUCT_NAME_EXISTS");
    const timestamp = this.now().toISOString();
    const product = { id: createEntityId(), ...input, createdAt: timestamp, updatedAt: timestamp };
    this.records.push(product);
    return product;
  }
  async update(id: string, raw: ProductInput) {
    const product = this.records.find(row => row.id === id);
    if (!product) throw new ProductCatalogError("PRODUCT_NOT_FOUND");
    const input = normalizedInput(raw);
    if (collides(this.records, input, id)) throw new ProductCatalogError("PRODUCT_NAME_EXISTS");
    Object.assign(product, input);
    product.updatedAt = this.now().toISOString();
    return { ...product, aliases: [...product.aliases] };
  }
  async delete(id: string) {
    const index = this.records.findIndex(row => row.id === id);
    if (index < 0) return false;
    this.records.splice(index, 1);
    return true;
  }
}

type Database = ReturnType<typeof postgres>;
type ProductRow = Omit<Product, "createdAt" | "updatedAt"> & { createdAt: Date; updatedAt: Date };
const fromRow = (row: ProductRow): Product => ({ ...row, createdAt: row.createdAt.toISOString(), updatedAt: row.updatedAt.toISOString() });

export class PostgresProductCatalog implements ProductCatalog {
  constructor(private readonly database: Database) {}
  async list() {
    const rows = await this.database<ProductRow[]>`select id, name, description, aliases, created_at as "createdAt", updated_at as "updatedAt" from products order by lower(name), id`;
    return rows.map(fromRow);
  }
  async create(raw: ProductInput, audit?: AdminMutationAudit) {
    const input = normalizedInput(raw);
    return this.database.begin(async tx => {
      const existing = await tx<ProductRow[]>`select id, name, description, aliases, created_at as "createdAt", updated_at as "updatedAt" from products for update`;
      if (collides(existing.map(fromRow), input)) throw new ProductCatalogError("PRODUCT_NAME_EXISTS");
      const id = createEntityId();
      const [row] = await tx<ProductRow[]>`insert into products (id, name, description, aliases) values (${id}, ${input.name}, ${input.description}, ${tx.array(input.aliases)}) on conflict (lower(btrim(name))) do nothing returning id, name, description, aliases, created_at as "createdAt", updated_at as "updatedAt"`;
      if (!row) throw new ProductCatalogError("PRODUCT_NAME_EXISTS");
      await recordAdminMutation(tx, audit, "PRODUCT_CREATED", "PRODUCT", id, { name: row.name, description: row.description, aliases: row.aliases });
      return fromRow(row);
    });
  }
  async update(id: string, raw: ProductInput, audit?: AdminMutationAudit) {
    const input = normalizedInput(raw);
    try {
      return await this.database.begin(async tx => {
        const existing = await tx<ProductRow[]>`select id, name, description, aliases, created_at as "createdAt", updated_at as "updatedAt" from products for update`;
        const prior = existing.find(row => row.id === id);
        if (!prior) throw new ProductCatalogError("PRODUCT_NOT_FOUND");
        if (collides(existing.map(fromRow), input, id)) throw new ProductCatalogError("PRODUCT_NAME_EXISTS");
        const [row] = await tx<ProductRow[]>`update products set name=${input.name}, description=${input.description}, aliases=${tx.array(input.aliases)}, updated_at=now() where id=${id} returning id, name, description, aliases, created_at as "createdAt", updated_at as "updatedAt"`;
        if (!row) throw new ProductCatalogError("PRODUCT_NOT_FOUND");
        await recordAdminMutation(tx, audit, "PRODUCT_RENAMED", "PRODUCT", id, { before: { name: prior.name, description: prior.description, aliases: prior.aliases }, after: { name: row.name, description: row.description, aliases: row.aliases } });
        return fromRow(row);
      });
    } catch (error) {
      // The unique index also protects concurrent renames after the existence check.
      if ((error as { code?: string }).code === "23505") throw new ProductCatalogError("PRODUCT_NAME_EXISTS");
      throw error;
    }
  }
  async delete(id: string, audit?: AdminMutationAudit) {
    return this.database.begin(async tx => {
      const [row] = await tx<Array<{ name: string }>>`delete from products where id=${id} returning name`;
      if (!row) return false;
      await recordAdminMutation(tx, audit, "PRODUCT_DELETED", "PRODUCT", id, { name: row.name });
      return true;
    });
  }
}
