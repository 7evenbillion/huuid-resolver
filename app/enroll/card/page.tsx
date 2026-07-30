'use client';

import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import QRCode from 'qrcode';
import Image from 'next/image';
import IdentityCard from '@/components/enroll/IdentityCard';
import QrModal from '@/components/enroll/QrModal';
import { findCountry } from '@/lib/countries';
import {
  buildPhysicalCard,
  downloadPhysicalCardPDF,
  downloadPhysicalCardPNG,
  PHYSICAL_CARD_WIDTH,
  PHYSICAL_CARD_HEIGHT,
  type PhysicalCardMedicalData,
} from '@/lib/client/card-canvas';

/**
 * QR NOTE (Phase 2A): the QR now encodes the signed offline emergency token
 * from lib/qr-token.ts when one is available in sessionStorage
 * (huuid_qr_token, set by /api/enroll/register and refreshed by
 * /api/enroll/medical) -- a compressed, EdDSA-signed blob carrying blood
 * type/allergies/medications/etc. per HUUID-RESOLUTION-SPEC-v0.3 §4,
 * decodable offline without a resolver call. Falls back to the plain HUUID
 * string if no token is present (e.g. sessionStorage cleared, or no signing
 * key configured server-side) so the card never ships with an empty QR.
 * Still signed with the interim HUUID_TEST_FACILITY_JWK, not a dedicated
 * resolver key -- see lib/qr-token.ts's getSigningKey() comment
 * (Pre-Pilot Blocker 2, not yet resolved). Any scanner expecting a bare
 * HUUID string (rather than this token blob) will need updating to decode
 * it first -- a downstream compatibility change this task does not cover.
 */

interface StoredAllergy { substance: string; reaction: string; severity: string }
interface StoredMedication { name: string; dose: string; frequency: string }
interface StoredContraindication { substance: string; reason: string; severity: 'never' | 'avoid' | 'consult' }
interface StoredMedicalProfile {
  bloodType: string | null;
  allergies: StoredAllergy[];
  medications: StoredMedication[];
  chronicConditions: string[];
  pregnancyStatus: string | null;
  organDonor: string | null;
  implantedDevices: string[];
  contraindications: StoredContraindication[];
  medicalProfileCompleted: boolean;
}

const REMINDER_DISMISS_KEY = 'huuid_medical_reminder_dismissed';
const REMINDER_DISMISS_DAYS = 30;

function fileSafe(name: string): string {
  return name.replace(/[^a-z0-9]+/gi, '-').replace(/^-+|-+$/g, '');
}

