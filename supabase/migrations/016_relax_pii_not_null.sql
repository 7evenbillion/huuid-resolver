-- ============================================================
-- HUUID Resolver — Migration 016: relax NOT NULL on erasable PII columns
--
-- Applied live to production immediately after 015, when
-- huuid_gdpr_erase_patient() was actually run for the first time and hit
-- a real NOT NULL constraint violation -- migration 013 defined
-- full_name_enc, date_of_birth_enc, sex_at_birth_enc, phone_hash,
-- phone_enc, encrypted_private_key, pbkdf2_salt, and pbkdf2_iv as
-- NOT NULL (correct at enrollment time), but the erasure function needs
-- to null every one of them out, which is impossible under the original
-- constraint. The UPDATE failed atomically (no partial write -- single
-- statement, rolled back cleanly) but the erasure itself could not
-- complete until this was fixed.
-- ============================================================

ALTER TABLE huuid_patients
  ALTER COLUMN full_name_enc DROP NOT NULL,
  ALTER COLUMN date_of_birth_enc DROP NOT NULL,
  ALTER COLUMN sex_at_birth_enc DROP NOT NULL,
  ALTER COLUMN phone_hash DROP NOT NULL,
  ALTER COLUMN phone_enc DROP NOT NULL,
  ALTER COLUMN encrypted_private_key DROP NOT NULL,
  ALTER COLUMN pbkdf2_salt DROP NOT NULL,
  ALTER COLUMN pbkdf2_iv DROP NOT NULL;
