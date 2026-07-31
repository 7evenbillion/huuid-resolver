-- ============================================================
-- HUUID Resolver — Migration 026: facility Verify Patient support (Layer 6)
--
-- Two functions the Verify Patient screen needs that didn't exist yet:
--   huuid_get_patient_contact   -- decrypted phone, for sending the
--                                  consent-request SMS (REQUEST RECORD
--                                  ACCESS button)
--   huuid_search_patients_by_name_dob -- Tab 3's "fallback only, lower
--                                  confidence" search. Real constraint,
--                                  disclosed: full_name is
--                                  pgp_sym_encrypt'd (non-deterministic),
--                                  so it cannot be indexed or searched
--                                  with a plain SQL LIKE on ciphertext.
--                                  This function decrypts a bounded set
--                                  of non-revoked rows and filters in
--                                  SQL -- correct and fine at pilot
--                                  scale (a handful of enrolled
--                                  patients), not a scalable design for
--                                  a large patient base. A real search
--                                  index (e.g. a separate deterministic
--                                  blind-index column) would be needed
--                                  before that matters.
-- ============================================================

CREATE FUNCTION huuid_get_patient_contact(p_huuid text, p_pii_key text)
RETURNS TABLE (phone text)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
  SELECT CASE WHEN phone_enc IS NULL THEN NULL ELSE pgp_sym_decrypt(phone_enc, p_pii_key) END
  FROM huuid_patients
  WHERE huuid = p_huuid;
$$;

REVOKE ALL ON FUNCTION huuid_get_patient_contact FROM PUBLIC;
GRANT EXECUTE ON FUNCTION huuid_get_patient_contact TO service_role;

CREATE FUNCTION huuid_search_patients_by_name_dob(p_name_query text, p_dob date, p_pii_key text)
RETURNS TABLE (huuid text, full_name text, date_of_birth date, country_code text)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
BEGIN
  RETURN QUERY
  SELECT p.huuid, decrypted.full_name, decrypted.dob, p.country_code
  FROM huuid_patients p
  CROSS JOIN LATERAL (
    SELECT
      pgp_sym_decrypt(p.full_name_enc, p_pii_key) AS full_name,
      NULLIF(pgp_sym_decrypt(p.date_of_birth_enc, p_pii_key), '')::date AS dob
  ) decrypted
  WHERE p.status = 'active'
    AND p.full_name_enc IS NOT NULL
    AND decrypted.full_name ILIKE '%' || p_name_query || '%'
    AND (p_dob IS NULL OR decrypted.dob = p_dob)
  ORDER BY p.created_at DESC
  LIMIT 20;
END;
$$;

REVOKE ALL ON FUNCTION huuid_search_patients_by_name_dob FROM PUBLIC;
GRANT EXECUTE ON FUNCTION huuid_search_patients_by_name_dob TO service_role;
