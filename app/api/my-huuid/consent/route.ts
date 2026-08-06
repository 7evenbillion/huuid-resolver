import { NextResponse } from 'next/server';
import { getServiceClient } from '@/lib/supabase-server';
import { patientSession } from '@/lib/patient-session';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/** GET /api/my-huuid/consent — my-huuid Layer 7. Returns both tabs in one
 * call: pending (status='pending' AND not yet expired) and history (all
 * requests, newest first, capped at 100) -- huuid_consent_requests has no
 * PII columns (patient_phone_hash is a one-way hash, not reversible), so
 * this is a plain select, no RPC/decryption needed. */
export async function GET() {
  const session = await patientSession.get();
  if (!session || !session.phoneVerified || !session.huuid) {
    return NextResponse.json({ error: 'Not authenticated.' }, { status: 401 });
  }

  const client = getServiceClient();
  const nowIso = new Date().toISOString();

  const [{ data: pendingRows, error: pendingError }, { data: historyRows, error: historyError }] = await Promise.all([
    client
      .from('huuid_consent_requests')
      .select('consent_id, requesting_facility_name, holding_facility_names, record_types_requested, expires_at, created_at')
      .eq('huuid', session.huuid)
      .eq('status', 'pending')
      .gt('expires_at', nowIso)
      .order('created_at', { ascending: false }),
    client
      .from('huuid_consent_requests')
      .select('consent_id, requesting_facility_name, record_types_requested, status, expires_at, created_at')
      .eq('huuid', session.huuid)
      .order('created_at', { ascending: false })
      .limit(100),
  ]);

  if (pendingError || historyError) {
    console.error(
      JSON.stringify({
        level: 'error',
        action: 'my_huuid_consent_query_failed',
        message: pendingError?.message ?? historyError?.message,
      })
    );
    return NextResponse.json({ error: 'Could not load your consent requests.' }, { status: 500 });
  }

  return NextResponse.json({
    pending: (pendingRows ?? []).map((r) => ({
      consentId: r.consent_id,
      facilityName: r.requesting_facility_name,
      holdingFacilityNames: r.holding_facility_names,
      recordTypesRequested: r.record_types_requested,
      expiresAt: r.expires_at,
      createdAt: r.created_at,
    })),
    // Display-only: nothing transitions a 'pending' row to 'expired' in
    // the database (no cleanup job exists, same disclosed gap as
    // huuid_cleanup_expired_otps -- see HANDOFF.md). A pending row whose
    // expires_at has already passed is shown as Expired here without
    // writing anything, rather than leaving a stuck "Pending" badge on a
    // request the patient can no longer act on.
    history: (historyRows ?? []).map((r) => ({
      consentId: r.consent_id,
      facilityName: r.requesting_facility_name,
      recordTypesRequested: r.record_types_requested,
      status: r.status === 'pending' && new Date(r.expires_at) <= new Date() ? 'expired' : r.status,
      createdAt: r.created_at,
    })),
  });
}
