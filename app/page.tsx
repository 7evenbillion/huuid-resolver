import ResolverTerminal from '@/components/ResolverTerminal';
import { getServiceClient } from '@/lib/supabase-server';

export const dynamic = 'force-dynamic';

async function getNetworkStats() {
  try {
    const client = getServiceClient();
    const [{ count: identifiers }, { count: resolutions }] = await Promise.all([
      client.from('huuid_did_documents').select('id', { count: 'exact', head: true }),
      client.from('huuid_audit_log').select('audit_entry_id', { count: 'exact', head: true }),
    ]);
    return { identifiers: identifiers ?? null, resolutions: resolutions ?? null };
  } catch {
    return { identifiers: null, resolutions: null };
  }
}

const FOOTPRINT = [
  { country: 'Ghana', status: 'National Pilot', pilot: true },
  { country: 'Nigeria', status: 'Protocol Available', pilot: false },
  { country: 'Kenya', status: 'Protocol Available', pilot: false },
  { country: 'Rwanda', status: 'Protocol Available', pilot: false },
  { country: 'South Africa', status: 'Protocol Available', pilot: false },
];

const GOVERNANCE_LINKS = [
  { label: 'Protocol Specification', href: 'https://7evenbillion.github.io/huuid-did-method' },
  { label: 'Open Governance', href: 'https://github.com/7evenbillion/huuid-resolver' },
  { label: 'Independent Technical Review', href: 'https://github.com/w3c/did-extensions/pull/722' },
  { label: 'Reference Implementation', href: 'https://github.com/7evenbillion/huuid-resolver' },
  {
    label: 'Security Disclosure Policy',
    href: 'mailto:josephtdnarnor@gmail.com?subject=Security%20Disclosure',
  },
  {
    label: 'Protocol Roadmap',
    href: 'mailto:josephtdnarnor@gmail.com?subject=Protocol%20Roadmap',
  },
  {
    label: 'Government Adoption Framework',
    href: 'mailto:josephtdnarnor@gmail.com?subject=Government%20Adoption',
  },
];

const PATHS = [
  {
    role: "I'm a Government",
    desc: 'Read the national adoption framework.',
    label: 'Government adoption framework',
    href: 'mailto:josephtdnarnor@gmail.com?subject=Government%20Adoption%20Inquiry',
  },
  {
    role: "I'm a Hospital",
    desc: 'Request a facility certificate.',
    label: 'Request a certificate',
    href: 'mailto:josephtdnarnor@gmail.com?subject=Facility%20Certificate%20Request',
  },
  {
    role: "I'm a Developer",
    desc: 'Read the API documentation.',
    label: 'View on GitHub',
    href: 'https://github.com/7evenbillion/huuid-resolver',
  },
  {
    role: "I'm a Researcher",
    desc: 'Read the protocol specification.',
    label: 'Read the spec',
    href: 'https://7evenbillion.github.io/huuid-did-method',
  },
];

const W3C_STATUS =
  'did:huuid registered in the W3C DID Extensions Registry. PR #722, merged July 13, 2026 by ottomorac.';

function NetworkGraphic() {
  return (
    <svg width="220" height="90" viewBox="0 0 220 90" fill="none" aria-hidden="true">
      <line x1="40" y1="45" x2="110" y2="20" stroke="#c7d2d6" strokeWidth="1" />
      <line x1="110" y1="20" x2="180" y2="45" stroke="#c7d2d6" strokeWidth="1" />
      <line x1="40" y1="45" x2="110" y2="70" stroke="#c7d2d6" strokeWidth="1" />
      <line x1="110" y1="70" x2="180" y2="45" stroke="#c7d2d6" strokeWidth="1" />
      <line x1="110" y1="20" x2="110" y2="70" stroke="#c7d2d6" strokeWidth="1" />
      <circle cx="40" cy="45" r="5" fill="#c7d2d6" />
      <circle cx="180" cy="45" r="5" fill="#c7d2d6" />
      <circle cx="110" cy="20" r="5" fill="#c7d2d6" />
      <circle cx="110" cy="70" r="8" fill="#0f9d8c" />
    </svg>
  );
}

