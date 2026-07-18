import { randomUUID } from 'node:crypto';
import { headers } from 'next/headers';
import { getServiceClient, RESOLVER_VERSION } from '@/lib/supabase-server';
import { verifyFacilityJWT } from '@/lib/facility-jwt';
import { signTestFacilityJWT } from '@/lib/test-facility-jwt';
import {
  enforceResponseTimeFloor,
  MIN_RESOLUTION_RESPONSE_TIME_MS,
} from '@/lib/response-time-floor';

export const dynamic = 'force-dynamic';

const TEST_FACILITY_DID = 'did:huuid:gh:node-test-001';
const ACTIVE_TEST_DID = 'did:huuid:gh:TEST7X29ALPHAxyz001';
const REVOKED_TEST_DID = 'did:huuid:gh:TEST7X29ALPHAxyz002';

/**
 * /debug/resolver — TEMPORARY debug page (Build Rule 4: debug pages before
 * production pages). Raw data only, no styling. Remove before public launch.
 *
 * Audit log access outside this debug context is restricted: Root Authority
 * via service role only, facilities see only their own records, patients can
 * request their own access history (GET /1.0/audit/{huuid}, scoped JWT).
 *
 * The certificate-status and duplicate-request tests below make real,
 * self-targeted HTTP calls to this deployment's own resolver endpoint (via
 * the incoming request's host) so they exercise the actual deployed route
 * logic rather than a re-implementation of it. The certificate-status test
 * temporarily flips the test facility to 'suspended' and restores it to
 * 'active' in a finally block — this is a side effect of loading this page,
 * acceptable only because this page is temporary and debug-only.
 */

interface TestResult {
  outcome: 'PASS' | 'FAIL';
  detail: string;
}

interface JWTTestCase {
  name: string;
  expected: 'PASS' | 'FAIL';
  run: (publicKeyMultibase: string) => Promise<TestResult>;
}

