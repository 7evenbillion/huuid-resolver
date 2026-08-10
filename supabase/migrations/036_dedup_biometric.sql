-- ============================================================
-- HUUID Resolver — Migration 036: Duplicate prevention + biometric
-- identity verification (dedup layers)
--
-- Merges the operator-supplied Smile ID build prompt with the T1-T5
-- weighted matching model already designed in HUUID-RESOLUTION-SPEC-v0.3
-- Section 3.1/3.2 (operator decision 2026-08-10: do not replace the
-- weighted model with a flat name/DOB check -- Smile ID becomes the T1
-- biometric input, name/DOB fuzzy match becomes T5, flagging-only, exactly
-- as the spec already required). See HUUID-COMPLIANCE-v0.2.docx Section 2A
-- for the sub-processor disclosure this build depends on.
--
-- Two real deviations from the build prompt's literal pseudocode,
-- disclosed here rather than silently papered over:
--
-- 1. full_name and date_of_birth are NOT plaintext columns on this table
--    (they are full_name_enc / date_of_birth_enc, pgp_sym_encrypt'd --
--    migration 013). The prompt's Layer 2 pseudocode assumes a plain
--    `.eq('date_of_birth', date_of_birth)` query, which cannot work
--    against an encrypted column. date_of_birth_hash (HMAC-SHA256, same
--    pattern as the existing phone_hash / huuid_hash_phone from migration
--    027) is added so a same-DOB candidate set can be found by an indexed
--    equality lookup without decrypting every active patient's DOB --
--    full_name is decrypted server-side, inside a SECURITY DEFINER RPC,
--    only for the small candidate set that already matches on DOB, and
--    must never be returned to an unauthenticated enrollment client (only
--    the matched HUUID, partially masked, per the prompt's own UI copy).
--
-- 2. T2 ("issuing node ID match") needs to know which facility, if any,
--    witnessed an enrollment -- no such column existed. enrolling_
--    facility_did is added, nullable (NULL for self-enrollment via
--    /api/enroll/start, set to the facility's DID for
--    /api/facility/enroll/start).
--
-- T4 ("guardian-link cross-reference") is NOT implemented in this
-- migration -- no guardian-registration/linkage feature exists anywhere
-- in this codebase yet (confirmed via grep across the whole repo;
-- "guardian" only appears as a break-glass SMS notification channel
-- name in migration 005). The scoring function built in lib/dedup-
-- scoring.ts (Layer 2) accepts a T4 input and always scores it 0 for
-- now -- a disclosed gap, not a silent omission.
-- ============================================================

-- ------------------------------------------------------------
-- huuid_patients: dedup + biometric columns
-- ------------------------------------------------------------

ALTER TABLE huuid_patients
  ADD COLUMN potential_duplicate boolean NOT NULL DEFAULT false,
  ADD COLUMN duplicate_review_status text DEFAULT 'pending'
    CHECK (duplicate_review_status IN ('pending', 'confirmed_duplicate', 'cleared', 'merged')),
  ADD COLUMN duplicate_of_huuid text,
  ADD COLUMN duplicate_pms_score numeric,
  ADD COLUMN identity_document_hash text,
  ADD COLUMN identity_document_expiry date,
  ADD COLUMN biometric_commitment_hash text,
  ADD COLUMN smile_id_job_id text,
  ADD COLUMN smile_id_smile_reference text,
  ADD COLUMN face_enrolled_at timestamptz,
  ADD COLUMN date_of_birth_hash text,
  ADD COLUMN enrolling_facility_did text;

-- identity_verified_method already exists (migration 031) with no CHECK
-- constraint yet -- add one now that its real values are known.
ALTER TABLE huuid_patients ADD CONSTRAINT huuid_patients_identity_verified_method_check
  CHECK (identity_verified_method IS NULL OR identity_verified_method IN (
    'smile_id_document_face',
    'facility_in_person',
    'government_registry'
  ));

-- One government ID = one HUUID maximum.
CREATE UNIQUE INDEX idx_patients_document_hash
  ON huuid_patients(identity_document_hash)
  WHERE identity_document_hash IS NOT NULL;

-- T5 candidate lookup: same DOB, active patients only.
CREATE INDEX idx_patients_dob_hash
  ON huuid_patients(date_of_birth_hash)
  WHERE status = 'active';

CREATE INDEX idx_patients_duplicate_review
  ON huuid_patients(potential_duplicate, duplicate_review_status)
  WHERE potential_duplicate = true;

-- ------------------------------------------------------------
-- huuid_smile_id_log: immutable verification log
-- ------------------------------------------------------------

CREATE TABLE huuid_smile_id_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  huuid text NOT NULL,
  job_id text NOT NULL,
  job_type text NOT NULL CHECK (job_type IN (
    'document_verification', 'biometric_kyc', 'face_match', 'id_authority_check'
  )),
  smile_reference text,
  document_type text,
  document_country text,
  result_code text,
  result_text text,
  confidence_value numeric,
  actions_liveness_check text,
  actions_register_selfie text,
  actions_verify_document text,
  actions_return_personal_info text,
  duplicate_reference text,
  raw_response jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE huuid_smile_id_log ENABLE ROW LEVEL SECURITY;
GRANT SELECT, INSERT ON huuid_smile_id_log TO service_role;
REVOKE ALL ON huuid_smile_id_log FROM anon, authenticated;

CREATE POLICY smile_id_log_service ON huuid_smile_id_log
  FOR ALL TO service_role USING (true) WITH CHECK (true);

CREATE OR REPLACE FUNCTION prevent_smile_id_log_modification()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, extensions
AS $$
BEGIN
  RAISE EXCEPTION 'huuid_smile_id_log is immutable';
END;
$$;

CREATE TRIGGER smile_id_log_immutable
  BEFORE UPDATE OR DELETE ON huuid_smile_id_log
  FOR EACH ROW
  EXECUTE FUNCTION prevent_smile_id_log_modification();

CREATE INDEX idx_smile_id_log_huuid ON huuid_smile_id_log(huuid);
CREATE INDEX idx_smile_id_log_job ON huuid_smile_id_log(job_id);

-- ------------------------------------------------------------
-- Audit action list: new dedup/biometric actions
-- ------------------------------------------------------------

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
    'profile_updated',
    'pin_changed',
    'otp_possibly_undelivered',
    'potential_duplicate_flagged',
    'identity_verified_smile_id',
    'identity_verification_failed',
    'tier2_upgrade_completed',
    'tier2_upgrade_staff_verified',
    'duplicate_document_detected'
  ));

