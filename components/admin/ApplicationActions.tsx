'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

export default function ApplicationActions({
  applicationId,
  facilityName,
}: {
  applicationId: string;
  facilityName: string;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showReject, setShowReject] = useState(false);
  const [reason, setReason] = useState('');

  async function approve() {
    if (busy) return;
    if (!confirm(`Approve ${facilityName} and issue a certificate?`)) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/admin/applications/${applicationId}/approve`, { method: 'POST' });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? 'Could not approve this application.');
        setBusy(false);
        return;
      }
      router.refresh();
    } catch {
      setError('Could not reach the server.');
      setBusy(false);
    }
  }

  async function reject(e: React.FormEvent) {
    e.preventDefault();
    if (busy || reason.trim().length === 0) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/admin/applications/${applicationId}/reject`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reason: reason.trim() }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? 'Could not reject this application.');
        setBusy(false);
        return;
      }
      router.refresh();
    } catch {
      setError('Could not reach the server.');
      setBusy(false);
    }
  }

  if (showReject) {
    return (
      <form onSubmit={reject} className="admin-detail-section">
        <div className="form-group">
          <label className="form-label">Reason for rejection</label>
          <textarea
            className="form-input"
            rows={3}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            required
          />
        </div>
        {error && <p className="form-error-text">{error}</p>}
        <div className="admin-action-row">
          <button type="submit" className="btn btn-red" disabled={busy || reason.trim().length === 0}>
            {busy ? 'Rejecting…' : 'Confirm Rejection'}
          </button>
          <button type="button" className="btn btn-white-outline" onClick={() => setShowReject(false)} disabled={busy}>
            Cancel
          </button>
        </div>
      </form>
    );
  }

  return (
    <>
      {error && <p className="form-error-text">{error}</p>}
      <div className="admin-action-row">
        <button className="btn btn-green" onClick={approve} disabled={busy}>
          {busy ? 'Working…' : '✅ APPROVE AND ISSUE CERTIFICATE'}
        </button>
        <button className="btn btn-red" onClick={() => setShowReject(true)} disabled={busy}>
          ❌ REJECT
        </button>
      </div>
    </>
  );
}
