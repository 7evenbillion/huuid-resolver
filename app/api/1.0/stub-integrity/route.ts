import { NextRequest, NextResponse } from 'next/server';
import { createHash } from 'node:crypto';
import { getServiceClient } from '@/lib/supabase-server';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/**
 * POST /1.0/stub-integrity — receives process-integrity alerts from EMR
 * Stub installations (HUUID-EMR-STUB-v0.1.2 Section 2 P4). A Stub POSTs
 * here when its local HMAC manifest of src/scripts no longer matches its
 * signed baseline.
 *
 * Month 4 scope, deliberately minimal per this build step:
 * - Accepts the POST, logs it to huuid_stub_integrity_log, returns 200.
 * - No auth required on this endpoint -- the payload carries an EdDSA
 *   `signature` field, but this handler does NOT verify it against the
 *   reporting facility's public key (huuid_facilities.public_key_multibase)
 *   before writing the row. "No auth required because it's signed" is
 *   only true once something actually checks the signature; until then,
 *   anyone who can reach this endpoint can write an entry that reads as if
 *   it came from any facility_did they choose to claim. Flagged here and
 *   in the migration file rather than silently treating this as a trusted
 *   channel. Signature verification is a natural next step, not built
 *   this step ("one layer at a time").
 * - Malformed bodies are logged with best-effort field extraction rather
 *   than rejected with 400 -- an integrity-violation alert is exactly the
 *   kind of signal that should never be silently dropped for being
 *   slightly malformed, and this table is a diagnostic log, not the audit
 *   trail that GET /1.0/identifiers/{did} writes to.
 */
export async function POST(req: NextRequest) {
  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    body = {};
  }

  const facilityDid = typeof body.facilityDID === 'string' ? body.facilityDID : 'unknown';
  const manifestHash = typeof body.manifestHash === 'string' ? body.manifestHash : 'unknown';
  const stubVersion = typeof body.stubVersion === 'string' ? body.stubVersion : 'unknown';
  const violation = body.violation === true;

  const forwarded = req.headers.get('x-forwarded-for');
  const ip = forwarded?.split(',')[0]?.trim() || 'unknown';
  const ipHash = createHash('sha256').update(ip).digest('hex');

  try {
    const { error } = await getServiceClient().from('huuid_stub_integrity_log').insert({
      facility_did: facilityDid,
      manifest_hash: manifestHash,
      stub_version: stubVersion,
      violation,
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

  // Always 200 -- this is a best-effort alert receiver, not a
  // resolution path. A Stub that cannot reach this endpoint already logs
  // locally and retries on its next check (see integrity-check.ts); this
  // handler failing to persist a row must not compound that by also
  // returning an error the Stub would need special handling for.
  return NextResponse.json({ received: true });
}
