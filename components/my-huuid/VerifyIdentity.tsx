'use client';

import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';

type SmileIdStatus = { configured: boolean; environment: 'sandbox' | 'production' } | null;

type Stage =
  | 'loading'
  | 'select'
  | 'not_configured'
  | 'sandbox_running'
  | 'capture_selfie'
  | 'capture_document'
  | 'submitting'
  | 'submitted'
  | 'error';

const DOCUMENT_TYPES: { value: string; label: string }[] = [
  { value: 'national_id', label: '🇬🇭 Ghana Card (National ID)' },
  { value: 'passport', label: '🛂 Passport (any country)' },
  { value: 'voters_id', label: "🗳️ Voter's ID Card" },
  { value: 'drivers_license', label: '🚗 Driver’s License' },
  { value: 'nhis', label: '📋 NHIS Card' },
  { value: 'other', label: '📄 Other national ID' },
];

const LIVENESS_FRAME_COUNT = 6;
const LIVENESS_FRAME_INTERVAL_MS = 200;
const PRIVACY_POLICY_URL = 'https://usesmileid.com/privacy';

function captureFrame(video: HTMLVideoElement): Promise<Blob> {
  const canvas = document.createElement('canvas');
  canvas.width = video.videoWidth;
  canvas.height = video.videoHeight;
  const ctx = canvas.getContext('2d');
  if (!ctx) return Promise.reject(new Error('Could not access canvas.'));
  ctx.drawImage(video, 0, 0);
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error('Could not capture frame.'))), 'image/jpeg', 0.9);
  });
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Dedup Layer 7 — same document/selfie/liveness capture flow as
 * components/enroll/VerifyIdentity.tsx (dedup Layer 3), but for an
 * already-enrolled, logged-in patient completing verification later
 * from /my-huuid rather than at enrollment: posts to the
 * /api/my-huuid/verify-identity/* routes (patientSession-based) instead
 * of /api/enroll/verify-identity/* (postEnrollmentSession-based), and
 * returns to /my-huuid/settings rather than /enroll/ready. */
