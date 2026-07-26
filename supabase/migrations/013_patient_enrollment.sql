-- ============================================================
-- HUUID Resolver — Migration 013: Patient self-enrollment
--
-- Renumbered from the originally-specified 012_patient_enrollment.sql —
-- 012 was already taken by 012_waitlist.sql. This is 013; the OTP cleanup
-- migration that follows it is 014, not 013.
--
-- PROTOCOL NOTE: HUUID-RESOLUTION-SPEC-v0.3 § 5 documents an
-- institutionally-anchored issuance model only (L3 Facility terminal,
-- mandatory biometric commitment). This migration introduces a new,
-- lower-trust onboarding path — Tier 1 "self-enrolled" — alongside it.
-- huuid_patients.verification_tier and the DID Document's
-- huuid:enrollmentType/huuid:verificationTier fields are a real protocol
-- extension, not previously documented. This closes Pre-Pilot Blocker 6
-- ("Patient contact store for SMS... needs a patient registration flow"),
-- but HUUID-RESOLUTION-SPEC and HUUID-COMPLIANCE need a formal addendum
-- before pilot — see the note below on PII handling.
--
-- COMPLIANCE NOTE: HUUID-COMPLIANCE-v0.1's HIPAA/GDPR posture rests on
-- "the resolver holds identity pointers only, no Article 9 data." This
-- table breaks that claim for self-enrolled patients — it holds legal
-- name, date of birth, and sex at birth (health-context data under GDPR
-- Art. 9). Two mitigations applied here: (1) those fields plus emergency
-- contact details are encrypted at the column level via pgcrypto
-- (pgp_sym_encrypt), not just relying on Supabase's disk-level encryption,
-- so "PII encrypted at rest" is true at the field level; (2) phone number
-- — the spec's "primary identity anchor" — is stored BOTH as a one-way
-- HMAC-SHA256 lookup hash (phone_hash, for uniqueness/dedup/OTP lookups)
-- AND a separate pgp_sym_encrypt'd reversible copy (phone_enc, decrypted
-- only server-side when an SMS must actually be sent). pgp_sym_encrypt is
-- non-deterministic (random session key per call) so it cannot back a
-- UNIQUE constraint or equality lookup directly — hence the hash+enc
-- split, the same pattern this project already uses for IP addresses
-- (one-way hash, never reversed) extended to a case where the plaintext
-- IS occasionally needed back out.
--
-- This migration does NOT itself update HUUID-COMPLIANCE-v0.1.docx or
-- HUUID-RESOLUTION-SPEC-v0.3.docx — that's a documentation task, flagged
-- to the operator, not done silently as a side effect of a code change.
-- ============================================================

CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- ------------------------------------------------------------
-- huuid_patients
-- ------------------------------------------------------------

