'use client';

import Image from 'next/image';

export default function IdentityCard({
  fullName,
  huuid,
  countryFlag,
  countryName,
  tierLabel,
  enrollmentDate,
  qrDataUrl,
  onExpandQr,
}: {
  fullName: string;
  huuid: string;
  countryFlag: string;
  countryName: string;
  tierLabel: string;
  enrollmentDate: string;
  qrDataUrl: string | null;
  onExpandQr?: () => void;
}) {
  return (
    <div className="id-card">
      <div className="id-card-topbar">
        <div className="id-card-brand">
          <Image src="/images/logo-h.png" alt="" width={24} height={24} />
          <div className="id-card-brand-text">
            <div className="id-card-brand-name">HUUID</div>
            <div className="id-card-brand-sub">Human Universal Identity Directory</div>
          </div>
        </div>
        <div className="id-card-type">Healthcare Identity</div>
      </div>

      <div className="id-card-body">
        <div className="id-card-info">
          <div className="id-card-country">
            {countryFlag} {countryName}
          </div>
          <div className="id-card-name" title={fullName}>
            {fullName}
          </div>
          <div className="id-card-label">Healthcare Identity</div>
          <div className="id-card-huuid">
            {huuid.length > 30 ? `${huuid.slice(0, 30)}…` : huuid}
          </div>
        </div>
        <div className="id-card-qr-col">
          {qrDataUrl && (
            // eslint-disable-next-line @next/next/no-img-element -- data: URL
            <img
              src={qrDataUrl}
              alt="Scan to verify HUUID"
              onClick={onExpandQr}
              style={{ cursor: onExpandQr ? 'pointer' : 'default' }}
            />
          )}
          <div className="id-card-qr-label">Scan to verify</div>
        </div>
      </div>

      <div className="id-card-bottom">
        <div>
          <div className="id-card-tier">🛡 {tierLabel}</div>
          <div className="id-card-tier-sub">Self-Enrolled</div>
        </div>
        <div className="id-card-date">{enrollmentDate}</div>
      </div>

      <div className="id-card-footer">
        <span>Identity travels. Records stay.</span>
      </div>
    </div>
  );
}
