/**
 * Deterministic JSON serialization (recursively sorted object keys) so that
 * signing and verifying a request body produce byte-identical output
 * regardless of source key order. Both the signer (clinician software /
 * test harness) and the verifier (this resolver) must use this exact
 * function — HUUID-BREAK-GLASS-API-v0.2 specifies signing over
 * SHA256(full_request_body_minus_this_field) but does not itself mandate a
 * canonicalization algorithm, so this is the protocol convention adopted
 * for the Month 3 build.
 */
export function canonicalJsonStringify(value: unknown): string {
  return JSON.stringify(sortKeysDeep(value));
}

function sortKeysDeep(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortKeysDeep);
  if (value !== null && typeof value === 'object') {
    const sorted: Record<string, unknown> = {};
    for (const key of Object.keys(value as Record<string, unknown>).sort()) {
      sorted[key] = sortKeysDeep((value as Record<string, unknown>)[key]);
    }
    return sorted;
  }
  return value;
}
