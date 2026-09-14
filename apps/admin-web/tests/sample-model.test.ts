import { expect, test } from "bun:test";
import { newSample, setExpectedNumber } from "../src/rules/sample-model";
test("sample capture copies answers but never fabricates expected scores", () => {
  const answers = { weight: 0, choice: ["option_a"], agreed: false };
  const sample = newSample(answers);
  answers.choice.push("option_b");
  expect(sample.answers).toEqual({ weight: 0, choice: ["option_a"], agreed: false });
  expect(sample.expected).toEqual({ complete: false, score: null, classificationId: null, interventionIds: [], domains: {}, calculations: {} });
  expect(newSample().id).not.toBe(sample.id);
});
test("optional numeric expectations distinguish zero from no assertion", () => {
  const initial = { domain_a: 3 };
  expect(setExpectedNumber(initial, "domain_a", "0")).toEqual({ domain_a: 0 });
  expect(setExpectedNumber(initial, "domain_a", "")).toEqual({});
  expect(initial).toEqual({ domain_a: 3 });
});