export default async function Home() {
  const stats = await getNetworkStats();

  return (
    <main>
      {/* HERO */}
      <section className="hero container">
        <p className="hero-logo">HUUID</p>
        <p className="hero-declaration">A neutral protocol for trusted healthcare identity.</p>

        <h1 className="hero-mission">
          One patient.
          <br />
          One identity.
          <br />
          Every hospital.
        </h1>
        <p className="hero-category">Africa&apos;s Healthcare Trust Infrastructure</p>
        <p className="hero-body">Ghana retains complete sovereignty over every patient record.</p>

        <a className="btn btn-primary" href="#resolver">
          Try the Resolver
        </a>
      </section>

      {/* RESOLVER TERMINAL */}
      <section className="section section-alt section-border-top" id="resolver">
        <div className="container">
          <p className="eyebrow">Live infrastructure</p>
          <h2 className="section-title">Try the Resolver</h2>
          <p className="section-subtitle">
            Resolve a real HUUID against the production resolver — right now.
          </p>
          <ResolverTerminal />
        </div>
      </section>

      {/* NATIONAL RESOLVER NETWORK */}
      <section className="section section-border-top">
        <div className="container">
          <p className="eyebrow">Status</p>
          <h2 className="section-title">National Resolver Network</h2>
          <p className="section-subtitle">
            Live production status of the HUUID resolution infrastructure.
          </p>
          <div className="dashboard-grid">
            <div className="dashboard-cell">
              <div className="dashboard-value">Live</div>
              <div className="dashboard-label">Resolver status</div>
            </div>
            <div className="dashboard-cell">
              <div className="dashboard-value">
                {stats.identifiers !== null ? stats.identifiers.toLocaleString() : '—'}
              </div>
              <div className="dashboard-label">Identifiers registered</div>
            </div>
            <div className="dashboard-cell">
              <div className="dashboard-value">
                {stats.resolutions !== null ? stats.resolutions.toLocaleString() : '—'}
              </div>
              <div className="dashboard-label">Resolutions logged</div>
            </div>
            <div className="dashboard-cell">
              <div className="dashboard-value">8/8</div>
              <div className="dashboard-label">Attack vectors blocked</div>
            </div>
            <div className="dashboard-cell">
              <div className="dashboard-value">Paris</div>
              <div className="dashboard-label">Resolver region (cdg1)</div>
            </div>
          </div>
          <p className="dashboard-footnote">
            Every resolution generates a permanent cryptographic audit record.
          </p>
        </div>
      </section>

      {/* WORLD FOOTPRINT */}
      <section className="section section-alt section-border-top">
        <div className="container">
          <p className="eyebrow">Reach</p>
          <h2 className="section-title">Where HUUID Operates</h2>
          <p className="section-subtitle">
            HUUID is an open, W3C-registered protocol. Any country can implement it —
            Ghana is the first to pilot it.
          </p>
          <div className="network-graphic">
            <NetworkGraphic />
          </div>
          <div className="footprint-grid">
            {FOOTPRINT.map((f) => (
              <div className="footprint-card" key={f.country}>
                <div className="footprint-country">{f.country}</div>
                <span
                  className={
                    f.pilot ? 'status-pill status-pill-pilot' : 'status-pill status-pill-available'
                  }
                >
                  {f.status}
                </span>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* GOVERNMENT SECTION */}
      <section className="section section-border-top">
        <div className="container">
          <p className="eyebrow">For government</p>
          <h2 className="section-title">Built for institutional trust</h2>
          <p className="section-subtitle">
            Three questions every Ministry asks before adopting national infrastructure.
          </p>
          <div className="gov-grid">
            <div>
              <h3 className="gov-heading">Sovereign Health Data</h3>
              <p className="gov-body">
                No medical record ever leaves the facility where it was created. HUUID holds a
                cryptographic pointer only — never a diagnosis, prescription, or lab result. Every
                access requires the patient&apos;s physical presence and consent, or a permanently
                audited Break-Glass declaration. Ghana&apos;s data stays in Ghana.
              </p>
            </div>
            <div>
              <h3 className="gov-heading">Protecting Public Health Funds</h3>
              <p className="gov-body">
                The average hospital system carries 15-30% duplicate patient records, and
                comparable deployments elsewhere in Africa report 15-40% of health insurance
                payouts lost to claims fraud. Every HUUID resolution is cryptographically signed
                and permanently logged — insurance claims become independently verifiable, and
                fraud becomes detectable even years after the fact.
              </p>
            </div>
            <div>
              <h3 className="gov-heading">Emergency Clinical Access</h3>
              <p className="gov-body">
                When a patient arrives unconscious, an authorised clinician can trigger
                time-limited Break-Glass access to blood type, critical allergies, and current
                medications — no prior consent required, because none can be given. The access is
                logged, the patient is notified, and the grant expires automatically.
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* STANDARDS */}
      <section className="section section-alt section-border-top">
        <div className="container">
          <p className="eyebrow">Standards</p>
          <h2 className="section-title">Built on open standards</h2>
          <div className="standards-box">
            <strong>did:huuid</strong> registered in the W3C DID Extensions Registry. PR #722,
            merged July 13, 2026 by ottomorac.
          </div>
        </div>
      </section>

      {/* GOVERNANCE */}
      <section className="section section-border-top">
        <div className="container">
          <p className="eyebrow">Governance</p>
          <h2 className="section-title">Governance</h2>
          <p className="section-subtitle">HUUID is governed as an open protocol.</p>
          <ul className="governance-list">
            {GOVERNANCE_LINKS.map((link) => (
              <li key={link.label}>
                <a href={link.href} target={link.href.startsWith('mailto:') ? undefined : '_blank'} rel="noreferrer">
                  <span>{link.label}</span>
                  <span className="governance-arrow">→</span>
                </a>
              </li>
            ))}
          </ul>
        </div>
      </section>

      {/* FOUR PATHS */}
      <section className="section section-alt section-border-top">
        <div className="container">
          <p className="eyebrow">Participate</p>
          <h2 className="section-title">How to participate</h2>
          <div className="paths-grid">
            {PATHS.map((p) => (
              <div className="path-cell" key={p.role}>
                <div className="path-role">{p.role}</div>
                <p className="path-desc">{p.desc}</p>
                <a
                  className="path-link"
                  href={p.href}
                  target={p.href.startsWith('mailto:') ? undefined : '_blank'}
                  rel="noreferrer"
                >
                  {p.label} →
                </a>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* FOOTER */}
      <footer className="footer">
        <div className="container">
          <p className="footer-text">{W3C_STATUS}</p>
          <p className="footer-text">
            HUUID Protocol Working Group — josephtdnarnor@gmail.com
          </p>
        </div>
      </footer>
    </main>
  );
}
