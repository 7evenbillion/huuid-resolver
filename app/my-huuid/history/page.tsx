'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';

interface StandardEntry {
  kind: 'standard';
  timestamp: string;
  facilityName: string;
  purposeCode: string;
  outcome: string;
}
interface BreakGlassEntry {
  kind: 'break_glass';
  timestamp: string;
  facilityName: string;
  clinicianLicense: string;
  reasonCode: string;
}
type HistoryEntry = StandardEntry | BreakGlassEntry;

const PURPOSE_LABEL: Record<string, string> = {
  Treatment: 'Healthcare Visit',
  Administrative: 'Administrative Check',
  Emergency: 'Emergency Access',
  Research: 'Research Request',
};

/** The brief specifies only success/notFound/unauthorized -- the other
 * four outcomes in huuid_audit_log's own CHECK constraint (migration 001)
 * are mapped here too rather than falling back to the raw code, since a
 * real patient could see any of them. */
const OUTCOME_LABEL: Record<string, { text: string; className: string }> = {
  success: { text: '✓ Verified', className: 'myhuuid-history-outcome-success' },
  notFound: { text: 'Not Found', className: 'myhuuid-history-outcome-neutral' },
  unauthorized: { text: '✗ Rejected', className: 'myhuuid-history-outcome-fail' },
  forbidden: { text: '✗ Forbidden', className: 'myhuuid-history-outcome-fail' },
  deactivated: { text: 'Deactivated', className: 'myhuuid-history-outcome-neutral' },
  rateLimitExceeded: { text: 'Rate Limited', className: 'myhuuid-history-outcome-neutral' },
  internalError: { text: 'System Error', className: 'myhuuid-history-outcome-neutral' },
  duplicateRequest: { text: 'Duplicate Request', className: 'myhuuid-history-outcome-neutral' },
};

function formatTimestamp(iso: string): string {
  return new Date(iso).toLocaleString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

export default function MyHuuidHistoryPage() {
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [entries, setEntries] = useState<HistoryEntry[]>([]);

  useEffect(() => {
    (async () => {
      const res = await fetch('/api/my-huuid/history');
      if (res.status === 401) {
        router.replace('/my-huuid/login');
        return;
      }
      if (!res.ok) {
        setError('Could not load your access history.');
        setLoading(false);
        return;
      }
      const data = await res.json();
      setEntries(data.entries ?? []);
      setLoading(false);
    })();
  }, [router]);

  return (
    <div className="admin-page">
      <div className="admin-shell" style={{ maxWidth: 640 }}>
        <Link href="/my-huuid" style={{ color: 'var(--teal)', fontWeight: 600, fontSize: 13.5 }}>
          ← Back
        </Link>
        <h1 className="admin-title" style={{ margin: '16px 0 4px' }}>Access History</h1>
        <p className="admin-subtitle" style={{ margin: '0 0 24px' }}>
          Every time a healthcare facility has verified your identity.
        </p>

        {loading && <p className="form-helper">Loading…</p>}
        {error && <p className="form-error-text">{error}</p>}

        {!loading && !error && entries.length === 0 && (
          <div className="info-box">
            No access records yet. When a healthcare facility verifies your identity it will appear here.
          </div>
        )}

        {!loading && entries.length > 0 && (
          <div className="myhuuid-history-list">
            {entries.map((entry, i) =>
              entry.kind === 'break_glass' ? (
                <div className="myhuuid-history-card myhuuid-history-card-emergency" key={i}>
                  <div className="myhuuid-history-badge myhuuid-history-badge-emergency">🚨 EMERGENCY ACCESS</div>
                  <div className="myhuuid-history-facility">{entry.facilityName}</div>
                  <div className="myhuuid-history-meta">Clinician License: {entry.clinicianLicense}</div>
                  <div className="myhuuid-history-meta">{formatTimestamp(entry.timestamp)}</div>
                  <p className="myhuuid-history-emergency-note">
                    Emergency access was made to your Healthcare Identity. Your records remain secure and
                    this access has been permanently recorded.
                  </p>
                </div>
              ) : (
                <div className="myhuuid-history-card" key={i}>
                  <div className="myhuuid-history-top-row">
                    <span className="myhuuid-history-datetime">{formatTimestamp(entry.timestamp)}</span>
                    {entry.purposeCode === 'Emergency' ? (
                      <span className="myhuuid-history-badge myhuuid-history-badge-emergency">
                        {PURPOSE_LABEL[entry.purposeCode] ?? entry.purposeCode}
                      </span>
                    ) : (
                      <span className="myhuuid-history-badge myhuuid-history-badge-neutral">
                        {PURPOSE_LABEL[entry.purposeCode] ?? entry.purposeCode}
                      </span>
                    )}
                  </div>
                  <div className="myhuuid-history-facility">{entry.facilityName}</div>
                  <span className={OUTCOME_LABEL[entry.outcome]?.className ?? 'myhuuid-history-outcome-neutral'}>
                    {OUTCOME_LABEL[entry.outcome]?.text ?? entry.outcome}
                  </span>
                </div>
              )
            )}
          </div>
        )}

        <p className="myhuuid-history-privacy-notice">
          Every access to your Healthcare Identity is permanently recorded and cannot be deleted — not
          even by HUUID.
        </p>
      </div>
    </div>
  );
}
