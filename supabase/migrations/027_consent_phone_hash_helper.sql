-- ============================================================
-- HUUID Resolver — Migration 027: phone-hash helper for consent requests
--
-- Every other phone_hash comparison in this codebase happens entirely
-- inside a Postgres function (encode(hmac(...))), never precomputed in
-- Node and passed in, to guarantee byte-identical hashing between write
-- and lookup. Consent requests (huuid_consent_requests.patient_phone_hash)
-- need the same guarantee across two different call sites (creating the
-- request, and matching an inbound SMS reply's sender number back to a
-- pending request) -- a small reusable wrapper instead of duplicating
-- the encode(hmac(...)) expression in two places.
-- ============================================================

CREATE FUNCTION huuid_hash_phone(p_phone text, p_pii_key text)
RETURNS text
LANGUAGE sql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
  SELECT encode(hmac(p_phone::bytea, p_pii_key::bytea, 'sha256'), 'hex');
$$;

REVOKE ALL ON FUNCTION huuid_hash_phone FROM PUBLIC;
GRANT EXECUTE ON FUNCTION huuid_hash_phone TO service_role;