-- ------------------------------------------------------------
-- RPCs: Layer 2 (duplicate detection on self-enrollment)
-- ------------------------------------------------------------

-- Mirrors huuid_hash_phone (migration 027) exactly -- same HMAC-SHA256
-- pattern, applied to date_of_birth instead of phone, for the same
-- reason: a deterministic, indexable equality key over an otherwise
-- encrypted field, computed once in Postgres so write and lookup are
-- guaranteed byte-identical.
CREATE OR REPLACE FUNCTION huuid_hash_dob(p_dob date, p_pii_key text)
RETURNS text
LANGUAGE sql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
  SELECT encode(hmac(p_dob::text::bytea, p_pii_key::bytea, 'sha256'), 'hex');
$$;

-- Candidates for T5 (name/DOB) and T1/T2/T3 scoring: same date_of_birth,
-- active patients only, optionally excluding the enrollment's own huuid
-- (used when re-scoring after the row already exists). full_name is
-- decrypted here for server-side Levenshtein comparison only -- the
-- calling route must never return it to an enrollment client.
CREATE OR REPLACE FUNCTION huuid_find_dob_candidates(
  p_dob_hash text,
  p_pii_key text,
  p_exclude_huuid text DEFAULT NULL
)
RETURNS TABLE (
  huuid text,
  full_name text,
  verification_tier integer,
  enrolling_facility_did text,
  created_at timestamptz
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
  SELECT
    p.huuid,
    pgp_sym_decrypt(p.full_name_enc, p_pii_key),
    p.verification_tier,
    p.enrolling_facility_did,
    p.created_at
  FROM huuid_patients p
  WHERE p.date_of_birth_hash = p_dob_hash
    AND p.status = 'active'
    AND (p_exclude_huuid IS NULL OR p.huuid <> p_exclude_huuid);
$$;

CREATE OR REPLACE FUNCTION huuid_check_document_hash(p_document_hash text)
RETURNS TABLE (huuid text)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
  SELECT p.huuid FROM huuid_patients p
  WHERE p.identity_document_hash = p_document_hash AND p.status = 'active';
$$;

CREATE OR REPLACE FUNCTION huuid_flag_potential_duplicate(
  p_huuid text,
  p_duplicate_of_huuid text,
  p_pms_score numeric
)
RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
  UPDATE huuid_patients
  SET potential_duplicate = true,
      duplicate_of_huuid = p_duplicate_of_huuid,
      duplicate_pms_score = p_pms_score,
      duplicate_review_status = 'pending'
  WHERE huuid = p_huuid;
$$;

CREATE OR REPLACE FUNCTION huuid_set_date_of_birth_hash(p_huuid text, p_dob_hash text)
RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
  UPDATE huuid_patients SET date_of_birth_hash = p_dob_hash WHERE huuid = p_huuid;
$$;

REVOKE ALL ON FUNCTION huuid_hash_dob(date, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION huuid_find_dob_candidates(text, text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION huuid_check_document_hash(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION huuid_flag_potential_duplicate(text, text, numeric) FROM PUBLIC;
REVOKE ALL ON FUNCTION huuid_set_date_of_birth_hash(text, text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION huuid_hash_dob(date, text) FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION huuid_find_dob_candidates(text, text, text) FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION huuid_check_document_hash(text) FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION huuid_flag_potential_duplicate(text, text, numeric) FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION huuid_set_date_of_birth_hash(text, text) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION huuid_hash_dob(date, text) TO service_role;
GRANT EXECUTE ON FUNCTION huuid_find_dob_candidates(text, text, text) TO service_role;
GRANT EXECUTE ON FUNCTION huuid_check_document_hash(text) TO service_role;
GRANT EXECUTE ON FUNCTION huuid_flag_potential_duplicate(text, text, numeric) TO service_role;
GRANT EXECUTE ON FUNCTION huuid_set_date_of_birth_hash(text, text) TO service_role;
