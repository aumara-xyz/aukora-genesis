// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Aukora
/**
 * GOLD memory registry — the amber, CONSTITUTIONAL class of KIRA memory.
 *
 * A GOLD memory is protected, VERSIONED, and RECEIPTED: every version is receipt-chained (canonical
 * @aukora/kernel chain — reuse, not clone), every change appends a new version (history is never rewritten),
 * and a change is possible ONLY through an explicit owner AUMLOK ceremony (an injected verification over the
 * exact change — the registry holds no key and never signs). Gold is deliberately NOT literally immutable:
 * the owner can always amend the constitution — through ceremony, on the record, never silently.
 */
import { receiptChainHash, verifyReceiptChain, type ReceiptChainEntryV1, type ReceiptChainVerdict } from '@aukora/kernel/evidence';
import { deriveRecordId } from '@aukora/memory';

export interface GoldVersion {
  readonly version: number;
  /** Content-addressed id of this version's content (canonical deriveRecordId). */
  readonly recordId: string;
  readonly content: string;
  readonly at: string;
  readonly receiptHash: string;
}

export interface GoldChangeRequest {
  readonly key: string;
  readonly newContent: string;
  readonly at: string;
  readonly reason: string;
}

/** The exact preimage the owner ceremony must attest. Content-addressed — no ambiguity about what was approved. */
export interface GoldCeremonyAttestation {
  readonly key: string;
  readonly newRecordId: string;
  readonly reason: string;
}

export type GoldChangeVerdict =
  | { readonly ok: true; readonly version: number; readonly receiptHash: string }
  | { readonly ok: false; readonly refusal: string };

export class GoldMemoryRegistry {
  private readonly versions = new Map<string, GoldVersion[]>();
  private readonly entries: ReceiptChainEntryV1[] = [];

  /**
   * Propose a change to a GOLD memory. `verifyOwnerCeremony` is the injected AUMLOK ceremony check over the
   * EXACT attestation (key + content-addressed new id + reason) — fail-closed: no valid ceremony ⇒ refused.
   * A successful change appends a NEW version and a receipt; prior versions are never rewritten or deleted.
   */
  change(request: GoldChangeRequest, verifyOwnerCeremony: (a: GoldCeremonyAttestation) => boolean): GoldChangeVerdict {
    if (request.newContent.length === 0) return { ok: false, refusal: 'refused: empty gold content' };
    const newRecordId = deriveRecordId(request.newContent);
    const attestation: GoldCeremonyAttestation = { key: request.key, newRecordId, reason: request.reason };
    if (!verifyOwnerCeremony(attestation)) {
      return { ok: false, refusal: 'refused: gold is constitutional — change requires an explicit owner AUMLOK ceremony' };
    }
    const history = this.versions.get(request.key) ?? [];
    const version = history.length + 1;
    const prevHash = this.entries.length ? this.entries[this.entries.length - 1].chainHash : null;
    const payload = { kind: 'gold-change', key: request.key, version, recordId: newRecordId, at: request.at, reason: request.reason };
    const receiptHash = receiptChainHash(payload, prevHash);
    this.entries.push({ payload: payload as never, prevHash, chainHash: receiptHash });
    history.push({ version, recordId: newRecordId, content: request.newContent, at: request.at, receiptHash });
    this.versions.set(request.key, history);
    return { ok: true, version, receiptHash };
  }

  /** The current (latest) version of a gold memory, or null. Read-only. */
  current(key: string): GoldVersion | null {
    const history = this.versions.get(key) ?? [];
    return history.length ? history[history.length - 1] : null;
  }

  /** Full version history — never rewritten. Read-only. */
  history(key: string): readonly GoldVersion[] {
    return this.versions.get(key) ?? [];
  }

  /** The canonical receipt-chain verdict over every gold change ever made. */
  verifyReceipts(): ReceiptChainVerdict {
    return verifyReceiptChain(this.entries);
  }
}

/** Gold grants no authority — it is protected BY authority (the owner ceremony), never a source of it. */
export function goldGrantsAuthority(): false {
  return false;
}
