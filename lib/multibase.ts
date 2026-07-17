import bs58 from 'bs58';

const ED25519_MULTICODEC_PREFIX = Buffer.from([0xed, 0x01]);

/** Decodes a multibase base58btc ('z...') Ed25519 public key to its raw 32 bytes. */
export function decodeEd25519PublicKeyMultibase(multibase: string): Buffer | null {
  if (!multibase.startsWith('z')) return null;

  let decoded: Buffer;
  try {
    decoded = Buffer.from(bs58.decode(multibase.slice(1)));
  } catch {
    return null;
  }

  if (decoded.length !== 34) return null;
  if (
    decoded[0] !== ED25519_MULTICODEC_PREFIX[0] ||
    decoded[1] !== ED25519_MULTICODEC_PREFIX[1]
  ) {
    return null;
  }
  return decoded.subarray(2);
}

/** Encodes a raw 32-byte Ed25519 public key as a multibase base58btc string. */
export function encodeEd25519PublicKeyMultibase(rawPublicKey: Buffer): string {
  return 'z' + bs58.encode(Buffer.concat([ED25519_MULTICODEC_PREFIX, rawPublicKey]));
}