export default function VerifyIdentity() {
  const router = useRouter();
  const [smileId, setSmileId] = useState<SmileIdStatus>(null);
  const [stage, setStage] = useState<Stage>('loading');
  const [documentType, setDocumentType] = useState(DOCUMENT_TYPES[0].value);
  const [countryCode] = useState('GH');
  const [error, setError] = useState<string | null>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const selfieBlobRef = useRef<Blob | null>(null);
  const livenessBlobsRef = useRef<Blob[]>([]);
  const mounted = useRef(false);

  useEffect(() => {
    if (mounted.current) return;
    mounted.current = true;
    fetch('/api/smile-id/status')
      .then((r) => (r.ok ? r.json() : Promise.reject()))
      .then((data: NonNullable<SmileIdStatus>) => {
        setSmileId(data);
        setStage(data.configured ? 'select' : 'not_configured');
      })
      .catch(() => {
        setSmileId({ configured: false, environment: 'sandbox' });
        setStage('not_configured');
      });
  }, []);

  useEffect(() => {
    return () => {
      streamRef.current?.getTracks().forEach((t) => t.stop());
    };
  }, []);

  async function startCamera() {
    const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'user' } });
    streamRef.current = stream;
    if (videoRef.current) {
      videoRef.current.srcObject = stream;
      await videoRef.current.play();
    }
  }

  function stopCamera() {
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
  }

  async function handleVerifyClick() {
    setError(null);
    if (!smileId?.configured) {
      setStage('not_configured');
      return;
    }
    if (smileId.environment === 'sandbox') {
      setStage('sandbox_running');
      try {
        await sleep(1500);
        await sleep(1500);
        const res = await fetch('/api/my-huuid/verify-identity/sandbox', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ documentType, documentCountry: countryCode }),
        });
        if (res.status === 401) {
          router.replace('/my-huuid/login');
          return;
        }
        if (!res.ok) throw new Error('sandbox verification failed');
        router.push('/my-huuid/settings');
      } catch {
        setError('Could not complete verification. You can try again or verify at a facility later.');
        setStage('error');
      }
      return;
    }

    try {
      await startCamera();
      setStage('capture_selfie');
    } catch {
      setError('Camera access is needed to verify your identity. You can verify at a facility instead.');
      setStage('error');
    }
  }

  async function handleCaptureSelfie() {
    if (!videoRef.current) return;
    try {
      selfieBlobRef.current = await captureFrame(videoRef.current);
      const frames: Blob[] = [];
      for (let i = 0; i < LIVENESS_FRAME_COUNT; i++) {
        frames.push(await captureFrame(videoRef.current));
        await sleep(LIVENESS_FRAME_INTERVAL_MS);
      }
      livenessBlobsRef.current = frames;
      setStage('capture_document');
    } catch {
      setError('Could not capture your photo. Please try again.');
      setStage('error');
    }
  }

  async function handleCaptureDocument() {
    if (!videoRef.current || !selfieBlobRef.current) return;
    setStage('submitting');
    try {
      const documentBlob = await captureFrame(videoRef.current);
      stopCamera();

      const form = new FormData();
      form.append('selfie_image', selfieBlobRef.current, 'selfie.jpg');
      for (const frame of livenessBlobsRef.current) form.append('liveness_images', frame, 'liveness.jpg');
      form.append('document_front', documentBlob, 'document.jpg');
      form.append('country_code', countryCode);
      form.append('document_type', documentType);
      form.append('notice_privacy_policy_url', PRIVACY_POLICY_URL);

      const res = await fetch('/api/my-huuid/verify-identity/start', { method: 'POST', body: form });
      if (res.status === 401) {
        router.replace('/my-huuid/login');
        return;
      }
      if (!res.ok) throw new Error('submission failed');
      setStage('submitted');
      await sleep(2000);
      router.push('/my-huuid/settings');
    } catch {
      setError('Could not submit your verification. You can try again or verify at a facility later.');
      setStage('error');
    }
  }

  function handleBackToSettings() {
    stopCamera();
    router.push('/my-huuid/settings');
  }

  return (
    <div className="admin-page">
      <div className="admin-shell" style={{ maxWidth: 560 }}>
        <Link href="/my-huuid/settings" style={{ color: 'var(--teal)', fontWeight: 600, fontSize: 13.5 }}>
          ← Back to Settings
        </Link>
        <h1 className="admin-title" style={{ margin: '16px 0 24px' }}>Verify Your Identity</h1>

        {stage === 'loading' && <p className="form-helper">Loading…</p>}

        {stage === 'not_configured' && (
          <div>
            <p style={{ marginBottom: 24 }}>
              Biometric identity verification is coming soon for self-service.
            </p>
            <p style={{ marginBottom: 24 }}>
              To verify now, visit any connected healthcare facility with your government ID document.
            </p>
            <Link href="/my-huuid/settings" className="btn btn-teal btn-block" style={{ textAlign: 'center', display: 'block' }}>
              Back to Settings
            </Link>
          </div>
        )}

        {stage === 'sandbox_running' && <p>Verifying your identity… this will only take a moment.</p>}

        {stage === 'capture_selfie' && (
          <>
            <p style={{ marginBottom: 16 }}>Position your face in the frame and hold still.</p>
            {/* eslint-disable-next-line jsx-a11y/media-has-caption */}
            <video ref={videoRef} playsInline muted style={{ width: '100%', borderRadius: 12, marginBottom: 16 }} />
            <button type="button" className="btn btn-teal btn-block" onClick={handleCaptureSelfie}>
              Capture →
            </button>
          </>
        )}

        {(stage === 'capture_document' || stage === 'submitting') && (
          <>
            <p style={{ marginBottom: 16 }}>
              Photograph the front of your {DOCUMENT_TYPES.find((d) => d.value === documentType)?.label ?? 'ID'}. Hold
              it flat, in good light, fully inside the frame.
            </p>
            {/* eslint-disable-next-line jsx-a11y/media-has-caption */}
            <video ref={videoRef} playsInline muted style={{ width: '100%', borderRadius: 12, marginBottom: 16 }} />
            <button
              type="button"
              className="btn btn-teal btn-block"
              onClick={handleCaptureDocument}
              disabled={stage === 'submitting'}
            >
              {stage === 'submitting' ? 'Submitting…' : 'Capture →'}
            </button>
          </>
        )}

        {stage === 'submitted' && (
          <p>We&apos;re verifying your identity. You&apos;ll be notified once it&apos;s complete.</p>
        )}

        {stage === 'error' && (
          <>
            {error && <p className="form-error-text" style={{ marginBottom: 20 }}>{error}</p>}
            <button
              type="button"
              className="btn btn-teal btn-block"
              style={{ marginBottom: 12 }}
              onClick={() => { setStage('select'); setError(null); }}
            >
              Try Again
            </button>
            <button type="button" className="btn btn-white-outline btn-block" onClick={handleBackToSettings}>
              Back to Settings
            </button>
          </>
        )}

        {stage === 'select' && (
          <>
            <p style={{ marginBottom: 20 }}>
              Verify your identity to protect against duplicate accounts and unlock the full benefits of HUUID.
            </p>

            <div style={{ marginBottom: 20 }}>
              <p style={{ marginBottom: 8 }}>What you will need:</p>
              <p style={{ marginBottom: 4 }}>📄 Your government ID</p>
              <p style={{ marginBottom: 4 }}>📸 A selfie — we check it matches your ID</p>
            </div>

            <div style={{ marginBottom: 20 }}>
              <label htmlFor="my-huuid-document-type" style={{ display: 'block', marginBottom: 6 }}>
                What document will you use?
              </label>
              <select
                id="my-huuid-document-type"
                value={documentType}
                onChange={(e) => setDocumentType(e.target.value)}
                style={{ width: '100%', padding: 10 }}
              >
                {DOCUMENT_TYPES.map((d) => (
                  <option key={d.value} value={d.value}>
                    {d.label}
                  </option>
                ))}
              </select>
            </div>

            <button type="button" className="btn btn-teal btn-block" style={{ marginBottom: 16 }} onClick={handleVerifyClick}>
              Verify My Identity →
            </button>

            <button type="button" className="medical-skip-link" onClick={handleBackToSettings}>
              Back to Settings
            </button>
          </>
        )}
      </div>
    </div>
  );
}
