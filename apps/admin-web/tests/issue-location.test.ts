import { expect, test } from "bun:test";
import { blankRuleDefinition } from "@niq-scoring/contracts/rules";
import { issueLocation } from "../src/rules/issue-location";
import { newQuestion } from "../src/rules/questionnaire-model";
import { newSample } from "../src/rules/sample-model";
test("validation links resolve both schema indexes and evaluator sample identifiers", () => {
  const d = blankRuleDefinition("Test");
  const q = { ...newQuestion(), label: "Example field" };
  d.sections = [{ id: "example", title: "Example section", description: "", questions: [q] }];
  const sample = newSample(); d.samples = [sample];
  expect(issueLocation(d, ["sections", 0, "questions", 0, "label"])).toEqual({ tab: "questionnaire", label: q.label, id: `rule-question-${q.id}` });
  expect(issueLocation(d, `samples.${sample.id}.score`)).toEqual({ tab: "validation", label: sample.name, id: `rule-samples-${sample.id}` });
  expect(issueLocation(d, "sections.25").tab).toBe("questionnaire");
});
