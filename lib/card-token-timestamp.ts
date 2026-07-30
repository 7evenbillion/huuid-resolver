import 'server-only';
import type { SupabaseClient } from '@supabase/supabase-js';

/**
 * Stamps huuid_patients.card_token_generated_at (migration 019) with the
 * current time and returns it alongside medical_profile_updated_at, so
 * callers can hand both timestamps back to the client for the staleness
 * check on /enroll/card. A plain UPDATE, not an RPC — the column is a bare
 * timestamp with no encryption or business logic, unlike every other
 * huuid_patients write in this codebase.
 *
 * Called by every code path that generates a fresh QR token
 * (/api/enroll/register, /api/enroll/medical, /api/patient/medical) so the
 * staleness comparison is meaningful from first enrollment onward, not
 * only after a future return-visit edit.
 */
export async function markCardTokenGenerated(
  client: SupabaseClient,
  huuid: string
): Promise<{ cardTokenGeneratedAt: string | null; medicalProfileUpdatedAt: string | null }> {
  const { data, error } = await client
    .from('huuid_patients')
    .update({ card_token_generated_at: new Date().toISOString() })
    .eq('huuid', huuid)
    .select('card_token_generated_at, medical_profile_updated_at')
    .single();

  if (error || !data) {
    console.error(
      JSON.stringify({ level: 'error', action: 'card_token_timestamp_update_failed', message: error?.message ?? 'no row returned' })
    );
    return { cardTokenGeneratedAt: null, medicalProfileUpdatedAt: null };
  }

  return {
    cardTokenGeneratedAt: data.card_token_generated_at as string | null,
    medicalProfileUpdatedAt: data.medical_profile_updated_at as string | null,
  };
}
