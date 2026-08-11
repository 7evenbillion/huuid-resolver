'use client';

import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import EnrollLayout from '@/components/enroll/EnrollLayout';

export default function DuplicateCheckPage() {
  const router = useRouter();
  const [maskedHuuid, setMaskedHuuid] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const mounted = useRef(false);

  useEffect(() => {
    if (mounted.current) return;
    mounted.current = true;
    fetch('/api/enroll/duplicate-check')
      .then((r) => (r.ok ? r.json() : Promise.reject()))
      .then((data) => {
        if (!data.potentialDuplicate) {
          router.replace('/enroll/secure');
          return;
        }
        setMaskedHuuid(data.maskedHuuid);
        setLoading(false);
      })
      .catch(() => router.replace('/enroll'));
  }, [router]);

  if (loading) {
    return (
      <EnrollLayout step={1} heading="Checking…">
        <p>Loading…</p>
      </EnrollLayout>
    );
  }

  return (
    <EnrollLayout step={1} heading="We Found a Similar Healthcare Identity">
      <p style={{ marginBottom: 20 }}>
        A Healthcare Identity with a similar name and date of birth already exists in our network.
      </p>
      <p style={{ marginBottom: 8 }}>If you already have a HUUID, please use it instead of creating a new one.</p>
      <p style={{ marginBottom: 28, fontFamily: 'monospace', fontSize: 14, color: 'var(--text-grey)' }}>
        Your existing HUUID: {maskedHuuid}
        <br />
        (partial — for your security)
      </p>

      <button type="button" onClick={() => router.push('/my-huuid/login')} style={{ width: '100%', marginBottom: 12 }}>
        Use My Existing HUUID →
      </button>
      <button
        type="button"
        onClick={() => router.push('/enroll/secure')}
        className="secondary"
        style={{ width: '100%' }}
      >
        This Is My First HUUID →
      </button>
    </EnrollLayout>
  );
}
