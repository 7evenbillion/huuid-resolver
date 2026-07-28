-- ============================================================
-- HUUID Resolver — Migration 018: emergency medical profile
--
-- Phase 2A of the QR card. All fields patient-provided, not clinically
-- verified -- same trust tier as the rest of self-enrolled data (Tier 1).
-- Encrypted with the same pgcrypto column-level pattern as migration 013
-- (pgp_sym_encrypt/pgp_sym_decrypt, HUUID_PII_ENCRYPTION_KEY passed per
-- call, never stored). jsonb fields (allergies, medications, chronic
-- conditions, implanted devices, contraindications) are serialized to
-- text before encryption and cast back to jsonb on decrypt.
--
-- primary_facility_name/country are encrypted too, even though the same
-- facility name also appears in the QR token's `pf` field and is
-- therefore visible on the printed card -- encrypting the at-rest copy
-- is still worth doing (defense in depth against a database-only
-- breach), and keeps every column in this migration handled uniformly
-- rather than carving out an exception.
-- ============================================================

ALTER TABLE huuid_patients
  ADD COLUMN blood_type_enc bytea,
  ADD COLUMN allergies_enc bytea,
  ADD COLUMN medications_enc bytea,
  ADD COLUMN chronic_conditions_enc bytea,
  ADD COLUMN pregnancy_status_enc bytea,
  ADD COLUMN organ_donor_enc bytea,
  ADD COLUMN implanted_devices_enc bytea,
  ADD COLUMN primary_physician_name_enc bytea,
  ADD COLUMN primary_physician_phone_enc bytea,
  ADD COLUMN primary_facility_name_enc bytea,
  ADD COLUMN primary_facility_country_enc bytea,
  ADD COLUMN contraindications_enc bytea,
  ADD COLUMN medical_profile_completed boolean NOT NULL DEFAULT false,
  ADD COLUMN medical_profile_updated_at timestamptz;

-- New audit action for medical profile saves.
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
    'medical_profile_updated'
  ));

-- Re-stated for explicitness (already covered by migration 013's
-- table-level GRANT, which extends automatically to new columns on the
-- same table -- Postgres does not require a per-column re-GRANT).
GRANT SELECT, INSERT, UPDATE ON huuid_patients TO service_role;

