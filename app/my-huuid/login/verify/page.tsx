'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import EnrollLayout from '@/components/enroll/EnrollLayout';
import OtpInput from '@/components/enroll/OtpInput';

export default function MyHuuidLoginVerifyPage() {
  const router = useRouter();
  const [phoneLast4, setPhoneLast4] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [locked, setLocked] = useState(false);
  const [verifying, setVerifying] = useState(false);
  const [resetKey, setResetKey] = useState(0);

  useEffect(() => {
    const stored = sessionStorage.getItem('huuid_my_huuid_login_phone_last4');
    if (!stored) {
      router.replace('/my-huuid/login');
      return;
    }
    setPhoneLast4(stored);
  }, [router]);

  async function handleComplete(code: string) {
    setVerifying(true);
    setError(null);
    try {
      const res = await fetch('/api/my-huuid/login/otp/verify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? 'Incorrect code.');
        if (data.code === 'locked') setLocked(true);
        setResetKey((k) => k + 1);
        setVerifying(false);
        return;
      }
      sessionStorage.removeItem('huuid_my_huuid_login_phone_last4');
      router.push('/my-huuid');
    } catch {
      setError('Could not reach the server. Check your connection and try again.');
      setResetKey((k) => k + 1);
      setVerifying(false);
    }
  }

  if (!phoneLast4) return null;

  return (
    <EnrollLayout step={1} heading="Enter Your Sign-In Code" sub={`We sent a 6-digit code to a number ending in ${phoneLast4}`}>
      <OtpInput length={6} disabled={verifying || locked} onComplete={handleComplete} resetKey={resetKey} />
      {error && <p className="form-error-text" style={{ textAlign: 'center', marginBottom: 16 }}>{error}</p>}
    </EnrollLayout>
  );
}
