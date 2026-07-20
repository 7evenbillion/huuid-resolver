-- HUUID Resolver -- Migration 009: huuid_stub_integrity_log immutability
--
-- Gap 4, found while closing Gaps 1/2 (see docs/TECHNICAL-DECISIONS.md §11
-- in huuid-emr-stub and api.md "Stub Integrity" section): migration 006
-- deliberately left this table without an immutability trigger, reasoning
-- it was an operational/diagnostic log of self-reported, unverified
-- claims -- not evidentiary. Migration 007 closed the verification gap:
-- every row now passes EdDSA signature verification against the claimed
-- facility's public key before insert. That makes this a verified audit
-- trail, the same category as huuid_audit_log / huuid_bg_audit_log, both
-- of which already block UPDATE/DELETE at the database level. This table
-- was the odd one out. Matching their exact pattern.

CREATE OR REPLACE FUNCTION huuid_stub_integrity_log_immutable()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'huuid_stub_integrity_log is immutable: % is not permitted', TG_OP;
END;
$$;

CREATE TRIGGER trg_huuid_stub_integrity_log_no_update
  BEFORE UPDATE ON huuid_stub_integrity_log
  FOR EACH ROW EXECUTE FUNCTION huuid_stub_integrity_log_immutable();

CREATE TRIGGER trg_huuid_stub_integrity_log_no_delete
  BEFORE DELETE ON huuid_stub_integrity_log
  FOR EACH ROW EXECUTE FUNCTION huuid_stub_integrity_log_immutable();
