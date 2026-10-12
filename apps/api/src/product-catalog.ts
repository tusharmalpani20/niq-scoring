import type postgres from "postgres";
import { createEntityId } from "./lib/id";
import { recordAdminMutation, type AdminMutationAudit } from "./admin-mutation-audit";

export type Product = { id: string; name: string; createdAt: string; updatedAt: string };
export const initialProductNames = ["Invigour", "Nourish", "Protect", "Recover", "Liss WH"] as const;

export class ProductCatalogError extends Error {
  constructor(readonly code: "PRODUCT_NAME_EXISTS" | "PRODUCT_NOT_FOUND") { super(code); }
}

export interface ProductCatalog {
  list(): Promise<Product[]>;
  create(name: string, audit?: AdminMutationAudit): Promise<Product>;
  rename(id: string, name: string, audit?: AdminMutationAudit): Promise<Product>;
  delete(id: string, audit?: AdminMutationAudit): Promise<boolean>;
}

const normalizedName = (name: string) => name.trim().toLowerCase();

export class MemoryProductCatalog implements ProductCatalog {
  readonly records: Product[];
  constructor(private readonly now: () => Date = () => new Date()) {
    const timestamp = this.now().toISOString();
    this.records = initialProductNames.map(name => ({ id: createEntityId(), name, createdAt: timestamp, updatedAt: timestamp }));
  }
  async list() { return [...this.records].sort((a, b) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id)); }
  async create(name: string) {
    if (this.records.some(row => normalizedName(row.name) === normalizedName(name))) throw new ProductCatalogError("PRODUCT_NAME_EXISTS");
    const timestamp = this.now().toISOString();
    const product = { id: createEntityId(), name: name.trim(), createdAt: timestamp, updatedAt: timestamp };
    this.records.push(product);
    return product;
  }
  async rename(id: string, name: string) {
    const product = this.records.find(row => row.id === id);
    if (!product) throw new ProductCatalogError("PRODUCT_NOT_FOUND");
    if (this.records.some(row => row.id !== id && normalizedName(row.name) === normalizedName(name))) throw new ProductCatalogError("PRODUCT_NAME_EXISTS");
    product.name = name.trim();
    product.updatedAt = this.now().toISOString();
    return { ...product };
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
    const rows = await this.database<ProductRow[]>`select id, name, created_at as "createdAt", updated_at as "updatedAt" from products order by lower(name), id`;
    return rows.map(fromRow);
  }
  async create(name: string, audit?: AdminMutationAudit) {
    return this.database.begin(async tx => {
      const id = createEntityId();
      const [row] = await tx<ProductRow[]>`insert into products (id, name) values (${id}, ${name.trim()}) on conflict (lower(btrim(name))) do nothing returning id, name, created_at as "createdAt", updated_at as "updatedAt"`;
      if (!row) throw new ProductCatalogError("PRODUCT_NAME_EXISTS");
      await recordAdminMutation(tx, audit, "PRODUCT_CREATED", "PRODUCT", id, { name: row.name });
      return fromRow(row);
    });
  }
  async rename(id: string, name: string, audit?: AdminMutationAudit) {
    try {
      return await this.database.begin(async tx => {
        const [prior] = await tx<Array<{ name: string }>>`select name from products where id=${id} for update`;
        if (!prior) throw new ProductCatalogError("PRODUCT_NOT_FOUND");
        const [row] = await tx<ProductRow[]>`update products set name=${name.trim()}, updated_at=now() where id=${id} and not exists (select 1 from products where id<>${id} and lower(btrim(name))=lower(btrim(${name}))) returning id, name, created_at as "createdAt", updated_at as "updatedAt"`;
        if (!row) throw new ProductCatalogError("PRODUCT_NAME_EXISTS");
        await recordAdminMutation(tx, audit, "PRODUCT_RENAMED", "PRODUCT", id, { before: prior.name, after: row.name });
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
