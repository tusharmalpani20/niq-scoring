-- Draft editing was previously blocked by an unconditional publication trigger.
-- Published contents stay immutable; retirement only changes lifecycle metadata.
CREATE OR REPLACE FUNCTION protect_published_scoring_rule() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF OLD.lifecycle <> 'DRAFT' THEN
      RAISE EXCEPTION 'published scoring rules cannot be deleted';
    END IF;
    RETURN OLD;
  END IF;
  IF OLD.lifecycle IN ('APPROVED', 'ACTIVE', 'RETIRED') THEN
    IF NEW.version IS DISTINCT FROM OLD.version
      OR NEW.package_checksum IS DISTINCT FROM OLD.package_checksum
      OR NEW.definition IS DISTINCT FROM OLD.definition
      OR NEW.lifecycle IN ('DRAFT', 'VALIDATED') THEN
      RAISE EXCEPTION 'published scoring rule identity and definition are immutable';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;
