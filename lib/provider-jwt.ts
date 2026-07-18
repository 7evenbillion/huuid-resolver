import 'server-only';
import { importJWK, jwtVerify } from 'jose';
import { decodeEd25519PublicKeyMultibase } from '@/lib/multibase';

const BREAK_GLASS_AUD = 'https://resolver.huuid.health/break-glass';
const MAX_JWT_WINDOW_SECONDS = 120; // half the standard facility JWT window — HUUID-BREAK-GLASS-API-v0.2 §3

export interface ProviderJWTClaims {
  iss: string; // individual clinician DID — NOT the facility DID
  aud: string | string[];
  iat: number;
  exp: number;
  jti?: string;
  huuid_facility?: string;
  huuid_reason_code?: string;
  huuid_license?: string;
}

export type ProviderJWTVerificationResult =
  | { ok: true; claims: ProviderJWTClaims }
  | { ok: false; reason: string };

/**
 * Verifies a clinician-signed Ed25519 ProviderJWT (HUUID-BREAK-GLASS-API-v0.2
 * §3). Separate from facility-jwt.ts: different audience
 * (.../break-glass, not .../resolver), a tighter 120s replay window (not
 * 300s), and the binding claim is `iss` (the clinician), not `sub`/`jti`
 * matched against facility headers.
 *
 * Month 3 simplification, explicitly sanctioned by the build spec: there is
 * no separate clinician key registry yet (Month 4+). The ProviderJWT is
 * verified against the same facility public key used for standard facility
 * JWTs (huuid_facilities.public_key_multibase).
 *
 * Does NOT check `iss` against providerCertificate.providerId or `jti`
 * against X-HUUID-Request-ID — the caller does that.
 */
export async function verifyProviderJWT(
  authorizationHeader: string | null,
  publicKeyMultibase: string
): Promise<ProviderJWTVerificationResult> {
  if (!authorizationHeader?.startsWith('Bearer ')) {
    return {
      ok: false,
      reason: 'Missing or malformed Authorization header. Expected: Bearer {ProviderJWT}.',
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

  let claims: ProviderJWTClaims;
  try {
    const { payload } = await jwtVerify(token, publicKey, {
      audience: BREAK_GLASS_AUD,
      algorithms: ['EdDSA'],
    });
    claims = payload as unknown as ProviderJWTClaims;
  } catch (err) {
    return {
      ok: false,
      reason:
        err instanceof Error
          ? `ProviderJWT verification failed: ${err.message}`
          : 'ProviderJWT verification failed.',
    };
  }

  if (typeof claims.iat !== 'number' || typeof claims.exp !== 'number') {
    return { ok: false, reason: 'ProviderJWT is missing iat or exp.' };
  }
  if (claims.exp - claims.iat > MAX_JWT_WINDOW_SECONDS) {
    return {
      ok: false,
      reason: `ProviderJWT expiry window exceeds ${MAX_JWT_WINDOW_SECONDS} seconds.`,
    };
  }
  if (!claims.iss) {
    return { ok: false, reason: 'ProviderJWT is missing iss (clinician DID).' };
  }

  return { ok: true, claims };
}
