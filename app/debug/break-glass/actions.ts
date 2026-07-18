'use server';

import { randomUUID } from 'node:crypto';
import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { signTestProviderJWT, signTestBGRequestSignature } from '@/lib/test-provider-jwt';
import { TEST_FACILITY_DID, TEST_CLINICIAN_DID, ACTIVE_TEST_DID } from './constants';

function currentOrigin(host: string): string {
  const isLocalHost = /^(localhost|127\.0\.0\.1)(:\d+)?$/.test(host);
  return `${isLocalHost ? 'http' : 'https'}://${host}`;
}

/**
 * Server Action backing the debug page's "trigger a real Break-Glass
 * request" form. Runs a full, valid request — this DOES consume one slot
 * of the facility's 10/24h rate-limit ceiling, unlike the auto-run
 * scenarios below, which are all designed to fail before Step 6's
 * rate-limit record insert. That's why this is an explicit form action
 * rather than something that runs automatically on every page load.
 */
export async function triggerTestBreakGlass() {
  const host = headers().get('host') ?? 'localhost:3000';
  const origin = currentOrigin(host);
  const now = Math.floor(Date.now() / 1000);
  const requestId = randomUUID();

  const bodyWithoutSignature = {
    providerCertificate: {
      providerId: TEST_CLINICIAN_DID,
      providerName: 'Dr. Test Clinician',
      licenseNumber: 'GH-MED-TEST-0001',
      issuingAuthority: 'Ghana Medical and Dental Council',
      facilityId: TEST_FACILITY_DID,
      signature: 'test-cert-signature-not-separately-verified-month3',
    },
    clinicalJustification: {
      reasonCode: 'cardiac_arrest',
      freeText: 'Debug page test trigger — patient arrived unresponsive, no pulse.',
      assertedAt: new Date().toISOString(),
    },
    requestedScope: ['blood_type', 'allergies'],
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

  let result: Record<string, unknown>;
  if (!jwt || !requestSignature) {
    result = { error: 'HUUID_TEST_FACILITY_JWK not set — cannot sign test request' };
  } else {
    const res = await fetch(
      `${origin}/1.0/identifiers/${ACTIVE_TEST_DID}/break-glass?_debugCacheBust=${randomUUID()}`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${jwt}`,
          'X-HUUID-Facility': TEST_FACILITY_DID,
          'X-HUUID-Request-ID': requestId,
          'X-HUUID-BG-Reason': 'cardiac_arrest',
        },
        body: JSON.stringify({ ...bodyWithoutSignature, requestSignature }),
        cache: 'no-store',
      }
    );
    const responseBody = await res.json();
    result = { status: res.status, body: responseBody };
  }

  const encoded = Buffer.from(JSON.stringify(result)).toString('base64url');
  redirect(`/debug/break-glass?result=${encoded}`);
}
