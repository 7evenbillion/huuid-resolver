import { NextResponse } from 'next/server';
import { patientSession } from '@/lib/patient-session';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function POST() {
  await patientSession.clear();
  return NextResponse.json({ ok: true });
}
