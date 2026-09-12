import { describe, expect, test } from "bun:test";
import { ulidSchema } from "@niq-scoring/contracts";
import { createEntityId } from "./id";

describe("createEntityId", () => {
  test("creates canonical uppercase Crockford ULIDs", () => {
    const id = createEntityId();

    expect(id).toHaveLength(26);
    expect(ulidSchema.parse(id)).toBe(id);
  });

  test("creates distinct identifiers", () => {
    expect(createEntityId()).not.toBe(createEntityId());
  });

  test("rejects timestamps outside the ULID range", () => {
    expect(() => createEntityId(-1)).toThrow(RangeError);
    expect(() => createEntityId(281_474_976_710_656)).toThrow(RangeError);
  });

  test.each([
    "01arz3ndektsv4rrffq69g5fav",
    "01ARZ3NDEKTSV4RRFFQ69G5FAI",
    "01ARZ3NDEKTSV4RRFFQ69G5FAO",
    "01ARZ3NDEKTSV4RRFFQ69G5FA",
    "81ARZ3NDEKTSV4RRFFQ69G5FAV",
  ])("rejects non-canonical identifier %s", (id: string) => {
    expect(ulidSchema.safeParse(id).success).toBe(false);
  });
});
