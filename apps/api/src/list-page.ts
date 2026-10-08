import type { Context } from "hono";

export type ListPage = { page: number; pageSize: number; search: string };

export function parseListPage(c: Context, defaultPageSize = 10): ListPage | null {
  const rawPage = c.req.query("page") ?? "1";
  const rawPageSize = c.req.query("pageSize") ?? String(defaultPageSize);
  if (!/^[1-9]\d*$/.test(rawPage) || !/^[1-9]\d*$/.test(rawPageSize)) return null;
  const page = Number(rawPage);
  const pageSize = Number(rawPageSize);
  const search = (c.req.query("search") ?? "").trim();
  if (!Number.isSafeInteger(page) || !Number.isSafeInteger(pageSize) || pageSize > 50 || search.length > 120 || !Number.isSafeInteger((page - 1) * pageSize)) return null;
  return { page, pageSize, search };
}

export function pageResult<T>(items: T[], total: number, page: number, pageSize: number) {
  return { items, total, page, pageSize, pageCount: Math.max(1, Math.ceil(total / pageSize)) };
}

export function clampPage(page: number, total: number, pageSize: number) {
  return Math.min(page, Math.max(1, Math.ceil(total / pageSize)));
}
