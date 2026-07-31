import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { adminSession } from '@/lib/admin-session';
import { getServiceClient } from '@/lib/supabase-server';
import { sendSMS, SMSDeliveryError } from '@/lib/sms';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const rejectSchema = z.object({ reason: z.string().trim().min(1).max(1000) });

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const session = await adminSession.get();
  if (!session) {
    return NextResponse.json({ error: 'Not authenticated.' }, { status: 401 });
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid request body.' }, { status: 400 });
  }
  const parsed = rejectSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: 'A rejection reason is required.' }, { status: 400 });
  }

  const client = getServiceClient();
  const { data: app, error: fetchError } = await client
    .from('huuid_facility_applications')
    .select('*')
    .eq('application_id', params.id)
    .single();

  if (fetchError || !app) {
    return NextResponse.json({ error: 'Application not found.' }, { status: 404 });
  }
  if (app.status !== 'pending') {
    return NextResponse.json({ error: `Application is already ${app.status}.` }, { status: 409 });
  }

  const { error: updateError } = await client
    .from('huuid_facility_applications')
    .update({ status: 'rejected', rejection_reason: parsed.data.reason, updated_at: new Date().toISOString() })
    .eq('application_id', params.id);
  if (updateError) {
    console.error(JSON.stringify({ level: 'error', action: 'admin_reject_update_failed', message: updateError.message }));
    return NextResponse.json({ error: 'Could not reject this application.' }, { status: 500 });
  }

  const rootAuthorityPhone = process.env.HUUID_ROOT_AUTHORITY_PHONE;
  try {
    await sendSMS(
      app.authorised_signatory_phone,
      `Your HUUID application for ${app.facility_name} was not approved.\nReason: ${parsed.data.reason}\nTo reapply or appeal contact:\n${rootAuthorityPhone ?? 'the HUUID Root Authority'}\nHUUID`
    );
  } catch (err) {
    const reason = err instanceof SMSDeliveryError ? `${err.hubtelReason} / ${err.africasTalkingReason}` : 'unknown';
    console.error(JSON.stringify({ level: 'warn', action: 'admin_reject_sms_failed', message: reason }));
  }

  return NextResponse.json({ ok: true });
}