function CardScreen() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const canvasRef = useRef<HTMLCanvasElement>(null);

  const [huuid, setHuuid] = useState<string | null>(null);
  const [fullName, setFullName] = useState('');
  const [countryCode, setCountryCode] = useState('GH');
  const [qrDataUrl, setQrDataUrl] = useState<string | null>(null);
  const [qrLarge, setQrLarge] = useState<string | null>(null);
  const [tab, setTab] = useState<'digital' | 'print'>('digital');
  const [showModal, setShowModal] = useState(false);
  const [pdfError, setPdfError] = useState<string | null>(null);
  const [medical, setMedical] = useState<StoredMedicalProfile | null>(null);
  const [reminderDismissed, setReminderDismissed] = useState(true); // default true until checked, avoids a flash

  useEffect(() => {
    const storedHuuid = sessionStorage.getItem('huuid_just_created');
    if (!storedHuuid) {
      router.replace('/enroll');
      return;
    }
    setHuuid(storedHuuid);
    setFullName(sessionStorage.getItem('huuid_just_created_name') ?? '');
    setCountryCode(sessionStorage.getItem('huuid_just_created_country') ?? 'GH');

    const storedMedical = sessionStorage.getItem('huuid_medical_profile');
    if (storedMedical) {
      try {
        setMedical(JSON.parse(storedMedical));
      } catch {
        setMedical(null);
      }
    }

    const dismissedAt = Number(localStorage.getItem(REMINDER_DISMISS_KEY) ?? 0);
    const stillDismissed = dismissedAt > 0 && Date.now() - dismissedAt < REMINDER_DISMISS_DAYS * 24 * 60 * 60 * 1000;
    setReminderDismissed(stillDismissed);
  }, [router]);

  function dismissReminder() {
    localStorage.setItem(REMINDER_DISMISS_KEY, String(Date.now()));
    setReminderDismissed(true);
  }

  useEffect(() => {
    if (!huuid) return;
    const qrContent = sessionStorage.getItem('huuid_qr_token') || huuid;
    QRCode.toDataURL(qrContent, {
      errorCorrectionLevel: 'H',
      margin: 4,
      color: { dark: '#0A6E5F', light: '#FFFFFF' },
      width: 300,
    }).then(setQrDataUrl);
    QRCode.toDataURL(qrContent, {
      errorCorrectionLevel: 'H',
      margin: 4,
      color: { dark: '#0A6E5F', light: '#FFFFFF' },
      width: 512,
    }).then(setQrLarge);
  }, [huuid]);

  const neverGive = medical?.contraindications?.filter((c) => c.severity === 'never') ?? [];
  const severeAllergies = medical?.allergies?.filter((a) => a.severity === 'severe' || a.severity === 'life-threatening') ?? [];
  const profileIncomplete = !medical || !medical.medicalProfileCompleted;

  const country = findCountry(countryCode);
  const enrollmentDate = new Date().toLocaleDateString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });

  // Physical-card spec: "Critical allergies (life-threatening only)" -- a
  // stricter filter than the on-screen banner above, which also shows
  // 'severe'. Computed fresh inside the memo (rather than reusing a
  // separately-declared array) so this only depends on `medical` itself.
  const physicalCardMedical: PhysicalCardMedicalData | undefined = useMemo(() => {
    if (!medical) return undefined;
    const critical = medical.allergies?.filter((a) => a.severity === 'life-threatening') ?? [];
    const doNotGive = medical.contraindications?.filter((c) => c.severity === 'never') ?? [];
    return {
      bloodType: medical.bloodType,
      criticalAllergies: critical.map((a) => ({ substance: a.substance, severity: a.severity })),
      chronicConditions: medical.chronicConditions,
      implantedDevices: medical.implantedDevices,
      organDonor: medical.organDonor,
      pregnancyStatus: medical.pregnancyStatus,
      doNotGive: doNotGive.map((c) => c.substance),
      medicalProfileCompleted: medical.medicalProfileCompleted,
    };
  }, [medical]);

  const buildCanvas = useCallback(async () => {
    if (!huuid || !qrDataUrl || !canvasRef.current) return null;
    return buildPhysicalCard(canvasRef.current, {
      fullName,
      huuid,
      tierNumber: 1,
      issuedDate: new Date(),
      qrDataUrl,
      medical: physicalCardMedical,
    });
  }, [huuid, qrDataUrl, fullName, physicalCardMedical]);

  const filenameBase = huuid ? `HUUID-Card-${fileSafe(fullName || 'patient')}-${huuid.slice(-8)}` : 'HUUID-Card';

  const handleDownloadPdf = useCallback(async () => {
    setPdfError(null);
    const canvas = await buildCanvas();
    if (!canvas) return;

    try {
      await downloadPhysicalCardPDF(canvas, `${filenameBase}.pdf`);
    } catch (err) {
      // Graceful degradation: some mobile browsers choke on jsPDF's canvas
      // pipeline under memory pressure. Fall back to the browser's own
      // print-to-PDF via the print-only card + @page CSS sizing.
      console.error('jsPDF failed, falling back to print dialog:', err);
      setPdfError('Could not generate a PDF directly on this device. Opening the print dialog instead — choose "Save as PDF".');
      setTab('print');
      setTimeout(() => window.print(), 300);
    }
  }, [buildCanvas, filenameBase]);

  const handleDownloadPng = useCallback(async () => {
    const canvas = await buildCanvas();
    if (!canvas) return;
    downloadPhysicalCardPNG(canvas, `${filenameBase}.png`);
  }, [buildCanvas, filenameBase]);

  function handleDownloadQr() {
    if (!qrLarge || !huuid) return;
    const a = document.createElement('a');
    a.href = qrLarge;
    a.download = `${filenameBase}-qr.png`;
    a.click();
  }

  useEffect(() => {
    if (searchParams.get('download') === '1' && huuid && qrDataUrl) {
      handleDownloadPdf();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams, huuid, qrDataUrl]);

  if (!huuid) return null;

  return (
    <div className="enroll-page">
      <div className="enroll-shell" style={{ maxWidth: 620 }}>
        <div className="enroll-logo">
          <Image src="/images/logo-h.png" alt="HUUID" width={44} height={44} />
        </div>
        <h1 className="enroll-heading">Your Healthcare Identity Card</h1>

        {neverGive.length > 0 && (
          <div className="do-not-give-banner">
            🚫 DO NOT GIVE: {neverGive.map((c) => c.substance).join(', ')}
          </div>
        )}

        {profileIncomplete && !reminderDismissed && (
          <div className="medical-incomplete-banner">
            <span>
              Your emergency medical profile is incomplete. <a href="/enroll/medical">Add it now →</a>
            </span>
            <button className="medical-incomplete-dismiss" onClick={dismissReminder} aria-label="Dismiss">
              ✕
            </button>
          </div>
        )}

        {medical && medical.medicalProfileCompleted && (
          <div className="info-box" style={{ display: 'flex', flexWrap: 'wrap', gap: '8px 14px', alignItems: 'center' }}>
            {medical.bloodType && medical.bloodType !== 'unknown' && (
              <span>🩸 <strong>Blood Type:</strong> {medical.bloodType}</span>
            )}
            {severeAllergies.length > 0 && (
              <span>⚠️ <strong>ALLERGY:</strong> {severeAllergies.map((a) => a.substance).join(', ')}</span>
            )}
            {medical.chronicConditions.length > 0 && (
              <span><strong>Conditions:</strong> {medical.chronicConditions.join(', ')}</span>
            )}
            {medical.implantedDevices.includes('Pacemaker') && <span>🔋 Pacemaker</span>}
            {medical.pregnancyStatus === 'pregnant' && <span>🤰 Pregnant</span>}
            {medical.organDonor === 'yes' && <span>💚 Organ Donor</span>}
          </div>
        )}

        <div className="card-tabs">
          <button className={`card-tab${tab === 'digital' ? ' active' : ''}`} onClick={() => setTab('digital')}>
            Digital Card
          </button>
          <button className={`card-tab${tab === 'print' ? ' active' : ''}`} onClick={() => setTab('print')}>
            Print &amp; Download
          </button>
        </div>

        {tab === 'digital' && (
          <>
            <IdentityCard
              fullName={fullName}
              huuid={huuid}
              countryFlag={country?.flag ?? ''}
              countryName={country?.name ?? countryCode}
              tierLabel="Tier 1 — Self-Enrolled"
              enrollmentDate={enrollmentDate}
              qrDataUrl={qrDataUrl}
              onExpandQr={() => setShowModal(true)}
            />
            <button className="btn btn-teal-outline card-expand-btn" onClick={() => setShowModal(true)}>
              Tap QR to Expand
            </button>
          </>
        )}

        {tab === 'print' && (
          <>
            <div id="print-card-area">
              <IdentityCard
                fullName={fullName}
                huuid={huuid}
                countryFlag={country?.flag ?? ''}
                countryName={country?.name ?? countryCode}
                tierLabel="Tier 1 — Self-Enrolled"
                enrollmentDate={enrollmentDate}
                qrDataUrl={qrDataUrl}
              />
            </div>
            <div className="print-instructions">
              Print on card stock (85.6mm × 53.98mm). Laminate for durability. This card is
              accepted at any HUUID-connected healthcare facility worldwide.
            </div>

            {pdfError && <p className="form-error-text" style={{ marginBottom: 12 }}>{pdfError}</p>}

            <div className="download-buttons">
              <button className="btn btn-teal btn-block" onClick={handleDownloadPdf}>
                Download PDF — Print Ready
              </button>
              <button className="btn btn-teal-outline btn-block" onClick={handleDownloadPng}>
                Download PNG — Digital Copy
              </button>
              <button className="btn btn-teal-outline btn-block" onClick={handleDownloadQr}>
                Download QR Code Only
              </button>
            </div>
          </>
        )}

        <canvas ref={canvasRef} width={PHYSICAL_CARD_WIDTH} height={PHYSICAL_CARD_HEIGHT} style={{ display: 'none' }} />
      </div>

      {showModal && qrLarge && (
        <QrModal qrDataUrl={qrLarge} fullName={fullName} onClose={() => setShowModal(false)} />
      )}
    </div>
  );
}

export default function CardPage() {
  return (
    <Suspense fallback={null}>
      <CardScreen />
    </Suspense>
  );
}
