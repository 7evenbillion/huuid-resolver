import { redirect } from 'next/navigation';
import Link from 'next/link';
import Image from 'next/image';
import { patientSession } from '@/lib/patient-session';
import { getServiceClient } from '@/lib/supabase-server';
import { getPiiKey } from '@/lib/pii';
import SignOutButton from '@/components/my-huuid/SignOutButton';

export const dynamic = 'force-dynamic';

interface PatientIdentityRow {
  full_name: string;
  country_code: string;
  verification_tier: number;
  status: string;
  created_at: string;
}

/**
 * /my-huuid — Layer 2 home dashboard. patientSession (lib/patient-session.ts)
 * only carries huuid/phone, not the patient's name, so it's fetched here via
 * huuid_get_patient_by_huuid (migration 013) rather than duplicating PII into
 * the session cookie. A session pointing at a since-revoked/erased HUUID is
 * treated as invalid -- same trust boundary as a missing session.
 */
export default async function MyHuuidHomePage() {
  const session = await patientSession.get();
  if (!session) redirect('/my-huuid/login');

  const client = getServiceClient();
  const { data, error } = await client
    .rpc('huuid_get_patient_by_huuid', { p_huuid: session.huuid, p_pii_key: getPiiKey() })
    .maybeSingle();

  const patient = data as PatientIdentityRow | null;
  if (error || !patient || patient.status !== 'active') {
    await patientSession.clear();
    redirect('/my-huuid/login');
  }

  const huuidShort = `${session.huuid.slice(0, 18)}…${session.huuid.slice(-6)}`;

  return (
    <div className="myhuuid-page">
      <div className="myhuuid-topbar">
        <div className="myhuuid-topbar-left">
          <Image src="/images/logo-h.png" alt="HUUID" width={32} height={32} />
          <div>
            <div className="myhuuid-name">{patient.full_name}</div>
            <div className="myhuuid-id" title={session.huuid}>{huuidShort}</div>
          </div>
        </div>
        <SignOutButton />
      </div>

      <div className="myhuuid-main">
        <p className="myhuuid-welcome">Welcome back. What would you like to do?</p>

        <div className="myhuuid-card-grid">
          <Link href="/my-huuid/profile" className="myhuuid-card">
            <span className="myhuuid-card-icon">👤</span>
            <span className="myhuuid-card-title">My Profile</span>
            <span className="myhuuid-card-sub">Name, contact, emergency details</span>
          </Link>

          <Link href="/my-huuid/medical" className="myhuuid-card">
            <span className="myhuuid-card-icon">🩺</span>
            <span className="myhuuid-card-title">Medical Information</span>
            <span className="myhuuid-card-sub">Blood type, allergies, conditions</span>
          </Link>

          <Link href="/my-huuid/card" className="myhuuid-card">
            <span className="myhuuid-card-icon">🪪</span>
            <span className="myhuuid-card-title">My Card</span>
            <span className="myhuuid-card-sub">View, download, print your card</span>
          </Link>

          <Link href="/my-huuid/history" className="myhuuid-card">
            <span className="myhuuid-card-icon">📜</span>
            <span className="myhuuid-card-title">Access History</span>
            <span className="myhuuid-card-sub">Who has viewed your records</span>
          </Link>
        </div>

        <div className="myhuuid-footer-links">
          <Link href="/my-huuid/consent">Consent Management</Link>
          <span className="myhuuid-footer-dot">·</span>
          <Link href="/my-huuid/settings">Security Settings</Link>
        </div>
      </div>
    </div>
  );
}
