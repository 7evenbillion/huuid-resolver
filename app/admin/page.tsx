import { redirect } from 'next/navigation';
import Link from 'next/link';
import { adminSession } from '@/lib/admin-session';
import { getServiceClient } from '@/lib/supabase-server';
import { FACILITY_TYPE_LABELS } from '@/lib/facility-types';

export const dynamic = 'force-dynamic';

export default async function AdminDashboardPage() {
  const session = await adminSession.get();
  if (!session) redirect('/admin/login');

  const client = getServiceClient();
  const todayStart = new Date();
  todayStart.setUTCHours(0, 0, 0, 0);

  const [pendingRes, facilitiesRes, patientsRes, resolutionsRes, applicationsRes, duplicatesRes] = await Promise.all([
    client.from('huuid_facility_applications').select('id', { count: 'exact', head: true }).eq('status', 'pending'),
    client.from('huuid_facilities').select('id', { count: 'exact', head: true }).eq('certificate_status', 'active'),
    client.from('huuid_patients').select('id', { count: 'exact', head: true }),
    client
      .from('huuid_audit_log')
      .select('id', { count: 'exact', head: true })
      .gte('resolved_at', todayStart.toISOString()),
    client
      .from('huuid_facility_applications')
      .select('application_id, facility_name, facility_type, country_code, region, created_at')
      .eq('status', 'pending')
      .order('created_at', { ascending: true })
      .limit(50),
    client
      .from('huuid_patients')
      .select('id', { count: 'exact', head: true })
      .eq('potential_duplicate', true)
      .eq('duplicate_review_status', 'pending'),
  ]);

  const applications = applicationsRes.data ?? [];

  return (
    <div className="admin-page">
      <div className="admin-shell">
        <header className="admin-header">
          <div>
            <h1 className="admin-title">HUUID Root Authority</h1>
            <p className="admin-subtitle">{new Date().toUTCString()}</p>
          </div>
        </header>

        <div className="admin-cards-row">
          <div className="admin-card">
            <span className="admin-card-icon">📋</span>
            <span className="admin-card-value">{pendingRes.count ?? 0}</span>
            <span className="admin-card-label">Pending Applications</span>
          </div>
          <div className="admin-card">
            <span className="admin-card-icon">✅</span>
            <span className="admin-card-value">{facilitiesRes.count ?? 0}</span>
            <span className="admin-card-label">Active Facilities</span>
          </div>
          <div className="admin-card">
            <span className="admin-card-icon">👥</span>
            <span className="admin-card-value">{patientsRes.count ?? 0}</span>
            <span className="admin-card-label">Enrolled Patients</span>
          </div>
          <div className="admin-card">
            <span className="admin-card-icon">🔍</span>
            <span className="admin-card-value">{resolutionsRes.count ?? 0}</span>
            <span className="admin-card-label">Resolutions Today</span>
          </div>
          <Link href="/admin/duplicates" className="admin-card" style={{ textDecoration: 'none', color: 'inherit' }}>
            <span className="admin-card-icon">⚠️</span>
            <span className="admin-card-value">{duplicatesRes.count ?? 0}</span>
            <span className="admin-card-label">Potential Duplicates</span>
          </Link>
        </div>

        <h2 className="admin-section-heading">Pending Applications</h2>
        {applications.length === 0 && <p className="admin-empty">No pending applications.</p>}
        <div className="admin-app-list">
          {applications.map((app) => (
            <Link key={app.application_id} href={`/admin/applications/${app.application_id}`} className="admin-app-card">
              <div className="admin-app-card-name">{app.facility_name}</div>
              <div className="admin-app-card-meta">
                {FACILITY_TYPE_LABELS[app.facility_type as keyof typeof FACILITY_TYPE_LABELS] ?? app.facility_type} —{' '}
                {app.country_code} — {app.region}
              </div>
              <div className="admin-app-card-meta">
                Applied: {new Date(app.created_at).toLocaleDateString()}
              </div>
              <span className="admin-app-card-review">Review →</span>
            </Link>
          ))}
        </div>
      </div>
    </div>
  );
}
