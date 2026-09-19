import { expect, type Page } from "@playwright/test";
import { createFinalAssessmentTemplate } from "@niq-scoring/contracts/final-assessment-template";
import { evaluateFinalAssessment, validateFinalAssessmentSamples } from "@niq-scoring/scoring-engine/final-assessment";
import { validateFinalAssessmentDefinition } from "@niq-scoring/contracts/final-assessment-validation";
import type { FinalAssessmentDefinition } from "@niq-scoring/contracts/final-assessment";
import type { RuleDetail } from "../src/rules/rule-api";

export async function mockFinalConsole(page: Page) {
  let record: RuleDetail & { definition: FinalAssessmentDefinition } | null = null;
  const aliases = new Set<string>();
  const state = { createError: "", saveError: "", transitionError: "", transitionIssues: [] as Array<{ message: string }>, getRecord: () => record };
  function audit(action: string) {
    if (!record) return;
    record.audit = [...(record.audit ?? []), { id: `event-${record.revision}-${action}`, actor: "synthetic-admin", actorName: "Browser QA", action, at: `2026-09-19T10:${String(record.revision).padStart(2, "0")}:00.000Z`, revision: record.revision, checksum: record.packageChecksum }];
  }
  await page.route("**/api/**", async route => {
    const request = route.request();
    const path = new URL(request.url()).pathname;
    const json = (body: unknown, status = 200) => route.fulfill({ status, json: body });
    if (path === "/api/auth/status") return json({ setupRequired: false });
    if (path === "/api/auth/session") return json({ user: { id: "synthetic-admin", displayName: "Browser QA", enabled: true } });
    if (path === "/api/admin/overview") return json({ clients: [], deployments: [], assignments: [], entitlements: [], versions: [] });
    if (path.startsWith("/api/admin/rules/by-name/") && request.method() === "GET") {
      const name = decodeURIComponent(path.slice("/api/admin/rules/by-name/".length)).trim().toLowerCase();
      return record && (name === record.version.trim().toLowerCase() || aliases.has(name)) ? json(record) : json({ error: "RULE_NOT_FOUND" }, 404);
    }
    if (path === "/api/admin/rules" && request.method() === "GET") return json({ versions: record ? [record] : [] });
    if (path === "/api/admin/rules" && request.method() === "POST") {
      const body = request.postDataJSON();
      if (state.createError) return json({ error: state.createError }, 409);
      record = { id: "final-assessment-rule", version: body.name, lifecycle: "DRAFT", clinicalUsePermitted: false, revision: 1, packageChecksum: "synthetic", editable: true, definition: createFinalAssessmentTemplate(body.name) };
      audit("RULE_CREATED");
      return json(record);
    }
    if (path === "/api/admin/rules/final-assessment-rule" && record) {
      if (request.method() === "GET") return json(record);
      if (request.method() === "PUT") {
        if (state.saveError) return json({ error: state.saveError }, 409);
        const body = request.postDataJSON();
        expect(body.revision).toBe(record.revision);
        aliases.add(record.version.trim().toLowerCase());
        record = { ...record, lifecycle: "DRAFT", clinicalUsePermitted: false, version: body.definition.name, definition: body.definition, revision: record.revision + 1 };
        audit("RULE_SAVED");
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
      if (issues.length) return json({ error: "RULE_VALIDATION_FAILED", issues }, 422);
      if (state.transitionError) return json({ error: state.transitionError, issues: state.transitionIssues }, 409);
      if (action === "set-default") {
        expect(record.lifecycle).toBe("ACTIVE");
        record = { ...record, isDefault: true, revision: record.revision + 1 };
        audit("RULE_DEFAULT_SET");
        return json(record);
      }
      if (action === "retire" && record.isDefault) return json({ error: "RULE_IS_DEFAULT" }, 409);
      const lifecycle = action === "retire" ? "RETIRED" : action === "validate" ? "VALIDATED" : action === "approve" ? "APPROVED" : "ACTIVE";
      record = { ...record, lifecycle, revision: record.revision + 1, clinicalUsePermitted: lifecycle === "APPROVED" || lifecycle === "ACTIVE" };
      audit(`RULE_${lifecycle}`);
      if (action === "activate" && body.makeDefault) { record.isDefault = true; audit("RULE_DEFAULT_SET"); }
      return json(record);
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
  await expect(page).toHaveURL(/\/versions\/Final%20assessment%20browser%20draft$/);
  await expect(page.getByRole("tab", { name: "Details", exact: true })).toHaveAttribute("aria-selected", "true");
  await page.getByRole("tab", { name: "Scoring", exact: true }).click();
}
