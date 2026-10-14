ALTER TABLE report_generation_calls DROP CONSTRAINT IF EXISTS report_call_step_ck;
ALTER TABLE report_generation_calls ADD CONSTRAINT report_call_step_ck CHECK (step IN ('manager','writer','reviewer','revision','coverage','summarizer','highlighter'));
ALTER TABLE report_generation_calls ADD COLUMN reasoning_effort varchar(20);
