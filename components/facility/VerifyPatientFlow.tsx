'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import jsQR from 'jsqr';

interface VerifyResult {
  huuid: string;
  fullName: string | null;
  bloodType: string | null;
  allergies: { s: string; sv?: string }[];
  medications: { n: string }[];
  chronicConditions: string[];
  contraindications: { s: string; r?: string }[];
  organDonor: string | null;
  pregnancyStatus: string | null;
  holdingFacilityNames: string[];
}

interface SearchCandidate {
  huuid: string;
  full_name: string;
  date_of_birth: string | null;
  country_code: string;
}

type Tab = 'qr' | 'manual' | 'search';
type ConsentStatus = 'idle' | 'waiting' | 'granted' | 'declined' | 'expired';

export default function VerifyPatientFlow({ facilityName }: { facilityName: string }) {
  const router = useRouter();
  const [tab, setTab] = useState<Tab>('qr');
  const [manualHuuid, setManualHuuid] = useState('');
  const [searchName, setSearchName] = useState('');
  const [searchDob, setSearchDob] = useState('');
  const [candidates, setCandidates] = useState<SearchCandidate[] | null>(null);
  const [result, setResult] = useState<VerifyResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const [consentStatus, setConsentStatus] = useState<ConsentStatus>('idle');
  const [consentId, setConsentId] = useState<string | null>(null);
  const [secondsLeft, setSecondsLeft] = useState(0);

  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const scanFrameRef = useRef<number | null>(null);

  async function resolvePatient(body: object) {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch('/api/facility/verify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.message ?? data.error ?? 'Could not verify this patient.');
        setBusy(false);
        return;
      }
      setResult(data);
      setCandidates(null);
    } catch {
      setError('Could not reach the server.');
    }
    setBusy(false);
  }

  // ---- QR scanning ----
  useEffect(() => {
    if (tab !== 'qr' || result) return;
    let cancelled = false;

    async function startCamera() {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } });
        if (cancelled) {
          stream.getTracks().forEach((t) => t.stop());
          return;
        }
        streamRef.current = stream;
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          await videoRef.current.play();
        }
        scanLoop();
      } catch {
        setError('Could not access the camera. Use manual entry instead.');
      }
    }

    function scanLoop() {
      if (cancelled) return;
      const video = videoRef.current;
      const canvas = canvasRef.current;
      if (video && canvas && video.readyState === video.HAVE_ENOUGH_DATA) {
        canvas.width = video.videoWidth;
        canvas.height = video.videoHeight;
        const ctx = canvas.getContext('2d');
        if (ctx) {
          ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
          const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
          const code = jsQR(imageData.data, imageData.width, imageData.height);
          if (code?.data) {
            resolvePatient({ mode: 'qr', raw: code.data });
            return;
          }
        }
      }
      scanFrameRef.current = requestAnimationFrame(scanLoop);
    }

    startCamera();
    return () => {
      cancelled = true;
      if (scanFrameRef.current) cancelAnimationFrame(scanFrameRef.current);
      streamRef.current?.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab, result]);

  // ---- Consent countdown ----
  useEffect(() => {
    if (consentStatus !== 'waiting' || !consentId) return;
    const poll = setInterval(async () => {
      try {
        const res = await fetch(`/api/facility/consent/${consentId}/status`);
        const data = await res.json();
        if (res.ok) {
          const remaining = Math.max(0, Math.floor((new Date(data.expiresAt).getTime() - Date.now()) / 1000));
          setSecondsLeft(remaining);
          if (data.status !== 'pending') {
            setConsentStatus(data.status);
          }
        }
      } catch {
        // keep polling silently
      }
    }, 2000);
    return () => clearInterval(poll);
  }, [consentStatus, consentId]);

  async function requestAccess() {
    if (!result) return;
    setConsentStatus('waiting');
    setSecondsLeft(300);
    try {
      const res = await fetch('/api/facility/consent/request', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ huuid: result.huuid, holdingFacilityNames: result.holdingFacilityNames }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? 'Could not send the consent request.');
        setConsentStatus('idle');
        return;
      }
      setConsentId(data.consentId);
    } catch {
      setError('Could not reach the server.');
      setConsentStatus('idle');
    }
  }

  function resetAll() {
    setResult(null);
    setCandidates(null);
    setError(null);
    setManualHuuid('');
    setSearchName('');
    setSearchDob('');
    setConsentStatus('idle');
    setConsentId(null);
  }

  if (result) {
    const criticalAllergies = result.allergies.filter((a) => a.sv === 'life-threatening' || a.sv === 'severe');
    const doNotGive = result.contraindications;

    return (
      <div className="enroll-page">
        <div className="enroll-shell">
          <h1 className="enroll-heading" style={{ color: '#1a8f4c' }}>
            ✅ PATIENT VERIFIED
          </h1>
          {result.fullName && <h2 style={{ color: 'var(--navy)', fontSize: 22 }}>{result.fullName}</h2>}

          <div className="admin-detail-section">
            {result.bloodType && (
              <div className="admin-detail-row">
                <span className="admin-detail-label">🩸 Blood Type</span>
                <span className="admin-detail-value">{result.bloodType}</span>
              </div>
            )}
            {criticalAllergies.map((a, i) => (
              <div className="admin-detail-row" key={i}>
                <span className="admin-detail-label">⚠️ ALLERGY</span>
                <span className="admin-detail-value">
                  {a.s} {a.sv ? `(${a.sv})` : ''}
                </span>
              </div>
            ))}
            {doNotGive.length > 0 && (
              <div className="admin-detail-row">
                <span className="admin-detail-label">🚫 DO NOT GIVE</span>
                <span className="admin-detail-value">{doNotGive.map((d) => d.s).join(', ')}</span>
              </div>
            )}
            {result.chronicConditions.length > 0 && (
              <div className="admin-detail-row">
                <span className="admin-detail-label">💊 Conditions</span>
                <span className="admin-detail-value">{result.chronicConditions.join(', ')}</span>
              </div>
            )}
          </div>

          <p style={{ fontSize: 13, color: 'var(--text-grey)' }}>
            Records available at:{' '}
            {result.holdingFacilityNames.length > 0 ? result.holdingFacilityNames.join(', ') : 'No linked facilities yet.'}
          </p>

          {error && <p className="form-error-text">{error}</p>}

          {consentStatus === 'idle' && (
            <div className="admin-action-row" style={{ flexDirection: 'column' }}>
              <button className="btn btn-teal btn-block" onClick={requestAccess}>
                REQUEST RECORD ACCESS
              </button>
              <button className="btn btn-white-outline btn-block" onClick={() => alert('Visit noted.')}>
                REGISTER NEW VISIT
              </button>
              <button className="medical-skip-link" onClick={resetAll}>
                DONE
              </button>
            </div>
          )}

          {consentStatus === 'waiting' && (
            <div className="warning-box">
              Waiting for patient consent… Patient will receive an SMS on their phone. Ask them to
              reply YES or NO.
              <div style={{ fontSize: 22, fontWeight: 800, marginTop: 8 }}>
                {Math.floor(secondsLeft / 60)}:{String(secondsLeft % 60).padStart(2, '0')}
              </div>
            </div>
          )}
          {consentStatus === 'granted' && <div className="warning-box">Patient consented ✅</div>}
          {consentStatus === 'declined' && <div className="warning-box">Patient declined access.</div>}
          {consentStatus === 'expired' && (
            <div className="warning-box">
              Request expired. Ask patient to reply to the SMS or request again.
            </div>
          )}

          <Link href="/debug/break-glass" className="btn btn-red btn-block" style={{ marginTop: 12 }}>
            🚨 EMERGENCY ACCESS
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="enroll-page">
      <div className="enroll-shell">
        <button onClick={() => router.push('/facility')} className="medical-skip-link" style={{ marginBottom: 8 }}>
          ← Back
        </button>
        <h1 className="enroll-heading">Verify a Patient</h1>
        <p className="enroll-sub">{facilityName}</p>

        <div className="admin-action-row" style={{ marginBottom: 20 }}>
          <button className={`btn ${tab === 'qr' ? 'btn-teal' : 'btn-white-outline'}`} onClick={() => setTab('qr')}>
            Scan QR
          </button>
          <button className={`btn ${tab === 'manual' ? 'btn-teal' : 'btn-white-outline'}`} onClick={() => setTab('manual')}>
            Enter HUUID
          </button>
          <button className={`btn ${tab === 'search' ? 'btn-teal' : 'btn-white-outline'}`} onClick={() => setTab('search')}>
            Search
          </button>
        </div>

        {tab === 'qr' && (
          <div>
            <p className="form-helper">Point camera at patient&apos;s QR card</p>
            <video ref={videoRef} playsInline muted style={{ width: '100%', borderRadius: 12, background: '#000' }} />
            <canvas ref={canvasRef} style={{ display: 'none' }} />
          </div>
        )}

        {tab === 'manual' && (
          <div className="form-group">
            <label className="form-label">Type or paste the patient&apos;s HUUID</label>
            <input
              className="form-input"
              placeholder="did:huuid:gh:..."
              value={manualHuuid}
              onChange={(e) => setManualHuuid(e.target.value)}
            />
            <button
              className="btn btn-teal btn-block"
              style={{ marginTop: 12 }}
              disabled={manualHuuid.trim().length === 0 || busy}
              onClick={() => resolvePatient({ mode: 'huuid', huuid: manualHuuid.trim() })}
            >
              {busy ? 'Verifying…' : 'Verify →'}
            </button>
          </div>
        )}

        {tab === 'search' && (
          <div>
            <div className="form-group">
              <label className="form-label">Name</label>
              <input className="form-input" value={searchName} onChange={(e) => setSearchName(e.target.value)} />
            </div>
            <div className="form-group">
              <label className="form-label">
                Date of Birth <span className="form-optional-tag">Optional</span>
              </label>
              <input
                type="date"
                className="form-input"
                value={searchDob}
                onChange={(e) => setSearchDob(e.target.value)}
              />
            </div>
            <button
              className="btn btn-teal btn-block"
              disabled={searchName.trim().length === 0 || busy}
              onClick={async () => {
                setBusy(true);
                setError(null);
                try {
                  const res = await fetch('/api/facility/verify', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ mode: 'search', name: searchName.trim(), dateOfBirth: searchDob || null }),
                  });
                  const data = await res.json();
                  setCandidates(res.ok ? data.candidates : []);
                } catch {
                  setError('Could not reach the server.');
                }
                setBusy(false);
              }}
            >
              {busy ? 'Searching…' : 'Search →'}
            </button>

            {candidates && candidates.length === 0 && <p className="admin-empty">No matches found.</p>}
            {candidates && candidates.length > 0 && (
              <div className="admin-app-list" style={{ marginTop: 16 }}>
                {candidates.map((c) => (
                  <div
                    key={c.huuid}
                    className="admin-app-card"
                    onClick={() => resolvePatient({ mode: 'huuid', huuid: c.huuid })}
                  >
                    <div className="admin-app-card-name">{c.full_name}</div>
                    <div className="admin-app-card-meta">{c.date_of_birth ?? 'DOB unknown'}</div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {error && <p className="form-error-text" style={{ marginTop: 16 }}>{error}</p>}
      </div>
    </div>
  );
}
