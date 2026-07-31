-- ============================================================
-- HUUID Resolver — Migration 022: credential delivery RPC functions
--
-- pgp_sym_encrypt/pgp_sym_decrypt are Postgres-side (pgcrypto) functions,
-- not reachable as literal values through supabase-js's .insert()/.select()
-- parameter binding -- same reason migration 013's patient PII writes go
-- through SECURITY DEFINER functions rather than plain inserts. Two
-- functions: one to store the facility private key encrypted at
-- creation (Layer 3 approve), one to decrypt-and-immediately-clear it on
-- the single legitimate download (Layer 4) -- the plaintext key is never
-- held in the row for longer than between these two calls.
-- ============================================================

CREATE OR REPLACE FUNCTION huuid_create_credential_delivery(
  p_facility_did text,
  p_download_token text,
  p_download_url text,
  p_expires_at timestamptz,
  p_otp_hash text,
  p_private_key_pem text,
  p_pii_key text
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_id uuid;
BEGIN
  INSERT INTO public.huuid_facility_credential_deliveries (
    facility_did, download_token, download_url, expires_at, otp_hash, private_key_pem_enc
  ) VALUES (
    p_facility_did, p_download_token, p_download_url, p_expires_at, p_otp_hash,
    pgp_sym_encrypt(p_private_key_pem, p_pii_key)
  )
  RETURNING id INTO v_id;
  RETURN v_id;
END;
$$;

REVOKE ALL ON FUNCTION huuid_create_credential_delivery FROM PUBLIC;
GRANT EXECUTE ON FUNCTION huuid_create_credential_delivery TO service_role;

CREATE OR REPLACE FUNCTION huuid_verify_credential_otp(
  p_download_token text,
  p_otp_hash text
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_row public.huuid_facility_credential_deliveries%ROWTYPE;
BEGIN
  SELECT * INTO v_row FROM public.huuid_facility_credential_deliveries
    WHERE download_token = p_download_token
      AND expires_at > now()
      AND downloaded = false
    FOR UPDATE;

  IF NOT FOUND OR v_row.otp_hash != p_otp_hash THEN
    RETURN false;
  END IF;

  UPDATE public.huuid_facility_credential_deliveries
    SET otp_verified = true
    WHERE id = v_row.id;
  RETURN true;
END;
$$;

REVOKE ALL ON FUNCTION huuid_verify_credential_otp FROM PUBLIC;
GRANT EXECUTE ON FUNCTION huuid_verify_credential_otp TO service_role;

-- Decrypts and returns the private key + facility_did for a verified,
-- not-yet-downloaded, unexpired token, then immediately marks the row
-- downloaded (true) and clears the encrypted key -- single use, enforced
-- atomically inside the function rather than as two separate round trips
-- from the API route.
CREATE OR REPLACE FUNCTION huuid_consume_credential_delivery(
  p_download_token text,
  p_pii_key text,
  p_download_ip_hash text
)
RETURNS TABLE (facility_did text, private_key_pem text)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_row public.huuid_facility_credential_deliveries%ROWTYPE;
BEGIN
  SELECT * INTO v_row FROM public.huuid_facility_credential_deliveries
    WHERE download_token = p_download_token
      AND expires_at > now()
      AND downloaded = false
      AND otp_verified = true
    FOR UPDATE;

  IF NOT FOUND THEN
    RETURN;
  END IF;

  UPDATE public.huuid_facility_credential_deliveries
    SET downloaded = true, downloaded_at = now(), download_ip_hash = p_download_ip_hash,
        private_key_pem_enc = NULL
    WHERE id = v_row.id;

  RETURN QUERY SELECT v_row.facility_did, pgp_sym_decrypt(v_row.private_key_pem_enc, p_pii_key);
END;
$$;

REVOKE ALL ON FUNCTION huuid_consume_credential_delivery FROM PUBLIC;
GRANT EXECUTE ON FUNCTION huuid_consume_credential_delivery TO service_role;
