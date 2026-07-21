import 'server-only';

/**
 * The Root Authority's (HUUID Protocol Working Group, josephtdnarnor@
 * gmail.com) own facility identity — seeded in huuid_facilities like any
 * other facility (Month 5, GET /1.0/audit/{huuid}) so its JWT verifies
 * through the identical code path every other facility uses. No special
 * signature-verification logic anywhere; only a special QUERY SCOPE is
 * granted once this specific, normally-verified identity is established.
 * Shared here so every endpoint that grants elevated access to this
 * identity (the audit endpoint, /api/health) compares against the same
 * constant rather than each hardcoding its own copy.
 */
export const ROOT_AUTHORITY_FACILITY_DID = 'did:huuid:gh:root-authority-hpwg';
