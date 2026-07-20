import { NextResponse } from 'next/server';
import { encodeEd25519PublicKeyMultibase } from '@/lib/multibase';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

// Month 4, QR verification (tier 4 offline fallback). Public, unauthenticated
// by design -- a Stub with no internet still needs to have fetched this once
// while it had connectivity, and any clinician's phone or browser should be
// able to sanity-check a card's issuer key without a credential.

const KEY_ID = 'huuid-resolver-gh-v1';

// No key-issuance ledger exists yet -- this is the date this key was wired
// into the resolver for the shared test/build environment, hardcoded because
// there is nowhere else to read it from. A real key-rotation/issuance record
// is a pre-pilot item; see docs.
const VALID_FROM = '2026-07-20T00:00:00.000Z';

export async function GET() {
  // Known, deliberate simplification for this build stage: HUUID_TEST_FACILITY_JWK
  // is the ONLY signing keypair that exists in this environment, so it is being
  // reused here as a stand-in for what production needs to be a distinct
  // resolver-owned signing keypair (used only to sign patient QR cards at
  // enrollment, never a facility's own key). That means this endpoint
  // currently publishes the exact same public key as the seeded test
  // facility in huuid_facilities. See docs/TECHNICAL-DECISIONS.md and
  // huuid-emr-stub's QR verification notes for what this means for testing
  // vs. production.
  const jwkJson = process.env.HUUID_TEST_FACILITY_JWK;
  if (!jwkJson) {
    return NextResponse.json({ error: 'resolver signing key not configured' }, { status: 500 });
  }

  let jwk: { x?: string };
  try {
    jwk = JSON.parse(jwkJson);
  } catch {
    return NextResponse.json({ error: 'resolver signing key malformed' }, { status: 500 });
  }
  if (!jwk.x) {
    return NextResponse.json({ error: 'resolver signing key malformed' }, { status: 500 });
  }

  const rawPublicKey = Buffer.from(jwk.x, 'base64url');
  const publicKeyMultibase = encodeEd25519PublicKeyMultibase(rawPublicKey);

  return NextResponse.json({
    publicKeyMultibase,
    keyId: KEY_ID,
    validFrom: VALID_FROM,
    algorithm: 'Ed25519',
  });
}
