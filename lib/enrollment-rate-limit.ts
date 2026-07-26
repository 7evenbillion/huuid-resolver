import 'server-only';
import { createHash } from 'node:crypto';
import { NextRequest } from 'next/server';
import { getServiceClient } from '@/lib/supabase-server';
import { getPiiKey } from '@/lib/pii';
import { OTP_MAX_REQUESTS_PER_HOUR } from '@/lib/otp';

const ENROLLMENT_MAX_ATTEMPTS_PER_HOUR = 3;

/** SHA-256 hash of the request IP — raw IPs are never stored, matching every other table in this project. */
export function requesterIpHash(req: NextRequest): string {
  const forwarded = req.headers.get('x-forwarded-for');
  const ip = forwarded?.split(',')[0]?.trim() || 'unknown';
  return createHash('sha256').update(ip).digest('hex');
}

export function userAgentHash(req: NextRequest): string {
  const ua = req.headers.get('user-agent') || 'unknown';
  return createHash('sha256').update(ua).digest('hex');
}

/** Atomic, advisory-lock-backed IP rate limit (huuid_check_and_log_rate_limit, migration 013). */
export async function checkEnrollmentRateLimit(ipHash: string, action: string): Promise<boolean> {
  const { data, error } = await getServiceClient().rpc('huuid_check_and_log_rate_limit', {
    p_ip_hash: ipHash,
    p_action: action,
    p_max_per_hour: ENROLLMENT_MAX_ATTEMPTS_PER_HOUR,
  });
  if (error) {
    console.error(JSON.stringify({ level: 'error', action: 'rate_limit_check_failed', message: error.message }));
    // Fail closed: if the rate-limit check itself is broken, do not allow the attempt through.
    return false;
  }
  return data === true;
}

/** OTP-specific: 3 requests per phone per hour, checked independently of the IP limit above. */
export async function checkOtpRequestRateLimit(phone: string, otpType: string): Promise<boolean> {
  const since = new Date(Date.now() - 60 * 60 * 1000).toISOString();
  const { data, error } = await getServiceClient().rpc('huuid_otp_count_recent', {
    p_phone: phone,
    p_otp_type: otpType,
    p_since: since,
    p_pii_key: getPiiKey(),
  });
  if (error) {
    console.error(JSON.stringify({ level: 'error', action: 'otp_rate_limit_check_failed', message: error.message }));
    return false;
  }
  return (data ?? OTP_MAX_REQUESTS_PER_HOUR) < OTP_MAX_REQUESTS_PER_HOUR;
}
