-- Custom SQL migration file, put your code below! --
-- The first activation migration seeded a nonclinical placeholder. Remove it
-- after all migrations on new installations, and on existing installations
-- only when no deployment, assessment, usage or default refers to it.
-- Referenced historical records remain available by ID for traceability.
DELETE FROM scoring_rule_versions AS rule
WHERE rule.id = '01K4ZJ9QJ7F3TWHDW1B1T6A4YV'
  AND rule.version = 'NIQ-DRAFT-2026-09'
  AND rule.lifecycle = 'DRAFT'
  AND rule.clinical_use_permitted = false
  AND NOT EXISTS (SELECT 1 FROM deployment_version_assignments WHERE scoring_rule_version_id = rule.id)
  AND NOT EXISTS (SELECT 1 FROM assessment_bindings WHERE scoring_rule_version_id = rule.id)
  AND NOT EXISTS (SELECT 1 FROM usage_events WHERE scoring_rule_version_id = rule.id)
  AND NOT EXISTS (SELECT 1 FROM scoring_rule_default WHERE rule_id = rule.id);
