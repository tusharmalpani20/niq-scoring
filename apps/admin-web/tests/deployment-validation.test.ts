import { expect, test } from "bun:test";
import { deploymentErrors, type DeploymentValues } from "../src/deployment-validation";
const values: DeploymentValues = { clientId: "client", environment: "production", hostingType: "NIQ_HOSTED", enabled: true, scoringEnabled: true, faceEnabled: true, scoringUnlimited: true, faceUnlimited: true, scoringLimit: "0", faceLimit: "0", ruleVersion: "LATEST_APPROVED", expiryPreset: "7", expiryDate: "" };
test("identity step requires all identity fields without validating later settings", () => {
  expect(deploymentErrors({ ...values, clientId: "", environment: "", hostingType: "" }, 0)).toEqual({ clientId: "This field is required.", environment: "This field is required.", hostingType: "This field is required." });
  expect(deploymentErrors({ ...values, scoringLimit: "invalid", scoringUnlimited: false }, 0)).toEqual({});
});
test("settings validate bounded whole-number limits only when applicable", () => {
  for (const limit of ["", "-1", "1.5", "2147483648"]) expect(deploymentErrors({ ...values, scoringUnlimited: false, scoringLimit: limit }, 1).scoringLimit).toBeDefined();
  for (const limit of ["0", "2147483647"]) expect(deploymentErrors({ ...values, scoringUnlimited: false, scoringLimit: limit }, 1)).toEqual({});
  expect(deploymentErrors({ ...values, scoringLimit: "invalid" }, 1)).toEqual({});
  expect(deploymentErrors({ ...values, faceEnabled: false, faceUnlimited: false, faceLimit: "invalid" }, 1)).toEqual({});
  expect(deploymentErrors({ ...values, enabled: false, scoringUnlimited: false, scoringLimit: "invalid" }, 1)).toEqual({});
  expect(deploymentErrors({ ...values, ruleVersion: "" }, 1).ruleVersion).toBeDefined();
});
