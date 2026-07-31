import { redirect } from 'next/navigation';
import Link from 'next/link';
import { facilitySession } from '@/lib/facility-session';
import { getServiceClient } from '@/lib/supabase-server';
import OfflineFallbackNotice from '@/components/facility/OfflineFallbackNotice';

export const dynamic = 'force-dynamic';

export default async function FacilitySettingsPage() {
  const session = await facilitySession.get();
  if (!session) redirect('/facility/login');

  const client = getServiceClient();
  const { data: facility } = await client
    .from('huuid_facilities')
    .select('facility_did, facility_name, certificate_status, created_at')
    .eq('facility_did', session.facilityDid)
    .single();

  return (
    <div className="admin-page">
      <div className="admin-shell" style={{ maxWidth: 640 }}>
        <Link href="/facility" style={{ color: 'var(--teal)', fontWeight: 600, fontSize: 13.5 }}>
          ← Back
        </Link>
        <h1 className="admin-title" style={{ margin: '16px 0 20px' }}>
          Settings
        </h1>
        <div className="admin-detail-section">
          <div className="admin-detail-row">
            <span className="admin-detail-label">Facility Name</span>
            <span className="admin-detail-value">{facility?.facility_name ?? session.facilityName}</span>
          </div>
          <div className="admin-detail-row">
            <span className="admin-detail-label">Facility ID (DID)</span>
            <span className="admin-detail-value" style={{ wordBreak: 'break-all' }}>
              {facility?.facility_did ?? session.facilityDid}
            </span>
          </div>
          <div className="admin-detail-row">
            <span className="admin-detail-label">Certificate Status</span>
            <span className="admin-detail-value">{facility?.certificate_status ?? '—'}</span>
          </div>
          <div className="admin-detail-row">
            <span className="admin-detail-label">Connected Since</span>
            <span className="admin-detail-value">
              {facility?.created_at ? new Date(facility.created_at).toLocaleDateString() : '—'}
            </span>
          </div>
        </div>
      </div>
      <OfflineFallbackNotice />
    </div>
  );
}
