// φ — canonical hashing for the memory ledger. Deterministic, domain-separated, sha256-based.
//
// ══ WHY A SEPARATE STABLE STRINGIFY ══
//
// `JSON.stringify` does not sort object keys, so two callers building "the same" event in a different
// field order would hash to different digests — and a digest that depends on insertion order is not a
// content hash, it is a serialisation accident. Every hash in this organ goes through `stableStringify`
// first so field order never matters.
//
// ══ DOMAIN SEPARATION ══
//
// RFC 6962 prefixes a leaf hash and a node hash differently so a crafted leaf can never be replayed as
// a node, or vice versa. The same idea, generalised: every hash ROLE in this organ (an event body, a
// head, a minted id, a certificate) hashes under its own tag, so a value built to collide as one role
// cannot also collide as another.
//
// This is intentionally NOT the donor's `@aukora/kernel/canonical` — that package is not part of this
// port (see docs/MEMORY-PORT.md). This is a small, self-contained equivalent using only `node:crypto`.

import { createHash } from 'crypto';

function stableStringify(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  const keys = Object.keys(value as Record<string, unknown>).sort();
  const body = keys
    .map((k) => `${JSON.stringify(k)}:${stableStringify((value as Record<string, unknown>)[k])}`)
    .join(',');
  return `{${body}}`;
}

/** sha256(domain ‖ 0x00 ‖ stableStringify(value)), hex. The one hash primitive this organ uses. */
export function domainHash(domain: string, value: unknown): string {
  return createHash('sha256')
    .update(domain, 'utf8')
    .update(Buffer.from([0x00]))
    .update(stableStringify(value), 'utf8')
    .digest('hex');
}

export { stableStringify };
