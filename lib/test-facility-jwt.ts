import 'server-only';
import { SignJWT, importJWK, type JWTPayload } from 'jose';

const RESOLVER_AUD = 'https://resolver.huuid.health';

/**
 * Signs a JWT for the seeded test facility, using the private key held only
 * in HUUID_TEST_FACILITY_JWK (env var — never committed). Used exclusively
 * by /debug/resolver to demonstrate live JWT verification outcomes; not
 * reachable from any production resolution path.
 *
 * iat/exp are absolute epoch seconds set explicitly by the caller so tests
 * can construct edge cases (expired tokens, oversized windows) precisely.
 */
export async function signTestFacilityJWT(opts: {
  facilityDid: string;
  requestId: string;
  purposeCode: string;
  iat: number;
  exp: number;
}): Promise<string | null> {
  const jwkJson = process.env.HUUID_TEST_FACILITY_JWK;
  if (!jwkJson) return null;

  let jwk: { kty: string; crv: string; x: string; d: string };
  try {
    jwk = JSON.parse(jwkJson);
  } catch {
    return null;
  }

  const privateKey = await importJWK(jwk, 'EdDSA');

  const payload: JWTPayload = {
    iss: opts.facilityDid,
    sub: opts.facilityDid,
    aud: RESOLVER_AUD,
    iat: opts.iat,
    exp: opts.exp,
    jti: opts.requestId,
    huuid_purpose: opts.purposeCode,
    huuid_facility_code: 'GH-TEST-001',
  };

  return new SignJWT(payload)
    .setProtectedHeader({ alg: 'EdDSA', typ: 'JWT', kid: `${opts.facilityDid}#key-1` })
    .sign(privateKey);
}
