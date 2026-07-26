import 'server-only';

/**
 * Passphrase for pgcrypto column encryption (migration 013). Passed as a
 * parameter on every RPC call — never stored inside a Postgres function
 * body or table, matching the rule that secrets live in env vars only.
 */
export function getPiiKey(): string {
  const key = process.env.HUUID_PII_ENCRYPTION_KEY;
  if (!key || key.length < 32) {
    throw new Error(
      'HUUID_PII_ENCRYPTION_KEY is missing or too short (minimum 32 characters).'
    );
  }
  return key;
}

/** E.164 validation: + followed by 8-15 digits, no leading zero after the country code. */
const E164_RE = /^\+[1-9]\d{7,14}$/;

export function isValidE164(phone: string): boolean {
  return E164_RE.test(phone);
}
