import { expect, type Page } from "@playwright/test";
import { blankRuleDefinition, type RuleDefinition } from "@niq-scoring/contracts/rules";
import { validateRuleDefinition } from "@niq-scoring/contracts/rule-validation";
import { validateSamples } from "@niq-scoring/scoring-engine/rules";
import type { EditableRule } from "../src/rules/rule-api";

// Every API request is intercepted. These interaction tests never use a real
// session, database, clinical rule or deployment, including when they fail.
export async function mockConsole(page: Page, definition?: RuleDefinition) {
  let record: EditableRule | null = null;
  const state = { createError: "", saveError: "", createRequests: [] as Array<{ requestId: string; name: string }>, getRecord: () => record };
  await page.route("**/api/**", async route => {
    const request = route.request();
    const path = new URL(request.url()).pathname;
    const json = (body: unknown, status = 200) => route.fulfill({ status, json: body });
    if (path === "/api/auth/status") return json({ setupRequired: false });
    if (path === "/api/auth/session") return json({ user: { id: "synthetic-admin", displayName: "Browser QA", enabled: true } });
    if (path === "/api/admin/overview") return json({ clients: [], deployments: [], assignments: [], entitlements: [], versions: [] });
    if (path === "/api/admin/rules" && request.method() === "GET") return json({ versions: record ? [record] : [] });
    if (path === "/api/admin/rules" && request.method() === "POST") {
      const body = request.postDataJSON();
      state.createRequests.push(body);
      if (state.createError) return json({ error: state.createError }, 409);
      record = { id: "synthetic-rule", version: body.name, lifecycle: "DRAFT", clinicalUsePermitted: false,
        revision: 1, packageChecksum: "synthetic", editable: true, definition: definition ? { ...structuredClone(definition), name: body.name } : blankRuleDefinition(body.name) };
      return json(record);
    }
    if (path === "/api/admin/rules/synthetic-rule" && record) {
      if (request.method() === "GET") return json(record);
      if (request.method() === "PUT") {
        if (state.saveError) return json({ error: state.saveError }, 409);
        const body = request.postDataJSON();
        expect(body.revision).toBe(record.revision);
        record = { ...record, version: body.definition.name, definition: body.definition, revision: record.revision + 1 };
        return json(record);
      }
    }
    if (record && path.startsWith("/api/admin/rules/synthetic-rule/") && request.method() === "POST") {
      expect(request.postDataJSON().revision).toBe(record.revision);
      const action = path.split("/").at(-1);
      const issues = [...validateRuleDefinition(record.definition), ...validateSamples(record.definition)];
      if (action === "check") return json({ issues });
      if ((action === "validate" || action === "approve") && issues.length) return json({ error: "RULE_VALIDATION_FAILED", issues }, 409);
      // Controlled lifecycle responses exercise rendering/confirmation only;
      // backend route and PostgreSQL tests prove transition enforcement.
      const next = { validate: "VALIDATED", approve: "APPROVED", activate: "ACTIVE", retire: "RETIRED" } as const;
      if (action && action in next) {
        const lifecycle = next[action as keyof typeof next];
        record = { ...record, lifecycle, revision: record.revision + 1,
          editable: lifecycle === "VALIDATED", clinicalUsePermitted: lifecycle !== "VALIDATED" };
        return json(record);
      }
    }
    return json({ error: "UNEXPECTED_TEST_REQUEST" }, 500);
  });
  return state;
}

export async function startDraft(page: Page) {
  await page.goto("/versions");
  await page.getByRole("button", { name: "Create rule version", exact: true }).click();
  await page.getByLabel("Version name", { exact: true }).fill("Synthetic browser draft");
  await page.getByLabel("Starting point", { exact: true }).selectOption("blank");
  await page.getByRole("button", { name: "Continue", exact: true }).click();
}
