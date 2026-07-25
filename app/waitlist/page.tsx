import Image from 'next/image';
import type { Metadata } from 'next';
import WaitlistForm from '@/components/WaitlistForm';
import Icon from '@/components/Icon';

export const metadata: Metadata = {
  title: 'Join the Waitlist — HUUID',
  description: 'Register your interest and be among the first to receive your trusted healthcare identity.',
};

export default function WaitlistPage() {
  return (
    <main className="waitlist-split">
      <div className="waitlist-image">
        <Image
          src="/images/patient-woman.png"
          alt="Patient smiling while using her phone"
          fill
          sizes="45vw"
          priority
          style={{ objectFit: 'cover' }}
        />
      </div>
      <div className="waitlist-content">
        <div className="waitlist-shell">
          <Image src="/images/logo-h.png" alt="HUUID" width={44} height={44} style={{ marginBottom: 28 }} />
          <span className="badge">
            <Icon name="shield" size={14} className="icon-inline" />
            Trusted Healthcare Identity
          </span>
          <h1 className="h2" style={{ marginTop: 20 }}>
            HUUID is coming to you.
          </h1>
          <p className="sub">
            Individual enrollment is opening soon. Register your interest and be among the first to
            receive your trusted healthcare identity.
          </p>
          <WaitlistForm />
        </div>
      </div>
    </main>
  );
}
