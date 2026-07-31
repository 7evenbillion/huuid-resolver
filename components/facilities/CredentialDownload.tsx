'use client';

import { useState } from 'react';

interface FacilityInfo {
  facilityDid: string;
  facilityName: string | null;
  certificateStatus: string | null;
}

export default function CredentialDownload({ token }: { token: string }) {
  const [stage, setStage] = useState<'otp' | 'ready' | 'done'>('otp');
  const [code, setCode] = useState('');
  const [info, setInfo] = useState<FacilityInfo | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);

  async function verifyOtp(e: React.FormEvent) {
    e.preventDefault();
    if (code.length !== 6 || busy) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/facilities/credentials/${token}/verify-otp`, {
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
      const infoRes = await fetch(`/api/facilities/credentials/${token}`);
      const infoData = await infoRes.json();
      if (infoRes.ok) setInfo(infoData);
      setStage('ready');
    } catch {
      setError('Could not reach the server.');
    }
    setBusy(false);
  }

  async function handleDownload() {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/facilities/credentials/${token}/download`, { method: 'POST' });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setError(data.error ?? 'Could not download your credentials.');
        setBusy(false);
        return;
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'huuid-facility-credentials.zip';
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
      setStage('done');
    } catch {
      setError('Could not reach the server.');
    }
    setBusy(false);
  }

  async function copyDid() {
    if (!info) return;
    try {
      await navigator.clipboard.writeText(info.facilityDid);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // clipboard unavailable -- DID is still visible on screen
    }
  }

  if (stage === 'otp') {
    return (
      <div className="enroll-page">
        <div className="enroll-shell">
          <h1 className="enroll-heading">Enter Your Verification Code</h1>
          <p className="enroll-sub">
            Enter the 6-digit code sent to your phone to access your credentials.
          </p>
          <form onSubmit={verifyOtp}>
            <div className="form-group">
              <label className="form-label">Verification Code</label>
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
        </div>
      </div>
    );
  }

  if (stage === 'done') {
    return (
      <div className="enroll-page">
        <div className="enroll-shell" style={{ textAlign: 'center' }}>
          <h1 className="enroll-heading">Credentials Downloaded Successfully</h1>
          <p className="enroll-sub">
            Your installation guide is included in the downloaded package. For support, contact
            the HUUID Root Authority.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="enroll-page">
      <div className="enroll-shell">
        <h1 className="enroll-heading">Your HUUID Facility Credentials</h1>

        <div className="warning-box">
          <strong>Download and save these credentials now.</strong> This page can only be
          accessed once. After you close this page you cannot return. Keep your private key
          secure and never share it.
        </div>

        {info && (
          <div className="admin-detail-section">
            <div className="admin-detail-row">
              <span className="admin-detail-label">Facility Name</span>
              <span className="admin-detail-value">{info.facilityName ?? '—'}</span>
            </div>
            <div className="admin-detail-row">
              <span className="admin-detail-label">Facility ID (DID)</span>
              <span className="admin-detail-value" style={{ wordBreak: 'break-all' }}>
                {info.facilityDid}
              </span>
            </div>
            <div className="admin-detail-row">
              <span className="admin-detail-label">Status</span>
              <span className="admin-detail-value">✅ Active</span>
            </div>
          </div>
        )}

        {error && <p className="form-error-text" style={{ marginBottom: 16 }}>{error}</p>}

        <div className="download-buttons">
          <button className="btn btn-teal btn-block" onClick={handleDownload} disabled={busy}>
            {busy ? 'Preparing…' : '📦 Download Credential Package'}
          </button>
          {info && (
            <button className="btn btn-white-outline btn-block" onClick={copyDid}>
              {copied ? 'Copied!' : '📋 Copy Facility DID'}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
