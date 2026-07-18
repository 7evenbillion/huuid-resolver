import 'server-only';
import { createHash, createPrivateKey, sign as cryptoSign } from 'node:crypto';
import { SignJWT, importJWK, type JWTPayload } from 'jose';
import { canonicalJsonStringify } from '@/lib/canonical-json';

const BREAK_GLASS_AUD = 'https://resolver.huuid.health/break-glass';

/**
 * Test-only signing helpers for /debug/break-glass, using the private key
 * held solely in HUUID_TEST_FACILITY_JWK (never committed). Mirrors
 * lib/test-facility-jwt.ts. Never reachable from any production
 * Break-Glass request path.
 */

function loadTestJwk(): { kty: string; crv: string; x: string; d: string } | null {
  const jwkJson = process.env.HUUID_TEST_FACILITY_JWK;
  if (!jwkJson) return null;
  try {
    return JSON.parse(jwkJson);
  } catch {
    return null;
  }
}

/** Signs a ProviderJWT for a test clinician. iat/exp are absolute epoch seconds. */
export async function signTestProviderJWT(opts: {
  clinicianDid: string;
  facilityDid: string;
  requestId: string;
  reasonCode: string;
  license: string;
  iat: number;
  exp: number;
}): Promise<string | null> {
  const jwk = loadTestJwk();
  if (!jwk) return null;

  const privateKey = await importJWK(jwk, 'EdDSA');

  const payload: JWTPayload = {
    iss: opts.clinicianDid,
    aud: BREAK_GLASS_AUD,
    iat: opts.iat,
    exp: opts.exp,
    jti: opts.requestId,
    huuid_facility: opts.facilityDid,
    huuid_reason_code: opts.reasonCode,
    huuid_license: opts.license,
  };

  return new SignJWT(payload)
    .setProtectedHeader({ alg: 'EdDSA', typ: 'JWT', kid: `${opts.clinicianDid}#key-1` })
    .sign(privateKey);
}

/**
 * Signs a Break-Glass requestSignature over the canonical JSON of the given
 * body (which must NOT include a requestSignature field). Returns
 * base64url(EdDSA_sign(SHA256(canonical_json(body)))), matching
 * lib/bg-request-signature.ts's verification exactly.
 */
export function signTestBGRequestSignature(bodyWithoutSignature: unknown): string | null {
  const jwk = loadTestJwk();
  if (!jwk) return null;

  const privateKey = createPrivateKey({
    key: { kty: 'OKP', crv: 'Ed25519', x: jwk.x, d: jwk.d },
    format: 'jwk',
  });

  const canonical = canonicalJsonStringify(bodyWithoutSignature);
  const hash = createHash('sha256').update(canonical).digest();
  const signature = cryptoSign(null, hash, privateKey);
  return signature.toString('base64url');
}
