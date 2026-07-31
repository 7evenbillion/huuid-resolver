import { redirect } from 'next/navigation';
import { facilitySession } from '@/lib/facility-session';
import VerifyPatientFlow from '@/components/facility/VerifyPatientFlow';

export const dynamic = 'force-dynamic';

export default async function FacilityVerifyPage() {
  const session = await facilitySession.get();
  if (!session) redirect('/facility/login');

  return <VerifyPatientFlow facilityName={session.facilityName} />;
}
