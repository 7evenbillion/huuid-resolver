import bs58 from 'bs58';

/**
 * Client-side Ed25519 keypair generation, encryption, and HUUID/DID
 * Document construction — runs entirely in the browser via Web Crypto.
 * The raw private key is never sent anywhere; only encrypted_private_key
 * (+ salt + iv) leaves the browser, in the POST to /api/enroll/register.
 *
 * PBKDF2_ITERATIONS = 310,000 (OWASP 2024 minimum) is the floor here, not
 * a ceiling anyone should raise casually — it's already a deliberate
 * multi-hundred-millisecond cost on low-end Android hardware, chosen to
 * match this project's Africa-first device baseline (see CLAUDE.md
 * §Africa Resilience Architecture, "Chrome 80+ minimum").
 */

export const PBKDF2_ITERATIONS = 310_000;
const ED25519_MULTICODEC_PREFIX = new Uint8Array([0xed, 0x01]);

export interface KeygenResult {
  huuid: string;
  didDocument: Record<string, unknown>;
  encryptedPrivateKeyB64: string; // iv || ciphertext, base64
  pbkdf2SaltB64: string;
  pbkdf2IvB64: string;
}

/** WebCrypto Ed25519 support probe — real, measured support is inconsistent on older Android Chrome/WebView (see HANDOFF.md report on this build). */
export async function isEd25519Supported(): Promise<boolean> {
  try {
    await window.crypto.subtle.generateKey({ name: 'Ed25519' }, false, ['sign', 'verify']);
    return true;
  } catch {
    return false;
  }
}

export function bytesToBase64(bytes: Uint8Array): string {
  let binary = '';
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
  return btoa(binary);
}

function multibaseEncodePublicKey(rawPublicKey: Uint8Array): string {
  const prefixed = new Uint8Array(ED25519_MULTICODEC_PREFIX.length + rawPublicKey.length);
  prefixed.set(ED25519_MULTICODEC_PREFIX, 0);
  prefixed.set(rawPublicKey, ED25519_MULTICODEC_PREFIX.length);
  return 'z' + bs58.encode(prefixed);
}

/**
 * Derives the AES-256-GCM encryption key. If `prfKey` is supplied (from a
 * WebAuthn PRF extension result), it's imported directly as high-entropy
 * key material. Otherwise the PIN is stretched via PBKDF2-SHA256.
 */
async function deriveEncryptionKey(secret: string | Uint8Array, salt: Uint8Array): Promise<CryptoKey> {
  if (secret instanceof Uint8Array) {
    return window.crypto.subtle.importKey('raw', secret as BufferSource, { name: 'AES-GCM' }, false, ['encrypt']);
  }

  const keyMaterial = await window.crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret) as BufferSource,
    'PBKDF2',
    false,
    ['deriveKey']
  );

  return window.crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt: salt as BufferSource, iterations: PBKDF2_ITERATIONS, hash: 'SHA-256' },
    keyMaterial,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt']
  );
}

/**
 * Generates the Ed25519 keypair, builds the HUUID string + DID Document,
 * and encrypts the private key with the supplied secret (PIN string, or
 * WebAuthn PRF bytes). Zeroes the raw private key bytes before returning.
 */
