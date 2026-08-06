-- ============================================================
-- HUUID Resolver — Migration 031: my-huuid Layer 8, security settings
--
-- identity_verified* columns are new -- nothing in this codebase sets
-- them yet (Smile ID biometric verification is explicitly out of scope
-- for this build, a separate upcoming task). Every current patient is
-- Tier 1 self-enrolled, so identity_verified defaults false and every
-- existing row genuinely reads as "not verified" -- not a placeholder
-- value pretending otherwise. Kept as plain columns (like the existing
-- verification_tier), not pgp_sym_encrypt'd -- verification metadata
-- about *how* identity was confirmed, not the PII itself.
-- ============================================================

ALTER TABLE huuid_patients
  ADD COLUMN identity_verified boolean NOT NULL DEFAULT false,
  ADD COLUMN identity_verified_method text,
  ADD COLUMN identity_verified_at timestamptz,
  ADD COLUMN identity_document_type text,
  ADD COLUMN identity_document_country text;

-- New audit action for PIN changes.
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
    'erasure_completed',
    'medical_profile_updated',
    'profile_updated',
    'pin_changed'
  ));
