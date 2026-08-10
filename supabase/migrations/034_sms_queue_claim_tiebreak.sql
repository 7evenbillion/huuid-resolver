-- Deterministic ordering for same-timestamp queued rows (5 rapid normal
-- sends to one recipient all get an identical scheduled_for since there is
-- no prior send yet to offset from -- created_at breaks the tie so the
-- dispatcher processes them in the order they were actually queued).
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
