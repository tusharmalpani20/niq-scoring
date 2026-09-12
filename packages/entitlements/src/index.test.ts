import { describe, expect, test } from "bun:test";
import { decideEntitlement } from "./index";

const base = {
  platformEnabled: true,
  organizationEnabled: true,
  deploymentEnabled: true,
  versionActive: true,
  monthlyLimit: null,
  monthlyUsage: 12,
};

describe("decideEntitlement", () => {
  test("null limit means unlimited", () => expect(decideEntitlement(base)).toEqual({ allowed: true, remaining: null }));
  test("blocks at the monthly limit", () => expect(decideEntitlement({ ...base, monthlyLimit: 10 })).toEqual({ allowed: false, reason: "MONTHLY_LIMIT_REACHED" }));
  test("NIQ can disable one organization", () => expect(decideEntitlement({ ...base, organizationEnabled: false })).toEqual({ allowed: false, reason: "ORGANIZATION_DISABLED" }));
});
