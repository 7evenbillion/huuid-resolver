import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'HUUID Resolver',
  description:
    'W3C DID resolution engine for did:huuid — health identity infrastructure. Pointers only; medical data never touches this server.',
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body style={{ fontFamily: 'monospace', margin: 0, padding: 24 }}>
        {children}
      </body>
    </html>
  );
}
