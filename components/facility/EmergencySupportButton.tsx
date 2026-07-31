'use client';

import { useState } from 'react';

export default function EmergencySupportButton({ facilityName }: { facilityName: string }) {
  const [open, setOpen] = useState(false);
  const [issue, setIssue] = useState('');
  const [rootAuthorityPhone, setRootAuthorityPhone] = useState<string | null>(null);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [now] = useState(() => new Date());

  async function openModal() {
    setOpen(true);
    setSent(false);
    setError(null);
    try {
      const res = await fetch('/api/facility/emergency');
      const data = await res.json();
      if (res.ok) setRootAuthorityPhone(data.rootAuthorityPhone);
    } catch {
      // phone display is best-effort; the send button still works without it
    }
  }

  async function send() {
    if (issue.trim().length === 0 || busy) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch('/api/facility/emergency', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ issue: issue.trim() }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? 'Could not send the alert.');
        setBusy(false);
        return;
      }
      setSent(true);
    } catch {
      setError('Could not reach the server.');
    }
    setBusy(false);
  }

  return (
    <>
      <button className="facility-emergency-btn" onClick={openModal}>
        🚨 Emergency Support
      </button>

      {open && (
        <div className="qr-modal-overlay">
          <button className="qr-modal-close" onClick={() => setOpen(false)}>
            ✕ Close
          </button>

          <div style={{ maxWidth: 480, width: '100%', textAlign: 'center' }}>
            <h1 className="enroll-heading" style={{ color: '#b3261e' }}>
              🚨 HUUID EMERGENCY SUPPORT
            </h1>

            {!sent ? (
              <>
                <div className="admin-detail-section" style={{ textAlign: 'left' }}>
                  <div className="admin-detail-row">
                    <span className="admin-detail-label">Your facility</span>
                    <span className="admin-detail-value">{facilityName}</span>
                  </div>
                  <div className="admin-detail-row">
                    <span className="admin-detail-label">Time</span>
                    <span className="admin-detail-value">{now.toLocaleString()}</span>
                  </div>
                </div>

                <div className="form-group" style={{ textAlign: 'left' }}>
                  <label className="form-label">Describe the issue</label>
                  <textarea
                    className="form-input"
                    rows={4}
                    value={issue}
                    onChange={(e) => setIssue(e.target.value)}
                    autoFocus
                  />
                </div>

                {error && <p className="form-error-text">{error}</p>}

                <button className="btn btn-red btn-block" disabled={issue.trim().length === 0 || busy} onClick={send}>
                  {busy ? 'Sending…' : '📱 SEND EMERGENCY ALERT'}
                </button>

                {rootAuthorityPhone && (
                  <p style={{ marginTop: 16, fontSize: 13.5, color: 'var(--text-grey)' }}>
                    Or call directly: <strong>{rootAuthorityPhone}</strong>
                  </p>
                )}
              </>
            ) : (
              <div className="warning-box">
                Alert sent. Our team will respond within 5 minutes. If life is at immediate risk
                call emergency services first.
              </div>
            )}
          </div>
        </div>
      )}
    </>
  );
}
