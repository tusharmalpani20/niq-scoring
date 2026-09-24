import { expect, test } from "bun:test";
import { deploymentDisplayLabel } from "../src/deployment-label";
import type { Overview } from "../src/Operations";

const deployment = (name: string): Overview["deployments"][number] => ({
  id: "deployment", clientId: "client", name, environment: "production", hostingType: "NIQ_HOSTED", enabled: true,
});

test("deployment labels stay readable for both new and legacy records", () => {
  expect(deploymentDisplayLabel(deployment("Production 3"))).toBe("Production 3");
  expect(deploymentDisplayLabel(deployment("apollo-production-niq-68541a17"))).toBe("Production");
});
