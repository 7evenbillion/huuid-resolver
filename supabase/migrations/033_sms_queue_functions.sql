-- ============================================================
-- HUUID Resolver — Migration 033: SMS queue RPC functions
--
-- Companion to 032. Phone hashing itself reuses the existing
-- huuid_hash_phone() (migration 027) from application code -- these
-- functions only handle the two things that must happen inside Postgres:
-- pgp_sym_encrypt/decrypt (Node cannot replicate pgcrypto's format) and
-- atomic counters (avoiding read-then-write races in the per-minute
-- dispatcher).
-- ============================================================

CREATE OR REPLACE FUNCTION huuid_sms_queue_insert(
  p_phone_hash text,
  p_phone text,
  p_message text,
  p_priority text,
  p_scheduled_for timestamptz,
  p_pii_key text
)
RETURNS uuid
LANGUAGE sql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
  -- phone_encrypted is a text column; pgp_sym_encrypt returns bytea, which
  -- has no implicit cast to/from text, so it's base64-encoded for storage
  -- and base64-decoded again in huuid_sms_queue_claim_batch below.
  INSERT INTO huuid_sms_queue (phone_hash, phone_encrypted, message, priority, scheduled_for)
  VALUES (p_phone_hash, encode(pgp_sym_encrypt(p_phone, p_pii_key), 'base64'), p_message, p_priority, p_scheduled_for)
  RETURNING id;
$$;

-- Claims (reads, does not mark sent) up to p_limit eligible rows for the
-- dispatcher to process one at a time. Marking sent/failed happens via
-- separate calls per-row from the dispatcher route itself, after each
-- real Hubtel send attempt -- so a mid-batch crash leaves unsent rows
-- correctly still unsent rather than silently lost.
CREATE OR REPLACE FUNCTION huuid_sms_queue_claim_batch(p_limit integer, p_pii_key text)
RETURNS TABLE (
  id uuid,
  phone_hash text,
  phone text,
  message text,
  priority text,
  attempts integer
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
  SELECT
    q.id,
    q.phone_hash,
    pgp_sym_decrypt(decode(q.phone_encrypted, 'base64'), p_pii_key),
    q.message,
    q.priority,
    q.attempts
  FROM huuid_sms_queue q
  WHERE q.sent = false AND q.scheduled_for <= now()
  ORDER BY q.scheduled_for ASC, q.created_at ASC
  LIMIT p_limit;
$$;

CREATE OR REPLACE FUNCTION huuid_sms_queue_mark_sent(p_id uuid, p_hubtel_message_id text)
RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
  UPDATE huuid_sms_queue
  SET sent = true, sent_at = now(), hubtel_message_id = p_hubtel_message_id
  WHERE id = p_id;
$$;

CREATE OR REPLACE FUNCTION huuid_sms_queue_increment_attempts(p_id uuid, p_error text)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_attempts integer;
BEGIN
  UPDATE huuid_sms_queue
  SET attempts = attempts + 1, last_error = p_error
  WHERE id = p_id
  RETURNING attempts INTO v_attempts;
  RETURN v_attempts;
END;
$$;

REVOKE ALL ON FUNCTION huuid_sms_queue_insert(text, text, text, text, timestamptz, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION huuid_sms_queue_claim_batch(integer, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION huuid_sms_queue_mark_sent(uuid, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION huuid_sms_queue_increment_attempts(uuid, text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION huuid_sms_queue_insert(text, text, text, text, timestamptz, text) FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION huuid_sms_queue_claim_batch(integer, text) FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION huuid_sms_queue_mark_sent(uuid, text) FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION huuid_sms_queue_increment_attempts(uuid, text) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION huuid_sms_queue_insert(text, text, text, text, timestamptz, text) TO service_role;
GRANT EXECUTE ON FUNCTION huuid_sms_queue_claim_batch(integer, text) TO service_role;
GRANT EXECUTE ON FUNCTION huuid_sms_queue_mark_sent(uuid, text) TO service_role;
GRANT EXECUTE ON FUNCTION huuid_sms_queue_increment_attempts(uuid, text) TO service_role;
