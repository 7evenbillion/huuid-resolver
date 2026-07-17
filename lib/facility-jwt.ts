import 'server-only';
import { importJWK, jwtVerify } from 'jose';
import { decodeEd25519PublicKeyMultibase } from '@/lib/multibase';

const RESOLVER_AUD = 'https://resolver.huuid.health';
const MAX_JWT_WINDOW_SECONDS = 300;

export interface FacilityJWTClaims {
  iss?: string;
  sub: string;
  aud: string | string[];
  iat: number;
  exp: number;
  jti: string;
  huuid_purpose?: string;
  huuid_facility_code?: string;
}

export type JWTVerificationResult =
  | { ok: true; claims: FacilityJWTClaims }
  | { ok: false; reason: string };

/**
 * Verifies a facility-signed Ed25519 JWT against the facility's registered
 * public key (HUUID-RESOLVER-API-v0.2). Checks signature, alg pinned to
 * EdDSA, aud, and the exp-iat <= 300s replay window.
 *
 * Does NOT check jti/sub against request headers — the caller compares
 * claims.sub to X-HUUID-Facility and claims.jti to X-HUUID-Request-ID.
 */
export async function verifyFacilityJWT(
  authorizationHeader: string | null,
  publicKeyMultibase: string
): Promise<JWTVerificationResult> {
  if (!authorizationHeader?.startsWith('Bearer ')) {
    return {
      ok: false,
      reason: 'Missing or malformed Authorization header. Expected: Bearer {JWT}.',
    };
  }
  const token = authorizationHeader.slice('Bearer '.length).trim();
  if (!token) {
    return { ok: false, reason: 'Empty bearer token.' };
  }

  const rawKey = decodeEd25519PublicKeyMultibase(publicKeyMultibase);
  if (!rawKey) {
    return { ok: false, reason: 'Facility public key is malformed.' };
  }

  let publicKey: Awaited<ReturnType<typeof importJWK>>;
  try {
    publicKey = await importJWK(
      { kty: 'OKP', crv: 'Ed25519', x: rawKey.toString('base64url') },
      'EdDSA'
    );
  } catch {
    return { ok: false, reason: 'Unable to import facility public key.' };
  }

  let claims: FacilityJWTClaims;
  try {
    const { payload } = await jwtVerify(token, publicKey, {
      audience: RESOLVER_AUD,
      algorithms: ['EdDSA'],
    });
    claims = payload as unknown as FacilityJWTClaims;
  } catch (err) {
    return {
      ok: false,
      reason:
        err instanceof Error
          ? `JWT verification failed: ${err.message}`
          : 'JWT verification failed.',
    };
  }

  if (typeof claims.iat !== 'number' || typeof claims.exp !== 'number') {
    return { ok: false, reason: 'JWT is missing iat or exp.' };
  }
  if (claims.exp - claims.iat > MAX_JWT_WINDOW_SECONDS) {
    return {
      ok: false,
      reason: `JWT expiry window exceeds ${MAX_JWT_WINDOW_SECONDS} seconds.`,
    };
  }
  if (!claims.jti) {
    return { ok: false, reason: 'JWT is missing jti.' };
  }

  return { ok: true, claims };
}
