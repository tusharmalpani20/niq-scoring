import { expect, test } from "bun:test";
import { paginate } from "../src/pagination";

test("pages contain ten rows with a partial last page", () => {
  const items = Array.from({ length: 23 }, (_, i) => i);
  expect(paginate(items, 1).rows).toEqual(items.slice(0, 10));
  expect(paginate(items, 2).rows).toEqual(items.slice(10, 20));
  expect(paginate(items, 3).rows).toEqual([20, 21, 22]);
});
test("empty and shortened lists stay on a valid page", () => {
  expect(paginate([], 2)).toEqual({ page: 1, pageCount: 1, rows: [], total: 0 });
  expect(paginate([1, 2], 3).page).toBe(1);
});