CREATE OR REPLACE FUNCTION huuid_update_medical_profile(
  p_huuid text,
  p_blood_type text,
  p_allergies jsonb,
  p_medications jsonb,
  p_chronic_conditions jsonb,
  p_pregnancy_status text,
  p_organ_donor text,
  p_implanted_devices jsonb,
  p_primary_physician_name text,
  p_primary_physician_phone text,
  p_primary_facility_name text,
  p_primary_facility_country text,
  p_contraindications jsonb,
  p_pii_key text
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_completed boolean;
BEGIN
  v_completed := (p_blood_type IS NOT NULL AND p_blood_type <> 'unknown')
    OR jsonb_array_length(COALESCE(p_allergies, '[]'::jsonb)) >= 1;

  UPDATE huuid_patients SET
    blood_type_enc = CASE WHEN p_blood_type IS NULL THEN NULL ELSE pgp_sym_encrypt(p_blood_type, p_pii_key) END,
    allergies_enc = pgp_sym_encrypt(COALESCE(p_allergies, '[]'::jsonb)::text, p_pii_key),
    medications_enc = pgp_sym_encrypt(COALESCE(p_medications, '[]'::jsonb)::text, p_pii_key),
    chronic_conditions_enc = pgp_sym_encrypt(COALESCE(p_chronic_conditions, '[]'::jsonb)::text, p_pii_key),
    pregnancy_status_enc = CASE WHEN p_pregnancy_status IS NULL THEN NULL ELSE pgp_sym_encrypt(p_pregnancy_status, p_pii_key) END,
    organ_donor_enc = CASE WHEN p_organ_donor IS NULL THEN NULL ELSE pgp_sym_encrypt(p_organ_donor, p_pii_key) END,
    implanted_devices_enc = pgp_sym_encrypt(COALESCE(p_implanted_devices, '[]'::jsonb)::text, p_pii_key),
    primary_physician_name_enc = CASE WHEN p_primary_physician_name IS NULL THEN NULL ELSE pgp_sym_encrypt(p_primary_physician_name, p_pii_key) END,
    primary_physician_phone_enc = CASE WHEN p_primary_physician_phone IS NULL THEN NULL ELSE pgp_sym_encrypt(p_primary_physician_phone, p_pii_key) END,
    primary_facility_name_enc = CASE WHEN p_primary_facility_name IS NULL THEN NULL ELSE pgp_sym_encrypt(p_primary_facility_name, p_pii_key) END,
    primary_facility_country_enc = CASE WHEN p_primary_facility_country IS NULL THEN NULL ELSE pgp_sym_encrypt(p_primary_facility_country, p_pii_key) END,
    contraindications_enc = pgp_sym_encrypt(COALESCE(p_contraindications, '[]'::jsonb)::text, p_pii_key),
    medical_profile_completed = v_completed,
    medical_profile_updated_at = now(),
    updated_at = now()
  WHERE huuid = p_huuid;
END;
$$;

CREATE OR REPLACE FUNCTION huuid_get_medical_profile(p_huuid text, p_pii_key text)
RETURNS TABLE (
  blood_type text,
  allergies jsonb,
  medications jsonb,
  chronic_conditions jsonb,
  pregnancy_status text,
  organ_donor text,
  implanted_devices jsonb,
  primary_physician_name text,
  primary_physician_phone text,
  primary_facility_name text,
  primary_facility_country text,
  contraindications jsonb,
  medical_profile_completed boolean,
  medical_profile_updated_at timestamptz
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
  SELECT
    CASE WHEN blood_type_enc IS NULL THEN NULL ELSE pgp_sym_decrypt(blood_type_enc, p_pii_key) END,
    COALESCE(NULLIF(pgp_sym_decrypt(allergies_enc, p_pii_key), '')::jsonb, '[]'::jsonb),
    COALESCE(NULLIF(pgp_sym_decrypt(medications_enc, p_pii_key), '')::jsonb, '[]'::jsonb),
    COALESCE(NULLIF(pgp_sym_decrypt(chronic_conditions_enc, p_pii_key), '')::jsonb, '[]'::jsonb),
    CASE WHEN pregnancy_status_enc IS NULL THEN NULL ELSE pgp_sym_decrypt(pregnancy_status_enc, p_pii_key) END,
    CASE WHEN organ_donor_enc IS NULL THEN NULL ELSE pgp_sym_decrypt(organ_donor_enc, p_pii_key) END,
    COALESCE(NULLIF(pgp_sym_decrypt(implanted_devices_enc, p_pii_key), '')::jsonb, '[]'::jsonb),
    CASE WHEN primary_physician_name_enc IS NULL THEN NULL ELSE pgp_sym_decrypt(primary_physician_name_enc, p_pii_key) END,
    CASE WHEN primary_physician_phone_enc IS NULL THEN NULL ELSE pgp_sym_decrypt(primary_physician_phone_enc, p_pii_key) END,
    CASE WHEN primary_facility_name_enc IS NULL THEN NULL ELSE pgp_sym_decrypt(primary_facility_name_enc, p_pii_key) END,
    CASE WHEN primary_facility_country_enc IS NULL THEN NULL ELSE pgp_sym_decrypt(primary_facility_country_enc, p_pii_key) END,
    COALESCE(NULLIF(pgp_sym_decrypt(contraindications_enc, p_pii_key), '')::jsonb, '[]'::jsonb),
    medical_profile_completed,
    medical_profile_updated_at
  FROM huuid_patients
  WHERE huuid = p_huuid;
$$;

-- Extend GDPR erasure to also clear medical data (Article 9 special
-- category health data -- if anything, more sensitive than the fields
-- migration 013's erasure already covered, so leaving it behind would
-- have been a real, obvious gap). Not explicitly requested by this
-- task's brief; added because the existing erasure feature (§18.9/18.10
-- of HANDOFF.md) would otherwise silently stop being complete the
-- moment this migration shipped.
CREATE OR REPLACE FUNCTION huuid_gdpr_erase_patient(
  p_huuid text,
  p_ip_hash text DEFAULT NULL,
  p_user_agent_hash text DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_audit_entry_id text;
BEGIN
  UPDATE huuid_patients SET
    full_name_enc = NULL,
    date_of_birth_enc = NULL,
    sex_at_birth_enc = NULL,
    emergency_contact_name_enc = NULL,
    emergency_contact_phone_enc = NULL,
    -- phone_hash intentionally NOT nulled -- retained permanently so an
    -- erased number cannot silently re-enroll a fresh HUUID (migration 017).
    phone_enc = NULL,
    email = NULL,
    encrypted_private_key = NULL,
    pbkdf2_salt = NULL,
    pbkdf2_iv = NULL,
    webauthn_credential_id = NULL,
    blood_type_enc = NULL,
    allergies_enc = NULL,
    medications_enc = NULL,
    chronic_conditions_enc = NULL,
    pregnancy_status_enc = NULL,
    organ_donor_enc = NULL,
    implanted_devices_enc = NULL,
    primary_physician_name_enc = NULL,
    primary_physician_phone_enc = NULL,
    primary_facility_name_enc = NULL,
    primary_facility_country_enc = NULL,
    contraindications_enc = NULL,
    medical_profile_completed = false,
    status = 'revoked',
    gdpr_erasure_requested = true,
    updated_at = now()
  WHERE huuid = p_huuid;

  UPDATE huuid_did_documents SET status = 'revoked', updated_at = now()
  WHERE huuid = p_huuid;

  v_audit_entry_id := 'erasure-audit-' || extract(epoch from now())::bigint || '-' || substr(md5(random()::text), 1, 8);

  INSERT INTO huuid_audit_enrollment (audit_entry_id, huuid, action, ip_hash, user_agent_hash, outcome)
  VALUES (
    v_audit_entry_id,
    p_huuid,
    'erasure_completed',
    COALESCE(p_ip_hash, encode(digest('administrative-action-supabase-mcp', 'sha256'), 'hex')),
    COALESCE(p_user_agent_hash, encode(digest('administrative-action-supabase-mcp', 'sha256'), 'hex')),
    'success'
  );
END;
$$;

REVOKE ALL ON FUNCTION huuid_update_medical_profile(text, text, jsonb, jsonb, jsonb, text, text, jsonb, text, text, text, text, jsonb, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION huuid_get_medical_profile(text, text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION huuid_update_medical_profile(text, text, jsonb, jsonb, jsonb, text, text, jsonb, text, text, text, text, jsonb, text) FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION huuid_get_medical_profile(text, text) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION huuid_update_medical_profile(text, text, jsonb, jsonb, jsonb, text, text, jsonb, text, text, text, text, jsonb, text) TO service_role;
GRANT EXECUTE ON FUNCTION huuid_get_medical_profile(text, text) TO service_role;
