-- Security advisor flagged prevent_smile_id_log_modification (036) as
-- having a mutable search_path -- every other function in this migration
-- set it, this trigger function was the one miss. Fixed here rather than
-- editing 036 after the fact and leaving the live DB and source out of
-- sync.
CREATE OR REPLACE FUNCTION prevent_smile_id_log_modification()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, extensions
AS $$
BEGIN
  RAISE EXCEPTION 'huuid_smile_id_log is immutable';
END;
$$;
