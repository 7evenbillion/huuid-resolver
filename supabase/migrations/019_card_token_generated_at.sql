-- ============================================================
-- HUUID Resolver — Migration 019: card_token_generated_at
--
-- Tracks when the QR token currently associated with a patient's card
-- was last (re)generated -- compared against medical_profile_updated_at
-- (migration 018) to detect a downloaded/printed card that no longer
-- reflects the patient's latest medical data. Set by every code path
-- that generates a fresh QR token: /api/enroll/register (base token),
-- /api/enroll/medical (initial profile save), and /api/patient/medical
-- (future return-visit updates) -- not just the last of these, so the
-- staleness check is meaningful from first enrollment onward rather
-- than only after a return-visit edit.
--
-- Not nulled by huuid_gdpr_erase_patient(): a plain timestamp, same
-- treatment as medical_profile_updated_at/created_at/updated_at, none
-- of which migration 018's erasure function nulls either.
-- ============================================================

ALTER TABLE huuid_patients
  ADD COLUMN card_token_generated_at timestamptz;

-- Re-stated for explicitness (already covered by migration 013's
-- table-level GRANT, which extends automatically to new columns on the
-- same table).
GRANT SELECT, INSERT, UPDATE ON huuid_patients TO service_role;
