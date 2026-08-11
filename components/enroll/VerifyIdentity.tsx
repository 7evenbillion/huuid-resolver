'use client';

import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import EnrollLayout from '@/components/enroll/EnrollLayout';

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
const PRIVACY_POLICY_URL = 'https://usesmileid.com/privacy'; // Smile ID's own privacy notice, shown to the user per their Consent object's required notice_privacy_policy_url

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

export default function VerifyIdentity() {
  const router = useRouter();
  const [smileId, setSmileId] = useState<SmileIdStatus>(null);
  const [stage, setStage] = useState<Stage>('loading');
  const [documentType, setDocumentType] = useState(DOCUMENT_TYPES[0].value);
  const [countryCode, setCountryCode] = useState('GH');
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
      .then((data: SmileIdStatus) => {
        setSmileId(data);
        setStage('select');
      })
      .catch(() => {
        setSmileId({ configured: false, environment: 'sandbox' });
        setStage('select');
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
        // Placeholder capture animation only -- no real Smile ID sandbox
        // account exists in this environment. See the sandbox route's own
        // header comment.
        await sleep(1500); // "Verifying your document…"
        await sleep(1500); // "Verifying your selfie…"
        const res = await fetch('/api/enroll/verify-identity/sandbox', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ documentType, documentCountry: countryCode }),
        });
        if (!res.ok) throw new Error('sandbox verification failed');
        router.push('/enroll/ready');
      } catch {
        setError('Could not complete verification. You can try again or verify at a facility later.');
        setStage('error');
      }
      return;
    }

    // Production: real device camera capture.
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

      const res = await fetch('/api/enroll/verify-identity/start', { method: 'POST', body: form });
      if (!res.ok) throw new Error('submission failed');
      setStage('submitted');
      await sleep(2000);
      router.push('/enroll/ready');
    } catch {
      setError('Could not submit your verification. You can try again or verify at a facility later.');
      setStage('error');
    }
  }

  function handleSkip() {
    stopCamera();
    router.push('/enroll/ready');
  }

  if (stage === 'loading') {
    return (
      <EnrollLayout step={3} heading="Loading…">
        <p>Loading…</p>
      </EnrollLayout>
    );
  }

  if (stage === 'not_configured') {
    return (
      <EnrollLayout step={3} heading="Identity verification is coming soon.">
        <p style={{ marginBottom: 24 }}>
          You will be notified when biometric verification is available. For now, visit any connected healthcare
          facility to verify your identity in person.
        </p>
        <button type="button" className="btn btn-teal btn-block" onClick={handleSkip}>
          Continue to My Card →
        </button>
      </EnrollLayout>
    );
  }

  if (stage === 'sandbox_running') {
    return (
      <EnrollLayout step={3} heading="Verifying your identity…">
        <p>This will only take a moment.</p>
      </EnrollLayout>
    );
  }

  if (stage === 'capture_selfie') {
    return (
      <EnrollLayout step={3} heading="Take a Selfie">
        <p style={{ marginBottom: 16 }}>Position your face in the frame and hold still.</p>
        {/* eslint-disable-next-line jsx-a11y/media-has-caption */}
        <video ref={videoRef} playsInline muted style={{ width: '100%', borderRadius: 12, marginBottom: 16 }} />
        <button type="button" className="btn btn-teal btn-block" onClick={handleCaptureSelfie}>
          Capture →
        </button>
      </EnrollLayout>
    );
  }

  if (stage === 'capture_document' || stage === 'submitting') {
    return (
      <EnrollLayout step={3} heading={`Photograph the Front of Your ${DOCUMENT_TYPES.find((d) => d.value === documentType)?.label ?? 'ID'}`}>
        <p style={{ marginBottom: 16 }}>Hold your document flat, in good light, fully inside the frame.</p>
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
      </EnrollLayout>
    );
  }

  if (stage === 'submitted') {
    return (
      <EnrollLayout step={3} heading="Verification Submitted">
        <p>We&apos;re verifying your identity. You&apos;ll be notified once it&apos;s complete.</p>
      </EnrollLayout>
    );
  }

  if (stage === 'error') {
    return (
      <EnrollLayout step={3} heading="Verification Not Completed">
        {error && <p className="form-error-text" style={{ marginBottom: 20 }}>{error}</p>}
        <button type="button" className="btn btn-teal btn-block" style={{ marginBottom: 12 }} onClick={() => { setStage('select'); setError(null); }}>
          Try Again
        </button>
        <button type="button" className="btn btn-white-outline btn-block" onClick={handleSkip}>
          Skip — I Will Verify at a Facility
        </button>
      </EnrollLayout>
    );
  }

  // stage === 'select'
  return (
    <EnrollLayout step={3} heading="Strengthen Your Healthcare Identity">
      <p style={{ marginBottom: 20 }}>
        Your Healthcare Identity has been created. Verify your identity now to protect against duplicate accounts
        and unlock the full benefits of HUUID.
      </p>

      <div style={{ marginBottom: 20 }}>
        <p style={{ marginBottom: 8 }}>What you will need:</p>
        <p style={{ marginBottom: 4 }}>📄 Your government ID</p>
        <p style={{ marginBottom: 4 }}>📸 A selfie — we check it matches your ID</p>
      </div>

      <div style={{ marginBottom: 20 }}>
        <label htmlFor="document-type" style={{ display: 'block', marginBottom: 6 }}>
          What document will you use?
        </label>
        <select
          id="document-type"
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

      <input
        type="text"
        aria-label="Country code"
        value={countryCode}
        onChange={(e) => setCountryCode(e.target.value.toUpperCase().slice(0, 2))}
        maxLength={2}
        style={{ display: 'none' }}
      />

      <button type="button" className="btn btn-teal btn-block" style={{ marginBottom: 16 }} onClick={handleVerifyClick}>
        Verify My Identity →
      </button>

      <button type="button" className="medical-skip-link" onClick={handleSkip}>
        Skip — I will verify at a facility
      </button>
      <p style={{ fontSize: 13, color: 'var(--text-grey)', marginTop: 8 }}>
        Skipping means your Healthcare Identity has basic duplicate protection only. Visit any connected facility to
        complete full verification.
      </p>
    </EnrollLayout>
  );
}
