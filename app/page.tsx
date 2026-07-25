import Image from 'next/image';
import Navigation from '@/components/Navigation';
import LiveDemo from '@/components/LiveDemo';
import Icon, { type IconName } from '@/components/Icon';

const FACILITY_CARDS: { icon: IconName; title: string; body: string }[] = [
  {
    icon: 'clipboard-check',
    title: 'Admissions & Registration',
    body: 'Register patients in seconds. Reduce duplicate records. Eliminate repeat registrations. Reduce queues. Improve patient flow. Spend less time on paperwork. Deliver a better patient experience from the moment of arrival.',
  },
  {
    icon: 'cross-medical',
    title: 'Doctors',
    body: 'Treat informed patients instead of strangers. Discover previous diagnoses. Locate existing laboratory results. Locate previous imaging. Identify allergies. Review current medications. Make faster, better-informed clinical decisions.',
  },
  {
    icon: 'microscope',
    title: 'Specialists',
    body: 'Locate relevant clinical history immediately. Reduce time requesting records. Collaborate across healthcare institutions. Improve continuity of specialist care. Begin treatment with greater confidence.',
  },
  {
    icon: 'flask',
    title: 'Laboratories',
    body: 'Help clinicians discover existing results. Reduce unnecessary duplicate testing. Improve efficiency. Reduce patient costs. Support better clinical decision-making.',
  },
  {
    icon: 'pill',
    title: 'Pharmacies',
    body: 'Improve medication safety. Identify allergies. Reduce prescription conflicts. Support safer dispensing decisions. Improve patient confidence.',
  },
  {
    icon: 'scan',
    title: 'Radiology',
    body: 'Locate existing CT scans, MRI studies, ultrasound reports and X-rays. Reduce unnecessary repeat imaging. Improve efficiency while lowering healthcare costs.',
  },
  {
    icon: 'document',
    title: 'Finance & Billing',
    body: 'Verify patient identity immediately. Reduce billing disputes. Strengthen insurance verification. Improve auditability. Reduce revenue leakage. Accelerate claims processing.',
  },
  {
    icon: 'building',
    title: 'Hospital Administration',
    body: 'Maintain cleaner patient records. Reduce duplicate identities. Improve operational efficiency. Strengthen interoperability. Reduce administrative workload. Improve reporting.',
  },
];

const PARTNER_CARDS: { icon: IconName; title: string; subtitle: string; body: string }[] = [
  {
    icon: 'laptop',
    title: 'Digital Health & Technology',
    subtitle: 'Build Once. Connect Everywhere.',
    body: 'HUUID provides open standards and secure APIs. Electronic Medical Records. Hospital Information Systems. Telemedicine. Pharmacy Systems. Laboratory Systems. AI. Analytics. Build once. Connect everywhere.',
  },
  {
    icon: 'microscope',
    title: 'Research Organisations',
    subtitle: 'Advance Research. Protect Privacy.',
    body: 'Advance healthcare research while protecting patient privacy. Recruit participants efficiently. Support longitudinal studies. Enable consent-driven participation.',
  },
  {
    icon: 'building',
    title: 'Employers',
    subtitle: 'Occupational Health. Simplified.',
    body: 'Support occupational health programmes. Simplify employee medical assessments. Verify authorised outcomes without exposing unnecessary medical information.',
  },
  {
    icon: 'graduation',
    title: 'Universities',
    subtitle: 'Student Health. Connected.',
    body: 'Support student healthcare services. Simplify vaccination verification. Improve medical clearance. Provide continuity for international students.',
  },
  {
    icon: 'bank',
    title: 'Banks & Financial Institutions',
    subtitle: 'Healthcare Finance. Verified.',
    body: 'Support healthcare financing through trusted verification. Verify healthcare events with patient consent. Improve healthcare loan processing.',
  },
  {
    icon: 'globe',
    title: 'Humanitarian Organisations',
    subtitle: 'Care Without Borders.',
    body: 'Deploy trusted healthcare identity in underserved and crisis environments. Support refugee healthcare continuity. Enable care without borders.',
  },
];

