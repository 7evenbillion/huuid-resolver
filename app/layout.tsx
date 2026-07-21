import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'HUUID — Health Unique Universal ID',
  description:
    'A neutral protocol for trusted healthcare identity. W3C-registered did:huuid resolution infrastructure for Ghana and beyond.',
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
