import { expect, test } from "@playwright/test";
import type { Overview } from "../src/Operations";
import { clientUrl, deploymentUrl, resolveClient, resolveDeployment } from "../src/record-urls";

const data: Overview = {
  clients: [
    { id: "01M2FDAT532K4JDA6W3G7PCWWF", name: "Apollo", enabled: true },
    { id: "01M2FDAT532K4JDA6W3G7PCWWG", name: "A B", enabled: true },
    { id: "01M2FDAT532K4JDA6W3G7PCWWH", name: "A-B", enabled: true },
  ],
  deployments: [
    { id: "01M2FHDK75DEXERYFMQMB66CCR", clientId: "01M2FDAT532K4JDA6W3G7PCWWF", name: "first", environment: "production", hostingType: "NIQ_HOSTED", enabled: true },
    { id: "01M2FHDK75DEXERYFMQMB66CCS", clientId: "01M2FDAT532K4JDA6W3G7PCWWF", name: "second", environment: "production", hostingType: "NIQ_HOSTED", enabled: true },
  ],
  entitlements: [], assignments: [], versions: [],
};

test("client links use unique names and keep old ID links resolvable", () => {
  expect(clientUrl(data.clients[0]!)).toBe("/clients/apollo");
  expect(clientUrl(data.clients[1]!)).toBe("/clients/a%20b");
  expect(clientUrl(data.clients[2]!)).toBe("/clients/a-b");
  expect(resolveClient(data, "apollo")?.id).toBe(data.clients[0]!.id);
  expect(resolveClient(data, data.clients[0]!.id)?.id).toBe(data.clients[0]!.id);
  expect(resolveClient(data, "apollo-6w3g7pcwwf")?.id).toBe(data.clients[0]!.id);
});

test("deployment links remain distinct when one client has two production deployments", () => {
  expect(deploymentUrl(data, data.deployments[0]!, "settings")).toBe("/deployments/apollo/01M2FHDK75DEXERYFMQMB66CCR/settings");
  expect(deploymentUrl(data, data.deployments[1]!)).toBe("/deployments/apollo/01M2FHDK75DEXERYFMQMB66CCS");
  expect(resolveDeployment(data, data.deployments[0]!.id)?.id).toBe(data.deployments[0]!.id);
  expect(resolveDeployment(data, "apollo-production-fmqmb66ccr")?.id).toBe(data.deployments[0]!.id);
});