export async function generateHuuidIdentity(input: {
  countryCode: string;
  webauthnCredentialId: string | null;
  encryptionSecret: string | Uint8Array; // PIN string, or PRF-derived key bytes
}): Promise<KeygenResult> {
  // STEP 1-3: generate keypair, export private (pkcs8) and public (raw) bytes.
  const keyPair = await window.crypto.subtle.generateKey({ name: 'Ed25519' }, true, ['sign', 'verify']);
  let privateKeyBytes = new Uint8Array(await window.crypto.subtle.exportKey('pkcs8', keyPair.privateKey));
  const publicKeyBytes = new Uint8Array(await window.crypto.subtle.exportKey('raw', keyPair.publicKey));

  // STEP 4-5: random salt (256 bits) and IV (96 bits).
  const salt = window.crypto.getRandomValues(new Uint8Array(32));
  const iv = window.crypto.getRandomValues(new Uint8Array(12));

  // STEP 6-7: derive the AES-256-GCM key.
  const encryptionKey = await deriveEncryptionKey(input.encryptionSecret, salt);

  // STEP 8: encrypt the private key.
  const encryptedBuffer = await window.crypto.subtle.encrypt({ name: 'AES-GCM', iv }, encryptionKey, privateKeyBytes);

  // STEP 12: zero the raw private key from memory immediately after encryption, before anything else touches it.
  privateKeyBytes.fill(0);
  privateKeyBytes = new Uint8Array(0);

  // STEP 9: encode ciphertext (iv prefixed) and salt for storage/transport.
  const encryptedPrivateKeyB64 = bytesToBase64(new Uint8Array(encryptedBuffer));
  const pbkdf2SaltB64 = bytesToBase64(salt);
  const pbkdf2IvB64 = bytesToBase64(iv);

  // STEP 10: HUUID string — did:huuid:{cc}:{base58(sha256(rawPublicKey))}.
  // Uses lib/multibase.ts's own multicodec-prefixed encoding for
  // publicKeyMultibase (matching the resolver's existing verification
  // logic exactly), NOT the brief's simplified "z + base58(pubkey)" —
  // omitting the multicodec prefix would produce a DID Document the
  // resolver's own decodeEd25519PublicKeyMultibase() couldn't parse.
  const hashBuffer = await window.crypto.subtle.digest('SHA-256', publicKeyBytes);
  const huuid = `did:huuid:${input.countryCode.toLowerCase()}:${bs58.encode(new Uint8Array(hashBuffer))}`;

  // STEP 11: DID Document.
  const didDocument: Record<string, unknown> = {
    '@context': ['https://www.w3.org/ns/did/v1', 'https://huuid.health/contexts/v1'],
    id: huuid,
    verificationMethod: [
      {
        id: `${huuid}#key-1`,
        type: 'Ed25519VerificationKey2020',
        controller: huuid,
        publicKeyMultibase: multibaseEncodePublicKey(publicKeyBytes),
      },
    ],
    authentication: [`${huuid}#key-1`],
    'huuid:status': 'active',
    'huuid:verificationTier': 1,
    'huuid:enrollmentType': 'self-enrolled',
    'huuid:issuedAt': new Date().toISOString(),
  };

  return { huuid, didDocument, encryptedPrivateKeyB64, pbkdf2SaltB64, pbkdf2IvB64 };
}

const OBVIOUS_PIN_PATTERNS = ['123456', '000000', '111111', '222222', '333333', '444444', '555555', '666666', '777777', '888888', '999999', '654321', '121212'];

export function isObviousPin(pin: string): boolean {
  return OBVIOUS_PIN_PATTERNS.includes(pin);
}

