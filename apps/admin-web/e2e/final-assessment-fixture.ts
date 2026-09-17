import { expect, type Page } from "@playwright/test";
import { createFinalAssessmentTemplate } from "@niq-scoring/contracts/final-assessment-template";
import { evaluateFinalAssessment, validateFinalAssessmentSamples } from "@niq-scoring/scoring-engine/final-assessment";
import { validateFinalAssessmentDefinition } from "@niq-scoring/contracts/final-assessment-validation";
import type { FinalAssessmentDefinition } from "@niq-scoring/contracts/final-assessment";
import type { RuleDetail } from "../src/rules/rule-api";

export async function mockFinalConsole(page: Page) {
  let record: RuleDetail & { definition: FinalAssessmentDefinition } | null = null;
  const state = { createError: "", saveError: "", getRecord: () => record };
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
      if (state.createError) return json({ error: state.createError }, 409);
      record = { id: "final-assessment-rule", version: body.name, lifecycle: "DRAFT", clinicalUsePermitted: false, revision: 1, packageChecksum: "synthetic", editable: true, definition: createFinalAssessmentTemplate(body.name) };
      return json(record);
    }
    if (path === "/api/admin/rules/final-assessment-rule" && record) {
      if (request.method() === "GET") return json(record);
      if (request.method() === "PUT") {
        if (state.saveError) return json({ error: state.saveError }, 409);
        const body = request.postDataJSON();
        expect(body.revision).toBe(record.revision);
        record = { ...record, version: body.definition.name, definition: body.definition, revision: record.revision + 1 };
        return json(record);
      }
    }
    if (record && path.startsWith("/api/admin/rules/final-assessment-rule/") && request.method() === "POST") {
      const body = request.postDataJSON();
      expect(body.revision).toBe(record.revision);
      const action = path.split("/").at(-1);
      if (action === "preview") return json({ ...evaluateFinalAssessment(record.definition, body.answers), calculatedAt: "2026-09-17T00:00:00.000Z", ruleVersionId: record.id, checksum: record.packageChecksum });
      const issues = [...validateFinalAssessmentDefinition(record.definition), ...validateFinalAssessmentSamples(record.definition)];
      if (action === "check") return json({ issues });
      return json({ error: "PROVISIONAL_THRESHOLDS_UNCONFIRMED" }, 409);
    }
    return json({ error: "UNEXPECTED_TEST_REQUEST" }, 500);
  });
  return state;
}

export async function startFinalDraft(page: Page) {
  await page.goto("/versions");
  await page.getByRole("button", { name: "Create rule version", exact: true }).click();
  await page.getByLabel("Name", { exact: true }).fill("Final assessment browser draft");
  await page.getByRole("button", { name: "Create draft", exact: true }).click();
  await expect(page).toHaveURL(/\/versions\/final-assessment-rule$/);
}
