'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';

export default function FacilityApplicationSubmittedPage() {
  const router = useRouter();
  const [applicationId, setApplicationId] = useState<string | null>(null);
  const [phone, setPhone] = useState<string | null>(null);

  useEffect(() => {
    const id = sessionStorage.getItem('huuid_facility_application_id');
    if (!id) {
      router.replace('/facilities/register');
      return;
    }
    setApplicationId(id);
    setPhone(sessionStorage.getItem('huuid_facility_application_phone'));
  }, [router]);

  if (!applicationId) return null;

  return (
    <div className="enroll-page">
      <div className="enroll-shell" style={{ textAlign: 'center' }}>
        <div className="ready-checkmark">
          <svg width="72" height="72" viewBox="0 0 72 72" fill="none">
            <circle cx="36" cy="36" r="30" stroke="#1a8f4c" strokeWidth="4" />
            <path
              d="M22 37l10 10 18-20"
              stroke="#1a8f4c"
              strokeWidth="5"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </div>
        <h1 className="enroll-heading">Application Received</h1>

        <div className="huuid-display-box">
          <span className="huuid-display-text">{applicationId}</span>
        </div>

        {phone && <p className="tier-note">We will contact {phone} within 2 business days.</p>}
        <div className="warning-box">
          <strong>Keep your Application ID safe:</strong> {applicationId}
        </div>
      </div>
    </div>
  );
}
