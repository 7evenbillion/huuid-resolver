-- ============================================================
-- HUUID Resolver — Migration 017: retain phone_hash after GDPR erasure
--
-- Operator decision, overriding migration 013's original design
-- ("frees phone_hash for reuse"). Rationale (operator's, recorded here
-- verbatim for the historical record):
--
--   Healthcare audit integrity takes priority over frictionless
--   re-enrollment. GDPR Article 17(3)(b) allows retention for legal
--   obligations. Phone hash retained permanently post-erasure.
--
-- Note: this document does not independently verify that GDPR Art.
-- 17(3)(b) applies to this specific retention -- that determination is
-- the operator's, consistent with HUUID-COMPLIANCE-v0.1's own "not a
-- legal opinion" framing for this whole document library. What this
-- migration changes is purely technical: huuid_gdpr_erase_patient() no
-- longer nulls phone_hash, only phone_enc (the reversible copy). Every
-- other PII field is still nulled exactly as before.
--
-- Practical effect: huuid_patient_exists_by_phone() already checks
-- phone_hash existence regardless of status, so an erased phone number
-- is automatically blocked from a fresh self-enrollment -- no change
-- needed to that function. Re-enrollment after erasure requires manual
-- intervention (contact identity@huuid.health), surfaced in the
-- /enroll/erase UI notice.
-- ============================================================

CREATE OR REPLACE FUNCTION huuid_gdpr_erase_patient(
  p_huuid text,
  p_ip_hash text DEFAULT NULL,
  p_user_agent_hash text DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_audit_entry_id text;
BEGIN
  UPDATE huuid_patients SET
    full_name_enc = NULL,
    date_of_birth_enc = NULL,
    sex_at_birth_enc = NULL,
    emergency_contact_name_enc = NULL,
    emergency_contact_phone_enc = NULL,
    -- phone_hash intentionally NOT nulled -- retained permanently so an
    -- erased number cannot silently re-enroll a fresh HUUID.
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

  v_audit_entry_id := 'erasure-audit-' || extract(epoch from now())::bigint || '-' || substr(md5(random()::text), 1, 8);

  INSERT INTO huuid_audit_enrollment (audit_entry_id, huuid, action, ip_hash, user_agent_hash, outcome)
  VALUES (
    v_audit_entry_id,
    p_huuid,
    'erasure_completed',
    COALESCE(p_ip_hash, encode(digest('administrative-action-supabase-mcp', 'sha256'), 'hex')),
    COALESCE(p_user_agent_hash, encode(digest('administrative-action-supabase-mcp', 'sha256'), 'hex')),
    'success'
  );
END;
$$;

-- New OTP type for the self-service /enroll/erase flow (app/enroll/erase,
-- app/api/enroll/erase/*) -- kept distinct from 'recovery' for clearer
-- audit/rate-limit separation on an irreversible action.
ALTER TABLE huuid_otp_verifications DROP CONSTRAINT huuid_otp_verifications_otp_type_check;
ALTER TABLE huuid_otp_verifications ADD CONSTRAINT huuid_otp_verifications_otp_type_check
  CHECK (otp_type IN ('enrollment', 'recovery', 'login', 'erasure'));

-- Lookup used by /api/enroll/erase/confirm to find a patient's huuid by
-- phone before erasing -- returns nothing beyond huuid + status, no PII.
CREATE OR REPLACE FUNCTION huuid_get_patient_huuid_by_phone(p_phone text, p_pii_key text)
RETURNS TABLE (huuid text, status text)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
  SELECT huuid, status FROM huuid_patients
  WHERE phone_hash = encode(hmac(p_phone::bytea, p_pii_key::bytea, 'sha256'), 'hex');
$$;

REVOKE ALL ON FUNCTION huuid_get_patient_huuid_by_phone(text, text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION huuid_get_patient_huuid_by_phone(text, text) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION huuid_get_patient_huuid_by_phone(text, text) TO service_role;
