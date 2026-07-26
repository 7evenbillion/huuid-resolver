'use client';

export default function QrModal({
  qrDataUrl,
  fullName,
  onClose,
}: {
  qrDataUrl: string;
  fullName: string;
  onClose: () => void;
}) {
  return (
    <div className="qr-modal-overlay" role="dialog" aria-modal="true">
      <button className="qr-modal-close" onClick={onClose}>
        Close ✕
      </button>
      {/* eslint-disable-next-line @next/next/no-img-element -- data: URL, not an optimizable remote image */}
      <img src={qrDataUrl} alt="HUUID QR code" />
      <p className="qr-modal-name">{fullName}</p>
    </div>
  );
}
