import {
  type ProvisionalScoringInput,
  type ProvisionalScoringResult,
} from "@niq-scoring/contracts";
import { PROVISIONAL_RULE_CHECKSUM, PROVISIONAL_SCORING_VERSION, PROVISIONAL_VERSION_STATUS } from "@niq-scoring/contracts/metadata";
import ruleManifest from "../rules/NIQ-DRAFT-2026-09.json";

const DISCLAIMER =
  "Development-only output from unvalidated prototype rules. Not for diagnosis, treatment, dosage, triage, or any patient-care decision.";

type Component = ProvisionalScoringResult["components"][number];

/**
 * Faithful server-side port of the UI prototype's current risk-point rules.
 * It intentionally excludes the prototype's treatment labels and care guidance.
 */
export function calculateProvisionalScore(
  input: ProvisionalScoringInput,
  calculatedAt = new Date().toISOString(),
): ProvisionalScoringResult {
  const components: Component[] = [];
  const add = (key: string, points: number, explanation: string) => {
    if (points > 0) components.push({ key, points, explanation });
  };

  const fluidFlags = Object.values(input.fluidStatus).filter(Boolean).length;
  const fluidCorrectedRisk = fluidFlags > 0;
  add("fluid_status", fluidFlags * ruleManifest.fluidPointsPerFlag, `${fluidFlags} prototype fluid-status flag(s)`);

  const bmi = calculateBmi(input.heightCm, input.weightKg);
  if (bmi !== null) {
    if (bmi < ruleManifest.bmi.underweightThreshold) add("bmi", ruleManifest.bmi.underweightPoints, "Prototype BMI threshold: below 18.5");
    else if (bmi < ruleManifest.bmi.borderlineThreshold) add("bmi", ruleManifest.bmi.borderlinePoints, "Prototype BMI threshold: 18.5 to below 20");
    else if (bmi >= ruleManifest.bmi.elevatedWithFluidThreshold && fluidCorrectedRisk) add("bmi_with_fluid", ruleManifest.bmi.elevatedWithFluidPoints, "Prototype BMI threshold with fluid flag(s)");
  }

  if (input.weightTrend === "loss") {
    const percent = input.weightChangePercent ?? 0;
    add("weight_change", percent >= ruleManifest.weightLoss.highThreshold ? ruleManifest.weightLoss.highPoints : percent >= ruleManifest.weightLoss.moderateThreshold ? ruleManifest.weightLoss.moderatePoints : ruleManifest.weightLoss.reportedPoints, "Prototype reported weight-loss threshold");
  }

  const intakePoints: Record<ProvisionalScoringInput["intakeLevel"], number> = {
    ...ruleManifest.intake,
  };
  add("intake", intakePoints[input.intakeLevel], `Prototype intake level: ${input.intakeLevel}`);

  if (input.appetite === "poor" || input.appetite === "none") {
    add("appetite", ruleManifest.poorAppetitePoints, `Prototype appetite level: ${input.appetite}`);
  }

  const symptomCount = Object.values(input.symptoms).filter(Boolean).length;
  add("symptoms", Math.min(symptomCount * ruleManifest.symptoms.pointsPerFlag, ruleManifest.symptoms.cap), `${symptomCount} prototype symptom flag(s), capped at ${ruleManifest.symptoms.cap} points`);

  const functionPoints: Record<ProvisionalScoringInput["functionalStatus"], number> = {
    ...ruleManifest.functionalStatus,
  };
  add("functional_status", functionPoints[input.functionalStatus], `Prototype functional status: ${input.functionalStatus}`);

  if (input.cancerStage === "Metastatic (Stage IV)") add("cancer_stage", ruleManifest.cancerStage.metastatic, "Prototype metastatic-stage rule");
  else if (input.cancerStage === "Locally Advanced (Stage III)") add("cancer_stage", ruleManifest.cancerStage.locallyAdvanced, "Prototype locally-advanced-stage rule");

  if (input.albumin !== null && input.albumin < ruleManifest.albumin.threshold) add("albumin", ruleManifest.albumin.points, "Prototype albumin threshold: below 3.5");
  if (input.crp !== null && input.crp > ruleManifest.crp.threshold) add("crp", ruleManifest.crp.points, "Prototype CRP threshold: above 10");

  const score = Math.min(ruleManifest.scoreCap, components.reduce((sum, component) => sum + component.points, 0));
  const band = score >= ruleManifest.bands.critical ? "Critical" : score >= ruleManifest.bands.high ? "High" : score >= ruleManifest.bands.moderate ? "Moderate" : "Low";

  return {
    assessmentReference: input.assessmentReference,
    version: PROVISIONAL_SCORING_VERSION,
    ruleChecksum: PROVISIONAL_RULE_CHECKSUM,
    versionStatus: PROVISIONAL_VERSION_STATUS,
    clinicalUsePermitted: false,
    calculatedAt,
    bmi,
    score,
    band,
    components,
    disclaimer: DISCLAIMER,
  };
}

function calculateBmi(heightCm: number | null, weightKg: number | null): number | null {
  if (heightCm === null || weightKg === null) return null;
  const metres = heightCm / 100;
  return Number((weightKg / (metres * metres)).toFixed(2));
}
