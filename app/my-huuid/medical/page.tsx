'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import MedicalProfileEditForm from '@/components/my-huuid/MedicalProfileEditForm';

export default function MyHuuidMedicalPage() {
  const router = useRouter();
  const [isFemale, setIsFemale] = useState<boolean | null>(null);

  useEffect(() => {
    (async () => {
      const res = await fetch('/api/my-huuid/profile');
      if (res.status === 401) {
        router.replace('/my-huuid/login');
        return;
      }
      const data = await res.json();
      setIsFemale(data.sexAtBirth === 'female');
    })();
  }, [router]);

  return (
    <div className="admin-page">
      <div className="admin-shell" style={{ maxWidth: 640 }}>
        <Link href="/my-huuid" style={{ color: 'var(--teal)', fontWeight: 600, fontSize: 13.5 }}>
          ← Back
        </Link>
        <h1 className="admin-title" style={{ margin: '16px 0 4px' }}>Medical Information</h1>
        <p className="admin-subtitle" style={{ margin: '0 0 24px' }}>
          Keep this up to date so clinicians have your latest information.
        </p>

        {isFemale === null ? (
          <p className="form-helper">Loading…</p>
        ) : (
          <MedicalProfileEditForm isFemale={isFemale} />
        )}
      </div>
    </div>
  );
}
