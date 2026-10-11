// Fixed clinical assessment cancer IDs, aligned with niq-application's
// assessment-form-options. These are matching references, not editable rules.
export const cancerTypeIds = [
  ...Array.from({ length: 22 }, (_, index) => `cancer_${index + 1}`),
  "cancer_cml", "cancer_triple_negative_breast", "cancer_her2_positive_breast", "cancer_er_positive_breast",
  "cancer_biliary", "cancer_all", "cancer_small_cell_lung", "cancer_gist", "cancer_mesothelioma",
  "cancer_non_small_cell_lung", "cancer_sarcoma", "cancer_kaposi_sarcoma", "cancer_b_cell_lymphomas",
  "cancer_other", "cancer_unknown",
] as const;
