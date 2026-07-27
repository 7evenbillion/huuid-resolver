-- ============================================================
-- HUUID Resolver — Migration 015: erasure_completed audit action
--
-- Applied live to production during a GDPR erasure test (operator
-- request). The original 013 migration's huuid_gdpr_erase_patient()
-- performed the UPDATEs but never wrote any audit record at all -- a
-- real gap. huuid_audit_enrollment's CHECK constraint also only allowed
-- 'erasure_requested', not 'erasure_completed'. Both fixed here: the
-- constraint now allows 'erasure_completed', and the erasure function
-- writes its own immutable audit entry on every call.
-- ============================================================

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
    'erasure_completed'
  ));

-- Drop the old single-arg overload from migration 013 before redefining
-- with optional ip_hash/user_agent_hash params -- CREATE OR REPLACE does
-- not replace a function with a different signature, it adds an
-- overload, which makes a 1-arg call ambiguous once the 3-arg version
-- (with defaults) also exists.
DROP FUNCTION IF EXISTS huuid_gdpr_erase_patient(text);

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
    phone_hash = NULL,
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

REVOKE ALL ON FUNCTION huuid_gdpr_erase_patient(text, text, text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION huuid_gdpr_erase_patient(text, text, text) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION huuid_gdpr_erase_patient(text, text, text) TO service_role;
