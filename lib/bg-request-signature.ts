import 'server-only';
import { createHash, createPublicKey, verify as cryptoVerify } from 'node:crypto';
import { decodeEd25519PublicKeyMultibase } from '@/lib/multibase';
import { canonicalJsonStringify } from '@/lib/canonical-json';

export type BGSignatureResult = { ok: true } | { ok: false; reason: string };

/**
 * Verifies a Break-Glass requestSignature: base64url(EdDSA_sign(clinician
 * private key, SHA256(canonical_json(body_minus_requestSignature)))) —
 * HUUID-BREAK-GLASS-API-v0.2 §2.1. Raw Ed25519 signature verification (not
 * a JWT), so this uses Node's crypto.verify directly rather than jose.
 *
 * Month 3: verified against the requesting facility's public key (see
 * lib/provider-jwt.ts for the same simplification, sanctioned until
 * per-clinician key management ships in Month 4+).
 */
export function verifyBGRequestSignature(
  bodyWithoutSignature: unknown,
  requestSignatureBase64Url: string,
  publicKeyMultibase: string
): BGSignatureResult {
  const rawKey = decodeEd25519PublicKeyMultibase(publicKeyMultibase);
  if (!rawKey) {
    return { ok: false, reason: 'Facility public key is malformed.' };
  }

  let signature: Buffer;
  try {
    signature = Buffer.from(requestSignatureBase64Url, 'base64url');
  } catch {
    return { ok: false, reason: 'requestSignature is not valid base64url.' };
  }
  if (signature.length === 0) {
    return { ok: false, reason: 'requestSignature is empty.' };
  }

  const canonical = canonicalJsonStringify(bodyWithoutSignature);
  const hash = createHash('sha256').update(canonical).digest();

  let keyObject;
  try {
    keyObject = createPublicKey({
      key: { kty: 'OKP', crv: 'Ed25519', x: rawKey.toString('base64url') },
      format: 'jwk',
    });
  } catch {
    return { ok: false, reason: 'Unable to import facility public key.' };
  }

  let valid: boolean;
  try {
    // Ed25519 has its own internal hashing (SHA-512) — algorithm is null.
    valid = cryptoVerify(null, hash, keyObject, signature);
  } catch {
    return { ok: false, reason: 'Signature verification threw an error.' };
  }

  if (!valid) {
    return {
      ok: false,
      reason: 'requestSignature does not verify against the facility public key.',
    };
  }
  return { ok: true };
}
