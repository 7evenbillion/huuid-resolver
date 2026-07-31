-- ============================================================
-- HUUID Resolver — Migration 023: fix migration 022's search_path
--
-- Real bug, found running huuid_create_credential_delivery for the
-- first time: `SET search_path = ''` (copied from the security-advisor
-- fix on migration 020's trigger function, which never calls a
-- cross-schema function) breaks unqualified calls to pgp_sym_encrypt/
-- pgp_sym_decrypt, since pgcrypto lives in the `extensions` schema on
-- this project, not `public` -- confirmed via pg_proc/pg_namespace.
-- migration 013's own functions already established the correct fixed
-- (non-mutable, so still advisor-clean) value: `public, extensions`.
-- Applying that same pattern here instead of empty string.
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
SET search_path = public, extensions
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

CREATE OR REPLACE FUNCTION huuid_verify_credential_otp(
  p_download_token text,
  p_otp_hash text
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
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

CREATE OR REPLACE FUNCTION huuid_consume_credential_delivery(
  p_download_token text,
  p_pii_key text,
  p_download_ip_hash text
)
RETURNS TABLE (facility_did text, private_key_pem text)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
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
