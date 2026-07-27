import 'server-only';
import { makeEncryptedCookieSession, type TimestampedPayload } from '@/lib/encrypted-cookie';

export interface EraseSessionData extends TimestampedPayload {
  phone: string; // E.164
  phoneVerified: boolean;
}

const SESSION_MAX_AGE_SECONDS = 15 * 60; // 15 minutes -- erasure is a short, sensitive, irreversible flow

export const eraseSession = makeEncryptedCookieSession<EraseSessionData>({
  cookieName: 'huuid_erase_session',
  envVarName: 'HUUID_SESSION_ENCRYPTION_KEY',
  maxAgeSeconds: SESSION_MAX_AGE_SECONDS,
});
