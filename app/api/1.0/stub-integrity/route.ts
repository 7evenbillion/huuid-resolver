import { NextRequest, NextResponse } from 'next/server';
import { createHash } from 'node:crypto';
import { getServiceClient } from '@/lib/supabase-server';
import { verifyStubIntegritySignature } from '@/lib/stub-integrity-signature';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/**
 * POST /1.0/stub-integrity — receives process-integrity alerts from EMR
 * Stub installations (HUUID-EMR-STUB-v0.1.2 Section 2 P4). A Stub POSTs
 * here when its local HMAC manifest of src/scripts no longer matches its
 * signed baseline.
 *
 * Signature verification (closing the gap the first version of this route
 * deliberately left open): the payload's `signature` is verified against
 * `huuid_facilities.public_key_multibase` for the claimed `facilityDID`
 * before anything is written. Unknown facility -> 403, not logged. Invalid
 * signature -> 401, not logged. Only a verified alert reaches the table,
 * with `signature_verified: true` recorded alongside it -- this endpoint
 * is no longer a channel where anyone who can reach it can write a row
 * that reads as if it came from any facility_did they choose to claim.
 *
 * Malformed bodies (missing/non-string fields) are treated as an unverified
 * request and rejected the same way a bad signature would be -- there is
 * no legitimate signed alert that would also have a missing manifestHash
 * or signature, so this doesn't cost real alerts anything.
 */
export async function POST(req: NextRequest) {
  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    body = {};
  }

  const facilityDid = typeof body.facilityDID === 'string' ? body.facilityDID : null;
  const manifestHash = typeof body.manifestHash === 'string' ? body.manifestHash : null;
  const stubVersion = typeof body.stubVersion === 'string' ? body.stubVersion : 'unknown';
  const signature = typeof body.signature === 'string' ? body.signature : null;
  const violation = body.violation === true;
  const override = body.override === true;

  const forwarded = req.headers.get('x-forwarded-for');
  const ip = forwarded?.split(',')[0]?.trim() || 'unknown';
  const ipHash = createHash('sha256').update(ip).digest('hex');

  if (!facilityDid) {
    return NextResponse.json({ received: false, error: 'facilityDID missing or invalid' }, { status: 403 });
  }

  // ── Step 1/2: look up the facility's public key ──
  let publicKeyMultibase: string | null = null;
  try {
    const { data, error } = await getServiceClient()
      .from('huuid_facilities')
      .select('public_key_multibase')
      .eq('facility_did', facilityDid)
      .maybeSingle();
    if (error) throw new Error(error.message);
    publicKeyMultibase = data?.public_key_multibase ?? null;
  } catch (err) {
    console.error(
      JSON.stringify({
        level: 'error',
        action: 'stub_integrity_facility_lookup_failed',
        resource: 'huuid_facilities',
        message: err instanceof Error ? err.message : 'unknown',
        timestamp: new Date().toISOString(),
      })
    );
    // A lookup failure is not proof the facility doesn't exist -- but this
    // endpoint has no retry/queue semantics of its own, and the Stub side
    // already retries on its next scheduled check if this alert is lost.
    return NextResponse.json({ received: false, error: 'facility lookup failed' }, { status: 403 });
  }

  if (!publicKeyMultibase) {
    return NextResponse.json({ received: false, error: 'unknown facility' }, { status: 403 });
  }

  // ── Step 3: verify the signature ──
  if (!manifestHash || !signature) {
    return NextResponse.json({ received: false, error: 'manifestHash or signature missing' }, { status: 401 });
  }

  const verification = verifyStubIntegritySignature(manifestHash, signature, publicKeyMultibase);
  if (!verification.ok) {
    return NextResponse.json({ received: false, error: verification.reason }, { status: 401 });
  }

  // ── Step 6: valid -- log and return 200 ──
  try {
    const { error } = await getServiceClient().from('huuid_stub_integrity_log').insert({
      facility_did: facilityDid,
      manifest_hash: manifestHash,
      stub_version: stubVersion,
      violation,
      override,
      signature_verified: true,
      ip_hash: ipHash,
    });
    if (error) {
      console.error(
        JSON.stringify({
          level: 'error',
          action: 'stub_integrity_log_insert_failed',
          resource: 'huuid_stub_integrity_log',
          message: error.message,
          timestamp: new Date().toISOString(),
        })
      );
    }
  } catch (err) {
    console.error(
      JSON.stringify({
        level: 'error',
        action: 'stub_integrity_log_insert_threw',
        resource: 'huuid_stub_integrity_log',
        message: err instanceof Error ? err.message : 'unknown',
        timestamp: new Date().toISOString(),
      })
    );
  }

  // Always 200 on a verified alert -- this is a best-effort alert
  // receiver, not a resolution path. A Stub that cannot reach this
  // endpoint already logs locally and retries on its next check (see
  // integrity-check.ts); an insert failure here must not compound that by
  // also returning an error the Stub would need special handling for.
  return NextResponse.json({ received: true });
}
