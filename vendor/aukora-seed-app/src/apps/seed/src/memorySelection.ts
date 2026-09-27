// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Aukora
/**
 * Memory-selection evidence packet (pure) — how Auma PROPOSES which donor memories migrate.
 *
 * Auma inspects the donor store and produces a packet: each candidate memory is cited by SOURCE ROW, classified
 * (`migrate` | `leave-behind` | `private-hold`), tier-proposed, and reasoned. Two privacy laws are structural:
 *   - CONTENT travels only with `migrate` items (and is fence-checked); `leave-behind` and `private-hold` items are
 *     CONTENT-FREE (source row + content hash only) — anything private or unwanted stays behind, unreadable here;
 *   - the packet is advisory: Peter approves the final set out-of-band, and NO import happens in this module —
 *     there is no apply surface and `importPerformed()` is a hard false.
 *
 * Reasons are scrubbed (secret/authority lines redacted); a fail-closed final audit refuses a packet with residue.
 * Digest-verifiable so the approver reviews exactly what Auma built. Pure: no I/O, no authority.
 */
import { canonicalHash } from '@aukora/kernel/canonical';
import { scanForbiddenKeys, scanForbiddenValues, scanForbiddenAuthorityClaims } from './forbiddenContent.js';
import { scrubText } from './councilPack.js';
import { isHex64 } from './proposal.js';
import type { MemoryTier } from './memoryConstitution.js';

export type SelectionClass = 'migrate' | 'leave-behind' | 'private-hold';

export interface SourceRowCitation {
  /** Which donor table/store the row lives in (a label, never a connection string). */
  readonly table: string;
  readonly rowId: string;
}

export interface SelectionItem {
  readonly citation: SourceRowCitation;
  /** Content-addressed identity of the donor row — present for EVERY class (the audit that it was considered). */
  readonly contentHash: string;
  readonly classification: SelectionClass;
  readonly proposedTier: MemoryTier;
  readonly reason: string;
  /** The memory text itself — ONLY on `migrate` items; structurally absent otherwise. */
  readonly content?: string;
}

export interface MemorySelectionPacketV1 {
  readonly schema: 'aukora-memory-selection-packet-v1';
  readonly proposedBy: 'auma';
  readonly items: readonly SelectionItem[];
  readonly counts: { readonly migrate: number; readonly leaveBehind: number; readonly privateHold: number };
  /** Approval is the OWNER'S out-of-band act; the packet only carries the slot, never fills it. */
  readonly approvedBy: null;
  readonly importPerformed: false;
  readonly digest: string;
  readonly advisoryOnly: true;
  readonly grantsAuthority: false;
}

export type SelectionResult =
  | { readonly ok: true; readonly packet: MemorySelectionPacketV1 }
  | { readonly ok: false; readonly reason: string; readonly leaks?: string[] };

const MAX_ITEMS = 1024;
const MAX_CONTENT = 16_384;

export interface SelectionItemInput {
  readonly table: string;
  readonly rowId: string;
  readonly contentHash: string;
  readonly classification: SelectionClass;
  readonly proposedTier: MemoryTier;
  readonly reason: string;
  readonly content?: string;
}

