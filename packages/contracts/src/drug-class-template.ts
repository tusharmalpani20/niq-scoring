import type { FinalAssessmentDefinition } from "./final-assessment";

type DrugClassConfig = NonNullable<FinalAssessmentDefinition["drugClassConfig"]>;

// Initial editable catalogue from Oncology Drug Class & Nutrition Guide (NIQ).ods,
// Drug_classes rows 2–17. These are treatment categories, not eligibility rules.
const workbookClasses = [
  ["taxanes", "Taxanes", "chemotherapy"],
  ["anthracyclines", "Anthracyclines", "chemotherapy"],
  ["alkylating_agents", "Alkylating agents", "chemotherapy"],
  ["platinum_agents", "Platinum agents", "chemotherapy"],
  ["antimetabolites", "Antimetabolites", "chemotherapy"],
  ["topoisomerase_inhibitors", "Topoisomerase inhibitors", "chemotherapy"],
  ["vinca_alkaloids", "Vinca alkaloids", "chemotherapy"],
  ["tyrosine_kinase_inhibitors", "Tyrosine kinase inhibitors", "targeted"],
  ["parp_inhibitors", "PARP inhibitors", "targeted"],
  ["her2_targeted_antibodies", "HER2-targeted antibodies", "targeted"],
  ["cd20_monoclonal_antibodies", "CD20 monoclonal antibodies", "targeted"],
  ["immune_checkpoint_inhibitors", "Immune checkpoint inhibitors", "immunotherapy"],
  ["anti_estrogens_serms", "Anti-estrogens / SERMs", "hormonal"],
  ["aromatase_inhibitors", "Aromatase inhibitors", "hormonal"],
  ["anti_androgens_androgen_deprivation_therapy", "Anti-androgens / androgen deprivation therapy", "hormonal"],
  ["cdk4_6_inhibitors", "CDK4/6 inhibitors", "targeted"],
] as const;

// Drugs_by_treatment rows 2–84: union of the cancer uses explicitly listed for
// each class's example drugs. Vague "other cancers" and regimen names are omitted. A
// broad cancer name is not expanded to every subtype, and unsupported cancers
// are not silently mapped to "Other". These pairs prefill editable rule data;
// clinicians may still search and select any configured class.
const cancer = {
  breast: "cancer_1", lung: "cancer_2", colorectal: "cancer_3", stomach: "cancer_4",
  liver: "cancer_5", pancreatic: "cancer_6", headNeck: "cancer_7", brain: "cancer_9",
  ovarian: "cancer_10", cervical: "cancer_12", prostate: "cancer_13", testicular: "cancer_14",
  kidney: "cancer_15", bladder: "cancer_16", bone: "cancer_17", softTissue: "cancer_18",
  leukaemia: "cancer_19", lymphoma: "cancer_20", myeloma: "cancer_21", skin: "cancer_22",
  cml: "cancer_cml", tripleNegativeBreast: "cancer_triple_negative_breast",
  her2PositiveBreast: "cancer_her2_positive_breast", erPositiveBreast: "cancer_er_positive_breast",
  biliary: "cancer_biliary", all: "cancer_all", smallCellLung: "cancer_small_cell_lung",
  gist: "cancer_gist", mesothelioma: "cancer_mesothelioma",
  nonSmallCellLung: "cancer_non_small_cell_lung", sarcoma: "cancer_sarcoma",
  kaposiSarcoma: "cancer_kaposi_sarcoma", bCellLymphomas: "cancer_b_cell_lymphomas",
} as const;

const workbookCancerTypesByClass: Record<(typeof workbookClasses)[number][0], readonly string[]> = {
  taxanes: [cancer.breast, cancer.ovarian, cancer.lung, cancer.prostate, cancer.stomach, cancer.headNeck, cancer.pancreatic],
  anthracyclines: [cancer.breast, cancer.lymphoma, cancer.sarcoma, cancer.stomach, cancer.leukaemia, cancer.ovarian, cancer.myeloma, cancer.kaposiSarcoma],
  alkylating_agents: [cancer.breast, cancer.lymphoma, cancer.sarcoma, cancer.myeloma, cancer.leukaemia, cancer.brain, cancer.skin, cancer.cml],
  platinum_agents: [cancer.lung, cancer.headNeck, cancer.cervical, cancer.bladder, cancer.testicular, cancer.ovarian, cancer.tripleNegativeBreast, cancer.colorectal, cancer.stomach, cancer.pancreatic],
  antimetabolites: [cancer.colorectal, cancer.stomach, cancer.breast, cancer.headNeck, cancer.pancreatic, cancer.bladder, cancer.lung, cancer.biliary, cancer.lymphoma, cancer.all, cancer.bone, cancer.nonSmallCellLung, cancer.mesothelioma, cancer.leukaemia],
  topoisomerase_inhibitors: [cancer.colorectal, cancer.pancreatic, cancer.smallCellLung, cancer.ovarian, cancer.cervical, cancer.testicular, cancer.lymphoma],
  vinca_alkaloids: [cancer.lymphoma, cancer.all, cancer.testicular, cancer.lung, cancer.breast],
  tyrosine_kinase_inhibitors: [cancer.cml, cancer.gist, cancer.all, cancer.lung, cancer.pancreatic, cancer.her2PositiveBreast, cancer.liver, cancer.kidney, cancer.sarcoma, cancer.softTissue, cancer.colorectal, cancer.leukaemia, cancer.lymphoma, cancer.bCellLymphomas],
  parp_inhibitors: [cancer.ovarian, cancer.breast, cancer.prostate, cancer.pancreatic],
  her2_targeted_antibodies: [cancer.her2PositiveBreast, cancer.stomach, cancer.breast],
  cd20_monoclonal_antibodies: [cancer.bCellLymphomas, cancer.leukaemia, cancer.lymphoma],
  immune_checkpoint_inhibitors: [cancer.lung, cancer.skin, cancer.kidney, cancer.liver, cancer.biliary],
  anti_estrogens_serms: [cancer.erPositiveBreast],
  aromatase_inhibitors: [cancer.erPositiveBreast],
  anti_androgens_androgen_deprivation_therapy: [cancer.prostate],
  cdk4_6_inhibitors: [cancer.breast],
};

export function initialDrugClassConfig(): DrugClassConfig {
  return {
    classes: workbookClasses.map(([id, label]) => ({ id, label })),
    suggestions: workbookClasses.flatMap(([classId, , treatment]) =>
      workbookCancerTypesByClass[classId].map(cancerTypeId => ({
        cancerTypeId, treatmentTypeId: `current_cancer_treatment_${treatment}`, classId,
      }))),
  };
}
