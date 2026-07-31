-- ============================================================
-- HUUID Resolver — Migration 024: store public_key_pem alongside the
-- encrypted private key, for Layer 4's credential package
--
-- Reconstructing an Ed25519 SPKI PEM from the raw 32-byte multibase
-- public key already in huuid_facilities would require hand-building
-- the fixed ASN.1 SubjectPublicKeyInfo DER prefix -- correct and
-- well-known, but a one-off risk not worth taking when the real
-- publicKey KeyObject already exists at Layer 3 approval time and can
-- just be stored directly. Not encrypted (a public key has no
-- confidentiality requirement, unlike private_key_pem_enc).
-- ============================================================

ALTER TABLE huuid_facility_credential_deliveries
  ADD COLUMN IF NOT EXISTS public_key_pem text;

GRANT SELECT, INSERT, UPDATE ON huuid_facility_credential_deliveries TO service_role;

DROP FUNCTION IF EXISTS huuid_create_credential_delivery(text, text, text, timestamptz, text, text, text);
DROP FUNCTION IF EXISTS huuid_consume_credential_delivery(text, text, text);

CREATE FUNCTION huuid_create_credential_delivery(
  p_facility_did text,
  p_download_token text,
  p_download_url text,
  p_expires_at timestamptz,
  p_otp_hash text,
  p_private_key_pem text,
  p_public_key_pem text,
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
    facility_did, download_token, download_url, expires_at, otp_hash,
    private_key_pem_enc, public_key_pem
  ) VALUES (
    p_facility_did, p_download_token, p_download_url, p_expires_at, p_otp_hash,
    pgp_sym_encrypt(p_private_key_pem, p_pii_key), p_public_key_pem
  )
  RETURNING id INTO v_id;
  RETURN v_id;
END;
$$;

CREATE FUNCTION huuid_consume_credential_delivery(
  p_download_token text,
  p_pii_key text,
  p_download_ip_hash text
)
RETURNS TABLE (facility_did text, private_key_pem text, public_key_pem text)
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

  RETURN QUERY SELECT v_row.facility_did, pgp_sym_decrypt(v_row.private_key_pem_enc, p_pii_key), v_row.public_key_pem;
END;
$$;

REVOKE ALL ON FUNCTION huuid_create_credential_delivery FROM PUBLIC;
GRANT EXECUTE ON FUNCTION huuid_create_credential_delivery TO service_role;
REVOKE ALL ON FUNCTION huuid_consume_credential_delivery FROM PUBLIC;
GRANT EXECUTE ON FUNCTION huuid_consume_credential_delivery TO service_role;
