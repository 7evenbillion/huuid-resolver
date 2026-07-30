import 'server-only';
import { generateKeyPairSync, createHash } from 'node:crypto';
import bs58 from 'bs58';
import { encodeEd25519PublicKeyMultibase } from '@/lib/multibase';

interface JwkPublic {
  kty: string;
  crv: string;
  x: string;
}

/**
 * Generates a fresh Ed25519 keypair server-side for a newly-approved
 * facility (Layer 3). Distinct from patient keypairs (lib/client/keypair.ts,
 * generated client-side, private key never touches the server) — facilities
 * are institutional identities the Root Authority issues on the facility's
 * behalf, so server-side generation + a one-time custodial download
 * (Layer 4) is the deliberate model here, matching the build brief.
 */
export function generateFacilityKeypair(): {
  publicKeyMultibase: string;
  publicKeyPem: string;
  privateKeyPem: string;
} {
  const { publicKey, privateKey } = generateKeyPairSync('ed25519');

  const publicJwk = publicKey.export({ format: 'jwk' }) as JwkPublic;
  const rawPublicKey = Buffer.from(publicJwk.x, 'base64url');

  return {
    publicKeyMultibase: encodeEd25519PublicKeyMultibase(rawPublicKey),
    publicKeyPem: publicKey.export({ type: 'spki', format: 'pem' }) as string,
    privateKeyPem: privateKey.export({ type: 'pkcs8', format: 'pem' }) as string,
  };
}

/**
 * did:huuid:[country-code]:[base58(sha256(facilityName + regNumber))],
 * per the build brief. NOTE: this differs from both
 * HUUID-RESOLUTION-SPEC-v0.3 §1.1 (hash of the entity's *public key*, not
 * personal/institutional data) and this codebase's own existing seeded
 * facility DIDs, which are human-readable slugs
 * (did:huuid:gh:node-test-001, did:huuid:gh:root-authority-hpwg) rather
 * than hashes at all. Implemented literally as the brief specified;
 * flagged rather than silently reconciled with either prior convention.
 */
export function generateFacilityDid(countryCode: string, facilityName: string, regNumber: string): string {
  const hash = createHash('sha256').update(facilityName + regNumber).digest();
  return `did:huuid:${countryCode.toLowerCase()}:${bs58.encode(hash)}`;
}
