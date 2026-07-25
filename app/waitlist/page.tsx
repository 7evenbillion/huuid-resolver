import Image from 'next/image';
import type { Metadata } from 'next';
import WaitlistForm from '@/components/WaitlistForm';

export const metadata: Metadata = {
  title: 'Join the Waitlist — HUUID',
  description: 'Register your interest and be among the first to receive your trusted healthcare identity.',
};

export default function WaitlistPage() {
  return (
    <main>
      <div className="waitlist-shell">
        <Image src="/images/logo-h.png" alt="HUUID" width={48} height={48} style={{ margin: '0 auto 32px' }} />
        <h1 className="h2">HUUID is coming to you.</h1>
        <p className="sub" style={{ margin: '0 auto' }}>
          Individual enrollment is opening soon. Register your interest and be among the first to
          receive your trusted healthcare identity.
        </p>
        <WaitlistForm />
      </div>
    </main>
  );
}
