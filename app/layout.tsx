import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'HUUID — Human Universal Identity Directory',
  description:
    'One trusted healthcare identity for life. Be recognised at any participating healthcare facility, anywhere in the world.',
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
