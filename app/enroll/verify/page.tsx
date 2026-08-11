'use client';

import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import EnrollLayout from '@/components/enroll/EnrollLayout';
import OtpInput from '@/components/enroll/OtpInput';

const OTP_EXPIRY_SECONDS = 10 * 60;
const RESEND_COOLDOWN_SECONDS = 60;
const MAX_RESENDS = 3;

export default function VerifyPage() {
  const router = useRouter();
  const [phoneLast4, setPhoneLast4] = useState<string | null>(null);
  const [secondsLeft, setSecondsLeft] = useState(OTP_EXPIRY_SECONDS);
  const [resendCooldown, setResendCooldown] = useState(RESEND_COOLDOWN_SECONDS);
  const [resendCount, setResendCount] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [locked, setLocked] = useState(false);
  const [verifying, setVerifying] = useState(false);
  const [resetKey, setResetKey] = useState(0);
  const mounted = useRef(false);

  useEffect(() => {
    if (mounted.current) return;
    mounted.current = true;
    fetch('/api/enroll/session-status')
      .then((r) => (r.ok ? r.json() : Promise.reject()))
      .then((data) => {
        if (data.phoneVerified) {
          router.replace('/enroll/secure');
        } else {
          setPhoneLast4(data.phoneLast4);
        }
      })
      .catch(() => router.replace('/enroll'));
  }, [router]);

  useEffect(() => {
    const t = setInterval(() => setSecondsLeft((s) => Math.max(0, s - 1)), 1000);
    return () => clearInterval(t);
  }, []);

  useEffect(() => {
    if (resendCooldown <= 0) return;
    const t = setInterval(() => setResendCooldown((s) => Math.max(0, s - 1)), 1000);
    return () => clearInterval(t);
  }, [resendCooldown]);

  async function handleComplete(code: string) {
    setVerifying(true);
    setError(null);
    try {
      const res = await fetch('/api/enroll/verify-otp', {
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

      // Dedup Layer 2: check for a similar existing identity before the
      // user does the whole WebAuthn/PIN/keygen flow on /enroll/secure.
      // A failure here shouldn't block enrollment -- fail open to
      // /enroll/secure, same as every other best-effort check in this flow.
      try {
        const dupRes = await fetch('/api/enroll/duplicate-check', { method: 'POST' });
        const dupData = await dupRes.json();
        if (dupRes.ok && dupData.potentialDuplicate) {
          router.push('/enroll/duplicate-check');
          return;
        }
      } catch {
        // fall through to /enroll/secure
      }

      router.push('/enroll/secure');
    } catch {
      setError('Could not reach the server. Check your connection and try again.');
      setResetKey((k) => k + 1);
      setVerifying(false);
    }
  }

  async function handleResend() {
    if (resendCooldown > 0 || resendCount >= MAX_RESENDS) return;
    setError(null);
    try {
      const res = await fetch('/api/enroll/resend-otp', { method: 'POST' });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? 'Could not resend code.');
        return;
      }
      setSecondsLeft(OTP_EXPIRY_SECONDS);
      setResendCooldown(RESEND_COOLDOWN_SECONDS);
      setResendCount((c) => c + 1);
      setLocked(false);
    } catch {
      setError('Could not reach the server.');
    }
  }

  const minutes = Math.floor(secondsLeft / 60);
  const seconds = secondsLeft % 60;

  return (
    <EnrollLayout
      step={1}
      heading="Verify Your Phone Number"
      sub={phoneLast4 ? `We sent a 6-digit code to a number ending in ${phoneLast4}` : 'Loading…'}
    >
      <OtpInput length={6} disabled={verifying || locked} onComplete={handleComplete} resetKey={resetKey} />

      <p className="otp-timer">
        {secondsLeft > 0 ? `Code expires in ${minutes}:${seconds.toString().padStart(2, '0')}` : 'Code expired.'}
      </p>

      {error && <p className="form-error-text" style={{ textAlign: 'center', marginBottom: 16 }}>{error}</p>}

      <p className="otp-resend">
        {resendCount >= MAX_RESENDS ? (
          <span style={{ color: 'var(--text-grey)' }}>Maximum resends reached.</span>
        ) : resendCooldown > 0 ? (
          <span style={{ color: 'var(--text-grey)' }}>Resend in {resendCooldown}s</span>
        ) : (
          <button type="button" onClick={handleResend}>
            Resend Code
          </button>
        )}
      </p>
    </EnrollLayout>
  );
}
