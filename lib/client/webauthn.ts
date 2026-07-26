/**
 * WebAuthn feature detection + credential creation, browser-side only.
 *
 * HONEST LIMITATION (see HANDOFF.md report on this build): real symmetric
 * key material out of a platform authenticator requires the WebAuthn PRF
 * extension, which is NOT universally supported (inconsistent across
 * Android Chrome versions and Safari releases as of this build). Where PRF
 * output is available, it is used directly as high-entropy AES-256-GCM
 * key material (skipping PBKDF2 -- stretching already-uniform 32 bytes
 * another 310,000 times adds no real security margin). Where it is not
 * available, a WebAuthn credential is still created (so the platform
 * biometric gates a future "quick unlock" convenience prompt), but the PIN
 * remains the actual encryption secret -- exactly like the PIN-only path.
 * This means a PIN is effectively always required today, contrary to what
 * the brief's Path A implies (biometric alone, no PIN). Field-test PRF
 * support before relying on "biometric replaces PIN" in any pilot
 * messaging.
 */

const PRF_SALT = new TextEncoder().encode('huuid-enrollment-prf-v1');

export async function isWebAuthnPlatformAvailable(): Promise<boolean> {
  if (typeof window === 'undefined') return false;
  if (!window.PublicKeyCredential) return false;
  try {
    const available = await window.PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable();
    return available === true;
  } catch {
    return false;
  }
}

export interface WebAuthnResult {
  credentialId: string; // base64url
  prfKey: Uint8Array | null; // 32 bytes if the PRF extension returned usable output, else null
}

/**
 * `identifier` is an opaque per-enrollment handle (a random UUID generated
 * by the caller) — WebAuthn's user.id doesn't need to be the final HUUID,
 * and requiring it to be would force credential creation to happen after
 * key generation for no real reason.
 */
export async function createWebAuthnCredential(identifier: string): Promise<WebAuthnResult | null> {
  if (typeof window === 'undefined' || !window.PublicKeyCredential) return null;

  const challenge = window.crypto.getRandomValues(new Uint8Array(32));
  const userId = new TextEncoder().encode(identifier);

  try {
    const credential = (await navigator.credentials.create({
      publicKey: {
        challenge,
        rp: { name: 'HUUID Healthcare Identity' },
        user: { id: userId, name: identifier, displayName: 'HUUID Patient' },
        pubKeyCredParams: [
          { type: 'public-key', alg: -8 }, // Ed25519
          { type: 'public-key', alg: -7 }, // ES256 fallback for authenticators without Ed25519 support
        ],
        authenticatorSelection: { authenticatorAttachment: 'platform', userVerification: 'required' },
        timeout: 60000,
        extensions: { prf: { eval: { first: PRF_SALT } } } as AuthenticationExtensionsClientInputs,
      },
    })) as PublicKeyCredential | null;

    if (!credential) return null;

    const rawIdBytes = Array.from(new Uint8Array(credential.rawId), (b) => String.fromCharCode(b)).join('');
    const credentialId = btoa(rawIdBytes).replace(/[+/=]/g, (c) => ({ '+': '-', '/': '_', '=': '' }[c] ?? c));

    const extResults = credential.getClientExtensionResults() as {
      prf?: { results?: { first?: ArrayBuffer } };
    };
    const prfFirst = extResults.prf?.results?.first;
    const prfKey = prfFirst ? new Uint8Array(prfFirst).slice(0, 32) : null;

    return { credentialId, prfKey };
  } catch {
    // User cancelled, no authenticator, or the browser rejected the request -- treat as "not available" and let the caller fall back to the PIN path.
    return null;
  }
}
