import 'server-only';
import { createClient, SupabaseClient } from '@supabase/supabase-js';

/**
 * Service-role Supabase client. Server-side ONLY (Rule 7: service role
 * never reaches the client bundle — enforced by the 'server-only' import).
 * Both tables are locked to service_role; anon has zero access.
 */
let client: SupabaseClient | null = null;

export function getServiceClient(): SupabaseClient {
  if (client) return client;

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url || !serviceRoleKey) {
    throw new Error(
      'Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY'
    );
  }

  client = createClient(url, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  return client;
}

export const RESOLVER_VERSION = process.env.HUUID_RESOLVER_VERSION ?? '1.0.0';
