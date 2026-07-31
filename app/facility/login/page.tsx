'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import Image from 'next/image';

export default function FacilityLoginPage() {
  const router = useRouter();
  const [stage, setStage] = useState<'start' | 'code'>('start');
  const [facilityDid, setFacilityDid] = useState('');
  const [code, setCode] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function sendCode(e: React.FormEvent) {
    e.preventDefault();
    if (busy || facilityDid.trim().length === 0) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch('/api/facility/login/start', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ facilityDid: facilityDid.trim() }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? 'Could not send a login code.');
        setBusy(false);
        return;
      }
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
      const res = await fetch('/api/facility/login/verify', {
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
      router.push('/facility');
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
        <h1 className="enroll-heading">HUUID Facility Login</h1>

        {stage === 'start' && (
          <form onSubmit={sendCode}>
            <p className="enroll-sub">Enter your Facility ID to receive a login code.</p>
            <div className="form-group">
              <label className="form-label">Facility ID</label>
              <input
                className="form-input"
                placeholder="did:huuid:gh:..."
                value={facilityDid}
                onChange={(e) => setFacilityDid(e.target.value)}
                autoFocus
              />
            </div>
            {error && <p className="form-error-text" style={{ marginBottom: 16 }}>{error}</p>}
            <button type="submit" className="btn btn-teal btn-block" disabled={facilityDid.trim().length === 0 || busy}>
              {busy ? 'Sending…' : 'Send Login Code'}
            </button>
          </form>
        )}

        {stage === 'code' && (
          <form onSubmit={verifyCode}>
            <p className="enroll-sub">
              If this Facility ID is active, a code has been sent by SMS to its registered phone.
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
