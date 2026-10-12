import assert from "node:assert/strict";
import { test } from "node:test";
import { createLegacyFinalAssessmentTemplate } from "@niq-scoring/contracts/final-assessment-template";
import type { RuleDetail } from "./rule-api";
import { comparableDefinition, draftUpdateRequired, editableDefinition } from "./final-assessment-editor-state";

test("opening an older draft distinguishes required updates from user edits", () => {
  const record = {
    id: "rule", version: "Older draft", lifecycle: "DRAFT", definition: createLegacyFinalAssessmentTemplate("Older draft"),
  } as RuleDetail;
  const editable = editableDefinition(record);
  assert.notEqual(editable, null);
  assert.equal(draftUpdateRequired(record), true);

  const saved = { ...record, definition: editable };
  assert.equal(draftUpdateRequired(saved), false);
  assert.equal(comparableDefinition(editable), comparableDefinition(editableDefinition(saved)));
  assert.equal(comparableDefinition({ name: "Example", revision: 2 }), comparableDefinition({ revision: 2, name: "Example" }));
  assert.notEqual(comparableDefinition({ ...editable, name: "Edited" }), comparableDefinition(editable));
});
