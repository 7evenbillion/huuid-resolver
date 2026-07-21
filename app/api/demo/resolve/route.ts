import { NextRequest, NextResponse } from 'next/server';
import { randomUUID } from 'node:crypto';
import { signTestFacilityJWT } from '@/lib/test-facility-jwt';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/**
 * POST /api/demo/resolve — powers the homepage's interactive resolver
 * terminal (ResolverTerminal.tsx). This is NOT a mock: it signs a real
 * facility JWT server-side (signTestFacilityJWT, already used by
 * /debug/resolver — private key never reaches the client) and calls this
 * deployment's own real GET /1.0/identifiers/{did}, the same endpoint any
 * external facility calls. The response — including didResolutionMetadata
 * .durationMs — is forwarded to the browser unmodified, so the terminal's
 * "Completed in Nms" is a real, current measurement, not a canned number.
 *
 * Demo facility (did:huuid:gh:node-test-001) is the seeded Month 2 test
 * facility already used throughout this build for connection tests —
 * requests made here are real Administrative-purpose resolutions and are
 * audited and rate-limited exactly like any other request.
 */
export async function POST(req: NextRequest) {
  let did: string;
  try {
    const body = await req.json();
    did = typeof body?.did === 'string' ? body.did.trim() : '';
  } catch {
    return NextResponse.json({ error: 'Invalid request body.' }, { status: 400 });
  }

  if (!did.startsWith('did:huuid:')) {
    return NextResponse.json(
      { error: 'Malformed HUUID. Expected format: did:huuid:{country}:{identifier}' },
      { status: 400 }
    );
  }

  const facilityDid = 'did:huuid:gh:node-test-001';
  const requestId = randomUUID();
  const now = Math.floor(Date.now() / 1000);

  const jwt = await signTestFacilityJWT({
    facilityDid,
    requestId,
    purposeCode: 'Administrative',
    iat: now,
    exp: now + 300,
  });

  if (!jwt) {
    return NextResponse.json(
      { error: 'Demo resolver unavailable — signing key not configured.' },
      { status: 503 }
    );
  }

  const origin = req.nextUrl.origin;
  const url = `${origin}/1.0/identifiers/${encodeURIComponent(did)}`;

  const res = await fetch(url, {
    method: 'GET',
    headers: {
      Authorization: `Bearer ${jwt}`,
      'X-HUUID-Purpose': 'Administrative',
      'X-HUUID-Facility': facilityDid,
      'X-HUUID-Request-ID': requestId,
    },
    cache: 'no-store',
  });

  const body = await res.json();
  return NextResponse.json(body, { status: res.status });
}
