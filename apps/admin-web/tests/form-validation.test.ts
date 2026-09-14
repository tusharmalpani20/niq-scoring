import { describe, expect, test } from "bun:test";
import {
  authSchema,
  dataFormSchema,
  invitationSchema,
} from "../src/form-validation";

const setup = {
  email: "admin@niq.test",
  displayName: "NIQ Admin",
  setupToken: "local-setup-token",
  password: "a-long-password",
  confirm: "a-long-password",
};

describe("administrator form validation", () => {
  test("setup and invitations accept 8–128 characters", () => {
    for (const mode of ["setup", "invite"] as const) {
      for (const length of [7, 8, 128, 129]) {
        const password = "a".repeat(length);
        expect(authSchema(mode).safeParse({ ...setup, password, confirm: password }).success)
          .toBe(length >= 8 && length <= 128);
      }
    }
  });
  test("setup requires identity, token, and matching strong passwords", () => {
    expect(authSchema("setup").safeParse(setup).success).toBe(true);
    for (const invalid of [
      { setupToken: "" },
      { displayName: " " },
      { email: "invalid" },
      { password: "short", confirm: "short" },
      { confirm: "different-password" },
    ])
      expect(
        authSchema("setup").safeParse({ ...setup, ...invalid }).success,
      ).toBe(false);
    const mismatch = authSchema("setup").safeParse({
      ...setup,
      confirm: "different-password",
    });
    if (!mismatch.success)
      expect(mismatch.error.issues[0]?.path).toEqual(["confirm"]);
  });
  test("login permits existing short passwords without setup-only fields", () => {
    expect(
      authSchema("login").safeParse({
        ...setup,
        setupToken: "",
        displayName: "",
        password: "short",
        confirm: "",
      }).success,
    ).toBe(true);
    expect(
      authSchema("login").safeParse({ ...setup, password: "" }).success,
    ).toBe(false);
  });
  test("invitation acceptance validates passwords without hidden identity fields", () => {
    expect(
      authSchema("invite").safeParse({
        ...setup,
        email: "",
        displayName: "",
        setupToken: "",
      }).success,
    ).toBe(true);
    expect(
      authSchema("invite").safeParse({ ...setup, confirm: "" }).success,
    ).toBe(false);
  });
  test("invitation creation validates name and email", () => {
    expect(
      invitationSchema.safeParse({
        email: "admin@niq.test",
        displayName: "Admin",
      }).success,
    ).toBe(true);
    expect(
      invitationSchema.safeParse({ email: "bad", displayName: " " }).success,
    ).toBe(false);
  });
});

describe("operation form validation", () => {
  test("blank quotas mean unlimited, and limits must be non-negative integers", () => {
    const schema = dataFormSchema(["monthlyLimit"], "Set monthly limit");
    for (const monthlyLimit of ["", "0", "100"])
      expect(schema.safeParse({ monthlyLimit }).success).toBe(true);
    for (const monthlyLimit of ["-1", "1.5", "Infinity", "9007199254740992"])
      expect(schema.safeParse({ monthlyLimit }).success).toBe(false);
  });
  test("deployments require a canonical client ID and valid environments", () => {
    const schema = dataFormSchema(
      ["clientId", "environment"],
      "Create deployment",
    );
    const valid = {
      clientId: "01ARZ3NDEKTSV4RRFFQ69G5FAV",
      environment: "production",
    };
    expect(schema.safeParse(valid).success).toBe(true);
    expect(
      schema.safeParse({ ...valid, clientId: "invalid" }).success,
    ).toBe(false);
    expect(schema.safeParse({ ...valid, environment: "prod" }).success).toBe(
      false,
    );
  });
});
