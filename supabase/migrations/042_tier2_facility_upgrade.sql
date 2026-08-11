-- ============================================================
-- HUUID Resolver — Migration 042: Layer 5 support (facility Tier 2 upgrade)
-- ============================================================

CREATE OR REPLACE FUNCTION huuid_complete_tier2_upgrade(p_huuid text)
RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
  UPDATE huuid_patients
  SET verification_tier = 2,
      identity_verified = true,
      identity_verified_at = now(),
      identity_verified_method = 'facility_in_person'
  WHERE huuid = p_huuid;
$$;

-- Extended to return job_type -- Layer 4's callback needs it to tell an
-- enrollment-time document verification apart from a facility Tier 2
-- face-match re-verification (different completion RPC for each).
DROP FUNCTION IF EXISTS huuid_get_latest_pending_smile_id_job(text);

CREATE OR REPLACE FUNCTION huuid_get_latest_pending_smile_id_job(p_huuid text)
RETURNS TABLE (
  job_id text,
  job_type text,
  document_type text,
  document_country text
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
  SELECT l.job_id, l.job_type, l.document_type, l.document_country
  FROM huuid_smile_id_log l
  WHERE l.huuid = p_huuid AND l.result_code IS NULL
  ORDER BY l.created_at DESC
  LIMIT 1;
$$;

REVOKE ALL ON FUNCTION huuid_complete_tier2_upgrade(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION huuid_get_latest_pending_smile_id_job(text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION huuid_complete_tier2_upgrade(text) FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION huuid_get_latest_pending_smile_id_job(text) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION huuid_complete_tier2_upgrade(text) TO service_role;
GRANT EXECUTE ON FUNCTION huuid_get_latest_pending_smile_id_job(text) TO service_role;
