'use client';

import { Suspense, useCallback, useEffect, useRef, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import QRCode from 'qrcode';
import jsPDF from 'jspdf';
import Image from 'next/image';
import IdentityCard from '@/components/enroll/IdentityCard';
import QrModal from '@/components/enroll/QrModal';
import { findCountry } from '@/lib/countries';
import { renderCardToCanvas, downloadCanvasAsPng, CARD_WIDTH, CARD_HEIGHT } from '@/lib/client/card-canvas';

/**
 * QR NOTE: this encodes the plain HUUID string only ("Generated from full
 * HUUID string" per the enrollment brief) -- a facility scans it and looks
 * the identity up via the resolver API. This is NOT the cryptographically
 * signed offline emergency token described in HUUID-RESOLUTION-SPEC-v0.3
 * §4 (blood type/allergies, EdDSA-signed, resolver-key-verified offline).
 * That remains blocked on Pre-Pilot Blocker 2 (dedicated resolver signing
 * key + a real card-issuance endpoint) -- not attempted here.
 */

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

  useEffect(() => {
    const storedHuuid = sessionStorage.getItem('huuid_just_created');
    if (!storedHuuid) {
      router.replace('/enroll');
      return;
    }
    setHuuid(storedHuuid);
    setFullName(sessionStorage.getItem('huuid_just_created_name') ?? '');
    setCountryCode(sessionStorage.getItem('huuid_just_created_country') ?? 'GH');
  }, [router]);

  useEffect(() => {
    if (!huuid) return;
    QRCode.toDataURL(huuid, {
      errorCorrectionLevel: 'H',
      margin: 4,
      color: { dark: '#0A6E5F', light: '#FFFFFF' },
      width: 300,
    }).then(setQrDataUrl);
    QRCode.toDataURL(huuid, {
      errorCorrectionLevel: 'H',
      margin: 4,
      color: { dark: '#0A6E5F', light: '#FFFFFF' },
      width: 512,
    }).then(setQrLarge);
  }, [huuid]);

  const country = findCountry(countryCode);
  const enrollmentDate = new Date().toLocaleDateString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });

  const buildCanvas = useCallback(async () => {
    if (!huuid || !qrDataUrl || !canvasRef.current) return null;
    await renderCardToCanvas(canvasRef.current, {
      fullName,
      huuid,
      countryFlag: country?.flag ?? '',
      countryName: country?.name ?? countryCode,
      tierLabel: 'Tier 1 — Self-Enrolled',
      enrollmentDate,
      qrDataUrl,
    });
    return canvasRef.current;
  }, [huuid, qrDataUrl, fullName, country, countryCode, enrollmentDate]);

  const filenameBase = huuid ? `HUUID-Card-${fileSafe(fullName || 'patient')}-${huuid.slice(-8)}` : 'HUUID-Card';

  const handleDownloadPdf = useCallback(async () => {
    setPdfError(null);
    const canvas = await buildCanvas();
    if (!canvas) return;

    try {
      const doc = new jsPDF({ unit: 'mm', format: [85.6, 53.98], orientation: 'landscape' });
      const imgData = canvas.toDataURL('image/png');
      doc.addImage(imgData, 'PNG', 0, 0, 85.6, 53.98);
      doc.save(`${filenameBase}.pdf`);
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
    downloadCanvasAsPng(canvas, `${filenameBase}.png`);
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

        <canvas ref={canvasRef} width={CARD_WIDTH} height={CARD_HEIGHT} style={{ display: 'none' }} />
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
