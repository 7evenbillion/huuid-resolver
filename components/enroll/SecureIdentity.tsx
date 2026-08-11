'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import EnrollLayout from '@/components/enroll/EnrollLayout';
import Icon from '@/components/Icon';
import { isWebAuthnPlatformAvailable, createWebAuthnCredential } from '@/lib/client/webauthn';
import { isEd25519Supported, generateHuuidIdentity, isObviousPin } from '@/lib/client/keypair';

type Stage = 'loading' | 'choose' | 'pin' | 'creating' | 'unsupported';

export default function SecureIdentity() {
  const router = useRouter();
  const [stage, setStage] = useState<Stage>('loading');
  const [countryCode, setCountryCode] = useState('gh');
  const [webauthnAvailable, setWebauthnAvailable] = useState(false);
  const [webauthnNote, setWebauthnNote] = useState<string | null>(null);
  const [prfKey, setPrfKey] = useState<Uint8Array | null>(null);
  const [webauthnCredentialId, setWebauthnCredentialId] = useState<string | null>(null);
  const [pin, setPin] = useState('');
  const [confirmPin, setConfirmPin] = useState('');
  const [showExplain, setShowExplain] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      const res = await fetch('/api/enroll/session-status');
      if (!res.ok) {
        router.replace('/enroll');
        return;
      }
      const data = await res.json();
      if (!data.phoneVerified) {
        router.replace('/enroll/verify');
        return;
      }
      setCountryCode((data.countryCode ?? 'gh').toLowerCase());

      const ed25519Ok = await isEd25519Supported();
      if (!ed25519Ok) {
        setStage('unsupported');
        return;
      }

      const webauthnOk = await isWebAuthnPlatformAvailable();
      setWebauthnAvailable(webauthnOk);
      setStage('choose');
    })();
  }, [router]);

  async function handleBiometricSetup() {
    setError(null);
    const identifier = crypto.randomUUID();
    const result = await createWebAuthnCredential(identifier);
    if (!result) {
      setWebauthnNote('Could not set up biometric protection on this device. Please use a PIN instead.');
      setStage('pin');
      return;
    }
    setWebauthnCredentialId(result.credentialId);
    if (result.prfKey) {
      setPrfKey(result.prfKey);
      // High-entropy key material already available -- no PIN needed. Proceed straight to creation.
      await createIdentity(result.prfKey, result.credentialId);
    } else {
      setWebauthnNote(
        'Biometric set up. This device also needs a PIN as a backup unlock method, since it doesn’t yet support deriving encryption keys directly from your biometric.'
      );
      setStage('pin');
    }
  }

  const pinValid = /^\d{6}$/.test(pin) && pin === confirmPin;

  async function handlePinSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!pinValid) return;
    await createIdentity(pin, webauthnCredentialId);
  }

  async function createIdentity(secret: string | Uint8Array, credentialId: string | null) {
    setStage('creating');
    setError(null);
    try {
      const result = await generateHuuidIdentity({
        countryCode,
        webauthnCredentialId: credentialId,
        encryptionSecret: secret,
      });

      const res = await fetch('/api/enroll/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          huuid: result.huuid,
          did_document: result.didDocument,
          encrypted_private_key: result.encryptedPrivateKeyB64,
          pbkdf2_salt: result.pbkdf2SaltB64,
          pbkdf2_iv: result.pbkdf2IvB64,
          webauthn_credential_id: credentialId,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? 'Could not complete enrollment. Please try again.');
        setStage(webauthnAvailable && !prfKey ? 'pin' : 'choose');
        return;
      }
      sessionStorage.setItem('huuid_just_created', data.huuid);
      sessionStorage.setItem('huuid_just_created_name', data.fullName ?? '');
      sessionStorage.setItem('huuid_just_created_country', data.countryCode ?? '');
      sessionStorage.setItem('huuid_just_created_sex', data.sexAtBirth ?? '');
      if (data.qrToken) sessionStorage.setItem('huuid_qr_token', data.qrToken);
      if (data.cardTokenGeneratedAt) sessionStorage.setItem('huuid_card_token_generated_at', data.cardTokenGeneratedAt);
      router.push('/enroll/verify-identity');
    } catch {
      setError('Could not reach the server. Check your connection and try again.');
      setStage('pin');
    }
  }

  if (stage === 'loading') {
    return (
      <EnrollLayout step={2} heading="Secure Your Healthcare Identity">
        <p style={{ textAlign: 'center', color: 'var(--text-grey)' }}>Loading…</p>
      </EnrollLayout>
    );
  }

  if (stage === 'unsupported') {
    return (
      <EnrollLayout step={2} heading="Secure Your Healthcare Identity">
        <div className="warning-box">
          This browser does not support the cryptography required to create a HUUID Healthcare
          Identity (Web Crypto Ed25519). Please try a recent version of Chrome, Edge, or Safari, or
          use a different device.
        </div>
      </EnrollLayout>
    );
  }

  if (stage === 'creating') {
    return (
      <EnrollLayout step={2} heading="Creating Your HUUID…">
        <p style={{ textAlign: 'center', color: 'var(--text-grey)' }}>
          Generating your cryptographic identity on this device. This only takes a moment.
        </p>
      </EnrollLayout>
    );
  }

  return (
    <EnrollLayout
      step={2}
      heading="Secure Your Healthcare Identity"
      sub="Your private key is generated on your device and encrypted before storage. HUUID never has access to your private key."
    >
      {stage === 'choose' && webauthnAvailable && (
        <div className="secure-option-card">
          <div className="secure-icon">
            <Icon name="lock" size={32} style={{ color: 'var(--teal)' }} />
          </div>
          <span className="recommended-badge">Recommended</span>
          <h3 className="secure-option-title">Use Your Device Biometric</h3>
          <p className="secure-option-body">
            Use your fingerprint or Face ID to protect your Healthcare Identity. Your biometric
            never leaves your device. This is the most secure option available.
          </p>
          <button className="btn btn-teal btn-block" onClick={handleBiometricSetup}>
            Set Up Biometric Protection
          </button>
        </div>
      )}

      {stage === 'choose' && (
        <button className="secure-alt-link" onClick={() => setStage('pin')}>
          Or create a PIN instead
        </button>
      )}

      {stage === 'pin' && (
        <form onSubmit={handlePinSubmit}>
          <div className="secure-option-card alt">
            <div className="secure-icon">
              <Icon name="lock" size={32} style={{ color: 'var(--navy)' }} />
            </div>
            <h3 className="secure-option-title">Create Your Security PIN</h3>
            <p className="secure-option-body">
              Create a 6-digit PIN to protect your Healthcare Identity. Choose a PIN you will
              remember. Do not use your phone PIN or mobile money PIN. If you forget your PIN, you
              can recover access by verifying your phone number.
            </p>
          </div>

          {webauthnNote && <p className="form-helper" style={{ marginBottom: 16 }}>{webauthnNote}</p>}

          <div className="form-group">
            <label className="form-label">6-digit PIN</label>
            <input
              className="form-input"
              type="password"
              inputMode="numeric"
              maxLength={6}
              value={pin}
              onChange={(e) => setPin(e.target.value.replace(/\D/g, ''))}
            />
          </div>
          <div className="form-group">
            <label className="form-label">Confirm PIN</label>
            <input
              className="form-input"
              type="password"
              inputMode="numeric"
              maxLength={6}
              value={confirmPin}
              onChange={(e) => setConfirmPin(e.target.value.replace(/\D/g, ''))}
            />
          </div>
          {pin.length === 6 && isObviousPin(pin) && (
            <p className="pin-warning">This PIN is easy to guess. Consider choosing a less predictable one.</p>
          )}
          {pin.length === 6 && confirmPin.length === 6 && pin !== confirmPin && (
            <p className="pin-warning">PINs do not match.</p>
          )}

          {error && <p className="form-error-text" style={{ marginBottom: 16 }}>{error}</p>}

          <div className="security-explain">
            <button
              type="button"
              className="security-explain-toggle"
              onClick={() => setShowExplain((v) => !v)}
            >
              {showExplain ? 'Hide' : 'How is my identity protected?'}
            </button>
            {showExplain && (
              <div className="security-explain-body">
                Your Healthcare Identity uses military-grade cryptography:
                <ul style={{ margin: '8px 0 0', paddingLeft: 20 }}>
                  <li>Ed25519 keypair generated on your device using Web Crypto API</li>
                  <li>Private key encrypted with AES-256-GCM</li>
                  <li>Key derived via PBKDF2 with 310,000 iterations</li>
                  <li>Encrypted key stored securely</li>
                  <li>Raw private key never transmitted</li>
                  <li>Compliant with NIST SP 800-63B, FIDO2, and W3C DID standards</li>
                </ul>
              </div>
            )}
          </div>

          <button type="submit" className="btn btn-teal btn-block" style={{ marginTop: 20 }} disabled={!pinValid}>
            Create My HUUID →
          </button>
        </form>
      )}
    </EnrollLayout>
  );
}
