export function paginate<T>(items: T[], requestedPage: number, pageSize = 10) {
  const pageCount = Math.max(1, Math.ceil(items.length / pageSize));
  const page = Math.min(Math.max(1, requestedPage), pageCount);
  const start = (page - 1) * pageSize;
  return { page, pageCount, rows: items.slice(start, start + pageSize), total: items.length };
}
