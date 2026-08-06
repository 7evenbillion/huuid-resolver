import { NextResponse } from 'next/server';
import { getServiceClient } from '@/lib/supabase-server';
import { patientSession } from '@/lib/patient-session';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

interface StandardEntry {
  kind: 'standard';
  timestamp: string;
  facilityDid: string;
  facilityName: string;
  purposeCode: string;
  outcome: string;
}

interface BreakGlassEntry {
  kind: 'break_glass';
  timestamp: string;
  facilityDid: string;
  facilityName: string;
  clinicianLicense: string;
  reasonCode: string;
}

type HistoryEntry = StandardEntry | BreakGlassEntry;

/** GET /api/my-huuid/history — my-huuid Layer 6. Merges huuid_audit_log
 * (standard resolution) and huuid_bg_audit_log (Break-Glass), both keyed
 * on requesting_facility/facility_did which store the facility's DID, not
 * its name -- huuid_facilities is joined in application code (a plain
 * batched IN-query, not a DB-level JOIN) to resolve human-readable names,
 * matching how huuid_audit_log/huuid_bg_audit_log store facility identity
 * everywhere else in this codebase. huuid_bg_audit_log has no "clinician
 * role" column (the brief's own wording) -- the closest real field is
 * clinician_license, used here instead of inventing one. Sorted by
 * resolved_at/created_at (that table's real column names -- the brief
 * says "triggered_at", which doesn't exist on either table). */
export async function GET() {
  const session = await patientSession.get();
  if (!session || !session.phoneVerified || !session.huuid) {
    return NextResponse.json({ error: 'Not authenticated.' }, { status: 401 });
  }

  const client = getServiceClient();

  const [{ data: standardRows, error: standardError }, { data: bgRows, error: bgError }] = await Promise.all([
    client
      .from('huuid_audit_log')
      .select('requesting_facility, purpose_code, outcome, resolved_at')
      .eq('huuid', session.huuid)
      .order('resolved_at', { ascending: false })
      .limit(50),
    client
      .from('huuid_bg_audit_log')
      .select('facility_did, clinician_license, reason_code, created_at')
      .eq('huuid', session.huuid)
      .order('created_at', { ascending: false })
      .limit(50),
  ]);

  if (standardError || bgError) {
    console.error(
      JSON.stringify({
        level: 'error',
        action: 'my_huuid_history_query_failed',
        message: standardError?.message ?? bgError?.message,
      })
    );
    return NextResponse.json({ error: 'Could not load your access history.' }, { status: 500 });
  }

  const facilityDids = new Set<string>();
  for (const r of standardRows ?? []) facilityDids.add(r.requesting_facility as string);
  for (const r of bgRows ?? []) facilityDids.add(r.facility_did as string);

  const facilityNames = new Map<string, string>();
  if (facilityDids.size > 0) {
    const { data: facilityRows } = await client
      .from('huuid_facilities')
      .select('facility_did, facility_name')
      .in('facility_did', Array.from(facilityDids));
    for (const f of facilityRows ?? []) {
      facilityNames.set(f.facility_did as string, f.facility_name as string);
    }
  }

  const standardEntries: StandardEntry[] = (standardRows ?? []).map((r) => ({
    kind: 'standard',
    timestamp: r.resolved_at as string,
    facilityDid: r.requesting_facility as string,
    facilityName: facilityNames.get(r.requesting_facility as string) ?? (r.requesting_facility as string),
    purposeCode: r.purpose_code as string,
    outcome: r.outcome as string,
  }));

  const bgEntries: BreakGlassEntry[] = (bgRows ?? []).map((r) => ({
    kind: 'break_glass',
    timestamp: r.created_at as string,
    facilityDid: r.facility_did as string,
    facilityName: facilityNames.get(r.facility_did as string) ?? (r.facility_did as string),
    clinicianLicense: r.clinician_license as string,
    reasonCode: r.reason_code as string,
  }));

  const merged: HistoryEntry[] = [...standardEntries, ...bgEntries]
    .sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime())
    .slice(0, 50);

  return NextResponse.json({ entries: merged });
}
