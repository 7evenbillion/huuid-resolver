export default function Home() {
  return (
    <main>
      <h1>HUUID Resolver</h1>
      <p>
        W3C DID resolution engine for <code>did:huuid</code> — health identity
        infrastructure for Ghana and beyond.
      </p>
      <p>
        Resolution endpoint: <code>GET /1.0/identifiers/{'{did}'}</code>
      </p>
      <p>
        Every resolution is audited before the response is sent. Medical data
        never touches this server — pointers only.
      </p>
    </main>
  );
}
