'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import EnrollLayout from '@/components/enroll/EnrollLayout';
import OtpInput from '@/components/enroll/OtpInput';
import { attemptDecryptPrivateKey } from '@/lib/client/keypair';

type Stage = 'phone' | 'otp' | 'pin' | 'recovered' | 'reenroll';

export default function RecoverPage() {
  const router = useRouter();
  const [stage, setStage] = useState<Stage>('phone');
  const [phone, setPhone] = useState('');
  const [phoneLast4, setPhoneLast4] = useState<string | null>(null);
  const [pin, setPin] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [resetKey, setResetKey] = useState(0);
  const [recovered, setRecovered] = useState<{ huuid: string; fullName: string; countryCode: string } | null>(null);

  async function handlePhoneSubmit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const res = await fetch('/api/enroll/recover/start', {
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
      const res = await fetch('/api/enroll/recover/verify-otp', {
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
      setStage('pin');
    } catch {
      setError('Could not reach the server.');
      setResetKey((k) => k + 1);
    }
    setBusy(false);
  }

  async function handlePinSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!/^\d{6}$/.test(pin)) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch('/api/enroll/recover/fetch', { method: 'POST' });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? 'No enrolled identity found.');
        setBusy(false);
        return;
      }

      const success = await attemptDecryptPrivateKey({
        encryptedPrivateKeyB64: data.encryptedPrivateKey,
        pbkdf2SaltB64: data.pbkdf2Salt,
        pbkdf2IvB64: data.pbkdf2Iv,
        pin,
      });

      if (success) {
        setRecovered({ huuid: data.huuid, fullName: data.fullName, countryCode: data.countryCode });
        setStage('recovered');
      } else {
        setStage('reenroll');
      }
    } catch {
      setError('Could not reach the server.');
    }
    setBusy(false);
  }

  function viewCard() {
    if (!recovered) return;
    sessionStorage.setItem('huuid_just_created', recovered.huuid);
    sessionStorage.setItem('huuid_just_created_name', recovered.fullName);
    sessionStorage.setItem('huuid_just_created_country', recovered.countryCode);
    router.push('/enroll/card');
  }

  if (stage === 'phone') {
    return (
      <EnrollLayout step={1} heading="Recover Your Healthcare Identity" sub="Enter the phone number you enrolled with.">
        <form onSubmit={handlePhoneSubmit}>
          <div className="form-group">
            <label className="form-label">Phone Number (E.164, e.g. +233241234567)</label>
            <input
              type="tel"
              className="form-input"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              required
            />
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
      <EnrollLayout
        step={1}
        heading="Verify Your Phone Number"
        sub={phoneLast4 ? `We sent a 6-digit code to a number ending in ${phoneLast4}` : undefined}
      >
        <OtpInput length={6} disabled={busy} onComplete={handleOtpComplete} resetKey={resetKey} />
        {error && <p className="form-error-text" style={{ textAlign: 'center' }}>{error}</p>}
      </EnrollLayout>
    );
  }

  if (stage === 'pin') {
    return (
      <EnrollLayout step={2} heading="Enter Your PIN" sub="Enter the PIN you set when you created your Healthcare Identity.">
        <form onSubmit={handlePinSubmit}>
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
          {error && <p className="form-error-text" style={{ marginBottom: 16 }}>{error}</p>}
          <button type="submit" className="btn btn-teal btn-block" disabled={busy || pin.length !== 6}>
            {busy ? 'Checking…' : 'Unlock My Identity →'}
          </button>
        </form>
      </EnrollLayout>
    );
  }

  if (stage === 'recovered' && recovered) {
    return (
      <EnrollLayout step={3} heading="Identity Recovered">
        <p style={{ textAlign: 'center', color: 'var(--text-grey)', marginBottom: 24 }}>
          Welcome back, {recovered.fullName}. Your Healthcare Identity has been verified on this
          device.
        </p>
        <button className="btn btn-teal btn-block" onClick={viewCard}>
          View My Healthcare Identity Card →
        </button>
      </EnrollLayout>
    );
  }

  // stage === 'reenroll'
  return (
    <EnrollLayout step={2} heading="PIN Not Recognised">
      <div className="warning-box">
        If you have forgotten your PIN, visit any HUUID-connected healthcare facility with a valid
        identity document. The facility can verify your identity and issue a new Healthcare
        Identity key. Your HUUID remains the same.
      </div>
      <button className="btn btn-teal-outline btn-block" onClick={() => setStage('pin')}>
        Try Again
      </button>
    </EnrollLayout>
  );
}
