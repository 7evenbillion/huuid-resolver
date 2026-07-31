import { redirect } from 'next/navigation';
import Link from 'next/link';
import { facilitySession } from '@/lib/facility-session';
import { getServiceClient } from '@/lib/supabase-server';
import OfflineFallbackNotice from '@/components/facility/OfflineFallbackNotice';

export const dynamic = 'force-dynamic';

export default async function FacilityActivityPage() {
  const session = await facilitySession.get();
  if (!session) redirect('/facility/login');

  const client = getServiceClient();
  const todayStart = new Date();
  todayStart.setUTCHours(0, 0, 0, 0);

  const { data: records } = await client
    .from('huuid_audit_log')
    .select('audit_entry_id, huuid, purpose_code, outcome, break_glass, resolved_at')
    .eq('requesting_facility', session.facilityDid)
    .gte('resolved_at', todayStart.toISOString())
    .order('resolved_at', { ascending: false })
    .limit(50);

  const rows = records ?? [];

  return (
    <div className="admin-page">
      <div className="admin-shell" style={{ maxWidth: 720 }}>
        <Link href="/facility" style={{ color: 'var(--teal)', fontWeight: 600, fontSize: 13.5 }}>
          ← Back
        </Link>
        <h1 className="admin-title" style={{ margin: '16px 0 20px' }}>
          Today&apos;s Activity
        </h1>
        {rows.length === 0 && <p className="admin-empty">No resolutions yet today.</p>}
        <div className="admin-app-list">
          {rows.map((r) => (
            <div className="admin-app-card" key={r.audit_entry_id} style={{ cursor: 'default' }}>
              <div className="admin-app-card-name" style={{ fontSize: 14, wordBreak: 'break-all' }}>
                {r.huuid}
              </div>
              <div className="admin-app-card-meta">
                {r.purpose_code} — {r.outcome}
                {r.break_glass ? ' — Break-Glass' : ''}
              </div>
              <div className="admin-app-card-meta">{new Date(r.resolved_at).toLocaleTimeString()}</div>
            </div>
          ))}
        </div>
      </div>
      <OfflineFallbackNotice />
    </div>
  );
}
