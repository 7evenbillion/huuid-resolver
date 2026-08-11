-- ============================================================
-- HUUID Resolver — Migration 043: Layer 5 support
--
-- /api/facility/tier2-upgrade/start needs to know whether a patient has
-- an enrolled Smile ID face to compare a facility selfie against
-- (smile_id_smile_reference is only set once Layer 3's enrollment
-- verification has actually completed -- a patient who skipped it has
-- nothing to match against, so the face-match path isn't offered).
-- ============================================================

CREATE OR REPLACE FUNCTION huuid_get_smile_id_reference(p_huuid text)
RETURNS TABLE (smile_id_smile_reference text)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
  SELECT p.smile_id_smile_reference FROM huuid_patients p WHERE p.huuid = p_huuid;
$$;

REVOKE ALL ON FUNCTION huuid_get_smile_id_reference(text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION huuid_get_smile_id_reference(text) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION huuid_get_smile_id_reference(text) TO service_role;
