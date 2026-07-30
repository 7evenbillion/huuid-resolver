import 'server-only';
import { webcrypto } from 'node:crypto';

function randomDigits(count: number): string {
  const buf = new Uint32Array(1);
  let out = '';
  for (let i = 0; i < count; i++) {
    webcrypto.getRandomValues(buf);
    out += Math.floor((buf[0] / 4294967296) * 10).toString();
  }
  return out;
}

/** APP-[YYYY]-[6 random digits], e.g. APP-2026-847291. */
export function generateApplicationId(): string {
  const year = new Date().getUTCFullYear();
  return `APP-${year}-${randomDigits(6)}`;
}

const CONSENT_ID_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // no 0/O/1/I, matches Base58-style unambiguity elsewhere in this project

/** CONSENT-[timestamp]-[8 random chars]. */
export function generateConsentId(): string {
  const buf = new Uint32Array(1);
  let suffix = '';
  for (let i = 0; i < 8; i++) {
    webcrypto.getRandomValues(buf);
    suffix += CONSENT_ID_CHARS[buf[0] % CONSENT_ID_CHARS.length];
  }
  return `CONSENT-${Date.now()}-${suffix}`;
}
