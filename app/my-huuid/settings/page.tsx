'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { isObviousPin, reencryptPrivateKeyWithNewPin, decryptAndSignChallenge } from '@/lib/client/keypair';

interface SecurityData {
  huuid: string;
  identityVerified: boolean;
  identityVerifiedMethod: string | null;
  identityVerifiedAt: string | null;
  identityDocumentType: string | null;
  identityDocumentCountry: string | null;
}

export default function MyHuuidSettingsPage() {
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [security, setSecurity] = useState<SecurityData | null>(null);

  // Section 1: Change PIN
  const [currentPin, setCurrentPin] = useState('');
  const [newPin, setNewPin] = useState('');
  const [confirmPin, setConfirmPin] = useState('');
  const [pinBusy, setPinBusy] = useState(false);
  const [pinError, setPinError] = useState<string | null>(null);
  const [pinSuccess, setPinSuccess] = useState(false);

  // Section 4: Delete account
  const [confirmText, setConfirmText] = useState('');
  const [deletePin, setDeletePin] = useState('');
  const [deleteBusy, setDeleteBusy] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [deleteDone, setDeleteDone] = useState(false);

  useEffect(() => {
    (async () => {
      const res = await fetch('/api/my-huuid/security');
      if (res.status === 401) {
        router.replace('/my-huuid/login');
        return;
      }
      if (res.ok) setSecurity(await res.json());
      setLoading(false);
    })();
  }, [router]);

  const newPinIsObvious = newPin.length === 6 && isObviousPin(newPin);

  async function handleChangePin(e: React.FormEvent) {
    e.preventDefault();
    setPinError(null);
    setPinSuccess(false);
    if (newPin !== confirmPin) {
      setPinError('New PIN and confirmation do not match.');
      return;
    }
    if (newPinIsObvious) {
      setPinError('This PIN is too simple. Choose a PIN that is harder to guess.');
      return;
    }
    setPinBusy(true);
    try {
      const materialRes = await fetch('/api/my-huuid/security/pin-material');
      if (materialRes.status === 401) {
        router.replace('/my-huuid/login');
        return;
      }
      const material = await materialRes.json();
      if (!materialRes.ok) {
        setPinError(material.error ?? 'Could not start PIN change.');
        setPinBusy(false);
        return;
      }

      const reencrypted = await reencryptPrivateKeyWithNewPin({
        encryptedPrivateKeyB64: material.encryptedPrivateKeyB64,
        pbkdf2SaltB64: material.pbkdf2SaltB64,
        pbkdf2IvB64: material.pbkdf2IvB64,
        currentPin,
        newPin,
      });
      if (!reencrypted) {
        setPinError('Incorrect current PIN. Try again.');
        setCurrentPin('');
        setPinBusy(false);
        return;
      }

      const commitRes = await fetch('/api/my-huuid/security/pin', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(reencrypted),
      });
      const commitBody = await commitRes.json();
      if (!commitRes.ok) {
        setPinError(commitBody.error ?? 'Could not update your PIN.');
        setPinBusy(false);
        return;
      }

      setPinSuccess(true);
      setCurrentPin('');
      setNewPin('');
      setConfirmPin('');
      setPinBusy(false);
    } catch {
      setPinError('Could not reach the server. Check your connection and try again.');
      setPinBusy(false);
    }
  }

  async function handleDelete(e: React.FormEvent) {
    e.preventDefault();
    setDeleteError(null);
    if (confirmText !== 'DELETE MY IDENTITY') {
      setDeleteError('Type DELETE MY IDENTITY exactly to confirm.');
      return;
    }
    if (!security) return;
    setDeleteBusy(true);
    try {
      // Re-verify the current PIN via the same real login flow used at
      // /my-huuid/login (Layer 1) -- a fresh cryptographic proof of PIN
      // knowledge right before an irreversible action, not a second,
      // separately-implemented PIN check.
      const challengeRes = await fetch('/api/my-huuid/login/pin/challenge', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ huuid: security.huuid }),
      });
      const challengeBody = await challengeRes.json();
      if (!challengeRes.ok) {
        setDeleteError(challengeBody.error ?? 'Could not verify your PIN.');
        setDeleteBusy(false);
        return;
      }
      const signatureB64 = await decryptAndSignChallenge({
        encryptedPrivateKeyB64: challengeBody.encryptedPrivateKeyB64,
        pbkdf2SaltB64: challengeBody.pbkdf2SaltB64,
        pbkdf2IvB64: challengeBody.pbkdf2IvB64,
        pin: deletePin,
        nonceB64: challengeBody.nonce,
      });
      if (!signatureB64) {
        setDeleteError('Incorrect PIN.');
        setDeletePin('');
        setDeleteBusy(false);
        return;
      }
      const verifyRes = await fetch('/api/my-huuid/login/pin/verify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ signatureB64 }),
      });
      if (!verifyRes.ok) {
        const verifyBody = await verifyRes.json();
        setDeleteError(verifyBody.error ?? 'Incorrect PIN.');
        setDeletePin('');
        setDeleteBusy(false);
        return;
      }

      const deleteRes = await fetch('/api/my-huuid/security/delete', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ confirmationText: confirmText }),
      });
      const deleteBody = await deleteRes.json();
      if (!deleteRes.ok) {
        setDeleteError(deleteBody.error ?? 'Could not complete deletion.');
        setDeleteBusy(false);
        return;
      }

      setDeleteDone(true);
      setTimeout(() => router.push('/'), 3000);
    } catch {
      setDeleteError('Could not reach the server. Check your connection and try again.');
      setDeleteBusy(false);
    }
  }

  if (deleteDone) {
    return (
      <div className="admin-page">
        <div className="admin-shell" style={{ maxWidth: 560, textAlign: 'center' }}>
          <p className="admin-title">Your Healthcare Identity has been permanently erased.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="admin-page">
      <div className="admin-shell" style={{ maxWidth: 560 }}>
        <Link href="/my-huuid" style={{ color: 'var(--teal)', fontWeight: 600, fontSize: 13.5 }}>
          ← Back
        </Link>
        <h1 className="admin-title" style={{ margin: '16px 0 24px' }}>Security Settings</h1>

        {/* Section 1 — Change PIN */}
        <div className="myhuuid-settings-section">
          <h2 className="medical-section-title">Change Your Security PIN</h2>
          <form onSubmit={handleChangePin}>
            <div className="form-group">
              <label className="form-label">Current PIN</label>
              <input
                className="form-input"
                type="password"
                inputMode="numeric"
                maxLength={6}
                value={currentPin}
                onChange={(e) => setCurrentPin(e.target.value.replace(/\D/g, ''))}
              />
            </div>
            <div className="form-group">
              <label className="form-label">New PIN</label>
              <input
                className="form-input"
                type="password"
                inputMode="numeric"
                maxLength={6}
                value={newPin}
                onChange={(e) => setNewPin(e.target.value.replace(/\D/g, ''))}
              />
              {newPinIsObvious && (
                <p className="form-error-text">This PIN is too simple. Choose a PIN that is harder to guess.</p>
              )}
            </div>
            <div className="form-group">
              <label className="form-label">Confirm New PIN</label>
              <input
                className="form-input"
                type="password"
                inputMode="numeric"
                maxLength={6}
                value={confirmPin}
                onChange={(e) => setConfirmPin(e.target.value.replace(/\D/g, ''))}
              />
            </div>
            {pinError && <p className="form-error-text" style={{ marginBottom: 12 }}>{pinError}</p>}
            {pinSuccess && <p className="form-helper" style={{ color: '#1a8f4c', marginBottom: 12 }}>✓ PIN updated successfully.</p>}
            <p className="form-helper" style={{ color: '#b3821a' }}>[SMS notifications active shortly]</p>
            <button
              type="submit"
              className="btn btn-teal btn-block"
              disabled={pinBusy || currentPin.length !== 6 || newPin.length !== 6 || confirmPin.length !== 6}
            >
              {pinBusy ? 'Updating…' : 'Update PIN'}
            </button>
          </form>
        </div>

        {/* Section 2 — Trusted Devices */}
        <div className="myhuuid-settings-section myhuuid-settings-coming-soon">
          <h2 className="medical-section-title">
            Trusted Devices <span className="myhuuid-coming-soon-tag">Coming Soon</span>
          </h2>
          <p className="myhuuid-settings-note">
            Manage devices that can access your Healthcare Identity without entering your PIN each time.
          </p>
        </div>

        {/* Section 3 — Identity Verification */}
        <div className="myhuuid-settings-section">
          <h2 className="medical-section-title">Identity Verification</h2>
          {loading ? (
            <p className="form-helper">Loading…</p>
          ) : security?.identityVerified ? (
            <div className="myhuuid-settings-verified-card">
              <p style={{ fontWeight: 700, margin: '0 0 8px' }}>✓ Identity Verified</p>
              <p style={{ margin: '0 0 4px' }}>Verified by: {security.identityVerifiedMethod}</p>
              <p style={{ margin: '0 0 4px' }}>
                Date: {security.identityVerifiedAt ? new Date(security.identityVerifiedAt).toLocaleDateString() : '—'}
              </p>
              <p style={{ margin: 0 }}>
                Document: {security.identityDocumentType} ({security.identityDocumentCountry})
              </p>
            </div>
          ) : (
            <div className="myhuuid-settings-unverified-card">
              <p style={{ fontWeight: 700, margin: '0 0 8px' }}>⚠️ Your identity is not verified.</p>
              <p style={{ margin: '0 0 8px' }}>Your Healthcare Identity has basic protection only.</p>
              <p style={{ margin: '0 0 8px' }}>
                To fully protect against duplicate accounts visit any connected healthcare facility with
                your government ID document. Staff will verify you in person.
              </p>
              <p style={{ margin: 0, fontStyle: 'italic' }}>[Biometric verification coming soon for self-service]</p>
            </div>
          )}
        </div>

        {/* Section 4 — Delete My Account */}
        <div className="myhuuid-settings-section myhuuid-delete-section">
          <h2 className="medical-section-title" style={{ color: '#b3261e' }}>Delete My Account</h2>
          <div className="myhuuid-delete-warning">
            <p style={{ fontWeight: 700, margin: '0 0 8px' }}>⚠️ PERMANENT ACTION — CANNOT BE UNDONE</p>
            <p style={{ margin: '0 0 8px' }}>If you delete your Healthcare Identity:</p>
            <ul style={{ margin: '0 0 8px', paddingLeft: 20 }}>
              <li>Your HUUID will be permanently revoked</li>
              <li>Your phone number cannot create a new HUUID</li>
              <li>Your medical profile will be erased</li>
              <li>Your access history is retained for legal compliance</li>
              <li>You will need to visit a facility to get a new Healthcare Identity</li>
            </ul>
          </div>
          <form onSubmit={handleDelete}>
            <div className="form-group">
              <label className="form-label">Type DELETE MY IDENTITY to confirm</label>
              <input
                className="form-input"
                value={confirmText}
                onChange={(e) => setConfirmText(e.target.value)}
                placeholder="DELETE MY IDENTITY"
              />
            </div>
            <div className="form-group">
              <label className="form-label">Current PIN</label>
              <input
                className="form-input"
                type="password"
                inputMode="numeric"
                maxLength={6}
                value={deletePin}
                onChange={(e) => setDeletePin(e.target.value.replace(/\D/g, ''))}
              />
            </div>
            {deleteError && <p className="form-error-text" style={{ marginBottom: 12 }}>{deleteError}</p>}
            <p className="form-helper" style={{ color: '#b3821a' }}>[SMS notifications active shortly]</p>
            <button
              type="submit"
              className="myhuuid-delete-btn"
              disabled={deleteBusy || confirmText !== 'DELETE MY IDENTITY' || deletePin.length !== 6}
            >
              {deleteBusy ? 'Deleting…' : 'Permanently Delete My Healthcare Identity'}
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}
