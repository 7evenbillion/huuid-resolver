'use client';

import { useState } from 'react';
import Image from 'next/image';

const LINKS = [
  { label: 'Patients', href: '#patients' },
  { label: 'Healthcare Facilities', href: '#healthcare-facilities' },
  { label: 'Governments', href: '#governments' },
  { label: 'Insurers', href: '#insurers' },
  { label: 'Partners', href: '#partners' },
  { label: 'Resources', href: '#trust-by-design' },
];

export default function Navigation() {
  const [open, setOpen] = useState(false);

  return (
    <header className="nav">
      <div className="nav-inner">
        <a href="#" className="nav-brand">
          <Image src="/images/logo-h.png" alt="HUUID" width={32} height={32} />
          <span className="nav-brand-text">
            <span className="nav-brand-name">HUUID</span>
            <span className="nav-brand-sub">Human Universal Identity Directory</span>
          </span>
        </a>

        <ul className="nav-links">
          {LINKS.map((l) => (
            <li key={l.label}>
              <a href={l.href}>{l.label}</a>
            </li>
          ))}
        </ul>

        <a href="/waitlist" className="btn btn-teal">
          Get Your HUUID
        </a>

        <button
          className="nav-toggle"
          aria-label="Toggle menu"
          aria-expanded={open}
          onClick={() => setOpen((v) => !v)}
        >
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none">
            <path d="M3 6h18M3 12h18M3 18h18" stroke="#1B3A6B" strokeWidth="2" strokeLinecap="round" />
          </svg>
        </button>
      </div>

      <nav className={open ? 'nav-mobile open' : 'nav-mobile'}>
        {LINKS.map((l) => (
          <a key={l.label} href={l.href} onClick={() => setOpen(false)}>
            {l.label}
          </a>
        ))}
        <a
          href="/waitlist"
          className="btn btn-teal btn-block"
          style={{ marginTop: 8 }}
          onClick={() => setOpen(false)}
        >
          Get Your HUUID
        </a>
      </nav>
    </header>
  );
}
