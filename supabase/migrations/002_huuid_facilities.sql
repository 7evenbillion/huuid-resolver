-- ============================================================
-- HUUID Resolver — Migration 002: huuid_facilities
-- Facility registry used to verify Ed25519 JWT signatures
-- (HUUID-RESOLVER-API-v0.2).
-- ============================================================

CREATE TABLE huuid_facilities (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  facility_did          text UNIQUE NOT NULL,
  facility_name         text NOT NULL,
  certificate_status    text NOT NULL DEFAULT 'active'
                        CHECK (certificate_status IN ('active', 'suspended', 'revoked')),
  public_key_multibase  text NOT NULL,
  created_at            timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_huuid_facilities_facility_did ON huuid_facilities (facility_did);
CREATE INDEX idx_huuid_facilities_certificate_status ON huuid_facilities (certificate_status);

-- ── RLS: enabled. Zero anon/authenticated access — server-side only. ──
ALTER TABLE huuid_facilities ENABLE ROW LEVEL SECURITY;

-- No policies for anon or authenticated: RLS-enabled + no policy = denied.
-- service_role bypasses RLS; capabilities are constrained by GRANTs below.

-- GRANTs (MANDATORY post May 30 2026 — silent permission-denied without)
-- service_role: SELECT, INSERT, UPDATE (certificate status updates only). No DELETE.
GRANT SELECT, INSERT, UPDATE ON huuid_facilities TO service_role;
REVOKE ALL ON huuid_facilities FROM anon, authenticated;

-- ── Seed: one test facility, matching the test DID document's issuing_node ──
-- Public key only — the matching private key is held solely in the
-- HUUID_TEST_FACILITY_JWK environment variable (never committed) and used
-- only by /debug/resolver to sign demonstration JWTs.
INSERT INTO huuid_facilities (facility_did, facility_name, certificate_status, public_key_multibase)
VALUES (
  'did:huuid:gh:node-test-001',
  'HUUID Test Node 001',
  'active',
  'z6MkgAdWsNjj1cujLxeQxrXJpxeAedGeeAkC3cn8548akjR1'
)
ON CONFLICT (facility_did) DO NOTHING;
