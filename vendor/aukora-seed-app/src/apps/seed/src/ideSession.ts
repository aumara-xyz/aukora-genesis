// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Aukora
/**
 * Auma IDE session (R34) — the next USABLE increment over the R0–R3 envelope.
 *
 * One session object ties the whole safe inward loop together for a local IDE surface:
 *   inspect (confined list/read/search) → cite (integrity-checked recall) → draft → rehearse (governed gate,
 *   verbatim refusal reasons) → receipt view → staged branch candidate (only after a PASSED rehearsal).
 *
 * The session ADDS bookkeeping, never power:
 *   - every refusal it witnesses is kept as a stable, quotable `RefusalLogEntry` (reason class + text);
 *   - `receiptView()` is a DISPLAY-ONLY projection of the receipt chain (prefixes, no content echo, fence-clean);
 *   - there is no push / merge / deploy / sign / widen surface — the session wraps the envelope, whose fences
 *     (path, capability, owner gate) all remain load-bearing underneath.
 *
 * Pure/in-memory over injected capabilities. Grants no authority.
 */
import type { ReactiveMemoryStore } from '@aukora/brain';
import { AumaIdeEnvelope, type RepoReadCapability, type Refusal, type ReadResult, type Citation, type DraftResult, type StageResult, type RecallHitCited, type IdeReasonClass } from './ideEnvelope.js';
import type { RecursionEnv, RecursionResult, OwnerAuthorization } from './recursion.js';
import type { Proposal } from './proposal.js';
import { scanForbiddenKeys, scanForbiddenValues, scanForbiddenAuthorityClaims } from './forbiddenContent.js';

export interface RefusalLogEntry {
  readonly seq: number;
  readonly surface: 'read' | 'search' | 'draft' | 'rehearse' | 'stage';
  readonly reasonClass: IdeReasonClass | string;
  readonly text: string;
  readonly path?: string;
}

/** One display-safe row of the receipt view — prefixes only, never content echo. */
export interface ReceiptViewRow {
  readonly index: number;
  readonly kind: string;
  readonly chainHashPrefix: string;
  readonly prevHashPrefix: string | null;
}

export interface ReceiptView {
  readonly schema: 'aukora-receipt-view-v1';
  readonly chainLength: number;
  readonly chainValid: boolean;
  readonly merkleRootPrefix: string | null;
  readonly rows: readonly ReceiptViewRow[];
  readonly classification: 'DISPLAY_ONLY';
  readonly advisoryOnly: true;
  readonly grantsAuthority: false;
}

const MAX_VIEW_ROWS = 100;
const MAX_REFUSAL_LOG = 512;

export class AumaIdeSession {
  private readonly envelope: AumaIdeEnvelope;
  private readonly refusalLog: RefusalLogEntry[] = [];
  private seq = 0;

  constructor(repo: RepoReadCapability, private readonly env: RecursionEnv) {
    this.envelope = new AumaIdeEnvelope(repo);
  }

  private log(surface: RefusalLogEntry['surface'], r: { reasonClass?: string; text?: string; path?: string } | null, fallback?: { reasonClass: string; text: string }): void {
    const entry = r ?? fallback;
    if (!entry || !entry.reasonClass || !entry.text) return;
    this.seq += 1;
    this.refusalLog.push({ seq: this.seq, surface, reasonClass: entry.reasonClass, text: entry.text, path: r?.path });
    if (this.refusalLog.length > MAX_REFUSAL_LOG) this.refusalLog.shift();
  }

  // ── inspect ──────────────────────────────────────────────────────────────
  list(dir: string): { entries: string[]; refusals: Refusal[] } {
    const out = this.envelope.list(dir);
    for (const r of out.refusals) this.log('read', r);
    return out;
  }

  read(path: string): ReadResult {
    const out = this.envelope.read(path);
    if (!out.ok) this.log('read', out.refusal);
    return out;
  }

  search(root: string, query: string): { citations: Citation[]; refusals: Refusal[] } {
    const out = this.envelope.search(root, query);
    for (const r of out.refusals) this.log('search', r);
    return out;
  }

  // ── cite ─────────────────────────────────────────────────────────────────
  recall(query: { text: string }): { integrityValid: boolean; hits: RecallHitCited[] } {
    return this.envelope.recall(this.env.store as ReactiveMemoryStore, query);
  }

  // ── draft / rehearse / stage ─────────────────────────────────────────────
  draft(input: { targetPath: string; newContent: string; createdAt: string; supersedes?: string | null; id?: string }): DraftResult {
    const out = this.envelope.draft(input);
    if (!out.ok && out.refusal) this.log('draft', out.refusal);
    return out;
  }

  rehearse(proposal: Proposal, auth?: OwnerAuthorization): RecursionResult {
    const out = this.envelope.rehearse(this.env, proposal, auth);
    if (!out.accepted) this.log('rehearse', { reasonClass: out.stage, text: out.refusals.join('; ') || out.stage, path: proposal.targetPath });
    return out;
  }

  stageBranchCandidate(drafts: readonly { readonly proposal: Proposal; readonly auth?: OwnerAuthorization }[], explanation: string): StageResult {
    const out = this.envelope.stageBranchCandidate(this.env, drafts, explanation);
    if (!out.ok) this.log('stage', out.refusal);
    return out;
  }

  // ── evidence surfaces ────────────────────────────────────────────────────
  /** Every refusal this session witnessed — stable classes, quotable text, bounded. */
  refusals(): readonly RefusalLogEntry[] {
    return this.refusalLog.slice();
  }

  /** DISPLAY-ONLY receipt view over the session store: prefixes + kinds only, chain verified, fence-clean. */
  receiptView(): ReceiptView {
    const store = this.env.store;
    const chain = store.chain();
    const snap = store.snapshot();
    const start = Math.max(0, chain.length - MAX_VIEW_ROWS);
    const rows: ReceiptViewRow[] = chain.slice(start).map((e, i) => {
      const payload = e.payload as Record<string, unknown>;
      return {
        index: start + i,
        kind: typeof payload.kind === 'string' ? payload.kind.slice(0, 24) : 'unknown',
        chainHashPrefix: e.chainHash.slice(0, 12),
        prevHashPrefix: e.prevHash ? e.prevHash.slice(0, 12) : null,
      };
    });
    const view: ReceiptView = {
      schema: 'aukora-receipt-view-v1',
      chainLength: chain.length,
      chainValid: store.verifyChain().valid,
      merkleRootPrefix: snap.merkleRootHex ? snap.merkleRootHex.slice(0, 12) : null,
      rows,
      classification: 'DISPLAY_ONLY',
      advisoryOnly: true,
      grantsAuthority: false,
    };
    // Fence-audit the view itself — a display surface must never leak forbidden material.
    const leaks = [...scanForbiddenKeys(view), ...scanForbiddenValues(view), ...scanForbiddenAuthorityClaims(view)];
    if (leaks.length > 0) {
      return { ...view, rows: [], chainLength: view.chainLength, classification: 'DISPLAY_ONLY' };
    }
    return view;
  }
}

/** The IDE session grants no authority — constant, by construction. */
export function ideSessionGrantsAuthority(): false {
  return false;
}
