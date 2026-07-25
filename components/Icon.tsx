/**
 * Hand-authored outline icon set -- no icon library dependency, by design
 * (design-pass constraint: no new libraries). Replaces the raw emoji used
 * throughout the homepage (🛡 🏥 👨‍⚕️ etc.), which render inconsistently
 * across operating systems and read as a placeholder choice rather than a
 * designed system. Every icon shares the same 24x24 viewBox, stroke width,
 * and line caps so they read as one consistent family regardless of which
 * concept they represent.
 */

import type { CSSProperties } from 'react';

export type IconName =
  | 'shield'
  | 'globe'
  | 'building'
  | 'cross-medical'
  | 'microscope'
  | 'flask'
  | 'pill'
  | 'scan'
  | 'clipboard-check'
  | 'document'
  | 'laptop'
  | 'graduation'
  | 'bank'
  | 'partnership'
  | 'person'
  | 'lock'
  | 'book'
  | 'scale'
  | 'check-circle'
  | 'arrow-right'
  | 'play';

function paths(name: IconName) {
  switch (name) {
    case 'shield':
      return <path d="M12 3l7 3v5c0 5-3.5 8.5-7 10c-3.5-1.5-7-5-7-10V6l7-3z" />;
    case 'globe':
      return (
        <>
          <circle cx="12" cy="12" r="9" />
          <path d="M3 12h18" />
          <path d="M12 3c2.5 2.5 4 6 4 9s-1.5 6.5-4 9c-2.5-2.5-4-6-4-9s1.5-6.5 4-9z" />
        </>
      );
    case 'building':
      return (
        <>
          <rect x="5" y="3" width="14" height="18" rx="1" />
          <line x1="8" y1="7" x2="16" y2="7" />
          <line x1="8" y1="11" x2="16" y2="11" />
          <rect x="10" y="16" width="4" height="5" />
        </>
      );
    case 'cross-medical':
      return (
        <>
          <circle cx="12" cy="12" r="9" />
          <line x1="12" y1="8" x2="12" y2="16" />
          <line x1="8" y1="12" x2="16" y2="12" />
        </>
      );
    case 'microscope':
      return (
        <>
          <path d="M8 20h8" />
          <path d="M12 20v-4" />
          <path d="M6 16h10" />
          <path d="M10 16l1-7a3 3 0 0 1 3-2.5" />
          <circle cx="14.5" cy="5" r="1.5" />
        </>
      );
    case 'flask':
      return (
        <>
          <path d="M9 3h6" />
          <path d="M10 3v6l-5 9a2 2 0 0 0 2 3h10a2 2 0 0 0 2-3l-5-9V3" />
          <line x1="7.5" y1="14" x2="16.5" y2="14" />
        </>
      );
    case 'pill':
      return (
        <>
          <rect x="3.5" y="9.5" width="17" height="5" rx="2.5" transform="rotate(-45 12 12)" />
          <line x1="12" y1="7.5" x2="12" y2="16.5" transform="rotate(-45 12 12)" />
        </>
      );
    case 'scan':
      return (
        <>
          <path d="M4 8V6a1 1 0 0 1 1-1h2" />
          <path d="M20 8V6a1 1 0 0 1-1-1h-2" />
          <path d="M4 16v2a1 1 0 0 0 1 1h2" />
          <path d="M20 16v2a1 1 0 0 0-1 1h-2" />
          <line x1="7" y1="12" x2="17" y2="12" />
        </>
      );
    case 'clipboard-check':
      return (
        <>
          <rect x="6" y="4" width="12" height="17" rx="2" />
          <rect x="9" y="2" width="6" height="3" rx="1" />
          <path d="M9 13l2 2l4-4" />
        </>
      );
    case 'document':
      return (
        <>
          <path d="M7 3h6l4 4v14a1 1 0 0 1-1 1H7a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1z" />
          <path d="M13 3v4h4" />
          <line x1="8.5" y1="13" x2="15" y2="13" />
          <line x1="8.5" y1="16.5" x2="15" y2="16.5" />
        </>
      );
    case 'laptop':
      return (
        <>
          <rect x="4" y="5" width="16" height="10" rx="1" />
          <path d="M2 19h20" />
        </>
      );
    case 'graduation':
      return (
        <>
          <path d="M12 4L2 9l10 5l10-5z" />
          <path d="M6 11v5c0 1.5 3 3 6 3s6-1.5 6-3v-5" />
        </>
      );
    case 'bank':
      return (
        <>
          <path d="M12 3l9 5H3z" />
          <line x1="5" y1="10" x2="5" y2="18" />
          <line x1="9.5" y1="10" x2="9.5" y2="18" />
          <line x1="14.5" y1="10" x2="14.5" y2="18" />
          <line x1="19" y1="10" x2="19" y2="18" />
          <line x1="3" y1="20" x2="21" y2="20" />
        </>
      );
    case 'partnership':
      return (
        <>
          <circle cx="9" cy="12" r="5.5" />
          <circle cx="15" cy="12" r="5.5" />
        </>
      );
    case 'person':
      return (
        <>
          <circle cx="12" cy="8" r="4" />
          <path d="M4 21c0-4.5 3.5-7 8-7s8 2.5 8 7" />
        </>
      );
    case 'lock':
      return (
        <>
          <rect x="5" y="11" width="14" height="9" rx="2" />
          <path d="M8 11V7a4 4 0 0 1 8 0v4" />
        </>
      );
    case 'book':
      return (
        <>
          <path d="M12 6c-2-1.5-5-2-8-1v13c3-1 6-0.5 8 1c2-1.5 5-2 8-1V5c-3-1-6-0.5-8 1z" />
          <line x1="12" y1="6" x2="12" y2="19" />
        </>
      );
    case 'scale':
      return (
        <>
          <line x1="12" y1="4" x2="12" y2="20" />
          <line x1="5" y1="7" x2="19" y2="7" />
          <path d="M5 7l-2.5 5a2.5 2.5 0 0 0 5 0z" />
          <path d="M19 7l-2.5 5a2.5 2.5 0 0 0 5 0z" />
          <line x1="8" y1="20" x2="16" y2="20" />
        </>
      );
    case 'check-circle':
      return (
        <>
          <circle cx="12" cy="12" r="9" />
          <path d="M8 12.5l2.5 2.5l5-6" />
        </>
      );
    case 'arrow-right':
      return (
        <>
          <line x1="4" y1="12" x2="19" y2="12" />
          <path d="M13 6l6 6l-6 6" />
        </>
      );
    case 'play':
      return <path d="M7 4l13 8l-13 8z" fill="currentColor" stroke="none" />;
  }
}

export default function Icon({
  name,
  size = 24,
  className,
  style,
}: {
  name: IconName;
  size?: number;
  className?: string;
  style?: CSSProperties;
}) {
  return (
    <svg
      width={size}
      height={size}
      style={style}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden="true"
    >
      {paths(name)}
    </svg>
  );
}