CREATE TABLE huuid_patients (
  id                            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  huuid                         text UNIQUE NOT NULL,
  did_document                  jsonb NOT NULL,

  -- Encrypted PII (pgp_sym_encrypt) — never stored or returned in plaintext
  -- except via the SECURITY DEFINER decrypt functions below, which require
  -- the passphrase to be supplied by the caller (server-side env var only).
  full_name_enc                 bytea NOT NULL,
  date_of_birth_enc             bytea NOT NULL,
  sex_at_birth_enc              bytea NOT NULL,
  emergency_contact_name_enc    bytea,
  emergency_contact_phone_enc   bytea,

  country_code                  text NOT NULL,

  -- Phone: HMAC-SHA256 lookup hash (deterministic, for UNIQUE/dedup/OTP
  -- association) + a separate encrypted reversible copy (for sending SMS).
  phone_hash                    text UNIQUE NOT NULL,
  phone_enc                     bytea NOT NULL,
  phone_verified                boolean NOT NULL DEFAULT false,

  -- Optional, explicitly lower-sensitivity ("digital card backup only" per
  -- the enrollment form's own helper text) — kept plaintext, no unique
  -- lookup requirement on this field in the enrollment flow.
  email                         text,

  encrypted_private_key         text NOT NULL,
  pbkdf2_salt                   text NOT NULL,
  pbkdf2_iv                     text NOT NULL,
  webauthn_credential_id        text,

  verification_tier             integer NOT NULL DEFAULT 1
                                   CHECK (verification_tier IN (1, 2, 3)),
  status                        text NOT NULL DEFAULT 'active'
                                   CHECK (status IN ('active', 'suspended', 'revoked')),

  consent_terms                 boolean NOT NULL DEFAULT false,
  consent_data_processing       boolean NOT NULL DEFAULT false,
  consent_timestamp              timestamptz NOT NULL DEFAULT now(),
  consent_ip_hash                text NOT NULL,

  gdpr_erasure_requested         boolean NOT NULL DEFAULT false,

  created_at                     timestamptz NOT NULL DEFAULT now(),
  updated_at                     timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_patients_phone_hash ON huuid_patients (phone_hash);
CREATE INDEX idx_patients_huuid ON huuid_patients (huuid);

ALTER TABLE huuid_patients ENABLE ROW LEVEL SECURITY;
GRANT SELECT, INSERT, UPDATE ON huuid_patients TO service_role;
REVOKE ALL ON huuid_patients FROM anon, authenticated;

CREATE POLICY patients_service ON huuid_patients FOR ALL
  TO service_role USING (true) WITH CHECK (true);

-- ------------------------------------------------------------
-- huuid_otp_verifications
-- Phone stored the same hash-only way — this table is short-lived
-- (see migration 014 cleanup job) but there is no reason to hold even a
-- temporary plaintext phone number when a one-way hash does the job.
-- ------------------------------------------------------------

CREATE TABLE huuid_otp_verifications (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  phone_hash    text NOT NULL,
  otp_hash      text NOT NULL,
  otp_type      text NOT NULL CHECK (otp_type IN ('enrollment', 'recovery', 'login')),
  attempts      integer NOT NULL DEFAULT 0,
  expires_at    timestamptz NOT NULL,
  used          boolean NOT NULL DEFAULT false,
  ip_hash       text NOT NULL,
  created_at    timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_otp_phone_hash_type ON huuid_otp_verifications (phone_hash, otp_type);

ALTER TABLE huuid_otp_verifications ENABLE ROW LEVEL SECURITY;
GRANT SELECT, INSERT, UPDATE ON huuid_otp_verifications TO service_role;
REVOKE ALL ON huuid_otp_verifications FROM anon, authenticated;

CREATE POLICY otp_service ON huuid_otp_verifications FOR ALL
  TO service_role USING (true) WITH CHECK (true);

-- ------------------------------------------------------------
-- huuid_enrollment_rate_limits
-- ------------------------------------------------------------

CREATE TABLE huuid_enrollment_rate_limits (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  ip_hash       text NOT NULL,
  action        text NOT NULL,
  attempted_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_rate_ip_action ON huuid_enrollment_rate_limits (ip_hash, action, attempted_at);

ALTER TABLE huuid_enrollment_rate_limits ENABLE ROW LEVEL SECURITY;
GRANT SELECT, INSERT ON huuid_enrollment_rate_limits TO service_role;
REVOKE ALL ON huuid_enrollment_rate_limits FROM anon, authenticated;

CREATE POLICY rate_service ON huuid_enrollment_rate_limits FOR ALL
  TO service_role USING (true) WITH CHECK (true);

-- ------------------------------------------------------------
-- huuid_audit_enrollment (immutable, matches huuid_audit_log's pattern)
-- ------------------------------------------------------------

CREATE TABLE huuid_audit_enrollment (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  audit_entry_id   text UNIQUE NOT NULL,
  huuid            text,
  action           text NOT NULL CHECK (action IN (
                     'enrollment_started',
                     'phone_verified',
                     'keypair_generated',
                     'enrollment_completed',
                     'card_downloaded',
                     'recovery_requested',
                     'erasure_requested'
                   )),
  ip_hash          text NOT NULL,
  user_agent_hash  text NOT NULL,
  outcome          text NOT NULL,
  created_at       timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_audit_enroll_huuid ON huuid_audit_enrollment (huuid);

ALTER TABLE huuid_audit_enrollment ENABLE ROW LEVEL SECURITY;
GRANT SELECT, INSERT ON huuid_audit_enrollment TO service_role;
REVOKE ALL ON huuid_audit_enrollment FROM anon, authenticated;

CREATE POLICY audit_enroll_service ON huuid_audit_enrollment FOR ALL
  TO service_role USING (true) WITH CHECK (true);

CREATE OR REPLACE FUNCTION huuid_audit_enrollment_immutable()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  RAISE EXCEPTION 'huuid_audit_enrollment is immutable: % is not permitted', TG_OP;
END;
$$;

CREATE TRIGGER trg_huuid_audit_enrollment_no_update
  BEFORE UPDATE ON huuid_audit_enrollment
  FOR EACH ROW EXECUTE FUNCTION huuid_audit_enrollment_immutable();

CREATE TRIGGER trg_huuid_audit_enrollment_no_delete
  BEFORE DELETE ON huuid_audit_enrollment
  FOR EACH ROW EXECUTE FUNCTION huuid_audit_enrollment_immutable();

-- ------------------------------------------------------------
-- RPC functions — all SECURITY DEFINER, EXECUTE restricted to service_role
-- only. The pgcrypto passphrase is passed as a parameter on every call
-- (from process.env server-side) and is never stored inside any function
-- body or table — consistent with how SUPABASE_SERVICE_ROLE_KEY is never
-- hardcoded either.
-- ------------------------------------------------------------

CREATE OR REPLACE FUNCTION huuid_patient_exists_by_phone(p_phone text, p_pii_key text)
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
  SELECT EXISTS (
    SELECT 1 FROM huuid_patients
    WHERE phone_hash = encode(hmac(p_phone::bytea, p_pii_key::bytea, 'sha256'), 'hex')
  );
$$;

CREATE OR REPLACE FUNCTION huuid_enroll_patient(
  p_huuid text,
  p_did_document jsonb,
  p_full_name text,
  p_date_of_birth date,
  p_sex_at_birth text,
  p_country_code text,
  p_phone text,
  p_email text,
  p_emergency_contact_name text,
  p_emergency_contact_phone text,
  p_encrypted_private_key text,
  p_pbkdf2_salt text,
  p_pbkdf2_iv text,
  p_webauthn_credential_id text,
  p_consent_ip_hash text,
  p_pii_key text
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_id uuid;
BEGIN
  IF p_sex_at_birth NOT IN ('male', 'female', 'intersex') THEN
    RAISE EXCEPTION 'Invalid sex_at_birth value';
  END IF;

  INSERT INTO huuid_patients (
    huuid, did_document,
    full_name_enc, date_of_birth_enc, sex_at_birth_enc,
    country_code, phone_hash, phone_enc, phone_verified, email,
    emergency_contact_name_enc, emergency_contact_phone_enc,
    encrypted_private_key, pbkdf2_salt, pbkdf2_iv, webauthn_credential_id,
    consent_terms, consent_data_processing, consent_ip_hash
  ) VALUES (
    p_huuid, p_did_document,
    pgp_sym_encrypt(p_full_name, p_pii_key),
    pgp_sym_encrypt(p_date_of_birth::text, p_pii_key),
    pgp_sym_encrypt(p_sex_at_birth, p_pii_key),
    p_country_code,
    encode(hmac(p_phone::bytea, p_pii_key::bytea, 'sha256'), 'hex'),
    pgp_sym_encrypt(p_phone, p_pii_key),
    true,
    p_email,
    CASE WHEN p_emergency_contact_name IS NULL THEN NULL
         ELSE pgp_sym_encrypt(p_emergency_contact_name, p_pii_key) END,
    CASE WHEN p_emergency_contact_phone IS NULL THEN NULL
         ELSE pgp_sym_encrypt(p_emergency_contact_phone, p_pii_key) END,
    p_encrypted_private_key, p_pbkdf2_salt, p_pbkdf2_iv, p_webauthn_credential_id,
    true, true, p_consent_ip_hash
  )
  RETURNING id INTO v_id;

  RETURN v_id;
END;
$$;

-- Used by the card screen (needs the display name) and the register route's
-- own confirmation step. Returns only what each caller needs, not the full
-- row — the private key fields are intentionally never part of this
-- function's output.
CREATE OR REPLACE FUNCTION huuid_get_patient_by_huuid(p_huuid text, p_pii_key text)
RETURNS TABLE (
  full_name text,
  country_code text,
  verification_tier integer,
  status text,
  created_at timestamptz
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
  SELECT
    pgp_sym_decrypt(full_name_enc, p_pii_key),
    country_code,
    verification_tier,
    status,
    created_at
  FROM huuid_patients
  WHERE huuid = p_huuid;
$$;

-- Recovery flow: locate a patient by phone and return everything needed to
-- attempt decryption with a newly-entered PIN. The caller (recovery API
-- route) attempts AES-GCM decryption client-side or server-side with the
-- returned encrypted_private_key/salt/iv — this function never decrypts
-- the private key itself, only the surrounding PII needed to resume.
CREATE OR REPLACE FUNCTION huuid_get_patient_for_recovery(p_phone text, p_pii_key text)
RETURNS TABLE (
  id uuid,
  huuid text,
  full_name text,
  country_code text,
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
    id, huuid,
    pgp_sym_decrypt(full_name_enc, p_pii_key),
    country_code,
    encrypted_private_key, pbkdf2_salt, pbkdf2_iv, status
  FROM huuid_patients
  WHERE phone_hash = encode(hmac(p_phone::bytea, p_pii_key::bytea, 'sha256'), 'hex');
$$;

-- GDPR Article 17 (right to erasure). Nulls every PII field, frees the
-- phone_hash for reuse, revokes the patient record AND the underlying DID
-- Document (so the resolver's existing 410 "deactivated" path applies —
-- see app/api/1.0/identifiers/[did]/route.ts, which already maps any
-- non-'active' huuid_did_documents.status to that outcome). Retains only
-- the huuid, DID Document shell, country_code, and timestamps for
-- protocol/audit integrity.
CREATE OR REPLACE FUNCTION huuid_gdpr_erase_patient(p_huuid text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
BEGIN
  UPDATE huuid_patients SET
    full_name_enc = NULL,
    date_of_birth_enc = NULL,
    sex_at_birth_enc = NULL,
    emergency_contact_name_enc = NULL,
    emergency_contact_phone_enc = NULL,
    phone_hash = NULL,
    phone_enc = NULL,
    email = NULL,
    encrypted_private_key = NULL,
    pbkdf2_salt = NULL,
    pbkdf2_iv = NULL,
    webauthn_credential_id = NULL,
    status = 'revoked',
    gdpr_erasure_requested = true,
    updated_at = now()
  WHERE huuid = p_huuid;

  UPDATE huuid_did_documents SET status = 'revoked', updated_at = now()
  WHERE huuid = p_huuid;
END;
$$;

-- ------------------------------------------------------------
-- OTP RPCs — atomic, mirroring the advisory-lock counter style already
-- used for resolution rate limiting (migrations 010/011).
-- ------------------------------------------------------------

CREATE OR REPLACE FUNCTION huuid_otp_create(
  p_phone text,
  p_otp_hash text,
  p_otp_type text,
  p_ip_hash text,
  p_expires_at timestamptz,
  p_pii_key text
)
RETURNS uuid
LANGUAGE sql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
  INSERT INTO huuid_otp_verifications (phone_hash, otp_hash, otp_type, expires_at, ip_hash)
  VALUES (encode(hmac(p_phone::bytea, p_pii_key::bytea, 'sha256'), 'hex'), p_otp_hash, p_otp_type, p_expires_at, p_ip_hash)
  RETURNING id;
$$;

-- Most recent, not-yet-used OTP row for a phone+type. The caller checks
-- expiry, attempts, and hash equality itself (comparing against a freshly
-- SHA-256'd version of the code the user just entered).
CREATE OR REPLACE FUNCTION huuid_otp_find_active(p_phone text, p_otp_type text, p_pii_key text)
RETURNS TABLE (
  id uuid,
  otp_hash text,
  attempts integer,
  expires_at timestamptz,
  created_at timestamptz
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
  SELECT id, otp_hash, attempts, expires_at, created_at
  FROM huuid_otp_verifications
  WHERE phone_hash = encode(hmac(p_phone::bytea, p_pii_key::bytea, 'sha256'), 'hex')
    AND otp_type = p_otp_type
    AND used = false
  ORDER BY created_at DESC
  LIMIT 1;
$$;

CREATE OR REPLACE FUNCTION huuid_otp_increment_attempts(p_id uuid)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_attempts integer;
BEGIN
  UPDATE huuid_otp_verifications
  SET attempts = attempts + 1
  WHERE id = p_id
  RETURNING attempts INTO v_attempts;
  RETURN v_attempts;
END;
$$;

CREATE OR REPLACE FUNCTION huuid_otp_mark_used(p_id uuid)
RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
  UPDATE huuid_otp_verifications SET used = true WHERE id = p_id;
$$;

-- Count of OTPs requested for a phone+type since a given timestamp — backs
-- the "3 OTP requests per phone per hour" limit.
CREATE OR REPLACE FUNCTION huuid_otp_count_recent(p_phone text, p_otp_type text, p_since timestamptz, p_pii_key text)
RETURNS integer
LANGUAGE sql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
  SELECT count(*)::integer FROM huuid_otp_verifications
  WHERE phone_hash = encode(hmac(p_phone::bytea, p_pii_key::bytea, 'sha256'), 'hex')
    AND otp_type = p_otp_type
    AND created_at > p_since;
$$;

-- IP-based rate limiting (enrollment attempts, 3/IP/hour). Atomic:
-- serializes on ip_hash+action via advisory lock, matching the pattern in
-- migration 011, then logs the attempt if under the ceiling.
CREATE OR REPLACE FUNCTION huuid_check_and_log_rate_limit(
  p_ip_hash text,
  p_action text,
  p_max_per_hour integer
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_count integer;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended(p_ip_hash || ':' || p_action, 0));

  SELECT count(*) INTO v_count
  FROM huuid_enrollment_rate_limits
  WHERE ip_hash = p_ip_hash
    AND action = p_action
    AND attempted_at > now() - interval '1 hour';

  IF v_count >= p_max_per_hour THEN
    RETURN false;
  END IF;

  INSERT INTO huuid_enrollment_rate_limits (ip_hash, action) VALUES (p_ip_hash, p_action);
  RETURN true;
END;
$$;

-- Lock EXECUTE down to service_role only, matching table-level GRANTs above.
REVOKE ALL ON FUNCTION huuid_patient_exists_by_phone(text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION huuid_enroll_patient(text, jsonb, text, date, text, text, text, text, text, text, text, text, text, text, text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION huuid_get_patient_by_huuid(text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION huuid_get_patient_for_recovery(text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION huuid_gdpr_erase_patient(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION huuid_otp_create(text, text, text, text, timestamptz, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION huuid_otp_find_active(text, text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION huuid_otp_increment_attempts(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION huuid_otp_mark_used(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION huuid_otp_count_recent(text, text, timestamptz, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION huuid_check_and_log_rate_limit(text, text, integer) FROM PUBLIC;

-- Explicit revoke from anon/authenticated too -- REVOKE ALL FROM PUBLIC alone
-- was not sufficient on this shared project (Supabase advisor flagged all 11
-- functions as directly callable by anon/authenticated via PostgREST's
-- /rest/v1/rpc/ surface even after the PUBLIC revoke -- likely a default
-- privilege on this shared project granting those roles EXECUTE on new
-- functions in the public schema). Without this, an unauthenticated caller
-- could invoke e.g. huuid_gdpr_erase_patient(huuid) directly over the API
-- and erase any patient's data just by knowing their HUUID string.
REVOKE EXECUTE ON FUNCTION huuid_patient_exists_by_phone(text, text) FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION huuid_enroll_patient(text, jsonb, text, date, text, text, text, text, text, text, text, text, text, text, text, text) FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION huuid_get_patient_by_huuid(text, text) FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION huuid_get_patient_for_recovery(text, text) FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION huuid_gdpr_erase_patient(text) FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION huuid_otp_create(text, text, text, text, timestamptz, text) FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION huuid_otp_find_active(text, text, text) FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION huuid_otp_increment_attempts(uuid) FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION huuid_otp_mark_used(uuid) FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION huuid_otp_count_recent(text, text, timestamptz, text) FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION huuid_check_and_log_rate_limit(text, text, integer) FROM anon, authenticated;

GRANT EXECUTE ON FUNCTION huuid_patient_exists_by_phone(text, text) TO service_role;
GRANT EXECUTE ON FUNCTION huuid_enroll_patient(text, jsonb, text, date, text, text, text, text, text, text, text, text, text, text, text, text) TO service_role;
GRANT EXECUTE ON FUNCTION huuid_get_patient_by_huuid(text, text) TO service_role;
GRANT EXECUTE ON FUNCTION huuid_get_patient_for_recovery(text, text) TO service_role;
GRANT EXECUTE ON FUNCTION huuid_gdpr_erase_patient(text) TO service_role;
GRANT EXECUTE ON FUNCTION huuid_otp_create(text, text, text, text, timestamptz, text) TO service_role;
GRANT EXECUTE ON FUNCTION huuid_otp_find_active(text, text, text) TO service_role;
GRANT EXECUTE ON FUNCTION huuid_otp_increment_attempts(uuid) TO service_role;
GRANT EXECUTE ON FUNCTION huuid_otp_mark_used(uuid) TO service_role;
GRANT EXECUTE ON FUNCTION huuid_otp_count_recent(text, text, timestamptz, text) TO service_role;
GRANT EXECUTE ON FUNCTION huuid_check_and_log_rate_limit(text, text, integer) TO service_role;
