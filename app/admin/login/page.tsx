'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import Image from 'next/image';

export default function AdminLoginPage() {
  const router = useRouter();
  const [stage, setStage] = useState<'start' | 'code'>('start');
  const [code, setCode] = useState('');
  const [phoneLast4, setPhoneLast4] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function sendCode() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch('/api/admin/login/start', { method: 'POST' });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? 'Could not send a login code.');
        setBusy(false);
        return;
      }
      setPhoneLast4(data.phoneLast4);
      setStage('code');
    } catch {
      setError('Could not reach the server.');
    }
    setBusy(false);
  }

  async function verifyCode(e: React.FormEvent) {
    e.preventDefault();
    if (code.length !== 6 || busy) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch('/api/admin/login/verify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? 'Incorrect code.');
        setBusy(false);
        return;
      }
      router.push('/admin');
    } catch {
      setError('Could not reach the server.');
      setBusy(false);
    }
  }

  return (
    <div className="enroll-page">
      <div className="enroll-shell">
        <div className="enroll-logo">
          <Image src="/images/logo-h.png" alt="HUUID" width={44} height={44} />
        </div>
        <h1 className="enroll-heading">HUUID Root Authority</h1>

        {stage === 'start' && (
          <>
            <p className="enroll-sub">
              A login code will be sent by SMS to the registered Root Authority phone number.
            </p>
            {error && <p className="form-error-text" style={{ marginBottom: 16 }}>{error}</p>}
            <button className="btn btn-teal btn-block" onClick={sendCode} disabled={busy}>
              {busy ? 'Sending…' : 'Send Login Code'}
            </button>
          </>
        )}

        {stage === 'code' && (
          <form onSubmit={verifyCode}>
            <p className="enroll-sub">
              Enter the 6-digit code sent to the number ending in {phoneLast4}.
            </p>
            <div className="form-group">
              <label className="form-label">Login Code</label>
              <input
                className="form-input"
                inputMode="numeric"
                maxLength={6}
                value={code}
                onChange={(e) => setCode(e.target.value.replace(/[^\d]/g, ''))}
                autoFocus
              />
            </div>
            {error && <p className="form-error-text" style={{ marginBottom: 16 }}>{error}</p>}
            <button type="submit" className="btn btn-teal btn-block" disabled={code.length !== 6 || busy}>
              {busy ? 'Verifying…' : 'Verify →'}
            </button>
          </form>
        )}
      </div>
    </div>
  );
}
