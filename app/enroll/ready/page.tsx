'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import Icon from '@/components/Icon';

function CheckmarkAnimation() {
  return (
    <div className="ready-checkmark">
      <svg width="72" height="72" viewBox="0 0 72 72" fill="none">
        <circle cx="36" cy="36" r="30" stroke="#1a8f4c" strokeWidth="4" />
        <path d="M22 37l10 10 18-20" stroke="#1a8f4c" strokeWidth="5" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    </div>
  );
}

export default function ReadyPage() {
  const router = useRouter();
  const [huuid, setHuuid] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    const stored = sessionStorage.getItem('huuid_just_created');
    if (!stored) {
      router.replace('/enroll');
      return;
    }
    setHuuid(stored);
  }, [router]);

  async function handleCopy() {
    if (!huuid) return;
    try {
      await navigator.clipboard.writeText(huuid);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard API unavailable -- the HUUID is still visible on-screen for manual copy.
    }
  }

  if (!huuid) return null;

  return (
    <div className="enroll-page">
      <div className="enroll-shell" style={{ textAlign: 'center' }}>
        <CheckmarkAnimation />
        <h1 className="enroll-heading">Your Healthcare Identity is ready.</h1>

        <div className="huuid-display-box">
          <span className="huuid-display-text">{huuid}</span>
          <button className="huuid-copy-btn" onClick={handleCopy}>
            {copied ? 'Copied!' : 'Copy'}
          </button>
        </div>

        <div className="tier-badge-row">
          <span className="tier-badge">
            <Icon name="shield" size={14} className="icon-inline" /> Tier 1 — Self-Enrolled
          </span>
        </div>
        <p className="tier-note">
          Your identity becomes Tier 2 — Facility Verified — when a connected healthcare provider
          confirms your identity at your next visit.
        </p>

        <div className="warning-box">
          <strong>Save your HUUID.</strong> Screenshot this page or write down your HUUID string.
          You will need it if you ever need to recover access.
        </div>

        <div className="download-buttons">
          <button className="btn btn-teal btn-block" onClick={() => router.push('/enroll/medical')}>
            Add Emergency Medical Info →
          </button>
          <button className="btn btn-white-outline btn-block" style={{ color: 'var(--navy)', borderColor: 'var(--navy)' }} onClick={() => router.push('/enroll/card')}>
            Skip for Now
          </button>
        </div>
        <button
          className="medical-skip-link"
          onClick={() => router.push('/enroll/card?download=1')}
        >
          Download My Card Now
        </button>
      </div>
    </div>
  );
}
