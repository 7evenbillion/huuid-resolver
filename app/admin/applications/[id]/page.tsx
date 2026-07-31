import { redirect, notFound } from 'next/navigation';
import { adminSession } from '@/lib/admin-session';
import { getServiceClient } from '@/lib/supabase-server';
import { FACILITY_TYPE_LABELS, EMR_SYSTEM_LABELS } from '@/lib/facility-types';
import ApplicationActions from '@/components/admin/ApplicationActions';

export const dynamic = 'force-dynamic';

export default async function AdminApplicationDetailPage({ params }: { params: { id: string } }) {
  const session = await adminSession.get();
  if (!session) redirect('/admin/login');

  const client = getServiceClient();
  const { data: app } = await client
    .from('huuid_facility_applications')
    .select('*')
    .eq('application_id', params.id)
    .single();

  if (!app) notFound();

  const rows: [string, string][] = [
    ['Application ID', app.application_id],
    ['Status', app.status],
    ['Facility Name', app.facility_name],
    [
      'Facility Type',
      FACILITY_TYPE_LABELS[app.facility_type as keyof typeof FACILITY_TYPE_LABELS] ?? app.facility_type,
    ],
    ['Country', app.country_code],
    ['Region', app.region],
    ['Physical Address', app.physical_address],
    ['Government Registration Number', app.government_registration_number],
    ['Patient Records System', EMR_SYSTEM_LABELS[app.emr_system as keyof typeof EMR_SYSTEM_LABELS] ?? app.emr_system],
    ['Estimated Daily Patients', String(app.estimated_daily_patients)],
    ['Authorised Signatory', `${app.authorised_signatory_name} (${app.authorised_signatory_role})`],
    ['Signatory Phone', app.authorised_signatory_phone],
    ['Signatory Email', app.authorised_signatory_email ?? '—'],
    ['IT Contact', app.it_contact_name],
    ['IT Contact Phone', app.it_contact_phone],
    ['Applied', new Date(app.created_at).toUTCString()],
  ];

  return (
    <div className="admin-page">
      <div className="admin-shell" style={{ maxWidth: 720 }}>
        <h1 className="admin-title" style={{ marginBottom: 20 }}>
          {app.facility_name}
        </h1>

        <div className="admin-detail-section">
          {rows.map(([label, value]) => (
            <div className="admin-detail-row" key={label}>
              <span className="admin-detail-label">{label}</span>
              <span className="admin-detail-value">{value}</span>
            </div>
          ))}
        </div>

        {app.status === 'pending' ? (
          <ApplicationActions applicationId={app.application_id} facilityName={app.facility_name} />
        ) : (
          <div className="warning-box">
            This application is already <strong>{app.status}</strong>.
            {app.facility_did && (
              <>
                <br />
                Facility DID: {app.facility_did}
              </>
            )}
            {app.rejection_reason && (
              <>
                <br />
                Reason: {app.rejection_reason}
              </>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
