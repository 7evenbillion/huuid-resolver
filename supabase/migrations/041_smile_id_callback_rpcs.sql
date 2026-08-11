-- ============================================================
-- HUUID Resolver — Migration 041: Layer 4 support (Smile ID callback)
-- ============================================================

-- Duplicate-face flagging in the callback needs to map a Smile ID
-- user_id (returned in antifraud.smile_secure.suspect_users) back to the
-- HUUID that owns it -- smile_id_smile_reference (migration 036) is
-- where that user_id is stored once a verification completes.
CREATE OR REPLACE FUNCTION huuid_find_patient_by_smile_reference(p_smile_reference text)
RETURNS TABLE (huuid text)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
  SELECT p.huuid FROM huuid_patients p WHERE p.smile_id_smile_reference = p_smile_reference;
$$;

-- huuid_smile_id_log_insert_pending (migration 040) didn't record
-- document_type/document_country -- the callback needs them (for the
-- document-hash dedup check and for huuid_complete_smile_id_verification)
-- but the real Smile ID V3 webhook's id_fields don't reliably carry a
-- distinct "document issuing country" field separate from what was
-- already selected client-side at submission. Recreated with two more
-- parameters rather than adding a second lookup table.
DROP FUNCTION IF EXISTS huuid_smile_id_log_insert_pending(text, text, text);

CREATE OR REPLACE FUNCTION huuid_smile_id_log_insert_pending(
  p_huuid text,
  p_job_id text,
  p_job_type text,
  p_document_type text,
  p_document_country text
)
RETURNS uuid
LANGUAGE sql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
  INSERT INTO huuid_smile_id_log (huuid, job_id, job_type, document_type, document_country, result_code, result_text)
  VALUES (p_huuid, p_job_id, p_job_type, p_document_type, p_document_country, NULL, 'submitted, awaiting callback')
  RETURNING id;
$$;

-- Callback correlates a webhook to the original submission by huuid
-- (partner_params.huuid, set at submit time) -- this retrieves the
-- document_type/document_country recorded then, from the most recent
-- still-pending job for that patient.
CREATE OR REPLACE FUNCTION huuid_get_latest_pending_smile_id_job(p_huuid text)
RETURNS TABLE (
  job_id text,
  document_type text,
  document_country text
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
  SELECT l.job_id, l.document_type, l.document_country
  FROM huuid_smile_id_log l
  WHERE l.huuid = p_huuid AND l.result_code IS NULL
  ORDER BY l.created_at DESC
  LIMIT 1;
$$;

-- Callback writes the FINAL result as its own immutable log row
-- (separate from the pending row inserted at submission -- this table is
-- an append-only audit log, not a current-state table, so two rows per
-- job_id -- submitted, then resolved -- is correct, not a duplicate bug).
CREATE OR REPLACE FUNCTION huuid_smile_id_log_insert_result(
  p_huuid text,
  p_job_id text,
  p_job_type text,
  p_smile_reference text,
  p_document_type text,
  p_document_country text,
  p_result_code text,
  p_result_text text,
  p_confidence_value numeric,
  p_duplicate_reference text,
  p_raw_response jsonb
)
RETURNS uuid
LANGUAGE sql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
  INSERT INTO huuid_smile_id_log (
    huuid, job_id, job_type, smile_reference, document_type, document_country,
    result_code, result_text, confidence_value, duplicate_reference, raw_response
  )
  VALUES (
    p_huuid, p_job_id, p_job_type, p_smile_reference, p_document_type, p_document_country,
    p_result_code, p_result_text, p_confidence_value, p_duplicate_reference, p_raw_response
  )
  RETURNING id;
$$;

REVOKE ALL ON FUNCTION huuid_find_patient_by_smile_reference(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION huuid_smile_id_log_insert_pending(text, text, text, text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION huuid_get_latest_pending_smile_id_job(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION huuid_smile_id_log_insert_result(text, text, text, text, text, text, text, text, numeric, text, jsonb) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION huuid_find_patient_by_smile_reference(text) FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION huuid_smile_id_log_insert_pending(text, text, text, text, text) FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION huuid_get_latest_pending_smile_id_job(text) FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION huuid_smile_id_log_insert_result(text, text, text, text, text, text, text, text, numeric, text, jsonb) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION huuid_find_patient_by_smile_reference(text) TO service_role;
GRANT EXECUTE ON FUNCTION huuid_smile_id_log_insert_pending(text, text, text, text, text) TO service_role;
GRANT EXECUTE ON FUNCTION huuid_get_latest_pending_smile_id_job(text) TO service_role;
GRANT EXECUTE ON FUNCTION huuid_smile_id_log_insert_result(text, text, text, text, text, text, text, text, numeric, text, jsonb) TO service_role;
