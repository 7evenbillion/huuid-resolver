import { randomUUID } from 'node:crypto';
import { getServiceClient, RESOLVER_VERSION } from '@/lib/supabase-server';
import { verifyFacilityJWT } from '@/lib/facility-jwt';
import { signTestFacilityJWT } from '@/lib/test-facility-jwt';

export const dynamic = 'force-dynamic';

const TEST_FACILITY_DID = 'did:huuid:gh:node-test-001';

/**
 * /debug/resolver — TEMPORARY debug page (Build Rule 4: debug pages before
 * production pages). Raw data only, no styling. Remove before public launch.
 *
 * Audit log access outside this debug context is restricted: Root Authority
 * via service role only, facilities see only their own records, patients can
 * request their own access history (GET /1.0/audit/{huuid}, scoped JWT).
 */

interface JWTTestCase {
  name: string;
  expected: 'PASS' | 'FAIL';
  run: (publicKeyMultibase: string) => Promise<{ outcome: 'PASS' | 'FAIL'; detail: string }>;
}

/** Mirrors the exact JWT + jti/sub checks the resolver route performs. */
async function evaluateJwtCase(
  facilityDid: string,
  presentedRequestId: string,
  token: string | null,
  publicKeyMultibase: string
): Promise<{ outcome: 'PASS' | 'FAIL'; detail: string }> {
  if (!token) {
    return { outcome: 'FAIL', detail: 'HUUID_TEST_FACILITY_JWK not set — cannot sign test JWT' };
  }
  const result = await verifyFacilityJWT(`Bearer ${token}`, publicKeyMultibase);
  if (!result.ok) return { outcome: 'FAIL', detail: result.reason };
  if (result.claims.sub !== facilityDid) {
    return { outcome: 'FAIL', detail: 'JWT subject (sub) does not match X-HUUID-Facility header.' };
  }
  if (result.claims.jti !== presentedRequestId) {
    return { outcome: 'FAIL', detail: 'JWT jti does not match X-HUUID-Request-ID header.' };
  }
  return { outcome: 'PASS', detail: `sub=${result.claims.sub} jti=${result.claims.jti}` };
}

export default async function DebugResolverPage() {
  const supabase = getServiceClient();

  const [docs, audits, facilities] = await Promise.all([
    supabase
      .from('huuid_did_documents')
      .select('huuid, status, issuing_node, created_at, updated_at, did_document')
      .order('created_at', { ascending: false }),
    supabase
      .from('huuid_audit_log')
      .select('*')
      .order('resolved_at', { ascending: false })
      .limit(10),
    supabase
      .from('huuid_facilities')
      .select('facility_did, facility_name, certificate_status, public_key_multibase, created_at')
      .order('created_at', { ascending: false }),
  ]);

  const publicKeyMultibase = facilities.data?.[0]?.public_key_multibase as string | undefined;

  const now = Math.floor(Date.now() / 1000);

  const testCases: JWTTestCase[] = [
    {
      name: 'Valid JWT (fresh, sub/jti match)',
      expected: 'PASS',
      run: async (pk) => {
        const requestId = randomUUID();
        const token = await signTestFacilityJWT({
          facilityDid: TEST_FACILITY_DID,
          requestId,
          purposeCode: 'Treatment',
          iat: now,
          exp: now + 60,
        });
        return evaluateJwtCase(TEST_FACILITY_DID, requestId, token, pk);
      },
    },
    {
      name: 'Expired JWT (exp in the past)',
      expected: 'FAIL',
      run: async (pk) => {
        const requestId = randomUUID();
        const token = await signTestFacilityJWT({
          facilityDid: TEST_FACILITY_DID,
          requestId,
          purposeCode: 'Treatment',
          iat: now - 600,
          exp: now - 300,
        });
        return evaluateJwtCase(TEST_FACILITY_DID, requestId, token, pk);
      },
    },
    {
      name: 'exp - iat > 300 seconds',
      expected: 'FAIL',
      run: async (pk) => {
        const requestId = randomUUID();
        const token = await signTestFacilityJWT({
          facilityDid: TEST_FACILITY_DID,
          requestId,
          purposeCode: 'Treatment',
          iat: now,
          exp: now + 400,
        });
        return evaluateJwtCase(TEST_FACILITY_DID, requestId, token, pk);
      },
    },
    {
      name: 'jti does not match X-HUUID-Request-ID',
      expected: 'FAIL',
      run: async (pk) => {
        const token = await signTestFacilityJWT({
          facilityDid: TEST_FACILITY_DID,
          requestId: randomUUID(), // embedded in the token
          purposeCode: 'Treatment',
          iat: now,
          exp: now + 60,
        });
        // client presents a different Request-ID than the token's jti
        return evaluateJwtCase(TEST_FACILITY_DID, randomUUID(), token, pk);
      },
    },
  ];

  const results = publicKeyMultibase
    ? await Promise.all(testCases.map((tc) => tc.run(publicKeyMultibase)))
    : testCases.map(() => ({
        outcome: 'FAIL' as const,
        detail: 'No facility public key found — seed huuid_facilities first',
      }));

  const curl = [
    `curl -i "https://huuid-resolver.vercel.app/1.0/identifiers/did:huuid:gh:TEST7X29ALPHAxyz001" \\`,
    `  -H "Authorization: Bearer {facility-signed Ed25519 JWT}" \\`,
    `  -H "X-HUUID-Purpose: Treatment" \\`,
    `  -H "X-HUUID-Facility: ${TEST_FACILITY_DID}" \\`,
    `  -H "X-HUUID-Request-ID: {uuid — must equal the JWT's jti}"`,
  ].join('\n');

  return (
    <main>
      <h1>/debug/resolver</h1>
      <p>resolver_version: {RESOLVER_VERSION}</p>

      <h2>JWT verification status (live test requests)</h2>
      <pre>
        {testCases
          .map((tc, i) => {
            const r = results[i];
            const status = r.outcome === tc.expected ? 'OK' : 'MISMATCH';
            return `[${status}] ${tc.name}\n        expected=${tc.expected} actual=${r.outcome} — ${r.detail}`;
          })
          .join('\n\n')}
      </pre>
      <p>
        These four cases exercise the same verification path as{' '}
        <code>GET /1.0/identifiers/{'{did}'}</code>: Ed25519 signature + aud,
        exp-iat &le; 300s window, jti == X-HUUID-Request-ID, sub == X-HUUID-Facility.
        Test JWTs are signed server-side from <code>HUUID_TEST_FACILITY_JWK</code>{' '}
        (env var, never committed) and never leave this debug page.
      </p>

      <h2>huuid_facilities ({facilities.data?.length ?? 0})</h2>
      {facilities.error ? (
        <pre>ERROR: {facilities.error.message}</pre>
      ) : (
        <pre>{JSON.stringify(facilities.data, null, 2)}</pre>
      )}

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
        Required headers: Authorization (Bearer Ed25519 JWT), X-HUUID-Purpose
        (Treatment | Administrative | Research | Emergency), X-HUUID-Facility,
        X-HUUID-Request-ID (UUID v4, must equal the JWT&apos;s jti). Research
        returns 403. Missing/invalid headers return 400. Invalid JWT returns
        401. Every call writes one audit row before the response is sent.
      </p>
    </main>
  );
}
