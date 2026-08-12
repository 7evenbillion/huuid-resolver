'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import VerifyIdentity from '@/components/my-huuid/VerifyIdentity';

/** /my-huuid/verify-identity — dedup Layer 7. For patients who skipped
 * verification at enrollment; accessible any time from the dashboard.
 * Auth-gated client-side (same pattern as every other /my-huuid
 * subpage) -- the actual security boundary is server-side in the
 * /api/my-huuid/verify-identity/* routes' patientSession check, this
 * redirect is just so an unauthenticated visitor doesn't see the form
 * before being bounced. */
export default function MyHuuidVerifyIdentityPage() {
  const router = useRouter();
  const [checked, setChecked] = useState(false);

  useEffect(() => {
    (async () => {
      const res = await fetch('/api/my-huuid/security');
      if (res.status === 401) {
        router.replace('/my-huuid/login');
        return;
      }
      setChecked(true);
    })();
  }, [router]);

  if (!checked) {
    return (
      <div className="admin-page">
        <div className="admin-shell" style={{ maxWidth: 560 }}>
          <p className="form-helper">Loading…</p>
        </div>
      </div>
    );
  }

  return <VerifyIdentity />;
}
