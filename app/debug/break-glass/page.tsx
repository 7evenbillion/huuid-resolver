import { randomUUID } from 'node:crypto';
import { headers } from 'next/headers';
import { getServiceClient, RESOLVER_VERSION } from '@/lib/supabase-server';
import { signTestProviderJWT, signTestBGRequestSignature } from '@/lib/test-provider-jwt';
import { triggerTestBreakGlass } from './actions';
import { TEST_FACILITY_DID, TEST_CLINICIAN_DID, ACTIVE_TEST_DID } from './constants';

export const dynamic = 'force-dynamic';

/**
 * /debug/break-glass — TEMPORARY debug page (BUILD.md Rule 4: debug pages
 * before any UI). Raw data only, no styling. Remove before public launch.
 *
 * Auto-run scenarios below are deliberately limited to ones that fail
 * BEFORE Step 6's rate-limit record insert (expired JWT, invalid
 * signature, forbidden scope) — they cost nothing against the facility's
 * 10/24h Break-Glass ceiling. A full valid (200) request DOES consume a
 * rate-limit slot, so that path is only run via the explicit form below,
 * never automatically on page load. The 10-then-11th-request suspension
 * sequence (DoD 8/9) is destructive/stateful and is verified via a
 * dedicated one-time script, not by this page — this page shows the
 * resulting state (suspension status, rate-limit counter) afterward.
 */

interface TestResult {
  outcome: 'PASS' | 'FAIL';
  detail: string;
}

function currentOrigin(host: string): string {
  const isLocalHost = /^(localhost|127\.0\.0\.1)(:\d+)?$/.test(host);
  return `${isLocalHost ? 'http' : 'https'}://${host}`;
}

