// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Aukora
/**
 * Domain-separated, length-framed pack digest (docs/EVIDENCEPACK_V1.md §6):
 *   packDigest = hex( SHA-256( utf8(DOMAIN) ‖ 0x00 ‖ uint64BE(len(C)) ‖ C ) ),  C = canonicalBytes(body)
 * Pure; uses only node:crypto hashing.
 */
import { createHash } from 'node:crypto';
import { canonicalBytes } from './canonical';

export const DIGEST_DOMAIN = 'aukora-fu-evidence-pack-v1';
const encoder = new TextEncoder();

export function sha256Hex(data: Uint8Array): string {
  return createHash('sha256').update(data).digest('hex');
}

/** 8-byte big-endian encoding of a non-negative safe integer (modulo arithmetic, not 32-bit bitwise). */
export function uint64BE(n: number): Uint8Array {
  if (!Number.isSafeInteger(n) || n < 0) throw new Error('E_BAD_INTEGER');
  const out = new Uint8Array(8);
  let v = n;
  for (let i = 7; i >= 0; i--) {
    out[i] = v % 256;
    v = Math.floor(v / 256);
  }
  return out;
}

export function packDigestOfCanonical(canonical: Uint8Array): string {
  const h = createHash('sha256');
  h.update(encoder.encode(DIGEST_DOMAIN));
  h.update(new Uint8Array([0x00]));
  h.update(uint64BE(canonical.length));
  h.update(canonical);
  return h.digest('hex');
}

export function packDigest(body: unknown): string {
  return packDigestOfCanonical(canonicalBytes(body));
}
