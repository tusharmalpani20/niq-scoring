import { expect, test } from "bun:test";
import { deploymentDisplayLabel } from "../src/deployment-label";
import type { Overview } from "../src/Operations";

const deployment = (name: string): Overview["deployments"][number] => ({
  id: "deployment", clientId: "client", name, environment: "production", hostingType: "NIQ_HOSTED", enabled: true,
});

test("deployment labels stay readable for both new and legacy records", () => {
  const first = { ...deployment("apollo-production-niq-68541a17"), id: "first" };
  const second = { ...deployment("apollo-production-niq-12345678"), id: "second" };
  const third = { ...deployment("Production 3"), id: "third" };
  const deployments = [first, second, third];
  expect(deploymentDisplayLabel(first, deployments)).toBe("Production");
  expect(deploymentDisplayLabel(second, deployments)).toBe("Production 2");
  expect(deploymentDisplayLabel(third, deployments)).toBe("Production 3");
  const custom = { ...deployment("Production"), id: "custom" };
  expect(deploymentDisplayLabel(first, [first, second, custom])).toBe("Production 2");
  expect(deploymentDisplayLabel(second, [first, second, custom])).toBe("Production 3");
});