export function base64ToBytes(b64: string): Uint8Array {
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

/**
 * Recovery flow: attempts to decrypt the (already AES-GCM-encrypted)
 * private key blob fetched from the server, using a PIN the user just
 * entered. Succeeds only if it's genuinely their original PIN -- a
 * "new" PIN cannot decrypt a blob encrypted under a different one, which
 * is the whole point (see app/enroll/recover/page.tsx). The decrypted
 * bytes are never returned, stored, or used for anything beyond proving
 * success/failure -- they're zeroed immediately after the check.
 */
export async function attemptDecryptPrivateKey(input: {
  encryptedPrivateKeyB64: string;
  pbkdf2SaltB64: string;
  pbkdf2IvB64: string;
  pin: string;
}): Promise<boolean> {
  try {
    const salt = base64ToBytes(input.pbkdf2SaltB64);
    const iv = base64ToBytes(input.pbkdf2IvB64);
    const ciphertext = base64ToBytes(input.encryptedPrivateKeyB64);

    const keyMaterial = await window.crypto.subtle.importKey(
      'raw',
      new TextEncoder().encode(input.pin),
      'PBKDF2',
      false,
      ['deriveKey']
    );
    const decryptionKey = await window.crypto.subtle.deriveKey(
      { name: 'PBKDF2', salt: salt as BufferSource, iterations: PBKDF2_ITERATIONS, hash: 'SHA-256' },
      keyMaterial,
      { name: 'AES-GCM', length: 256 },
      false,
      ['decrypt']
    );

    const plaintext = new Uint8Array(
      await window.crypto.subtle.decrypt({ name: 'AES-GCM', iv: iv as BufferSource }, decryptionKey, ciphertext as BufferSource)
    );
    plaintext.fill(0);
    return true;
  } catch {
    return false;
  }
}

/**
 * my-huuid Layer 8 (Change PIN): decrypts the private key with the
 * current PIN, then re-encrypts it under a NEW PIN with a fresh random
 * salt and IV -- a new PIN, by AES-GCM's construction, cannot decrypt a
 * blob encrypted under the old one, so the only way to "change" it is to
 * decrypt-then-re-encrypt. The raw private key bytes only ever exist in
 * this function's local scope (never returned, never sent anywhere) and
 * are zeroed immediately after re-encryption -- only the new encrypted
 * blob + salt + iv are returned, matching the same "raw key never leaves
 * the browser" rule as generateHuuidIdentity. Returns null on any
 * failure (wrong current PIN, corrupt data) -- the caller shows
 * "Incorrect current PIN."
 */
export async function reencryptPrivateKeyWithNewPin(input: {
  encryptedPrivateKeyB64: string;
  pbkdf2SaltB64: string;
  pbkdf2IvB64: string;
  currentPin: string;
  newPin: string;
}): Promise<{ encryptedPrivateKeyB64: string; pbkdf2SaltB64: string; pbkdf2IvB64: string } | null> {
  try {
    const oldSalt = base64ToBytes(input.pbkdf2SaltB64);
    const oldIv = base64ToBytes(input.pbkdf2IvB64);
    const ciphertext = base64ToBytes(input.encryptedPrivateKeyB64);

    const oldKeyMaterial = await window.crypto.subtle.importKey(
      'raw',
      new TextEncoder().encode(input.currentPin),
      'PBKDF2',
      false,
      ['deriveKey']
    );
    const decryptionKey = await window.crypto.subtle.deriveKey(
      { name: 'PBKDF2', salt: oldSalt as BufferSource, iterations: PBKDF2_ITERATIONS, hash: 'SHA-256' },
      oldKeyMaterial,
      { name: 'AES-GCM', length: 256 },
      false,
      ['decrypt']
    );

    let privateKeyBytes = new Uint8Array(
      await window.crypto.subtle.decrypt({ name: 'AES-GCM', iv: oldIv as BufferSource }, decryptionKey, ciphertext as BufferSource)
    );

    const newSalt = window.crypto.getRandomValues(new Uint8Array(32));
    const newIv = window.crypto.getRandomValues(new Uint8Array(12));
    const encryptionKey = await deriveEncryptionKey(input.newPin, newSalt);
    const encryptedBuffer = await window.crypto.subtle.encrypt(
      { name: 'AES-GCM', iv: newIv },
      encryptionKey,
      privateKeyBytes
    );

    privateKeyBytes.fill(0);
    privateKeyBytes = new Uint8Array(0);

    return {
      encryptedPrivateKeyB64: bytesToBase64(new Uint8Array(encryptedBuffer)),
      pbkdf2SaltB64: bytesToBase64(newSalt),
      pbkdf2IvB64: bytesToBase64(newIv),
    };
  } catch {
    return null;
  }
}

/**
 * my-huuid Layer 1 (PIN login): decrypts the private key with the entered
 * PIN, then immediately uses it to sign a server-issued nonce, returning
 * only the signature -- the decrypted private key bytes never leave this
 * function and are zeroed right after signing. The server verifies the
 * signature against the patient's already-public DID Document key
 * (POST /api/my-huuid/login/pin/verify) as cryptographic proof of PIN
 * knowledge, rather than trusting a client-asserted "decrypt succeeded"
 * boolean, which anyone could fake. Returns null on any failure (wrong
 * PIN, corrupt data) -- the caller shows "Incorrect PIN."
 */
export async function decryptAndSignChallenge(input: {
  encryptedPrivateKeyB64: string;
  pbkdf2SaltB64: string;
  pbkdf2IvB64: string;
  pin: string;
  nonceB64: string;
}): Promise<string | null> {
  try {
    const salt = base64ToBytes(input.pbkdf2SaltB64);
    const iv = base64ToBytes(input.pbkdf2IvB64);
    const ciphertext = base64ToBytes(input.encryptedPrivateKeyB64);
    const nonce = base64ToBytes(input.nonceB64);

    const keyMaterial = await window.crypto.subtle.importKey(
      'raw',
      new TextEncoder().encode(input.pin),
      'PBKDF2',
      false,
      ['deriveKey']
    );
    const decryptionKey = await window.crypto.subtle.deriveKey(
      { name: 'PBKDF2', salt: salt as BufferSource, iterations: PBKDF2_ITERATIONS, hash: 'SHA-256' },
      keyMaterial,
      { name: 'AES-GCM', length: 256 },
      false,
      ['decrypt']
    );

    const pkcs8Bytes = new Uint8Array(
      await window.crypto.subtle.decrypt({ name: 'AES-GCM', iv: iv as BufferSource }, decryptionKey, ciphertext as BufferSource)
    );

    const privateKey = await window.crypto.subtle.importKey('pkcs8', pkcs8Bytes as BufferSource, { name: 'Ed25519' }, false, ['sign']);
    const signatureBuffer = await window.crypto.subtle.sign('Ed25519', privateKey, nonce as BufferSource);

    pkcs8Bytes.fill(0);
    return bytesToBase64(new Uint8Array(signatureBuffer));
  } catch {
    return null;
  }
}
