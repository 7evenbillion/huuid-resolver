import Image from 'next/image';

export default function EnrollLayout({
  step,
  heading,
  sub,
  children,
}: {
  step: 1 | 2 | 3;
  heading: string;
  sub?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="enroll-page">
      <div className="enroll-shell">
        <div className="enroll-logo">
          <Image src="/images/logo-h.png" alt="HUUID" width={44} height={44} />
        </div>
        <div className="enroll-steps" aria-label={`Step ${step} of 3`}>
          {[1, 2, 3].map((s) => (
            <span
              key={s}
              className={`enroll-step-dot${s === step ? ' active' : ''}${s < step ? ' done' : ''}`}
            />
          ))}
        </div>
        <h1 className="enroll-heading">{heading}</h1>
        {sub && <p className="enroll-sub">{sub}</p>}
        {children}
      </div>
    </div>
  );
}
