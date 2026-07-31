import { getServiceClient } from '@/lib/supabase-server';
import CredentialDownload from '@/components/facilities/CredentialDownload';

export const dynamic = 'force-dynamic';

export default async function CredentialDeliveryPage({ params }: { params: { token: string } }) {
  const client = getServiceClient();
  const { data: delivery } = await client
    .from('huuid_facility_credential_deliveries')
    .select('expires_at, downloaded')
    .eq('download_token', params.token)
    .single();

  if (!delivery) {
    return (
      <div className="enroll-page">
        <div className="enroll-shell" style={{ textAlign: 'center' }}>
          <h1 className="enroll-heading">Link Not Found</h1>
          <p className="enroll-sub">This credential download link does not exist.</p>
        </div>
      </div>
    );
  }

  if (delivery.downloaded) {
    return (
      <div className="enroll-page">
        <div className="enroll-shell" style={{ textAlign: 'center' }}>
          <h1 className="enroll-heading">Already Downloaded</h1>
          <p className="enroll-sub">
            This credential package has already been downloaded and this link can only be used
            once. Contact the HUUID Root Authority if you need help.
          </p>
        </div>
      </div>
    );
  }

  if (new Date(delivery.expires_at).getTime() < Date.now()) {
    return (
      <div className="enroll-page">
        <div className="enroll-shell" style={{ textAlign: 'center' }}>
          <h1 className="enroll-heading">Link Expired</h1>
          <p className="enroll-sub">
            This credential download link has expired. Contact the HUUID Root Authority for a new
            one.
          </p>
        </div>
      </div>
    );
  }

  return <CredentialDownload token={params.token} />;
}
