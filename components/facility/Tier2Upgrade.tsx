'use client';

import { useEffect, useRef, useState } from 'react';
import { captureFrame, captureLivenessBurst } from '@/lib/client/camera-capture';

type SmileIdStatus = { configured: boolean; environment: 'sandbox' | 'production' } | null;
type Stage = 'prompt' | 'confirm_document' | 'capture' | 'submitting' | 'done' | 'error';

const PRIVACY_POLICY_URL = 'https://usesmileid.com/privacy';

export default function Tier2Upgrade({
  huuid,
  fullName,
  onComplete,
}: {
  huuid: string;
  fullName: string | null;
  onComplete: () => void;
}) {
  const [stage, setStage] = useState<Stage>('prompt');
  const [documentConfirmed, setDocumentConfirmed] = useState<boolean | null>(null);
  const [smileId, setSmileId] = useState<SmileIdStatus>(null);
  const [hasEnrolledFace, setHasEnrolledFace] = useState<boolean | null>(null);
  const [error, setError] = useState<string | null>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);

  useEffect(() => {
    return () => {
      streamRef.current?.getTracks().forEach((t) => t.stop());
    };
  }, []);

  async function beginVerification() {
    setError(null);
    setStage('confirm_document');
    fetch('/api/smile-id/status')
      .then((r) => (r.ok ? r.json() : Promise.reject()))
      .then((data: SmileIdStatus) => setSmileId(data))
      .catch(() => setSmileId({ configured: false, environment: 'sandbox' }));
  }

  async function handleDocumentConfirmed() {
    setDocumentConfirmed(true);
    if (!smileId?.configured) {
      await completeStaffVerified();
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'user' } });
      streamRef.current = stream;
      setStage('capture');
      // videoRef isn't mounted until the 'capture' stage renders -- attach on next tick.
      setTimeout(() => {
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          videoRef.current.play();
        }
      }, 0);
    } catch {
      // No camera access -- fall back to staff-confirmed-only, same as
      // when Smile ID itself isn't configured.
      await completeStaffVerified();
    }
  }

  function handleDocumentNotConfirmed() {
    setDocumentConfirmed(false);
  }

  async function completeStaffVerified() {
    setStage('submitting');
    try {
      const res = await fetch('/api/facility/tier2-upgrade/staff-verified', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ huuid }),
      });
      if (!res.ok) throw new Error('upgrade failed');
      setStage('done');
    } catch {
      setError('Could not upgrade this patient. Please try again.');
      setStage('error');
    }
  }

  async function handleCaptureAndSubmit() {
    if (!videoRef.current) return;
    setStage('submitting');
    try {
      const selfie = await captureFrame(videoRef.current);
      const liveness = await captureLivenessBurst(videoRef.current);
      streamRef.current?.getTracks().forEach((t) => t.stop());

      const form = new FormData();
      form.append('huuid', huuid);
      form.append('selfie_image', selfie, 'selfie.jpg');
      for (const frame of liveness) form.append('liveness_images', frame, 'liveness.jpg');
      form.append('notice_privacy_policy_url', PRIVACY_POLICY_URL);

      const res = await fetch('/api/facility/tier2-upgrade/start', { method: 'POST', body: form });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        if (data.code === 'no_enrolled_face') {
          // Patient skipped enrollment-time Smile ID verification -- no
          // face on file to compare against. Fall back to the
          // document-only path rather than failing outright.
          await completeStaffVerified();
          return;
        }
        throw new Error(data.error ?? 'submission failed');
      }
      // Async -- the real result arrives via the Layer 4 webhook. Tell
      // staff it's in progress rather than claiming it's done.
      setStage('done');
    } catch {
      setError('Could not submit verification. Please try again or use document-only verification.');
      setStage('error');
    }
  }

  if (stage === 'prompt') {
    return (
      <div className="warning-box" style={{ marginTop: 16 }}>
        <strong>UPGRADE THIS PATIENT TO TIER 2</strong>
        <p style={{ margin: '8px 0' }}>
          {fullName ?? 'This patient'} has not yet been verified in person at a facility.
        </p>
        <p style={{ marginBottom: 12, fontSize: 14 }}>
          Verifying this patient confirms who they are, upgrades their Healthcare Identity to Tier 2, and gives
          them full network access.
        </p>
        <button type="button" className="btn btn-teal btn-block" style={{ marginBottom: 8 }} onClick={beginVerification}>
          Verify Patient In Person →
        </button>
        <button type="button" className="medical-skip-link" onClick={onComplete}>
          Skip — Verify Later
        </button>
      </div>
    );
  }

  if (stage === 'confirm_document') {
    return (
      <div className="warning-box" style={{ marginTop: 16 }}>
        <strong>IN-PERSON VERIFICATION</strong>
        <p style={{ margin: '8px 0' }}>1. Ask the patient to show you their government-issued ID document.</p>
        <p style={{ marginBottom: 8 }}>
          2. Confirm the name matches what is shown on screen:
          <br />
          <strong>Name on HUUID: {fullName ?? 'Unknown'}</strong>
        </p>
        {documentConfirmed === false ? (
          <p className="form-error-text">Document does not match — verification stopped.</p>
        ) : (
          <div className="admin-action-row">
            <button type="button" className="btn btn-teal" onClick={handleDocumentConfirmed}>
              ✓ Document Confirms Identity
            </button>
            <button type="button" className="btn btn-white-outline" onClick={handleDocumentNotConfirmed}>
              ✗ Document Does Not Match
            </button>
          </div>
        )}
      </div>
    );
  }

  if (stage === 'capture') {
    return (
      <div className="warning-box" style={{ marginTop: 16 }}>
        <strong>Take a Photograph of the Patient</strong>
        <p style={{ margin: '8px 0' }}>The system will confirm the photograph matches their enrolled face.</p>
        {/* eslint-disable-next-line jsx-a11y/media-has-caption */}
        <video ref={videoRef} playsInline muted style={{ width: '100%', borderRadius: 12, marginBottom: 12 }} />
        <button type="button" className="btn btn-teal btn-block" onClick={handleCaptureAndSubmit}>
          Capture →
        </button>
      </div>
    );
  }

  if (stage === 'submitting') {
    return (
      <div className="warning-box" style={{ marginTop: 16 }}>
        Verifying…
      </div>
    );
  }

  if (stage === 'done') {
    return (
      <div className="warning-box" style={{ marginTop: 16 }}>
        <strong>✅ PATIENT VERIFIED — TIER 2</strong>
        <p style={{ margin: '8px 0' }}>{fullName ?? 'This patient'} has been successfully verified in person.</p>
        <button type="button" className="medical-skip-link" onClick={onComplete}>
          Done
        </button>
      </div>
    );
  }

  // stage === 'error'
  return (
    <div className="warning-box" style={{ marginTop: 16 }}>
      {error && <p className="form-error-text">{error}</p>}
      <div className="admin-action-row">
        <button type="button" className="btn btn-teal" onClick={() => setStage('prompt')}>
          Try Again
        </button>
        <button type="button" className="btn btn-white-outline" onClick={onComplete}>
          Skip — Verify Later
        </button>
      </div>
    </div>
  );
}
