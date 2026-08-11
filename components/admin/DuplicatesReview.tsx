'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

export interface DuplicatePair {
  new_huuid: string;
  new_full_name: string;
  new_verification_tier: number;
  new_created_at: string;
  new_phone_last4: string;
  existing_huuid: string | null;
  existing_full_name: string | null;
  existing_verification_tier: number | null;
  existing_created_at: string | null;
  existing_phone_last4: string | null;
  pms_score: number | null;
}

export default function DuplicatesReview({ pairs }: { pairs: DuplicatePair[] }) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function run(huuid: string, path: string, body: object) {
    setBusy(huuid);
    setError(null);
    try {
      const res = await fetch(path, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data.error ?? 'Action failed.');
        setBusy(null);
        return;
      }
      router.refresh();
    } catch {
      setError('Could not reach the server.');
    }
    setBusy(null);
  }

  return (
    <div>
      {error && <p className="form-error-text" style={{ marginBottom: 16 }}>{error}</p>}
      <div className="admin-app-list">
        {pairs.map((p) => (
          <div key={p.new_huuid} className="admin-detail-section" style={{ marginBottom: 20 }}>
            <div style={{ fontWeight: 700, marginBottom: 12 }}>
              ⚠️ POTENTIAL DUPLICATE — Review Required
              {p.pms_score !== null && (
                <span style={{ fontWeight: 400, fontSize: 13, color: 'var(--text-grey)' }}>
                  {' '}
                  (match score: {p.pms_score.toFixed(2)})
                </span>
              )}
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, marginBottom: 16 }}>
              <div>
                <div style={{ fontSize: 12, color: 'var(--text-grey)', marginBottom: 4 }}>NEW ENROLLMENT</div>
                <div className="admin-detail-row">
                  <span className="admin-detail-label">Name</span>
                  <span className="admin-detail-value">{p.new_full_name}</span>
                </div>
                <div className="admin-detail-row">
                  <span className="admin-detail-label">HUUID</span>
                  <span className="admin-detail-value" style={{ fontSize: 12 }}>{p.new_huuid}</span>
                </div>
                <div className="admin-detail-row">
                  <span className="admin-detail-label">Phone</span>
                  <span className="admin-detail-value">+233 **** {p.new_phone_last4}</span>
                </div>
                <div className="admin-detail-row">
                  <span className="admin-detail-label">Enrolled</span>
                  <span className="admin-detail-value">{new Date(p.new_created_at).toLocaleDateString()}</span>
                </div>
                <div className="admin-detail-row">
                  <span className="admin-detail-label">Tier</span>
                  <span className="admin-detail-value">{p.new_verification_tier}</span>
                </div>
              </div>

              <div>
                <div style={{ fontSize: 12, color: 'var(--text-grey)', marginBottom: 4 }}>EXISTING RECORD</div>
                {p.existing_huuid ? (
                  <>
                    <div className="admin-detail-row">
                      <span className="admin-detail-label">Name</span>
                      <span className="admin-detail-value">{p.existing_full_name}</span>
                    </div>
                    <div className="admin-detail-row">
                      <span className="admin-detail-label">HUUID</span>
                      <span className="admin-detail-value" style={{ fontSize: 12 }}>{p.existing_huuid}</span>
                    </div>
                    <div className="admin-detail-row">
                      <span className="admin-detail-label">Phone</span>
                      <span className="admin-detail-value">+233 **** {p.existing_phone_last4}</span>
                    </div>
                    <div className="admin-detail-row">
                      <span className="admin-detail-label">Enrolled</span>
                      <span className="admin-detail-value">
                        {p.existing_created_at ? new Date(p.existing_created_at).toLocaleDateString() : '—'}
                      </span>
                    </div>
                    <div className="admin-detail-row">
                      <span className="admin-detail-label">Tier</span>
                      <span className="admin-detail-value">{p.existing_verification_tier}</span>
                    </div>
                  </>
                ) : (
                  <p className="admin-empty">No linked existing record (referenced HUUID not found).</p>
                )}
              </div>
            </div>

            <div className="admin-action-row" style={{ flexWrap: 'wrap' }}>
              <button
                className="btn btn-white-outline"
                disabled={busy === p.new_huuid}
                onClick={() => run(p.new_huuid, '/api/admin/duplicates/clear', { huuid: p.new_huuid })}
              >
                ✅ NOT A DUPLICATE — CLEAR FLAG
              </button>
              {p.existing_huuid && (
                <button
                  className="btn btn-teal"
                  disabled={busy === p.new_huuid}
                  onClick={() =>
                    run(p.new_huuid, '/api/admin/duplicates/merge', { huuidA: p.new_huuid, huuidB: p.existing_huuid })
                  }
                >
                  ⚠️ CONFIRMED DUPLICATE — MERGE
                </button>
              )}
              <button
                className="btn btn-red"
                disabled={busy === p.new_huuid}
                onClick={() => run(p.new_huuid, '/api/admin/duplicates/fraud-escalate', { huuid: p.new_huuid })}
              >
                🚨 FRAUD SUSPECTED — ESCALATE
              </button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
