import 'server-only';
import { createPublicKey, verify as cryptoVerify } from 'node:crypto';
import { decodeEd25519PublicKeyMultibase } from '@/lib/multibase';

export type StubIntegritySignatureResult = { ok: true } | { ok: false; reason: string };

/**
 * Verifies a Stub integrity alert's `signature` field: base64url(EdDSA_sign(
 * facility private key, UTF-8 bytes of manifestHash)) -- see
 * huuid-emr-stub's integrity-manifest.ts (signManifestHash/
 * verifyManifestSignature). Deliberately NOT the Break-Glass pattern
 * (SHA-256 of a canonical-JSON body first, see bg-request-signature.ts):
 * the Stub signs the raw UTF-8 bytes of the manifestHash string directly,
 * with no pre-hash, so verification here must operate on the exact same
 * bytes or every signature will fail to verify even when genuinely valid.
 */
export function verifyStubIntegritySignature(
  manifestHash: string,
  signatureBase64Url: string,
  publicKeyMultibase: string
): StubIntegritySignatureResult {
  const rawKey = decodeEd25519PublicKeyMultibase(publicKeyMultibase);
  if (!rawKey) {
    return { ok: false, reason: 'Facility public key is malformed.' };
  }

  let signature: Buffer;
  try {
    signature = Buffer.from(signatureBase64Url, 'base64url');
  } catch {
    return { ok: false, reason: 'signature is not valid base64url.' };
  }
  if (signature.length === 0) {
    return { ok: false, reason: 'signature is empty.' };
  }

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
    valid = cryptoVerify(null, Buffer.from(manifestHash, 'utf8'), keyObject, signature);
  } catch {
    return { ok: false, reason: 'Signature verification threw an error.' };
  }

  if (!valid) {
    return { ok: false, reason: 'signature does not verify against the facility public key.' };
  }
  return { ok: true };
}
