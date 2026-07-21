import { NextRequest, NextResponse } from 'next/server';
import { getServiceClient, RESOLVER_VERSION } from '@/lib/supabase-server';
import { verifyFacilityJWT } from '@/lib/facility-jwt';
import { ROOT_AUTHORITY_FACILITY_DID } from '@/lib/root-authority';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

async function countRows(table: string): Promise<number | null> {
  try {
    const { count, error } = await getServiceClient()
      .from(table)
      .select('id', { count: 'exact', head: true });
    if (error) return null;
    return count ?? 0;
  } catch {
    return null;
  }
}

const PURPOSE_CODES_FOR_USAGE = ['Treatment', 'Administrative', 'Emergency', 'Research'] as const;

/**
 * System-wide, cross-facility request counts per purposeCode for the
 * trailing 60-minute window (Month 6) -- the same window
 * increment_resolution_rate_limit (migration 011) uses to enforce
 * Treatment/Administrative's independent 50/hour ceilings. Research is
 * included and will always read 0: it is rejected before ever reaching the
 * counter (see route.ts Step 4), so a non-zero count here would itself be
 * a bug worth noticing, not just a number to report.
 *
 * Only ever computed when the caller is verified as the Root Authority --
 * see checkRootAuthority() below. Never computed for an ordinary/anonymous
 * request, so an unauthenticated health check pays no extra query cost.
 */
async function perPurposeCodeUsage(): Promise<Record<string, number | null>> {
  const windowStart = new Date(Date.now() - 60 * 60 * 1000).toISOString();
  const entries = await Promise.all(
    PURPOSE_CODES_FOR_USAGE.map(async (purpose) => {
      try {
        const { count, error } = await getServiceClient()
          .from('huuid_request_log')
          .select('id', { count: 'exact', head: true })
          .eq('purpose_code', purpose)
          .gte('logged_at', windowStart);
        return [purpose, error ? null : (count ?? 0)] as const;
      } catch {
        return [purpose, null] as const;
      }
    })
  );
  return Object.fromEntries(entries);
}

/**
 * Verifies an OPTIONAL Authorization header as the Root Authority's own
 * facility JWT (same verifyFacilityJWT() path every facility JWT goes
 * through -- no special signature handling). Returns false for a missing
 * header, an invalid JWT, or a JWT from any other (even validly registered)
 * facility -- the base health response is unauthenticated by design
 * (monitoring should never require a credential), so failing this check is
 * never itself an error, just "no elevated data this time."
 */
async function checkRootAuthority(req: NextRequest): Promise<boolean> {
  const authHeader = req.headers.get('authorization');
  if (!authHeader) return false;
  try {
    const { data: facilityRow, error } = await getServiceClient()
      .from('huuid_facilities')
      .select('public_key_multibase')
      .eq('facility_did', ROOT_AUTHORITY_FACILITY_DID)
      .maybeSingle();
    if (error || !facilityRow) return false;
    const jwtResult = await verifyFacilityJWT(authHeader, facilityRow.public_key_multibase);
    return jwtResult.ok && jwtResult.claims.sub === ROOT_AUTHORITY_FACILITY_DID;
  } catch {
    return false;
  }
}

/**
 * GET /api/health — unauthenticated for the base response (200 healthy,
 * 503 when the database is down), matching every other health endpoint in
 * this ecosystem. An OPTIONAL Authorization: Bearer {Root Authority JWT}
 * unlocks perPurposeCodeUsage (Month 6) in the same response -- the base
 * shape and status code are identical either way; the elevated data is
 * additive, never a reason to change what an ordinary caller sees.
 */
export async function GET(req: NextRequest) {
  let database = 'connected';
  try {
    const { error } = await getServiceClient()
      .from('huuid_did_documents')
      .select('id', { count: 'exact', head: true });
    if (error) database = 'error';
  } catch {
    database = 'error';
  }

  const healthy = database === 'connected';

  const [bgAuditLogCount, bgRateLimitCount, activeFacilitySuspensionCount, isRootAuthority] = await Promise.all([
    countRows('huuid_bg_audit_log'),
    countRows('huuid_bg_rate_limit'),
    (async () => {
      try {
        const { count, error } = await getServiceClient()
          .from('huuid_facility_suspensions')
          .select('id', { count: 'exact', head: true })
          .eq('active', true);
        if (error) return null;
        return count ?? 0;
      } catch {
        return null;
      }
    })(),
    checkRootAuthority(req),
  ]);

  const perPurposeCode = isRootAuthority ? await perPurposeCodeUsage() : undefined;

  return NextResponse.json(
    {
      status: healthy ? 'ok' : 'degraded',
      timestamp: new Date().toISOString(),
      version: RESOLVER_VERSION,
      database,
      services: { supabase: healthy ? 'ok' : 'error' },
      breakGlass: {
        bg_audit_log: bgAuditLogCount,
        bg_rate_limit: bgRateLimitCount,
        facility_suspensions_active: activeFacilitySuspensionCount,
      },
      // Present only when the caller authenticated as the Root Authority's
      // own facility JWT (Month 6) -- absent, not null/empty, for every
      // other caller, so its mere presence is itself a signal, not just
      // its contents.
      ...(perPurposeCode ? { perPurposeCode } : {}),
    },
    {
      status: healthy ? 200 : 503,
      headers: { 'Cache-Control': 'no-store' },
    }
  );
}
