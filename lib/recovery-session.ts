import 'server-only';
import { makeEncryptedCookieSession, type TimestampedPayload } from '@/lib/encrypted-cookie';

export interface RecoverySessionData extends TimestampedPayload {
  phone: string; // E.164
  phoneVerified: boolean;
}

const SESSION_MAX_AGE_SECONDS = 15 * 60; // 15 minutes — recovery is a short, sensitive flow

export const recoverySession = makeEncryptedCookieSession<RecoverySessionData>({
  cookieName: 'huuid_recover_session',
  envVarName: 'HUUID_SESSION_ENCRYPTION_KEY',
  maxAgeSeconds: SESSION_MAX_AGE_SECONDS,
});
