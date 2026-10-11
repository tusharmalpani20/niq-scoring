// Fixed assessment choices. Keep IDs aligned with niq-application's assessment-form-options.
export const cancerTypeChoices = [
  ["cancer_1", "Breast cancer"], ["cancer_2", "Lung cancer"], ["cancer_3", "Colon / Rectal cancer"],
  ["cancer_4", "Stomach cancer"], ["cancer_5", "Liver cancer"], ["cancer_6", "Pancreatic cancer"],
  ["cancer_7", "Head & Neck cancer"], ["cancer_8", "Oral cancer"], ["cancer_9", "Brain tumour"],
  ["cancer_10", "Ovarian cancer"], ["cancer_11", "Uterine cancer"], ["cancer_12", "Cervical cancer"],
  ["cancer_13", "Prostate cancer"], ["cancer_14", "Testicular cancer"], ["cancer_15", "Kidney/Renal Cancer"],
  ["cancer_16", "Bladder cancer"], ["cancer_17", "Bone cancer"], ["cancer_18", "Soft tissue cancer"],
  ["cancer_19", "Blood cancer / Leukaemia"], ["cancer_20", "Lymphoma"], ["cancer_21", "Myeloma"],
  ["cancer_22", "Skin cancer"], ["cancer_cml", "Chronic Myeloid Leukemia (CML)"],
  ["cancer_triple_negative_breast", "Triple Negative Breast Cancer"],
  ["cancer_her2_positive_breast", "HER2-Positive Breast Cancer"],
  ["cancer_er_positive_breast", "ER-Positive Breast Cancer"], ["cancer_biliary", "Biliary Cancer"],
  ["cancer_all", "Acute Lymphoblastic Leukemia (ALL)"], ["cancer_small_cell_lung", "Small Cell Lung Cancer"],
  ["cancer_gist", "Gastrointestinal Stromal Tumour (GIST)"], ["cancer_mesothelioma", "Mesothelioma"],
  ["cancer_non_small_cell_lung", "Non-Small Cell Lung Cancer"], ["cancer_sarcoma", "Sarcoma"],
  ["cancer_kaposi_sarcoma", "Kaposi Sarcoma"], ["cancer_b_cell_lymphomas", "B-Cell Lymphomas"],
  ["cancer_other", "Other"], ["cancer_unknown", "Not sure / don’t know"],
] as const;