async function postBreakGlass(
  origin: string,
  headersOverride: Record<string, string>,
  body: unknown
): Promise<{ status: number; body: Record<string, unknown> }> {
  const res = await fetch(
    `${origin}/1.0/identifiers/${ACTIVE_TEST_DID}/break-glass?_debugCacheBust=${randomUUID()}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...headersOverride },
      body: JSON.stringify(body),
      cache: 'no-store',
    }
  );
  const responseBody = await res.json();
  return { status: res.status, body: responseBody };
}

/** Expired ProviderJWT (exp in the past) -> expect 401 unauthorized. */
async function testExpiredJWT(origin: string): Promise<TestResult> {
  const now = Math.floor(Date.now() / 1000);
  const requestId = randomUUID();
  const bodyWithoutSignature = {
    providerCertificate: {
      providerId: TEST_CLINICIAN_DID,
      providerName: 'Dr. Test Clinician',
      licenseNumber: 'GH-MED-TEST-0001',
      issuingAuthority: 'Ghana Medical and Dental Council',
      facilityId: TEST_FACILITY_DID,
      signature: 'test-cert-signature',
    },
    clinicalJustification: {
      reasonCode: 'cardiac_arrest',
      freeText: 'Debug test — expired JWT scenario.',
      assertedAt: new Date().toISOString(),
    },
    requestedScope: ['blood_type'],
  };
  const requestSignature = signTestBGRequestSignature(bodyWithoutSignature);
  const jwt = await signTestProviderJWT({
    clinicianDid: TEST_CLINICIAN_DID,
    facilityDid: TEST_FACILITY_DID,
    requestId,
    reasonCode: 'cardiac_arrest',
    license: 'GH-MED-TEST-0001',
    iat: now - 600,
    exp: now - 480, // expired 8 minutes ago
  });
  if (!jwt || !requestSignature) {
    return { outcome: 'FAIL', detail: 'HUUID_TEST_FACILITY_JWK not set' };
  }
  const { status, body } = await postBreakGlass(
    origin,
    {
      Authorization: `Bearer ${jwt}`,
      'X-HUUID-Facility': TEST_FACILITY_DID,
      'X-HUUID-Request-ID': requestId,
      'X-HUUID-BG-Reason': 'cardiac_arrest',
    },
    { ...bodyWithoutSignature, requestSignature }
  );
  const pass = status === 401;
  return { outcome: pass ? 'PASS' : 'FAIL', detail: `status=${status} error=${body.error} message="${body.errorMessage}"` };
}

/** Tampered body after signing -> expect 401 invalidSignature. */
async function testInvalidSignature(origin: string): Promise<TestResult> {
  const now = Math.floor(Date.now() / 1000);
  const requestId = randomUUID();
  const bodyWithoutSignature = {
    providerCertificate: {
      providerId: TEST_CLINICIAN_DID,
      providerName: 'Dr. Test Clinician',
      licenseNumber: 'GH-MED-TEST-0001',
      issuingAuthority: 'Ghana Medical and Dental Council',
      facilityId: TEST_FACILITY_DID,
      signature: 'test-cert-signature',
    },
    clinicalJustification: {
      reasonCode: 'cardiac_arrest',
      freeText: 'Debug test — invalid signature scenario.',
      assertedAt: new Date().toISOString(),
    },
    requestedScope: ['blood_type'],
  };
  const requestSignature = signTestBGRequestSignature(bodyWithoutSignature);
  const jwt = await signTestProviderJWT({
    clinicianDid: TEST_CLINICIAN_DID,
    facilityDid: TEST_FACILITY_DID,
    requestId,
    reasonCode: 'cardiac_arrest',
    license: 'GH-MED-TEST-0001',
    iat: now,
    exp: now + 60,
  });
  if (!jwt || !requestSignature) {
    return { outcome: 'FAIL', detail: 'HUUID_TEST_FACILITY_JWK not set' };
  }
  // Tamper with one field AFTER signing — the signature no longer matches.
  const tamperedBody = {
    ...bodyWithoutSignature,
    clinicalJustification: {
      ...bodyWithoutSignature.clinicalJustification,
      freeText: 'TAMPERED — this text was changed after signing.',
    },
    requestSignature,
  };
  const { status, body } = await postBreakGlass(
    origin,
    {
      Authorization: `Bearer ${jwt}`,
      'X-HUUID-Facility': TEST_FACILITY_DID,
      'X-HUUID-Request-ID': requestId,
      'X-HUUID-BG-Reason': 'cardiac_arrest',
    },
    tamperedBody
  );
  const pass = status === 401 && body.error === 'invalidSignature';
  return { outcome: pass ? 'PASS' : 'FAIL', detail: `status=${status} error=${body.error} message="${body.errorMessage}"` };
}

/** Forbidden scope (mental_health) -> expect 403 scopeNotPermitted. */
async function testForbiddenScope(origin: string): Promise<TestResult> {
  const now = Math.floor(Date.now() / 1000);
  const requestId = randomUUID();
  const bodyWithoutSignature = {
    providerCertificate: {
      providerId: TEST_CLINICIAN_DID,
      providerName: 'Dr. Test Clinician',
      licenseNumber: 'GH-MED-TEST-0001',
      issuingAuthority: 'Ghana Medical and Dental Council',
      facilityId: TEST_FACILITY_DID,
      signature: 'test-cert-signature',
    },
    clinicalJustification: {
      reasonCode: 'unconscious',
      freeText: 'Debug test — forbidden scope scenario.',
      assertedAt: new Date().toISOString(),
    },
    requestedScope: ['blood_type', 'mental_health'],
  };
  const requestSignature = signTestBGRequestSignature(bodyWithoutSignature);
  const jwt = await signTestProviderJWT({
    clinicianDid: TEST_CLINICIAN_DID,
    facilityDid: TEST_FACILITY_DID,
    requestId,
    reasonCode: 'unconscious',
    license: 'GH-MED-TEST-0001',
    iat: now,
    exp: now + 60,
  });
  if (!jwt || !requestSignature) {
    return { outcome: 'FAIL', detail: 'HUUID_TEST_FACILITY_JWK not set' };
  }
  const { status, body } = await postBreakGlass(
    origin,
    {
      Authorization: `Bearer ${jwt}`,
      'X-HUUID-Facility': TEST_FACILITY_DID,
      'X-HUUID-Request-ID': requestId,
      'X-HUUID-BG-Reason': 'unconscious',
    },
    { ...bodyWithoutSignature, requestSignature }
  );
  const pass = status === 403 && body.error === 'scopeNotPermitted';
  return { outcome: pass ? 'PASS' : 'FAIL', detail: `status=${status} error=${body.error} message="${body.errorMessage}"` };
}

export default async function DebugBreakGlassPage({
  searchParams,
}: {
  searchParams: { result?: string };
}) {
  const supabase = getServiceClient();
  const host = headers().get('host') ?? 'localhost:3000';
  const origin = currentOrigin(host);

  const [expiredResult, sigResult, scopeResult] = await Promise.all([
    testExpiredJWT(origin),
    testInvalidSignature(origin),
    testForbiddenScope(origin),
  ]);

  const windowStart = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();

  const [bgAuditLog, bgRateLimit, bgNotifications, suspensions, rateLimitCount] = await Promise.all([
    supabase.from('huuid_bg_audit_log').select('*').order('created_at', { ascending: false }).limit(10),
    supabase.from('huuid_bg_rate_limit').select('*').order('triggered_at', { ascending: false }).limit(10),
    supabase.from('huuid_bg_notifications').select('*').order('queued_at', { ascending: false }).limit(10),
    supabase
      .from('huuid_facility_suspensions')
      .select('*')
      .eq('facility_did', TEST_FACILITY_DID)
      .eq('active', true)
      .order('suspended_at', { ascending: false }),
    supabase
      .from('huuid_bg_rate_limit')
      .select('id', { count: 'exact', head: true })
      .eq('facility_did', TEST_FACILITY_DID)
      .gte('triggered_at', windowStart),
  ]);

  let formResult: unknown = null;
  if (searchParams.result) {
    try {
      formResult = JSON.parse(Buffer.from(searchParams.result, 'base64url').toString());
    } catch {
      formResult = { error: 'Could not decode result.' };
    }
  }

  return (
    <main>
      <h1>/debug/break-glass</h1>
      <p>resolver_version: {RESOLVER_VERSION}</p>
      <p>
        Endpoint: <code>POST /1.0/identifiers/{'{did}'}/break-glass</code> — the
        only POST endpoint in HUUID. Track B of three equal consent tracks
        (Track A: Physical-Present-Consent · Track B: Break-Glass · Track C:
        Guardian Proxy). Root Authority: HUUID Protocol Working Group ·
        josephtdnarnor@gmail.com.
      </p>

      <h2>Trigger a real Break-Glass request (valid, consumes a rate-limit slot)</h2>
      <form action={triggerTestBreakGlass}>
        <button type="submit">POST a valid test Break-Glass request</button>
      </form>
      {formResult ? (
        <pre>{JSON.stringify(formResult, null, 2)}</pre>
      ) : (
        <p>No request triggered yet this page load.</p>
      )}

      <h2>Auto-run scenarios (do not consume a rate-limit slot)</h2>
      <p>
        Note: if the rate-limit counter below reads 10/10, ALL three
        scenarios here will show 429 rateLimitExceeded instead of their
        intended status — the rate-limit gate (Step 3) runs before signature
        (Step 4) and scope (Step 5) checks, so an exhausted facility is
        rejected before those checks are ever reached. That is correct
        behavior, not a bug.
      </p>
      <pre>
        {[
          { name: 'Expired ProviderJWT (exp - iat window in the past)', expected: 'PASS' as const, result: expiredResult },
          { name: 'Tampered body / invalid requestSignature', expected: 'PASS' as const, result: sigResult },
          { name: 'Forbidden scope (mental_health)', expected: 'PASS' as const, result: scopeResult },
        ]
          .map((tc) => {
            const status = tc.result.outcome === 'PASS' ? 'OK' : 'MISMATCH';
            return `[${status}] ${tc.name}\n        ${tc.result.detail}`;
          })
          .join('\n\n')}
      </pre>

      <h2>Facility suspension status ({TEST_FACILITY_DID})</h2>
      {suspensions.error ? (
        <pre>ERROR: {suspensions.error.message}</pre>
      ) : (
        <pre>{JSON.stringify(suspensions.data, null, 2)}</pre>
      )}

      <h2>
        Rate limit counter (last 24h, {TEST_FACILITY_DID}):{' '}
        {rateLimitCount.count ?? 'unknown'} / 10
      </h2>
      <p>
        The 10-request-then-suspend-then-11th-returns-429 sequence (DoD 8/9)
        is destructive and stateful — it is verified via a dedicated
        one-time script, not run automatically by this page. This counter
        and the suspension status above show the resulting state after that
        script runs.
      </p>

      <h2>huuid_bg_audit_log (last 10)</h2>
      {bgAuditLog.error ? (
        <pre>ERROR: {bgAuditLog.error.message}</pre>
      ) : (
        <pre>{JSON.stringify(bgAuditLog.data, null, 2)}</pre>
      )}

      <h2>huuid_bg_rate_limit (last 10)</h2>
      {bgRateLimit.error ? (
        <pre>ERROR: {bgRateLimit.error.message}</pre>
      ) : (
        <pre>{JSON.stringify(bgRateLimit.data, null, 2)}</pre>
      )}

      <h2>huuid_bg_notifications (last 10)</h2>
      {bgNotifications.error ? (
        <pre>ERROR: {bgNotifications.error.message}</pre>
      ) : (
        <pre>{JSON.stringify(bgNotifications.data, null, 2)}</pre>
      )}
    </main>
  );
}
