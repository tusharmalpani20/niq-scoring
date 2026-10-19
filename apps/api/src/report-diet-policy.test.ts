import { expect, test } from "bun:test";
import { dietRecommendationIssues } from "./report-diet-policy";

const diet = (label: string) => [{id: "fact:diet_preference", text: `Reported diet preference: ${label}`}];

test("rejects incompatible food examples even when they are copied from a matched source", () => {
  const text = "Maintain adequate protein and energy with suitable foods such as eggs, paneer and dal.";
  expect(dietRecommendationIssues(text, diet("Vegetarian"))).toEqual(["DIET_INCOMPATIBLE_FOOD:eggs"]);
  expect(dietRecommendationIssues(text, diet("Jain"))).toEqual(["DIET_INCOMPATIBLE_FOOD:eggs"]);
});

test("applies the recorded diet without introducing extra Jain restrictions", () => {
  expect(dietRecommendationIssues("Choose eggs, fish, chicken, meat or poultry.", diet("Eggetarian"))).toEqual([
    "DIET_INCOMPATIBLE_FOOD:fish", "DIET_INCOMPATIBLE_FOOD:chicken", "DIET_INCOMPATIBLE_FOOD:meat", "DIET_INCOMPATIBLE_FOOD:poultry",
  ]);
  expect(dietRecommendationIssues("Try eggs and fish.", diet("Non-Vegetarian"))).toEqual([]);
  expect(dietRecommendationIssues("Eat potatoes, carrots and eggplant.", diet("Jain"))).toEqual([]);
  expect(dietRecommendationIssues("Include eggs and fish.", [])).toEqual([]);
  expect(dietRecommendationIssues("Include eggs and fish.", [{id: "rule:example", text: "Vegetarian foods are available."}])).toEqual([]);
});

test("keeps negated food restrictions and clinical labels without flagging them", () => {
  for (const text of ["Avoid eggs, fish and chicken.", "Do not eat fish or poultry.", "Don't choose eggs.",
    "Choose foods without eggs, fish or meat.", "Exclude eggs and fish.", "Egg allergy. Fish intolerance.",
    "Try eggplant and dal.", "You have an egg allergy."]) {
    expect(dietRecommendationIssues(text, diet("Vegetarian"))).toEqual([]);
  }
});

test("evaluates each local instruction so one restriction cannot hide a later recommendation", () => {
  expect(dietRecommendationIssues("Avoid eggs, but include fish. Do not eat fish, but try chicken.", diet("Vegetarian"))).toEqual([
    "DIET_INCOMPATIBLE_FOOD:fish", "DIET_INCOMPATIBLE_FOOD:chicken",
  ]);
  expect(dietRecommendationIssues("Choose foods without eggs and include paneer. Eat eggs with breakfast.", diet("Vegetarian"))).toEqual(["DIET_INCOMPATIBLE_FOOD:eggs"]);
});
