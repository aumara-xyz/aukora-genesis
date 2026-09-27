// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Aukora
/**
 * Inert-data fence (contract decision 4). Pure. The fence nonce is NOT stored in the pack body: it is
 * derived AFTER hashing from a pinned domain, the packDigest, and an increasing counter, incremented
 * until neither the open nor close token occurs in any presented content. So embedded code/comments
 * can never forge the fence, and the reproducible body/digest carry no presentation state. ASCII
 * tokens; visible separators; no raw NUL bytes.
 */
import { sha256Hex } from './digest';

const encoder = new TextEncoder();
export const FENCE_DOMAIN = 'aukora-fu-evidence-fence-v1';

export function fenceOpen(nonce: string): string { return `<<AUKORA-DATA:${nonce}>>`; }
export function fenceClose(nonce: string): string { return `<<AUKORA-END:${nonce}>>`; }

export function fenceCollisionFree(nonce: string, contents: readonly string[]): boolean {
  const open = fenceOpen(nonce);
  const close = fenceClose(nonce);
  for (const c of contents) {
    if (c.indexOf(open) !== -1 || c.indexOf(close) !== -1) return false;
  }
  return true;
}

/** Derive a presentation-time fence nonce from (domain, packDigest, counter), incrementing until
 *  collision-free. The FULL 64-hex SHA-256 is the nonce (D1: no truncation). Deterministic given
 *  (packDigest, contents). Never stored in the body. */
export function deriveFenceNonce(packDigest: string, contents: readonly string[]): string {
  for (let counter = 0; counter < 100000; counter++) {
    const nonce = sha256Hex(encoder.encode(`${FENCE_DOMAIN}|${packDigest}|${counter}`)); // full 64-hex
    if (fenceCollisionFree(nonce, contents)) return nonce;
  }
  throw new Error('E_FENCE_NONCE'); // unreachable in practice
}

export function fence(nonce: string, text: string): string {
  return fenceOpen(nonce) + text + fenceClose(nonce);
}
