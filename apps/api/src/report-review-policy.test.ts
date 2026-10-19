import { expect, test } from "bun:test";
import { REPORT_CARD_WARNING_POLICY } from "./report-card-warnings";
import {
  ASSEMBLED_REVIEW_STAGE, CARD_REVIEW_STAGE, NARRATIVE_REVIEW_STAGE, COMPATIBLE_WARNING_POLICY,
  REPORT_REVIEW_POLICY, REPORT_SECTION_OWNERSHIP, SOURCE_DERIVED_CARE_POLICY,
} from "./report-review-policy";

// These exported strings are the prompt contract. Guard the stage boundaries that
// caused rejected drafts, rather than snapshotting all editorial wording.
test("narrative review defers cards but still checks actual narrative safety", () => {
  expect(NARRATIVE_REVIEW_STAGE).toContain("have not been generated yet");
  expect(NARRATIVE_REVIEW_STAGE).toContain("do not reject this stage for missing cards");
  expect(NARRATIVE_REVIEW_STAGE).toContain("Do not waive unsafe or unsupported claims");
});

test("assembled coverage accepts appropriate components and rechecks repaired versions", () => {
  expect(ASSEMBLED_REVIEW_STAGE).toContain("narrative, generated possible-effect cards and structured product plan together");
  expect(ASSEMBLED_REVIEW_STAGE).toContain("Do not demand possible-effect details in treatmentAdvice");
  expect(ASSEMBLED_REVIEW_STAGE).toContain("an earlier failure is not proof the current version still fails");
  expect(ASSEMBLED_REVIEW_STAGE).toContain("Preserve approved unchanged content");
});

test("complete cards retain practical care even when shared sections repeat it", () => {
  expect(CARD_REVIEW_STAGE).toContain("Shared narrative passages cannot substitute");
  expect(CARD_REVIEW_STAGE).toContain("Accept intentional repetition");
  expect(REPORT_SECTION_OWNERSHIP).toContain("Required repetition is not an error");
  expect(REPORT_SECTION_OWNERSHIP).toContain("may repeat structured-card facts");
});

test("clinical requirements come from matched sources rather than hardcoded clinical examples", () => {
  expect(SOURCE_DERIVED_CARE_POLICY).toContain("A prompt example is not a new clinical requirement");
  expect(SOURCE_DERIVED_CARE_POLICY).toContain("only when a matched source supports it");
  expect(SOURCE_DERIVED_CARE_POLICY).not.toMatch(/diarrhea|oral rehydration|banana|TSH/u);
  expect(REPORT_REVIEW_POLICY).toContain(REPORT_SECTION_OWNERSHIP);
  expect(REPORT_REVIEW_POLICY).toContain(SOURCE_DERIVED_CARE_POLICY);
});

test("compatible warning triggers retain every action without invented threshold selection", () => {
  expect(REPORT_REVIEW_POLICY).toContain(COMPATIBLE_WARNING_POLICY);
  expect(COMPATIBLE_WARNING_POLICY).toContain("cumulative source obligations");
  expect(COMPATIBLE_WARNING_POLICY).toContain("do not require the patient to recognize an underlying effect diagnosis");
  expect(COMPATIBLE_WARNING_POLICY).toContain("Opposing restrictions, incompatible actions or explicitly exclusive scopes remain genuine conflicts");
  expect(COMPATIBLE_WARNING_POLICY).not.toMatch(/100|37\.8|38°C/);
});

test("reviewers accept harmless repetition while preserving clinical safeguards", () => {
  expect(REPORT_REVIEW_POLICY).toContain("Repetition alone, including identical sentences or a repeated prescribed-plan instruction, is an editorial preference, not an issuing blocker");
  expect(NARRATIVE_REVIEW_STAGE).toContain("Repetition alone is not a reason to reject or request consolidation");
  expect(CARD_REVIEW_STAGE).toContain("Do not mark coverage incomplete solely for repetition");
  expect(REPORT_REVIEW_POLICY).toContain("concrete clinical contradiction, ambiguity about quantity/frequency, unsupported instruction or confusing responsibility");
  expect(REPORT_REVIEW_POLICY).toContain("Keep complete supported care and applicable precautions in each separate possible-effect card");
});


test("local card warning contract uses explicitly linked source conditions", () => {
  expect(REPORT_REVIEW_POLICY).toContain(REPORT_CARD_WARNING_POLICY);
  expect(REPORT_CARD_WARNING_POLICY).toContain("Routine assessment alone does not cover");
  expect(REPORT_CARD_WARNING_POLICY).toContain("do not import unrelated conditions");
  expect(REPORT_CARD_WARNING_POLICY).toContain("do not imply the condition is present");
  expect(REPORT_CARD_WARNING_POLICY).not.toMatch(/dehydration|100|37\.8/);
});

test("first-pass writing and review distinguish clinical actions from patient tracking", () => {
  expect(REPORT_REVIEW_POLICY).toContain("laboratory or deficiency assessments and changes to nutrition support");
  expect(REPORT_REVIEW_POLICY).toContain("Patient self-monitoring");
  expect(REPORT_REVIEW_POLICY).toContain("Audit every clinical-action clause in this pass");
  expect(REPORT_REVIEW_POLICY).toContain("Do not copy a multi-clause source list verbatim");
  expect(REPORT_REVIEW_POLICY).toContain("preserve every distinct strategy, required combination, quantity, timing and qualification");
});
