import EnrollmentForm from '@/components/enroll/EnrollmentForm';
import { detectGeo } from '@/lib/country-detection';

export const dynamic = 'force-dynamic';

export default async function EnrollPage() {
  const geo = await detectGeo();
  return <EnrollmentForm detectedCountry={geo.country} />;
}
