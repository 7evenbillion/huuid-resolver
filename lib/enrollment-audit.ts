import 'server-only';
import { randomUUID } from 'node:crypto';
import { getServiceClient } from '@/lib/supabase-server';

export type EnrollmentAuditAction =
  | 'enrollment_started'
  | 'phone_verified'
  | 'keypair_generated'
  | 'enrollment_completed'
  | 'card_downloaded'
  | 'recovery_requested'
  | 'erasure_requested'
  | 'erasure_completed'
  | 'medical_profile_updated'
  | 'profile_updated'
  | 'pin_changed';

interface AuditInput {
  huuid: string | null;
  action: EnrollmentAuditAction;
  ipHash: string;
  userAgentHash: string;
  outcome: string;
}

/** Writes one immutable enrollment audit record (huuid_audit_enrollment). Never throws — logs and swallows on failure, matching this project's existing audit-write style for non-resolution paths. */
export async function writeEnrollmentAudit(input: AuditInput): Promise<void> {
  const auditEntryId = `enroll-audit-${Date.now()}-${randomUUID().slice(0, 8)}`;
  const { error } = await getServiceClient().from('huuid_audit_enrollment').insert({
    audit_entry_id: auditEntryId,
    huuid: input.huuid,
    action: input.action,
    ip_hash: input.ipHash,
    user_agent_hash: input.userAgentHash,
    outcome: input.outcome,
  });
  if (error) {
    console.error(
      JSON.stringify({
        level: 'error',
        action: 'enrollment_audit_write_failed',
        message: error.message,
      })
    );
  }
}
