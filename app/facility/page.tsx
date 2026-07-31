import { redirect } from 'next/navigation';
import Link from 'next/link';
import { facilitySession } from '@/lib/facility-session';
import NetworkStatus from '@/components/facility/NetworkStatus';
import EmergencySupportButton from '@/components/facility/EmergencySupportButton';

export const dynamic = 'force-dynamic';

export default async function FacilityHomePage() {
  const session = await facilitySession.get();
  if (!session) redirect('/facility/login');

  return (
    <div className="facility-page">
      <div className="facility-topbar">
        <div className="facility-topbar-left">
          <span className="facility-name">{session.facilityName}</span>
          <NetworkStatus />
        </div>
        <Link href="/facility/settings" className="facility-settings-link">
          ⚙️ Settings
        </Link>
      </div>

      <div className="facility-main">
        <Link href="/facility/verify" className="facility-verify-btn">
          <span className="facility-verify-icon">🔍</span>
          <span className="facility-verify-title">VERIFY A PATIENT</span>
          <span className="facility-verify-sub">Scan card or enter ID</span>
        </Link>

        <div className="facility-secondary-row">
          <Link href="/facility/enroll" className="facility-secondary-btn">
            ➕ Register New Patient
          </Link>
          <Link href="/facility/activity" className="facility-secondary-btn">
            📋 Today&apos;s Activity
          </Link>
        </div>
      </div>

      <EmergencySupportButton facilityName={session.facilityName} />

      <div className="facility-offline-notice">
        If HUUID is unavailable: scan patient&apos;s QR card offline using the HUUID Stub app. Blood
        type and allergies are always available on the card.
      </div>
    </div>
  );
}
