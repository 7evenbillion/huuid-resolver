-- ============================================================
-- HUUID Resolver — Migration 029: patient login lookup (my-huuid Layer 1)
--
-- huuid_get_patient_for_login mirrors huuid_get_patient_for_recovery
-- (migration 013) but keyed by huuid instead of phone -- the PIN login
-- flow already has the HUUID (the patient typed it in), and needs the
-- encrypted key material + phone (for the session + future SMS calls)
-- to attempt a client-side decrypt / challenge-response signature.
-- ============================================================

CREATE FUNCTION huuid_get_patient_for_login(p_huuid text, p_pii_key text)
RETURNS TABLE (
  full_name text,
  phone text,
  encrypted_private_key text,
  pbkdf2_salt text,
  pbkdf2_iv text,
  status text
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
  SELECT
    pgp_sym_decrypt(full_name_enc, p_pii_key),
    CASE WHEN phone_enc IS NULL THEN NULL ELSE pgp_sym_decrypt(phone_enc, p_pii_key) END,
    encrypted_private_key, pbkdf2_salt, pbkdf2_iv, status
  FROM huuid_patients
  WHERE huuid = p_huuid;
$$;

REVOKE ALL ON FUNCTION huuid_get_patient_for_login FROM PUBLIC;
GRANT EXECUTE ON FUNCTION huuid_get_patient_for_login TO service_role;
