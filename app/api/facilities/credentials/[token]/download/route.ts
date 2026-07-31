import { NextRequest, NextResponse } from 'next/server';
import { getServiceClient } from '@/lib/supabase-server';
import { getPiiKey } from '@/lib/pii';
import { requesterIpHash } from '@/lib/enrollment-rate-limit';
import { buildZip } from '@/lib/zip';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const RESOLVER_BASE_URL = process.env.NEXT_PUBLIC_APP_URL || 'https://huuid-resolver.vercel.app';

export async function POST(req: NextRequest, { params }: { params: { token: string } }) {
  const ipHash = requesterIpHash(req);
  const client = getServiceClient();

  const { data, error } = await client.rpc('huuid_consume_credential_delivery', {
    p_download_token: params.token,
    p_pii_key: getPiiKey(),
    p_download_ip_hash: ipHash,
  });
  if (error) {
    console.error(JSON.stringify({ level: 'error', action: 'credential_download_consume_failed', message: error.message }));
    return NextResponse.json({ error: 'Could not prepare your credentials.' }, { status: 500 });
  }

  const row = Array.isArray(data) ? data[0] : data;
  if (!row) {
    return NextResponse.json(
      { error: 'This link is invalid, expired, already used, or the code has not been verified yet.' },
      { status: 410 }
    );
  }

  const { data: facility } = await client
    .from('huuid_facilities')
    .select('facility_name')
    .eq('facility_did', row.facility_did)
    .single();

  const facilityName = facility?.facility_name ?? row.facility_did;

  const configEnv = `# HUUID EMR Stub -- configuration
# Generated at credential issuance for ${facilityName}.
# Copy this file to .env in your huuid-emr-stub installation directory.

HUUID_FACILITY_DID=${row.facility_did}
HUUID_RESOLVER_BASE_URL=${RESOLVER_BASE_URL}
HUUID_RESOLVER_TIMEOUT_MS=3000

STUB_PORT=3741
STUB_HOST=localhost

HUUID_LOCAL_AUTH_SECRET_PATH=./local-auth/emr-secret.key
HUUID_FACILITY_PRIVATE_KEY_PATH=./keys/facility-private-key.pem
HUUID_RESOLVER_PUBLIC_KEY_PATH=./keys/resolver-public-key.json
HUUID_CACHE_DB_PATH=./data/huuid-cache.db
HUUID_INTEGRITY_OVERRIDE=0
`;

  const readme = `HUUID Facility Credentials -- ${facilityName}
================================================

Facility ID (DID): ${row.facility_did}

Files in this package:
  facility-did.txt              Your facility's HUUID identifier (plain text)
  public-key.pem                Your facility's public key (safe to share)
  private-key.pem               Your facility's PRIVATE key -- KEEP THIS SECRET
  config.env                    Pre-filled configuration for the HUUID EMR Stub
  HUUID-Installation-Guide.txt  Installation instructions

Keep private-key.pem secure. Anyone who has it can act as your facility
on the HUUID network. Never share it, never commit it to version
control, never send it by email or chat.

For support, contact the HUUID Root Authority.
`;

  const installGuide = `HUUID EMR Stub -- Installation Guide
=====================================

1. Install Node.js 18 or later if you do not already have it.
2. Download and extract the huuid-emr-stub software.
3. Copy private-key.pem into the stub's keys/ folder as
   keys/facility-private-key.pem
4. Copy config.env into the stub's root folder as .env
5. Run: npm install
6. Run: npm run generate-local-secret
7. Run: npm run download-keys
8. Run: npm run start

Your facility ID: ${row.facility_did}

If you need help, contact the HUUID Root Authority.
`;

  const zip = buildZip([
    { name: 'facility-did.txt', content: row.facility_did },
    { name: 'public-key.pem', content: row.public_key_pem ?? '' },
    { name: 'private-key.pem', content: row.private_key_pem ?? '' },
    { name: 'config.env', content: configEnv },
    { name: 'HUUID-Installation-Guide.txt', content: installGuide },
    { name: 'README.txt', content: readme },
  ]);

  return new NextResponse(new Uint8Array(zip), {
    status: 200,
    headers: {
      'Content-Type': 'application/zip',
      'Content-Disposition': 'attachment; filename="huuid-facility-credentials.zip"',
      'Cache-Control': 'no-store',
    },
  });
}
