'use client';

import { useState } from 'react';
import EnrollLayout from '@/components/enroll/EnrollLayout';
import OtpInput from '@/components/enroll/OtpInput';

type Stage = 'phone' | 'otp' | 'confirm' | 'erased';

export default function ErasePage() {
  const [stage, setStage] = useState<Stage>('phone');
  const [phone, setPhone] = useState('');
  const [phoneLast4, setPhoneLast4] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [resetKey, setResetKey] = useState(0);
  const [erasedHuuid, setErasedHuuid] = useState<string | null>(null);

  async function handlePhoneSubmit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const res = await fetch('/api/enroll/erase/start', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ phone }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? 'Could not process your request.');
        setBusy(false);
        return;
      }
      setPhoneLast4(data.phoneLast4 ?? phone.slice(-4));
      setStage('otp');
    } catch {
      setError('Could not reach the server.');
    }
    setBusy(false);
  }

  async function handleOtpComplete(code: string) {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch('/api/enroll/erase/verify-otp', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? 'Incorrect code.');
        setResetKey((k) => k + 1);
        setBusy(false);
        return;
      }
      setStage('confirm');
    } catch {
      setError('Could not reach the server.');
      setResetKey((k) => k + 1);
    }
    setBusy(false);
  }

  async function handleConfirmErasure() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch('/api/enroll/erase/confirm', { method: 'POST' });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? 'Could not complete erasure.');
        setBusy(false);
        return;
      }
      setErasedHuuid(data.huuid);
      setStage('erased');
    } catch {
      setError('Could not reach the server.');
    }
    setBusy(false);
  }

  if (stage === 'phone') {
    return (
      <EnrollLayout step={1} heading="Erase My Healthcare Identity" sub="Enter the phone number you enrolled with.">
        <form onSubmit={handlePhoneSubmit}>
          <div className="form-group">
            <label className="form-label">Phone Number (E.164, e.g. +233241234567)</label>
            <input type="tel" className="form-input" value={phone} onChange={(e) => setPhone(e.target.value)} required />
          </div>
          {error && <p className="form-error-text" style={{ marginBottom: 16 }}>{error}</p>}
          <button type="submit" className="btn btn-teal btn-block" disabled={busy || !phone}>
            {busy ? 'Sending code…' : 'Continue →'}
          </button>
        </form>
      </EnrollLayout>
    );
  }

  if (stage === 'otp') {
    return (
      <EnrollLayout step={2} heading="Verify Your Phone Number" sub={phoneLast4 ? `We sent a 6-digit code to a number ending in ${phoneLast4}` : undefined}>
        <OtpInput length={6} disabled={busy} onComplete={handleOtpComplete} resetKey={resetKey} />
        {error && <p className="form-error-text" style={{ textAlign: 'center' }}>{error}</p>}
      </EnrollLayout>
    );
  }

  if (stage === 'confirm') {
    return (
      <EnrollLayout step={3} heading="Confirm Erasure">
        <div className="warning-box">
          This permanently deletes your name, date of birth, sex at birth, emergency contact, and
          private key material. Your HUUID and identity card will stop working immediately. This
          cannot be undone.
        </div>
        <div className="warning-box">
          After erasure your phone number cannot be used to create a new HUUID. Contact{' '}
          <a href="mailto:identity@huuid.health">identity@huuid.health</a> to reactivate your
          Healthcare Identity.
        </div>
        {error && <p className="form-error-text" style={{ marginBottom: 16 }}>{error}</p>}
        <button className="btn btn-teal btn-block" onClick={handleConfirmErasure} disabled={busy} style={{ background: '#b3261e' }}>
          {busy ? 'Erasing…' : 'Permanently Erase My Identity'}
        </button>
      </EnrollLayout>
    );
  }

  // stage === 'erased'
  return (
    <EnrollLayout step={3} heading="Your Healthcare Identity Has Been Erased">
      <p style={{ textAlign: 'center', color: 'var(--text-grey)', marginBottom: 16 }}>
        Your personal data has been permanently deleted. Your HUUID no longer resolves to any
        record.
      </p>
      {erasedHuuid && (
        <p style={{ textAlign: 'center', fontFamily: 'ui-monospace, monospace', fontSize: 12.5, color: 'var(--text-grey)', marginBottom: 16 }}>
          {erasedHuuid}
        </p>
      )}
      <div className="warning-box">
        After erasure your phone number cannot be used to create a new HUUID. Contact{' '}
        <a href="mailto:identity@huuid.health">identity@huuid.health</a> to reactivate your
        Healthcare Identity.
      </div>
    </EnrollLayout>
  );
}
