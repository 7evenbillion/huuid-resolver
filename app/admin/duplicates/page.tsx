import { redirect } from 'next/navigation';
import { adminSession } from '@/lib/admin-session';
import { getServiceClient } from '@/lib/supabase-server';
import { getPiiKey } from '@/lib/pii';
import DuplicatesReview, { type DuplicatePair } from '@/components/admin/DuplicatesReview';

export const dynamic = 'force-dynamic';

export default async function AdminDuplicatesPage() {
  const session = await adminSession.get();
  if (!session) redirect('/admin/login');

  const client = getServiceClient();
  const { data, error } = await client.rpc('huuid_list_potential_duplicates', { p_pii_key: getPiiKey() });
  if (error) {
    console.error(JSON.stringify({ level: 'error', action: 'admin_duplicates_list_failed', message: error.message }));
  }
  const pairs = (data ?? []) as DuplicatePair[];

  return (
    <div className="admin-page">
      <div className="admin-shell">
        <header className="admin-header">
          <div>
            <h1 className="admin-title">Potential Duplicates</h1>
            <p className="admin-subtitle">{pairs.length} pending review</p>
          </div>
        </header>

        {pairs.length === 0 && <p className="admin-empty">No potential duplicates flagged.</p>}
        <DuplicatesReview pairs={pairs} />
      </div>
    </div>
  );
}
