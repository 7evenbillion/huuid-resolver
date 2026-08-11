-- ============================================================
-- HUUID Resolver — Migration 040: Layer 3 support
--
-- Two RPCs. huuid_complete_smile_id_verification is the single write path
-- for "a Smile ID document+face verification succeeded" -- used by both
-- the sandbox-simulated path (Layer 3, this commit) and the real Layer 4
-- webhook callback (not yet built) so both paths converge on identical
-- patient-row semantics. huuid_smile_id_log_insert_pending records a
-- submitted-but-not-yet-resolved production verification job so Layer 4
-- can later correlate an incoming webhook's job_id back to a huuid.
-- ============================================================

CREATE OR REPLACE FUNCTION huuid_complete_smile_id_verification(
  p_huuid text,
  p_biometric_commitment_hash text,
  p_document_type text,
  p_document_country text,
  p_smile_job_id text,
  p_smile_id_smile_reference text
)
RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
  UPDATE huuid_patients
  SET identity_verified = true,
      identity_verified_method = 'smile_id_document_face',
      identity_verified_at = now(),
      identity_document_type = p_document_type,
      identity_document_country = p_document_country,
      biometric_commitment_hash = p_biometric_commitment_hash,
      smile_id_job_id = p_smile_job_id,
      smile_id_smile_reference = p_smile_id_smile_reference,
      face_enrolled_at = now()
  WHERE huuid = p_huuid;
$$;

CREATE OR REPLACE FUNCTION huuid_smile_id_log_insert_pending(
  p_huuid text,
  p_job_id text,
  p_job_type text
)
RETURNS uuid
LANGUAGE sql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
  INSERT INTO huuid_smile_id_log (huuid, job_id, job_type, result_code, result_text)
  VALUES (p_huuid, p_job_id, p_job_type, NULL, 'submitted, awaiting callback')
  RETURNING id;
$$;

REVOKE ALL ON FUNCTION huuid_complete_smile_id_verification(text, text, text, text, text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION huuid_smile_id_log_insert_pending(text, text, text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION huuid_complete_smile_id_verification(text, text, text, text, text, text) FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION huuid_smile_id_log_insert_pending(text, text, text) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION huuid_complete_smile_id_verification(text, text, text, text, text, text) TO service_role;
GRANT EXECUTE ON FUNCTION huuid_smile_id_log_insert_pending(text, text, text) TO service_role;
