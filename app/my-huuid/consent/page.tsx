'use client';

import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';

interface PendingRequest {
  consentId: string;
  facilityName: string;
  holdingFacilityNames: string[];
  recordTypesRequested: string[];
  expiresAt: string;
  createdAt: string;
}
interface HistoryRequest {
  consentId: string;
  facilityName: string;
  recordTypesRequested: string[];
  status: 'granted' | 'declined' | 'expired' | 'pending';
  createdAt: string;
}

const STATUS_BADGE: Record<string, { text: string; className: string }> = {
  granted: { text: 'Granted', className: 'myhuuid-consent-badge-granted' },
  declined: { text: 'Declined', className: 'myhuuid-consent-badge-declined' },
  expired: { text: 'Expired', className: 'myhuuid-consent-badge-expired' },
  pending: { text: 'Pending', className: 'myhuuid-consent-badge-expired' },
};

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
}

function Countdown({ expiresAt }: { expiresAt: string }) {
  const [remaining, setRemaining] = useState(() => Math.max(0, new Date(expiresAt).getTime() - Date.now()));

  useEffect(() => {
    const interval = setInterval(() => {
      setRemaining(Math.max(0, new Date(expiresAt).getTime() - Date.now()));
    }, 1000);
    return () => clearInterval(interval);
  }, [expiresAt]);

  const minutes = Math.floor(remaining / 60000);
  const seconds = Math.floor((remaining % 60000) / 1000);
  return (
    <span className="myhuuid-consent-countdown">
      Expires in {minutes}:{seconds.toString().padStart(2, '0')}
    </span>
  );
}

export default function MyHuuidConsentPage() {
  const router = useRouter();
  const [tab, setTab] = useState<'pending' | 'history'>('pending');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState<PendingRequest[]>([]);
  const [history, setHistory] = useState<HistoryRequest[]>([]);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [confirmation, setConfirmation] = useState<string | null>(null);

  const load = useCallback(async () => {
    const res = await fetch('/api/my-huuid/consent');
    if (res.status === 401) {
      router.replace('/my-huuid/login');
      return;
    }
    if (!res.ok) {
      setError('Could not load your consent requests.');
      setLoading(false);
      return;
    }
    const data = await res.json();
    setPending(data.pending ?? []);
    setHistory(data.history ?? []);
    setLoading(false);
  }, [router]);

  useEffect(() => {
    load();
  }, [load]);

  async function handleDecision(consentId: string, facilityName: string, decision: 'granted' | 'declined') {
    setBusyId(consentId);
    setError(null);
    try {
      const res = await fetch(`/api/my-huuid/consent/${encodeURIComponent(consentId)}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ decision }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? 'Could not record your decision.');
        setBusyId(null);
        return;
      }
      setConfirmation(
        decision === 'granted' ? `✓ Access granted to ${facilityName}` : 'Access declined.'
      );
      await load();
      setTab('history');
      setBusyId(null);
    } catch {
      setError('Could not reach the server.');
      setBusyId(null);
    }
  }

  return (
    <div className="admin-page">
      <div className="admin-shell" style={{ maxWidth: 640 }}>
        <Link href="/my-huuid" style={{ color: 'var(--teal)', fontWeight: 600, fontSize: 13.5 }}>
          ← Back
        </Link>
        <h1 className="admin-title" style={{ margin: '16px 0 4px' }}>Consent Management</h1>
        <p className="admin-subtitle" style={{ margin: '0 0 20px' }}>
          Control which facilities can access your records.
        </p>

        <div className="admin-action-row" style={{ marginBottom: 20 }}>
          <button className={`btn ${tab === 'pending' ? 'btn-teal' : 'btn-white-outline'}`} onClick={() => setTab('pending')}>
            Pending {pending.length > 0 ? `(${pending.length})` : ''}
          </button>
          <button className={`btn ${tab === 'history' ? 'btn-teal' : 'btn-white-outline'}`} onClick={() => setTab('history')}>
            History
          </button>
        </div>

        {confirmation && <p className="form-helper" style={{ color: '#1a8f4c', marginBottom: 16 }}>{confirmation}</p>}
        {error && <p className="form-error-text">{error}</p>}
        {loading && <p className="form-helper">Loading…</p>}

        {!loading && tab === 'pending' && (
          <>
            {pending.length === 0 && (
              <div className="info-box">You have no pending consent requests.</div>
            )}
            {pending.map((req) => (
              <div className="myhuuid-consent-card" key={req.consentId}>
                <div className="myhuuid-history-facility">{req.facilityName}</div>
                <p className="myhuuid-consent-line">Requesting access to your records at:</p>
                <ul className="myhuuid-consent-list">
                  {req.holdingFacilityNames.map((f, i) => (
                    <li key={i}>{f}</li>
                  ))}
                </ul>
                <p className="myhuuid-consent-line">They need:</p>
                <ul className="myhuuid-consent-list">
                  {req.recordTypesRequested.map((r, i) => (
                    <li key={i}>{r}</li>
                  ))}
                </ul>
                <Countdown expiresAt={req.expiresAt} />
                <div className="myhuuid-consent-buttons">
                  <button
                    className="btn myhuuid-consent-grant-btn"
                    onClick={() => handleDecision(req.consentId, req.facilityName, 'granted')}
                    disabled={busyId === req.consentId}
                  >
                    ✓ GRANT ACCESS
                  </button>
                  <button
                    className="btn myhuuid-consent-decline-btn"
                    onClick={() => handleDecision(req.consentId, req.facilityName, 'declined')}
                    disabled={busyId === req.consentId}
                  >
                    ✗ DECLINE
                  </button>
                </div>
              </div>
            ))}

            <div className="info-box myhuuid-consent-sms-notice">
              You can also respond to consent requests by replying YES or NO to the SMS sent to your
              phone.
              <br />
              <span style={{ color: '#b3821a' }}>[SMS notifications active shortly]</span>
            </div>
          </>
        )}

        {!loading && tab === 'history' && (
          <>
            {history.length === 0 && <div className="info-box">No past consent requests.</div>}
            <div className="myhuuid-history-list">
              {history.map((req) => (
                <div className="myhuuid-history-card" key={req.consentId}>
                  <div className="myhuuid-history-top-row">
                    <span className="myhuuid-history-datetime">{formatDate(req.createdAt)}</span>
                    <span className={STATUS_BADGE[req.status]?.className ?? 'myhuuid-consent-badge-expired'}>
                      {STATUS_BADGE[req.status]?.text ?? req.status}
                    </span>
                  </div>
                  <div className="myhuuid-history-facility">{req.facilityName}</div>
                  <div className="myhuuid-history-meta">{req.recordTypesRequested.join(', ')}</div>
                </div>
              ))}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
