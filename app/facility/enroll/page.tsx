import { redirect } from 'next/navigation';
import { facilitySession } from '@/lib/facility-session';
import FacilityEnrollFlow from '@/components/facility/FacilityEnrollFlow';

export const dynamic = 'force-dynamic';

export default async function FacilityEnrollPage() {
  const session = await facilitySession.get();
  if (!session) redirect('/facility/login');

  return <FacilityEnrollFlow />;
}