/** Mirrors the exact JWT + jti/sub checks the resolver route performs. */
async function evaluateJwtCase(
  facilityDid: string,
  presentedRequestId: string,
  token: string | null,
  publicKeyMultibase: string
): Promise<TestResult> {
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

async function resolveViaHttp(origin: string, did: string, requestId: string, token: string) {
  const start = Date.now();
  const res = await fetch(`${origin}/1.0/identifiers/${did}`, {
    headers: {
      Authorization: `Bearer ${token}`,
      'X-HUUID-Purpose': 'Treatment',
      'X-HUUID-Facility': TEST_FACILITY_DID,
      'X-HUUID-Request-ID': requestId,
    },
    cache: 'no-store',
  });
  const body = await res.json();
  return { status: res.status, body, ms: Date.now() - start };
}

/** Suspends the test facility, confirms 403, then always restores it to active. */
async function testCertificateStatus(origin: string): Promise<TestResult> {
  const supabase = getServiceClient();
  const { error: suspendError } = await supabase
    .from('huuid_facilities')
    .update({ certificate_status: 'suspended' })
    .eq('facility_did', TEST_FACILITY_DID);

  if (suspendError) {
    return { outcome: 'FAIL', detail: `Could not suspend test facility: ${suspendError.message}` };
  }

  try {
    const now = Math.floor(Date.now() / 1000);
    const requestId = randomUUID();
    const token = await signTestFacilityJWT({
      facilityDid: TEST_FACILITY_DID,
      requestId,
      purposeCode: 'Treatment',
      iat: now,
      exp: now + 60,
    });
    if (!token) {
      return { outcome: 'FAIL', detail: 'HUUID_TEST_FACILITY_JWK not set — cannot sign test JWT' };
    }

    const { status, body } = await resolveViaHttp(origin, ACTIVE_TEST_DID, requestId, token);
    const pass = status === 403 && body?.didResolutionMetadata?.error === 'forbidden';
    return {
      outcome: pass ? 'PASS' : 'FAIL',
      detail: `status=${status} error=${body?.didResolutionMetadata?.error} message="${body?.didResolutionMetadata?.errorMessage}"`,
    };
  } finally {
    await supabase
      .from('huuid_facilities')
      .update({ certificate_status: 'active' })
      .eq('facility_did', TEST_FACILITY_DID);
  }
}

/** Sends the same X-HUUID-Request-ID twice; the second call must return 409. */
async function testDuplicateRequest(origin: string): Promise<TestResult> {
  const now = Math.floor(Date.now() / 1000);
  const requestId = randomUUID();
  const token = await signTestFacilityJWT({
    facilityDid: TEST_FACILITY_DID,
    requestId,
    purposeCode: 'Treatment',
    iat: now,
    exp: now + 60,
  });
  if (!token) {
    return { outcome: 'FAIL', detail: 'HUUID_TEST_FACILITY_JWK not set — cannot sign test JWT' };
  }

  const first = await resolveViaHttp(origin, ACTIVE_TEST_DID, requestId, token);
  const second = await resolveViaHttp(origin, ACTIVE_TEST_DID, requestId, token);

  const pass =
    first.status === 200 && second.status === 409 && second.body?.didResolutionMetadata?.error === 'duplicateRequest';
  return {
    outcome: pass ? 'PASS' : 'FAIL',
    detail: `first=${first.status}, second=${second.status} error=${second.body?.didResolutionMetadata?.error}`,
  };
}

/**
 * Deterministic, non-network test of the exact utility route.ts uses to pad
 * resolution outcomes to a floor — avoids the timing jitter a self-fetch
 * over HTTP would introduce.
 */
async function testResponseTimeFloor(): Promise<TestResult> {
  const fastStart = Date.now();
  await enforceResponseTimeFloor(fastStart);
  const fastElapsed = Date.now() - fastStart;

  const simulatedElapsedMs = 140;
  const slowStart = Date.now() - simulatedElapsedMs;
  await enforceResponseTimeFloor(slowStart);
  const slowElapsed = Date.now() - slowStart;

  const withinTolerance = (ms: number) =>
    ms >= MIN_RESOLUTION_RESPONSE_TIME_MS && ms < MIN_RESOLUTION_RESPONSE_TIME_MS + 30;
  const pass = withinTolerance(fastElapsed) && withinTolerance(slowElapsed);

  return {
    outcome: pass ? 'PASS' : 'FAIL',
    detail: `floor=${MIN_RESOLUTION_RESPONSE_TIME_MS}ms — ~0ms elapsed padded to ${fastElapsed}ms; ${simulatedElapsedMs}ms elapsed padded to ${slowElapsed}ms`,
  };
}

export default async function DebugResolverPage() {
  const supabase = getServiceClient();
  const host = headers().get('host') ?? 'localhost:3000';
  // Vercel (production and preview) is always HTTPS; plain `next dev` over
  // localhost is HTTP with no reverse proxy setting x-forwarded-proto.
  const isLocalHost = /^(localhost|127\.0\.0\.1)(:\d+)?$/.test(host);
  const origin = `${isLocalHost ? 'http' : 'https'}://${host}`;

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

  const jwtTestCases: JWTTestCase[] = [
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

  const jwtResults = publicKeyMultibase
    ? await Promise.all(jwtTestCases.map((tc) => tc.run(publicKeyMultibase)))
    : jwtTestCases.map(() => ({
        outcome: 'FAIL' as const,
        detail: 'No facility public key found — seed huuid_facilities first',
      }));

  // Sequential, not parallel: the certificate-status test mutates and
  // restores shared facility state, so it must not race the duplicate test.
  const certificateResult = await testCertificateStatus(origin);
  const duplicateResult = await testDuplicateRequest(origin);
  const timingFloorResult = await testResponseTimeFloor();

  const curl = [
    `curl -i "https://huuid-resolver.vercel.app/1.0/identifiers/did:huuid:gh:TEST7X29ALPHAxyz001" \\`,
    `  -H "Authorization: Bearer {facility-signed Ed25519 JWT}" \\`,
    `  -H "X-HUUID-Purpose: Treatment" \\`,
    `  -H "X-HUUID-Facility: ${TEST_FACILITY_DID}" \\`,
    `  -H "X-HUUID-Request-ID: {uuid — must equal the JWT's jti, and must not repeat within 24h}"`,
  ].join('\n');

  return (
    <main>
      <h1>/debug/resolver</h1>
      <p>resolver_version: {RESOLVER_VERSION}</p>

      <h2>JWT verification status (live test requests)</h2>
      <pre>
        {jwtTestCases
          .map((tc, i) => {
            const r = jwtResults[i];
            const status = r.outcome === tc.expected ? 'OK' : 'MISMATCH';
            return `[${status}] ${tc.name}\n        expected=${tc.expected} actual=${r.outcome} — ${r.detail}`;
          })
          .join('\n\n')}
      </pre>

      <h2>Certificate status enforcement (Hours 61-80)</h2>
      <pre>{`[${certificateResult.outcome === 'PASS' ? 'OK' : 'MISMATCH'}] Suspend test facility -> expect 403 forbidden -> restore to active
        ${certificateResult.detail}`}</pre>
      <p>
        Suspends <code>{TEST_FACILITY_DID}</code>, sends a validly-signed
        request against it via a real HTTP call to this deployment, confirms{' '}
        <code>403 forbidden</code>, then restores <code>certificate_status</code>{' '}
        to <code>active</code> (always, even on error).
      </p>

      <h2>Duplicate request detection (Hours 61-80)</h2>
      <pre>{`[${duplicateResult.outcome === 'PASS' ? 'OK' : 'MISMATCH'}] Same X-HUUID-Request-ID sent twice -> first 200, second 409
        ${duplicateResult.detail}`}</pre>

      <h2>Response time floor (Hours 61-80)</h2>
      <pre>{`[${timingFloorResult.outcome === 'PASS' ? 'OK' : 'MISMATCH'}] enforceResponseTimeFloor pads to ${MIN_RESOLUTION_RESPONSE_TIME_MS}ms regardless of starting elapsed time
        ${timingFloorResult.detail}`}</pre>
      <p>
        This exercises the exact utility <code>route.ts</code> calls before
        responding to any resolution outcome (200/404/410) — deterministic,
        no network jitter. For a live 404-vs-410 comparison against the
        deployed endpoint, see the curl example below using{' '}
        <code>{ACTIVE_TEST_DID}</code> (200), a nonexistent DID (404), and{' '}
        <code>{REVOKED_TEST_DID}</code> (410, seeded revoked test document).
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
        X-HUUID-Request-ID (UUID v4, must equal the JWT&apos;s jti, must not
        repeat within 24h). Research returns 403. Missing/invalid headers
        return 400. Invalid JWT returns 401. Suspended/revoked facility
        certificate returns 403. Duplicate Request-ID returns 409 without
        writing to the audit log. Every other outcome writes one audit row
        before the response is sent.
      </p>
    </main>
  );
}
