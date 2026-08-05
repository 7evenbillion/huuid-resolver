-- ============================================================
-- HUUID Resolver — Migration 030: my-huuid Layer 3, patient profile
--
-- Two RPCs for the /my-huuid/profile screen: a decrypt-and-return read
-- (huuid_get_patient_profile) and a re-encrypt-and-write update
-- (huuid_update_patient_profile). Scope deliberately excludes phone_hash
-- and country_code: phone is the OTP/login lookup key (migration 013,
-- 017) and changing it needs its own re-verification flow, not a plain
-- field edit; country_code is embedded in the HUUID string itself
-- (did:huuid:{cc}:...), so editing it here would desync the DID from the
-- profile without actually changing the identifier. Both fields are
-- returned read-only by huuid_get_patient_profile so the UI can display
-- them without a second round trip.
-- ============================================================

CREATE OR REPLACE FUNCTION huuid_get_patient_profile(p_huuid text, p_pii_key text)
RETURNS TABLE (
  full_name text,
  date_of_birth date,
  sex_at_birth text,
  country_code text,
  phone text,
  phone_verified boolean,
  email text,
  emergency_contact_name text,
  emergency_contact_phone text,
  created_at timestamptz,
  updated_at timestamptz
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
  SELECT
    pgp_sym_decrypt(full_name_enc, p_pii_key),
    pgp_sym_decrypt(date_of_birth_enc, p_pii_key)::date,
    pgp_sym_decrypt(sex_at_birth_enc, p_pii_key),
    country_code,
    pgp_sym_decrypt(phone_enc, p_pii_key),
    phone_verified,
    email,
    CASE WHEN emergency_contact_name_enc IS NULL THEN NULL ELSE pgp_sym_decrypt(emergency_contact_name_enc, p_pii_key) END,
    CASE WHEN emergency_contact_phone_enc IS NULL THEN NULL ELSE pgp_sym_decrypt(emergency_contact_phone_enc, p_pii_key) END,
    created_at,
    updated_at
  FROM huuid_patients
  WHERE huuid = p_huuid AND status = 'active';
$$;

CREATE OR REPLACE FUNCTION huuid_update_patient_profile(
  p_huuid text,
  p_full_name text,
  p_date_of_birth date,
  p_sex_at_birth text,
  p_emergency_contact_name text,
  p_emergency_contact_phone text,
  p_email text,
  p_pii_key text
)
RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
  UPDATE huuid_patients SET
    full_name_enc = pgp_sym_encrypt(p_full_name, p_pii_key),
    date_of_birth_enc = pgp_sym_encrypt(p_date_of_birth::text, p_pii_key),
    sex_at_birth_enc = pgp_sym_encrypt(p_sex_at_birth, p_pii_key),
    emergency_contact_name_enc = CASE WHEN p_emergency_contact_name IS NULL THEN NULL ELSE pgp_sym_encrypt(p_emergency_contact_name, p_pii_key) END,
    emergency_contact_phone_enc = CASE WHEN p_emergency_contact_phone IS NULL THEN NULL ELSE pgp_sym_encrypt(p_emergency_contact_phone, p_pii_key) END,
    email = p_email,
    updated_at = now()
  WHERE huuid = p_huuid AND status = 'active';
$$;

REVOKE ALL ON FUNCTION huuid_get_patient_profile(text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION huuid_update_patient_profile(text, text, date, text, text, text, text, text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION huuid_get_patient_profile(text, text) FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION huuid_update_patient_profile(text, text, date, text, text, text, text, text) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION huuid_get_patient_profile(text, text) TO service_role;
GRANT EXECUTE ON FUNCTION huuid_update_patient_profile(text, text, date, text, text, text, text, text) TO service_role;

-- New audit action for profile saves.
ALTER TABLE huuid_audit_enrollment DROP CONSTRAINT huuid_audit_enrollment_action_check;
ALTER TABLE huuid_audit_enrollment ADD CONSTRAINT huuid_audit_enrollment_action_check
  CHECK (action IN (
    'enrollment_started',
    'phone_verified',
    'keypair_generated',
    'enrollment_completed',
    'card_downloaded',
    'recovery_requested',
    'erasure_requested',
    'erasure_completed',
    'medical_profile_updated',
    'profile_updated'
  ));
