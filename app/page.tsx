export default function Home() {
  return (
    <main>
      <h1>HUUID Resolver</h1>
      <p>
        W3C DID resolution engine for <code>did:huuid</code> — health identity
        infrastructure for Ghana and beyond.
      </p>
      <p>
        Resolution endpoint (GET only): <code>GET /1.0/identifiers/{'{did}'}</code>.
        Break-Glass is the protocol&apos;s only POST:{' '}
        <code>POST /1.0/identifiers/{'{did}'}/break-glass</code>.
      </p>
      <p>
        Every request carries a facility-signed Ed25519 JWT, verified against
        the facility&apos;s registered public key before resolution proceeds.
      </p>
      <p>
        Every resolution is audited before the response is sent. Medical data
        never touches this server — pointers only.
      </p>
    </main>
  );
}
