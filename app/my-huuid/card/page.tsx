'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
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

interface CardApiResponse {
  huuid: string;
  fullName: string;
  countryCode: string;
  qrToken: string | null;
  qrTokenGeneratedAt: number | null;
  qrTokenExpiresAt: number | null;
  cardTokenGeneratedAt: string | null;
  medicalProfileUpdatedAt: string | null;
  medicalProfileCompleted: boolean;
  medical: {
    bloodType: string | null;
    allergies: { substance: string; reaction?: string | null; severity?: string | null }[];
    chronicConditions: string[];
    implantedDevices: string[];
    organDonor: string | null;
    pregnancyStatus: string | null;
    contraindications: { substance: string; reason?: string | null; severity: 'never' | 'avoid' | 'consult' }[];
  };
}

const EXPIRY_WARNING_DAYS = 14;

function fileSafe(name: string): string {
  return name.replace(/[^a-z0-9]+/gi, '-').replace(/^-+|-+$/g, '');
}

export default function MyHuuidCardPage() {
  const router = useRouter();
  const canvasRef = useRef<HTMLCanvasElement>(null);

  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [card, setCard] = useState<CardApiResponse | null>(null);
  const [qrDataUrl, setQrDataUrl] = useState<string | null>(null);
  const [qrLarge, setQrLarge] = useState<string | null>(null);
  const [tab, setTab] = useState<'digital' | 'print'>('digital');
  const [showModal, setShowModal] = useState(false);
  const [pdfError, setPdfError] = useState<string | null>(null);

  const load = useCallback(async () => {
    const res = await fetch('/api/my-huuid/card');
    if (res.status === 401) {
      router.replace('/my-huuid/login');
      return;
    }
    if (!res.ok) {
      setError('Could not load your card.');
      setLoading(false);
      return;
    }
    const data: CardApiResponse = await res.json();
    setCard(data);
    setLoading(false);
  }, [router]);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    if (!card?.qrToken) return;
    QRCode.toDataURL(card.qrToken, {
      errorCorrectionLevel: 'H',
      margin: 4,
      color: { dark: '#0A6E5F', light: '#FFFFFF' },
      width: 300,
    }).then(setQrDataUrl);
    QRCode.toDataURL(card.qrToken, {
      errorCorrectionLevel: 'H',
      margin: 4,
      color: { dark: '#0A6E5F', light: '#FFFFFF' },
      width: 512,
    }).then(setQrLarge);
  }, [card?.qrToken]);

  const isCardStale =
    !!card?.cardTokenGeneratedAt &&
    !!card?.medicalProfileUpdatedAt &&
    new Date(card.cardTokenGeneratedAt).getTime() < new Date(card.medicalProfileUpdatedAt).getTime();

  const daysUntilExpiry = card?.qrTokenExpiresAt
    ? Math.ceil((card.qrTokenExpiresAt * 1000 - Date.now()) / (24 * 60 * 60 * 1000))
    : null;
  const isExpiringSoon = daysUntilExpiry !== null && daysUntilExpiry <= EXPIRY_WARNING_DAYS;

  const country = findCountry(card?.countryCode ?? 'GH');
  const enrollmentDate = card?.qrTokenGeneratedAt
    ? new Date(card.qrTokenGeneratedAt * 1000).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' })
    : '';

  const physicalCardMedical: PhysicalCardMedicalData | undefined = useMemo(() => {
    if (!card) return undefined;
    const critical = card.medical.allergies?.filter((a) => a.severity === 'life-threatening') ?? [];
    const doNotGive = card.medical.contraindications?.filter((c) => c.severity === 'never') ?? [];
    return {
      bloodType: card.medical.bloodType,
      criticalAllergies: critical.map((a) => ({ substance: a.substance, severity: a.severity })),
      chronicConditions: card.medical.chronicConditions,
      implantedDevices: card.medical.implantedDevices,
      organDonor: card.medical.organDonor,
      pregnancyStatus: card.medical.pregnancyStatus,
      doNotGive: doNotGive.map((c) => c.substance),
      medicalProfileCompleted: card.medicalProfileCompleted,
    };
  }, [card]);

  const buildCanvas = useCallback(async () => {
    if (!card || !qrDataUrl || !canvasRef.current) return null;
    return buildPhysicalCard(canvasRef.current, {
      fullName: card.fullName,
      huuid: card.huuid,
      tierNumber: 1,
      issuedDate: card.qrTokenGeneratedAt ? new Date(card.qrTokenGeneratedAt * 1000) : new Date(),
      qrDataUrl,
      medical: physicalCardMedical,
    });
  }, [card, qrDataUrl, physicalCardMedical]);

  const filenameBase = card ? `HUUID-Card-${fileSafe(card.fullName || 'patient')}` : 'HUUID-Card';

  async function handleRefresh() {
    setRefreshing(true);
    setError(null);
    try {
      const res = await fetch('/api/my-huuid/refresh-card', { method: 'POST' });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? 'Could not refresh your card.');
        setRefreshing(false);
        return;
      }
      setCard(data);
      setRefreshing(false);
    } catch {
      setError('Could not reach the server.');
      setRefreshing(false);
    }
  }

  const handleDownloadPdf = useCallback(async () => {
    setPdfError(null);
    const canvas = await buildCanvas();
    if (!canvas) return;
    try {
      await downloadPhysicalCardPDF(canvas, `${filenameBase}.pdf`);
    } catch (err) {
      console.error('jsPDF failed, falling back to print dialog:', err);
      setPdfError('Could not generate a PDF directly on this device. Opening the print dialog instead — choose "Save as PDF".');
      setTimeout(() => window.print(), 300);
    }
  }, [buildCanvas, filenameBase]);

  const handleDownloadPng = useCallback(async () => {
    const canvas = await buildCanvas();
    if (!canvas) return;
    downloadPhysicalCardPNG(canvas, `${filenameBase}.png`);
  }, [buildCanvas, filenameBase]);

  function handleDownloadQr() {
    if (!qrLarge) return;
    const a = document.createElement('a');
    a.href = qrLarge;
    a.download = `${filenameBase}-qr.png`;
    a.click();
  }

  async function handleDownloadUpdatedCard() {
    await handleRefresh();
    await handleDownloadPng();
  }

  if (loading) {
    return (
      <div className="admin-page">
        <div className="admin-shell" style={{ maxWidth: 620 }}>
          <p className="form-helper">Loading your card…</p>
        </div>
      </div>
    );
  }

  if (!card) {
    return (
      <div className="admin-page">
        <div className="admin-shell" style={{ maxWidth: 620 }}>
          <Link href="/my-huuid" style={{ color: 'var(--teal)', fontWeight: 600, fontSize: 13.5 }}>
            ← Back
          </Link>
          <p className="form-error-text" style={{ marginTop: 16 }}>{error ?? 'Could not load your card.'}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="enroll-page">
      <div className="enroll-shell" style={{ maxWidth: 620 }}>
        <Link href="/my-huuid" style={{ color: 'var(--teal)', fontWeight: 600, fontSize: 13.5, alignSelf: 'flex-start' }}>
          ← Back
        </Link>
        <div className="enroll-logo">
          <Image src="/images/logo-h.png" alt="HUUID" width={44} height={44} />
        </div>
        <h1 className="enroll-heading">Your Healthcare Identity Card</h1>

        {isCardStale && (
          <div className="card-stale-banner">
            <span>
              ⚠️ Your medical profile has been updated since you last downloaded your card. Download your
              new card to ensure clinicians see your latest information.
            </span>
            <button className="btn btn-teal" onClick={handleDownloadUpdatedCard} disabled={refreshing}>
              Download Updated Card →
            </button>
          </div>
        )}

        {!isCardStale && isExpiringSoon && (
          <div className="card-stale-banner">
            <span>Your card expires in {daysUntilExpiry} day{daysUntilExpiry === 1 ? '' : 's'}. Refresh it now to keep it valid.</span>
            <button className="btn btn-teal" onClick={handleRefresh} disabled={refreshing}>
              {refreshing ? 'Refreshing…' : 'Refresh My Card →'}
            </button>
          </div>
        )}

        {error && <p className="form-error-text">{error}</p>}

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
              fullName={card.fullName}
              huuid={card.huuid}
              countryFlag={country?.flag ?? ''}
              countryName={country?.name ?? card.countryCode}
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
                fullName={card.fullName}
                huuid={card.huuid}
                countryFlag={country?.flag ?? ''}
                countryName={country?.name ?? card.countryCode}
                tierLabel="Tier 1 — Self-Enrolled"
                enrollmentDate={enrollmentDate}
                qrDataUrl={qrDataUrl}
              />
            </div>
            <div className="print-instructions">
              Print on card stock (85.6mm × 53.98mm). Laminate for durability. This card is accepted at
              any HUUID-connected healthcare facility worldwide.
            </div>

            {pdfError && <p className="form-error-text" style={{ marginBottom: 12 }}>{pdfError}</p>}

            <div className="download-buttons">
              <button className="btn btn-teal btn-block" onClick={handleDownloadPdf}>
                Download PDF Card
              </button>
              <button className="btn btn-teal-outline btn-block" onClick={handleDownloadPng}>
                Download Digital Card PNG
              </button>
              <button className="btn btn-teal-outline btn-block" onClick={handleDownloadQr}>
                Download QR Code Only
              </button>
            </div>

            <div className="myhuuid-wallet-row">
              <button className="myhuuid-wallet-btn" disabled>
                🍎 Add to Apple Wallet <span className="myhuuid-coming-soon-tag">Coming Soon</span>
              </button>
              <button className="myhuuid-wallet-btn" disabled>
                🅖 Add to Google Wallet <span className="myhuuid-coming-soon-tag">Coming Soon</span>
              </button>
            </div>
          </>
        )}

        <canvas ref={canvasRef} width={PHYSICAL_CARD_WIDTH} height={PHYSICAL_CARD_HEIGHT} style={{ display: 'none' }} />
      </div>

      {showModal && qrLarge && (
        <QrModal qrDataUrl={qrLarge} fullName={card.fullName} onClose={() => setShowModal(false)} />
      )}
    </div>
  );
}