/** Build a scrubbed, digested selection packet. Fail-closed on any privacy/fence violation. */
export function buildSelectionPacket(inputs: readonly SelectionItemInput[]): SelectionResult {
  if (inputs.length === 0) return { ok: false, reason: 'selection: at least one considered item is required' };
  if (inputs.length > MAX_ITEMS) return { ok: false, reason: `selection: more than ${MAX_ITEMS} items` };

  const items: SelectionItem[] = [];
  for (const raw of inputs) {
    if (typeof raw.table !== 'string' || raw.table.length === 0 || raw.table.length > 128) return { ok: false, reason: 'selection: citation table invalid' };
    if (typeof raw.rowId !== 'string' || raw.rowId.length === 0 || raw.rowId.length > 128) return { ok: false, reason: 'selection: citation rowId invalid' };
    if (!isHex64(raw.contentHash)) return { ok: false, reason: 'selection: contentHash must be 64-hex' };
    if (raw.classification !== 'migrate' && raw.classification !== 'leave-behind' && raw.classification !== 'private-hold') {
      return { ok: false, reason: 'selection: unknown classification' };
    }
    // PRIVACY LAW: content only travels with migrate items — a private/left-behind row stays content-free.
    if (raw.classification !== 'migrate' && raw.content !== undefined) {
      return { ok: false, reason: `selection: a '${raw.classification}' item must be content-free (hash + citation only)` };
    }
    if (raw.classification === 'migrate') {
      if (typeof raw.content !== 'string' || raw.content.length === 0 || raw.content.length > MAX_CONTENT) {
        return { ok: false, reason: 'selection: a migrate item requires bounded content' };
      }
      if (canonicalHash({ content: raw.content }) !== raw.contentHash) {
        return { ok: false, reason: 'selection: migrate content does not match its contentHash' };
      }
    }
    items.push({
      citation: { table: raw.table, rowId: raw.rowId },
      contentHash: raw.contentHash,
      classification: raw.classification,
      proposedTier: raw.proposedTier,
      reason: scrubText(String(raw.reason)).slice(0, 512),
      ...(raw.classification === 'migrate' ? { content: raw.content } : {}),
    });
  }

  const counts = {
    migrate: items.filter((i) => i.classification === 'migrate').length,
    leaveBehind: items.filter((i) => i.classification === 'leave-behind').length,
    privateHold: items.filter((i) => i.classification === 'private-hold').length,
  };
  const body = {
    schema: 'aukora-memory-selection-packet-v1' as const,
    proposedBy: 'auma' as const,
    items: items.map((i) => ({ ...i.citation, contentHash: i.contentHash, classification: i.classification, proposedTier: i.proposedTier, reason: i.reason, content: i.content ?? null })),
    counts,
    approvedBy: null,
    importPerformed: false as const,
    advisoryOnly: true as const,
    grantsAuthority: false as const,
  };
  // Final fence audit over the FREE-TEXT fields — a packet may never carry secret/authority residue (even inside
  // migrate content). The structural contentHash fields are legitimately 64-hex and are excluded from the value scan.
  const auditable = items.map((i) => ({ table: i.citation.table, rowId: i.citation.rowId, reason: i.reason, content: i.content ?? null }));
  const leaks = [...scanForbiddenKeys(auditable), ...scanForbiddenValues(auditable).map((p) => `value@${p}`), ...scanForbiddenAuthorityClaims(auditable).map((p) => `authority@${p}`)];
  if (leaks.length) return { ok: false, reason: 'selection: packet carries forbidden content after scrubbing', leaks };

  const digest = canonicalHash(body);
  return {
    ok: true,
    packet: { schema: body.schema, proposedBy: body.proposedBy, items, counts, approvedBy: null, importPerformed: false, digest, advisoryOnly: true, grantsAuthority: false },
  };
}

/** Recompute the digest an approver reviews — proves the packet is exactly what Auma built. */
export function verifySelectionPacket(packet: MemorySelectionPacketV1): { valid: boolean; reason: string } {
  const body = {
    schema: packet.schema,
    proposedBy: packet.proposedBy,
    items: packet.items.map((i) => ({ table: i.citation.table, rowId: i.citation.rowId, contentHash: i.contentHash, classification: i.classification, proposedTier: i.proposedTier, reason: i.reason, content: i.content ?? null })),
    counts: { migrate: packet.counts.migrate, leaveBehind: packet.counts.leaveBehind, privateHold: packet.counts.privateHold },
    approvedBy: null,
    importPerformed: false,
    advisoryOnly: true,
    grantsAuthority: false,
  };
  if (canonicalHash(body) !== packet.digest) return { valid: false, reason: 'digest mismatch' };
  if (packet.importPerformed !== false || packet.grantsAuthority !== false) return { valid: false, reason: 'packet is not advisory-only' };
  if (packet.items.some((i) => i.classification !== 'migrate' && i.content !== undefined)) return { valid: false, reason: 'a non-migrate item carries content' };
  return { valid: true, reason: 'ok' };
}

/** HARD: this module performs NO import — proposing is not migrating. Constant, by construction. */
export function importPerformed(): false {
  return false;
}

/**
 * SALTED content tag for left-behind / private-hold rows (R35 PII law).
 *
 * A plain `canonicalHash({content})` of LOW-ENTROPY PII (a birthday, a name, a phone number) is guessable by
 * enumeration — publishing it would leak the very thing the row was held back to protect. Rows whose content stays
 * behind MUST therefore publish a salted tag instead: the salt (≥128-bit hex, owner-held, never published) makes the
 * tag useless for dictionary/rainbow enumeration while still letting the owner re-derive and audit it. Migrate rows
 * keep the unsalted hash — their content travels anyway, so the hash hides nothing and must stay verifiable.
 */
export function saltedContentTag(saltHex: string, content: string): string {
  if (typeof saltHex !== 'string' || !/^[0-9a-f]{32,64}$/.test(saltHex)) throw new Error('salted_tag_salt_invalid: need 32-64 lowercase hex chars (>=128-bit salt)');
  if (typeof content !== 'string') throw new Error('salted_tag_content_invalid');
  return canonicalHash({ domain: 'AUKORA-SALTED-ROW/1', salt: saltHex, content });
}
