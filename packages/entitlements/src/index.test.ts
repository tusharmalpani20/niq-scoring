import { describe, expect, test } from "bun:test";
import { decideEntitlement } from "./index";

const base = {
  platformEnabled: true,
  clientEnabled: true,
  deploymentEnabled: true,
  versionActive: true,
  monthlyLimit: null,
  monthlyUsage: 12,
};

describe("decideEntitlement", () => {
  test("null limit means unlimited", () => expect(decideEntitlement(base)).toEqual({ allowed: true, remaining: null }));
  test("blocks at the monthly limit", () => expect(decideEntitlement({ ...base, monthlyLimit: 10 })).toEqual({ allowed: false, reason: "MONTHLY_LIMIT_REACHED" }));
  test("NIQ can disable one client", () => expect(decideEntitlement({ ...base, clientEnabled: false })).toEqual({ allowed: false, reason: "CLIENT_DISABLED" }));
});
