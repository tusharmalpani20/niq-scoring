import { expect, test } from "bun:test";
import { clientSchema } from "../src/client-validation";

test("client form rejects duplicate names and accepts distinct names", () => {
  const schema = clientSchema([{ name: "Apollo" }]);
  for (const name of ["Apollo", "apollo", " APOLLO "]) {
    const result = schema.safeParse({ name });
    expect(result.success).toBe(false);
    if (!result.success) expect(result.error.issues[0]?.message).toBe("A client with this name already exists.");
  }
  expect(schema.parse({ name: " Apollo Health " })).toEqual({ name: "Apollo Health" });
  expect(schema.safeParse({ name: " " }).success).toBe(false);
});
