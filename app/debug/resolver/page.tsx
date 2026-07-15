import { getServiceClient, RESOLVER_VERSION } from '@/lib/supabase-server';

export const dynamic = 'force-dynamic';

/**
 * /debug/resolver — TEMPORARY debug page (Build Rule 4: debug pages before
 * production pages). Raw data only, no styling. Remove before public launch.
 */
export default async function DebugResolverPage() {
  const supabase = getServiceClient();

  const [docs, audits] = await Promise.all([
    supabase
      .from('huuid_did_documents')
      .select('huuid, status, issuing_node, created_at, updated_at, did_document')
      .order('created_at', { ascending: false }),
    supabase
      .from('huuid_audit_log')
      .select('*')
      .order('resolved_at', { ascending: false })
      .limit(10),
  ]);

  const curl = [
    `curl -i "https://huuid-resolver.vercel.app/1.0/identifiers/did:huuid:gh:TEST7X29ALPHAxyz001" \\`,
    `  -H "X-HUUID-Purpose: Treatment" \\`,
    `  -H "X-HUUID-Facility: did:huuid:gh:node-korlebu-reg" \\`,
    `  -H "X-HUUID-Request-ID: $(uuidgen)"`,
  ].join('\n');

  return (
    <main>
      <h1>/debug/resolver</h1>
      <p>resolver_version: {RESOLVER_VERSION}</p>

      <h2>huuid_did_documents ({docs.data?.length ?? 0})</h2>
      {docs.error ? (
        <pre>ERROR: {docs.error.message}</pre>
      ) : (
        <pre>{JSON.stringify(docs.data, null, 2)}</pre>
      )}

      <h2>huuid_audit_log (last 10, newest first)</h2>
      {audits.error ? (
        <pre>ERROR: {audits.error.message}</pre>
      ) : (
        <pre>{JSON.stringify(audits.data, null, 2)}</pre>
      )}

      <h2>How to test the endpoint</h2>
      <pre>{curl}</pre>
      <p>
        Required headers: X-HUUID-Purpose (Treatment | Administrative |
        Research | Emergency), X-HUUID-Facility, X-HUUID-Request-ID (UUID v4).
        Research returns 403. Missing headers return 400. Every call writes one
        audit row before the response is sent.
      </p>
    </main>
  );
}