const TRUST_ITEMS: { icon: IconName; label: string }[] = [
  { icon: 'lock', label: 'Patient-controlled consent' },
  { icon: 'clipboard-check', label: 'Immutable audit logs' },
  { icon: 'check-circle', label: 'Verifiable credentials' },
  { icon: 'book', label: 'Open standards' },
  { icon: 'shield', label: 'Privacy by design' },
  { icon: 'building', label: 'Healthcare institution ownership' },
  { icon: 'globe', label: 'National healthcare sovereignty' },
  { icon: 'scale', label: 'Transparent governance' },
  { icon: 'lock', label: 'Modern cryptography' },
];

function ArrowButton({
  href,
  className,
  children,
  target,
  rel,
}: {
  href: string;
  className: string;
  children: string;
  target?: string;
  rel?: string;
}) {
  return (
    <a href={href} className={className} target={target} rel={rel}>
      {children}
      <Icon name="arrow-right" size={16} className="icon-inline" />
    </a>
  );
}

export default function Home() {
  return (
    <main>
      <Navigation />

      {/* SECTION 1 — HERO */}
      <section className="hero">
        <div className="hero-text">
          <span className="badge">
            <Icon name="shield" size={14} className="icon-inline" />
            Trusted Healthcare Identity
          </span>
          <h1 className="hero-headline">
            Every patient is unique.
            <br />
            Healthcare should begin with
            <br />
            their unique medical history.
          </h1>
          <p className="hero-body">
            Get your HUUID. One trusted healthcare identity for life. Be recognised at any
            participating healthcare facility, anywhere in the world. Never start your healthcare
            journey from scratch again.
          </p>
          <div className="hero-buttons">
            <ArrowButton href="/waitlist" className="btn btn-teal">
              Get Your HUUID
            </ArrowButton>
            <a href="#how-it-works" className="btn btn-teal-outline">
              See How It Works
              <Icon name="play" size={14} className="icon-inline" />
            </a>
          </div>
          <div className="trust-row">
            <div className="trust-item">
              <Icon name="shield" size={18} className="icon-inline" style={{ color: 'var(--teal)' }} />
              <span>Your medical records stay where they are created.</span>
            </div>
            <div className="trust-item">
              <Icon name="globe" size={18} className="icon-inline" style={{ color: 'var(--teal)' }} />
              <span>Your trusted healthcare identity travels with you.</span>
            </div>
          </div>
        </div>
        <div className="hero-image-col">
          <Image src="/images/hero-main.png" alt="Patient showing her HUUID on a hospital app" fill priority sizes="40vw" style={{ objectFit: 'cover' }} />
        </div>
      </section>

      {/* SECTION 2 — WHY HUUID EXISTS */}
      <section className="section section-white" id="patients">
        <div className="container" style={{ maxWidth: 860 }}>
          <p className="eyebrow">WHY HUUID EXISTS</p>
          <h2 className="h2">Every person has a unique healthcare story.</h2>

          <p className="body-text">
            Your blood type, allergies, medications, vaccinations, surgeries, laboratory results,
            chronic conditions and treatment history are unique to you. No two patients are the
            same. Yet every day, millions of people walk into healthcare facilities around the
            world and become strangers.
          </p>
          <p className="body-text">
            The same registration forms.
            <br />
            The same medical questions.
            <br />
            The same history repeated from memory.
            <br />
            The same uncertainty.
          </p>

          <div className="callout">
            <p>
              Imagine Ama, who lives in Accra and manages diabetes. She travels to Cape Town for
              work and develops an infection. At the clinic she is asked to complete another
              registration form and recall years of medications, allergies, previous treatments
              and laboratory tests. Her medical history already exists — it simply cannot be
              recognised.
            </p>
            <p>
              With HUUID, that experience changes. The clinic recognises Ama&apos;s trusted
              healthcare identity in seconds. With her consent, the clinician discovers where her
              medical history already exists and requests exactly what is needed. Her records
              never leave Ghana. The treating facility gains the information it needs. Ama
              receives informed care without starting from the beginning.
            </p>
          </div>

          <p className="body-text">
            This happens every day, in every country, across every healthcare system.
          </p>
          <p className="body-text">
            Healthcare should never begin with guesswork.
            <br />
            Healthcare should begin with your unique medical history.
            <br />
            HUUID makes that possible.
          </p>
        </div>
      </section>

      {/* SECTION 3 — HOW HUUID WORKS */}
      <section className="section section-white center" id="how-it-works">
        <div className="container">
          <h2 className="h2">How HUUID Works</h2>
          <p className="sub" style={{ fontSize: 20 }}>
            One Healthcare Identity.
            <br />
            Lifetime Continuity of Care.
          </p>

          <div className="how-image">
            <Image
              src="/images/how-it-works.png"
              alt="Five-step diagram of how HUUID works"
              width={900}
              height={360}
              style={{ width: '100%', height: 'auto' }}
            />
          </div>

          <div style={{ maxWidth: 700, margin: '0 auto', textAlign: 'left' }}>
            <p className="body-text" style={{ fontSize: 17 }}>
              Your HUUID is your trusted healthcare identity. When you visit any participating
              healthcare facility anywhere in the world, your HUUID allows healthcare
              professionals to recognise you immediately and discover where your medical history
              already exists.
            </p>
            <p className="body-text" style={{ fontSize: 17 }}>
              Your medical records never leave the healthcare institutions that created them.
              Hospitals remain owners of hospital records. Laboratories remain owners of
              laboratory records. Pharmacies remain owners of pharmacy records.
            </p>
            <p className="body-text" style={{ fontSize: 17 }}>
              HUUID provides trusted identity, secure discovery, patient-controlled consent and
              verifiable access.
            </p>
          </div>

          <div className="stat-line">
            <Icon name="shield" size={22} className="icon-inline" style={{ marginRight: 8, verticalAlign: -4 }} />
            &ldquo;Your identity travels. Your medical records stay where they belong.&rdquo;
          </div>
        </div>
      </section>

      {/* SECTION 4 — WHAT CHANGES FOR PATIENTS */}
      <section className="section-grey" id="patients-detail">
        <div className="split">
          <div className="split-image">
            <Image src="/images/patient-woman.png" alt="Patient smiling while using her phone" fill sizes="50vw" style={{ objectFit: 'cover' }} />
          </div>
          <div className="split-text">
            <p className="eyebrow">FOR PATIENTS</p>
            <h2 className="h2">Healthcare should never start from scratch.</h2>
            <p className="body-text">
              Receive better-informed care because healthcare professionals can build on your
              medical history instead of beginning without it.
            </p>
            <ul className="check-list">
              <li>
                <span className="check-mark">✓</span>
                <span>Be recognised wherever you receive care.</span>
              </li>
              <li>
                <span className="check-mark">✓</span>
                <span>Stop repeating your medical history.</span>
              </li>
              <li>
                <span className="check-mark">✓</span>
                <span>Stop completing the same registration forms.</span>
              </li>
              <li>
                <span className="check-mark">✓</span>
                <span>Reduce unnecessary repeat tests.</span>
              </li>
              <li>
                <span className="check-mark">✓</span>
                <span>Receive safer treatment through better-informed clinical decisions.</span>
              </li>
              <li>
                <span className="check-mark">✓</span>
                <span>Remain in control of who can access your healthcare information.</span>
              </li>
            </ul>
            <p style={{ fontWeight: 700, color: 'var(--navy)', fontSize: 17 }}>
              One trusted healthcare identity. For life.
            </p>
          </div>
        </div>
      </section>

      {/* SECTION 5 — FOR HEALTHCARE FACILITIES */}
      <section className="section-white" id="healthcare-facilities">
        <div className="banner">
          <Image src="/images/doctor-tablet.png" alt="Doctor reviewing a patient's history on a tablet" fill sizes="100vw" style={{ objectFit: 'cover' }} />
          <div className="banner-overlay">
            <p className="eyebrow">FOR HEALTHCARE FACILITIES</p>
            <h2>Better Healthcare Begins Before Treatment</h2>
            <p>
              Every patient arrives with a story. HUUID helps your organisation understand that
              story before treatment begins.
            </p>
          </div>
        </div>

        <div className="container banner-cards">
          <div className="grid grid-4">
            {FACILITY_CARDS.map((c) => (
              <div className="card" key={c.title}>
                <div className="icon-badge">
                  <Icon name={c.icon} size={22} />
                </div>
                <h3 className="card-title">{c.title}</h3>
                <p className="card-body">{c.body}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* SECTION 6 — FOR GOVERNMENTS */}
      <section className="section section-dark" id="governments">
        <div className="container split" style={{ gap: 48, padding: 0 }}>
          <div style={{ display: 'flex', flexDirection: 'column', justifyContent: 'center' }}>
            <p className="eyebrow eyebrow-bright">FOR GOVERNMENTS</p>
            <h2 className="h2">
              National Healthcare Interoperability
              <br />
              Without Centralising Medical Records
            </h2>
            <p className="sub" style={{ fontSize: 20 }}>
              Governments need connected healthcare.
              <br />
              Not centralised healthcare databases.
            </p>
            <p className="body-text" style={{ color: 'var(--text-grey-light)' }}>
              HUUID enables healthcare providers across a nation to recognise the same patient
              while every healthcare institution continues to own and manage its own medical
              records.
            </p>

            <div className="strong-points">
              <div className="strong-point">
                <span className="strong-point-dot">●</span>
                <span>No national medical database to build.</span>
              </div>
              <div className="strong-point">
                <span className="strong-point-dot">●</span>
                <span>No patient data leaving the institutions that created it.</span>
              </div>
              <div className="strong-point">
                <span className="strong-point-dot">●</span>
                <span>No foreign company holding your citizens&apos; healthcare records.</span>
              </div>
            </div>

            <ul className="bullet-list">
              <li>Improve referrals</li>
              <li>Improve national health planning</li>
              <li>Support disease surveillance</li>
              <li>Strengthen public health reporting</li>
              <li>Reduce duplicate healthcare expenditure</li>
              <li>Improve continuity of care</li>
              <li>Protect national healthcare sovereignty</li>
              <li>Connect healthcare without centralising it</li>
            </ul>

            <ArrowButton
              href="mailto:josephtdnarnor@gmail.com?subject=Partner%20With%20HUUID"
              className="btn btn-white-outline"
            >
              Partner With HUUID
            </ArrowButton>
          </div>
          <div className="split-image" style={{ minHeight: 420, borderRadius: 12, overflow: 'hidden' }}>
            <Image src="/images/government-flags.png" alt="Government building with international flags" fill sizes="50vw" style={{ objectFit: 'cover' }} />
          </div>
        </div>
      </section>

      {/* SECTION 7 — FOR HEALTH INSURERS */}
      <section className="section-white" id="insurers">
        <div className="split">
          <div className="split-image">
            <Image src="/images/insurer-claims.png" alt="Insurance analyst reviewing a claims report" fill sizes="50vw" style={{ objectFit: 'cover' }} />
          </div>
          <div className="split-text">
            <p className="eyebrow">FOR HEALTH INSURERS</p>
            <h2 className="h2">
              Trusted Claims Begin With
              <br />
              Trusted Healthcare Identity
            </h2>
            <p className="sub">
              Every healthcare claim begins with a patient. HUUID makes that patient easier to
              verify.
            </p>
            <p className="body-text">
              Every identity resolution creates a permanent cryptographically signed audit record
              before any response is returned.
            </p>
            <p className="body-text">
              A healthcare visit can be verified against that audit trail.
              <br />
              Suspicious activity becomes easier to investigate.
              <br />
              Fraud becomes harder to hide.
            </p>
            <ul className="check-list">
              <li>
                <span className="check-mark">✓</span>
                <span>Verify healthcare interactions against permanent audit trails.</span>
              </li>
              <li>
                <span className="check-mark">✓</span>
                <span>Immutable cryptographic records of every identity resolution.</span>
              </li>
              <li>
                <span className="check-mark">✓</span>
                <span>Fraudulent claims become harder to hide and easier to detect.</span>
              </li>
              <li>
                <span className="check-mark">✓</span>
                <span>Faster reimbursement decisions built on trusted verified identity.</span>
              </li>
            </ul>
          </div>
        </div>
      </section>

      {/* SECTION 8 — FOR PARTNERS */}
      <section className="section section-grey center" id="partners">
        <div className="container">
          <p className="eyebrow">FOR PARTNERS</p>
          <h2 className="h2">
            Built For Everyone
            <br />
            Who Touches Healthcare
          </h2>

          <div style={{ position: 'relative', height: 320, borderRadius: 12, overflow: 'hidden', margin: '32px 0 48px' }}>
            <Image
              src="/images/technology-team.png"
              alt="Technology partners building on HUUID"
              fill
              sizes="100vw"
              style={{ objectFit: 'cover' }}
            />
          </div>

          <div className="grid grid-3" style={{ textAlign: 'left' }}>
            {PARTNER_CARDS.map((c) => (
              <div className="card" key={c.title}>
                <div className="icon-badge">
                  <Icon name={c.icon} size={22} />
                </div>
                <p className="card-subtitle">{c.subtitle}</p>
                <h3 className="card-title">{c.title}</h3>
                <p className="card-body">{c.body}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* SECTION 9 — LIVE DEMONSTRATION */}
      <section className="section section-dark center" id="demo">
        <div className="container">
          <p className="eyebrow eyebrow-bright">LIVE DEMONSTRATION</p>
          <h2 className="h2">See HUUID In Action</h2>
          <p className="sub" style={{ margin: '0 auto 48px' }}>
            Experience how trusted healthcare identity works. This demonstration shows how a
            participating healthcare facility securely recognises a patient without accessing or
            storing medical records.
          </p>
          <LiveDemo />
        </div>
      </section>

      {/* SECTION 10 — TRUST BY DESIGN */}
      <section className="section section-white center" id="trust-by-design">
        <div className="container">
          <p className="eyebrow">TRUST BY DESIGN</p>
          <h2 className="h2">Healthcare trust must be earned.</h2>

          <div className="grid" style={{ gridTemplateColumns: '1fr 1fr', textAlign: 'left', marginTop: 40 }}>
            <div className="w3c-card">
              <div className="credential-badge">
                <span className="credential-badge-icon">
                  <Icon name="check-circle" size={20} />
                </span>
                <span className="credential-badge-text">
                  <strong>W3C Registered</strong>
                  <span>Decentralized Identifier Method</span>
                </span>
              </div>
              <h3>W3C Registered Standard</h3>
              <p>
                The did:huuid method is built on W3C Decentralized Identifier standards, enabling
                globally interoperable, independently verifiable and vendor-neutral healthcare
                identity.
              </p>
            </div>
            <div className="trust-grid">
              {TRUST_ITEMS.map((t) => (
                <div className="trust-grid-item" key={t.label}>
                  <Icon name={t.icon} size={20} className="icon-inline" style={{ color: 'var(--teal)' }} />
                  <span>{t.label}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>

      {/* SECTION 11 — GOVERNANCE */}
      <section className="section section-navy center">
        <div className="container">
          <h2 className="h2">Built For Nations. Governed For Trust.</h2>
          <p className="sub" style={{ margin: '0 auto 48px' }}>HUUID is trusted healthcare infrastructure.</p>

          <div className="principle-grid">
            <div className="principle-card">
              <div className="icon-badge icon-badge-dark" style={{ margin: '0 auto 12px' }}>
                <Icon name="person" size={20} />
              </div>
              <p>Patients control consent.</p>
            </div>
            <div className="principle-card">
              <div className="icon-badge icon-badge-dark" style={{ margin: '0 auto 12px' }}>
                <Icon name="building" size={20} />
              </div>
              <p>Healthcare institutions own their medical records.</p>
            </div>
            <div className="principle-card">
              <div className="icon-badge icon-badge-dark" style={{ margin: '0 auto 12px' }}>
                <Icon name="scale" size={20} />
              </div>
              <p>Governments retain sovereignty over national healthcare systems.</p>
            </div>
            <div className="principle-card">
              <div className="icon-badge icon-badge-dark" style={{ margin: '0 auto 12px' }}>
                <Icon name="laptop" size={20} />
              </div>
              <p>Technology providers build on open standards.</p>
            </div>
          </div>

          <p className="governance-statement">
            The protocol remains transparent, interoperable and free from vendor lock-in.
            <br />
            <br />
            Healthcare trust belongs to everyone.
          </p>
        </div>
      </section>

      {/* SECTION 12 — JOIN THE NETWORK */}
      <section className="section section-white center">
        <div className="container">
          <h2 className="h2">Join the Global Network</h2>
          <p className="sub" style={{ margin: '0 auto' }}>
            Healthcare is stronger when it begins with knowledge instead of uncertainty.
            <br />
            <br />
            Whether you are a patient, healthcare provider, government, insurer, technology
            company, university, employer, researcher or innovator, HUUID enables a future where
            trusted healthcare identity improves care for everyone.
            <br />
            <br />
            Join the growing global network building the trust infrastructure for healthcare.
          </p>

          <div className="cta-grid">
            <div className="cta-card">
              <div className="icon-badge" style={{ margin: '0 auto 4px' }}>
                <Icon name="person" size={22} />
              </div>
              <h3>Get Your HUUID</h3>
              <p>Create your identity today.</p>
              <ArrowButton href="/waitlist" className="btn btn-teal">
                Get Your HUUID
              </ArrowButton>
            </div>
            <div className="cta-card">
              <div className="icon-badge" style={{ margin: '0 auto 4px' }}>
                <Icon name="partnership" size={22} />
              </div>
              <h3>Partner With HUUID</h3>
              <p>Bring trusted identity to your community.</p>
              <ArrowButton
                href="mailto:josephtdnarnor@gmail.com?subject=HUUID%20Partnership%20Inquiry"
                className="btn btn-teal-outline"
              >
                Partner With HUUID
              </ArrowButton>
            </div>
            <div className="cta-card">
              <div className="icon-badge" style={{ margin: '0 auto 4px' }}>
                <Icon name="globe" size={22} />
              </div>
              <h3>Explore the Platform</h3>
              <p>See how HUUID can power your solutions.</p>
              <ArrowButton href="/debug/resolver" className="btn btn-teal-outline">
                Explore the Platform
              </ArrowButton>
            </div>
          </div>
        </div>
      </section>

      {/* FOOTER */}
      <footer className="footer">
        <div className="container footer-grid">
          <div>
            <div className="footer-brand">
              <Image src="/images/logo-h.png" alt="HUUID" width={40} height={40} />
              <span className="footer-brand-name">HUUID</span>
            </div>
            <p className="footer-brand-sub" style={{ marginBottom: 16 }}>
              Human Universal Identity Directory
            </p>
            <p>One trusted healthcare identity for life.</p>
            <p>Recognised at any participating healthcare facility, anywhere in the world.</p>
          </div>

          <div>
            <p>
              Healthcare should begin with your unique medical history because no two patients are
              the same.
            </p>
            <p>Your medical records stay where they are created.</p>
            <p>Your trusted healthcare identity travels with you.</p>
          </div>

          <div>
            <h4>Links</h4>
            <ul className="footer-links">
              <li>
                <a href="#">About Us</a>
              </li>
              <li>
                <a href="#trust-by-design">Governance</a>
              </li>
              <li>
                <a href="https://github.com/7evenbillion/huuid-resolver" target="_blank" rel="noreferrer">
                  Developers
                </a>
              </li>
              <li>
                <a href="#">News</a>
              </li>
              <li>
                <a href="mailto:josephtdnarnor@gmail.com">Contact</a>
              </li>
            </ul>
          </div>

          <div>
            <div className="credential-badge credential-badge-dark">
              <span className="credential-badge-icon">
                <Icon name="check-circle" size={18} />
              </span>
              <span className="credential-badge-text">
                <strong>W3C Registered</strong>
                <span>did:huuid</span>
              </span>
            </div>
          </div>
        </div>

        <div className="footer-bottom">
          <div className="footer-bottom-inner">
            <span>© HUUID. Building the trust infrastructure for global healthcare.</span>
            <ul className="footer-bottom-links">
              <li>
                <a href="#">About Us</a>
              </li>
              <li>
                <a href="#trust-by-design">Governance</a>
              </li>
              <li>
                <a href="https://github.com/7evenbillion/huuid-resolver" target="_blank" rel="noreferrer">
                  Developers
                </a>
              </li>
              <li>
                <a href="#">News</a>
              </li>
              <li>
                <a href="mailto:josephtdnarnor@gmail.com">Contact</a>
              </li>
            </ul>
          </div>
        </div>
      </footer>
    </main>
  );
}
