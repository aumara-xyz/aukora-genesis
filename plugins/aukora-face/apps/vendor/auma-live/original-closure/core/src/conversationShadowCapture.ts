// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Aumara and Peter Viviani
/**
 * Conversation shadow-capture — the PURE orchestrator between the distiller and the governed
 * memory write path (docs/CONVEX_SHADOW_WRITE_PLAN.md piece 3, built on the 2026-07-07 directive).
 *
 * After a completed voice turn, the door asks this module to distill the two speech acts
 * (owner text + Auma's reply) into ONE bounded `turn-summary-v1` value and append it through
 * core/src/memoryAppend.ts — the single governed client write path. This module is deliberately
 * pure and injected: NO convex imports, NO fs, NO Bun globals, NO signing machinery. The ceremony
 * (manifest mint, per-write subject signatures) is injected via `deps.nextUse` by
 * scripts/captureSubjectAdapter.ts, and the transport via `deps.invoke`
 * (core/src/memoryKernelTransport.createGovernedHttpInvoke) — so every path here is testable
 * hermetically, and the convex-free law on core/src holds.
 *
 * Held invariants (each carried by a test in core/tests/conversationShadowCapture.test.ts):
 *   - SUMMARY ONLY: content flows through distillConversation — capped atoms, hedge-preserving,
 *     forbidden-content (keys, PEM, long hex, convex host strings) DROPPED, never sanitized-and-kept.
 *   - ZERO ATOMS → ZERO WRITES: if distillation yields nothing admissible, nothing travels; the
 *     caller gets a typed refusal to surface, not a silent success.
 *   - FIRE-AND-FORGET SAFE: this module never throws to its caller — every failure (lease, signing,
 *     transport, kernel) returns a refused envelope. Chat can never block on capture.
 *   - NO AUTHORITY: every envelope — success or refusal — carries advisoryOnly:true /
 *     grantsAuthority:false. A captured memory never grants permission to anything.
 *   - Recall is untouched: nothing here reads anything. Kira JSON stays the only fuzzy recall
 *     source until R5b (docs/R5_RECALL_STATUS.md).
 */
import { distillConversation, type DistilledAtom } from './conversationDistiller';
import { memoryAppend, MEM_KEY_RE, type MemoryAppendDeps, type MemoryAppendResult } from './memoryAppend';
import { buildCoreReceiptStamp, type CoreReceiptStampV1 } from './coreMemoryEnvelope';

export const TURN_SUMMARY_SCHEMA = 'turn-summary-v1' as const;

/** Hard cap on the canonical JSON bytes of one turn-summary value. The real envelope is a few
 *  hundred chars (two capped atoms + metadata); 8k is generous headroom, still bounded. */
export const MAX_TURN_SUMMARY_CHARS = 8_000;

/** Cap on the model-id string carried in the value (roster ids are ~30 chars). */
const MAX_MODEL_CHARS = 200;

/** Defense-in-depth over the shared scanner. HISTORY: when this lane shipped (2026-07-07),
 *  FORBIDDEN_VALUE_RE's `sk-` net required 12+ UNBROKEN alphanumerics and hyphenated key formats
 *  escaped it — this net was the stopgap. The shared scanner has since been broadened (same
 *  round, secret-scanner-hardening brick) and now covers those families; this stays as
 *  belt-and-braces (a second, independent drop-net costs nothing and survives future scanner
 *  regressions). Same law-3 semantics: drop the atom, never sanitize-and-keep. */
const CAPTURE_EXTRA_SECRET_RE = /\bsk-[A-Za-z0-9_-]{10,}/;

export interface TurnSummaryInput {
  /** The owner's typed text for this turn (owner_text ONLY — never attachments/images/recall). */
  ownerText: string;
  /** Auma's displayed reply text (the voiced info entry — never tool outputs or system prompts). */
  replyText: string;
  /** The roster model id that answered. Metadata only. */
  model: string;
  /** ISO timestamp of the completed turn (becomes both the value's `at` and the key's time part). */
  at: string;
  /** OPTIONAL door tag — WHICH surface this turn came through ('chat', 'presence', future doors).
   *  Metadata only, bounded lowercase slug; an invalid or absent tag is OMITTED from the envelope,
   *  never guessed, so old rows and untagged writers read honestly as door-unknown. */
  origin?: string;
  /** OPTIONAL thread/session id of the writing surface (one-core-memory round, #45/#244). Same
   *  drop-not-fail law as origin: an invalid id is omitted and the turn still captures. */
  thread?: string;
  /** OPTIONAL repo commit the writing process runs (resolved once per process by the edge).
   *  Metadata only; invalid values are dropped by the stamp builder. */
  sourceCommit?: string;
}

/** The door-tag law: a short lowercase slug or nothing. Capture must never fail a turn over a tag —
 *  an invalid origin is dropped (the turn still captures), pinned by tests. */
const ORIGIN_SLUG_RE = /^[a-z][a-z0-9_-]{0,23}$/;

/** The dedicated recent-turn digest riding inside turn-summary-v1 (ADDITIVE field — readers that
 *  only know `atoms` ignore it; the schema string is unchanged). Built ONLY from atoms that already
 *  passed distillation (law 3 forbidden-content refusal) AND the extra secret net below, so no new
 *  content path exists — nothing travels in it that did not already travel in `atoms`. */
export interface RecentTurnAtom {
  text: string;
  at: string;
  advisoryOnly: true;
  grantsAuthority: false;
}

export interface TurnSummaryValue {
  schema: typeof TURN_SUMMARY_SCHEMA;
  at: string;
  model: string;
  /** ADDITIVE door tag (see TurnSummaryInput.origin) — present only when a valid slug was given.
   *  Readers that don't know it ignore it; readers that do can say WHICH door a memory came through. */
  origin?: string;
  /** ADDITIVE core receipt stamp (one-core-memory round, #45/#244) — WHICH core instance, memory
   *  namespace, thread, and commit this write intended. Attached by captureTurn (the only place
   *  that knows the deployment), dropped — never failed over — when it cannot be built or fit.
   *  Readers that don't know it ignore it; old rows read honestly as unstamped. */
  core?: CoreReceiptStampV1;
  atoms: DistilledAtom[];
  /** Compact role-labeled owner+auma line for THIS pair — the high-recency recall surface
   *  (spatial/recallSource.governedValueMeta prefers it for display). */
  recentTurn?: RecentTurnAtom;
  advisoryOnly: true;
  grantsAuthority: false;
}

export type BuildTurnSummaryResult =
  | { ok: true; value: TurnSummaryValue }
  | { ok: false; refused: string; advisoryOnly: true; grantsAuthority: false };

const refuseBuild = (reason: string): BuildTurnSummaryResult => ({
  ok: false,
  refused: reason,
  advisoryOnly: true,
  grantsAuthority: false,
});

/** Cap mirrors the distiller's MAX_SUMMARY and recall's supportQuote budget (280 chars). */
const RECENT_TURN_MAX = 280;

/** Compose the recent-turn digest from the ADMITTED atoms only (they already passed the distiller's
 *  forbidden-content law AND the CAPTURE_EXTRA_SECRET_RE drop-net — this function adds no new
 *  content, only role labels and a joiner). Empty string when neither speech act yielded an
 *  admissible atom, in which case no digest travels. Pure and exported for tests. */
export function buildRecentTurnText(atoms: DistilledAtom[]): string {
  const owner = atoms.find((a) => a.role === 'owner')?.text ?? '';
  const auma = atoms.find((a) => a.role === 'auma')?.text ?? '';
  const joined = [owner ? `owner: ${owner}` : '', auma ? `auma: ${auma}` : ''].filter(Boolean).join(' · ');
  if (joined.length <= RECENT_TURN_MAX) return joined;
  return joined.slice(0, RECENT_TURN_MAX - 2).trimEnd() + ' …';
}

/**
 * Distill the two speech acts of one completed turn into a bounded turn-summary-v1 value.
 * Zero admissible atoms is a REFUSAL (write nothing), not an empty write. Never throws.
 */
export function buildTurnSummaryValue(input: TurnSummaryInput): BuildTurnSummaryResult {
  if (!input || typeof input !== 'object') return refuseBuild('capture_input_invalid');
  const { ownerText, replyText, model, at } = input;
  if (typeof ownerText !== 'string' || typeof replyText !== 'string') return refuseBuild('capture_input_invalid');
  if (typeof at !== 'string' || at.length === 0) return refuseBuild('capture_at_invalid');
  if (typeof model !== 'string') return refuseBuild('capture_input_invalid');

  // The distiller is the ONLY road content may travel: capped summaries, hedge preservation,
  // forbidden-content refusal per atom (law 3 — a secret-shaped candidate is dropped, not kept).
  const distilled = distillConversation(
    [
      { role: 'owner', text: ownerText, at },
      { role: 'auma', text: replyText, at },
    ],
    { maxAtoms: 4 },
  );
  if (!distilled.ok) return refuseBuild(`capture_distill_refused:${distilled.reason}`);
  // extra secret net (see CAPTURE_EXTRA_SECRET_RE): drop, never sanitize-and-keep.
  const atoms = distilled.atoms.filter((a) => !CAPTURE_EXTRA_SECRET_RE.test(a.text));
  if (atoms.length === 0) return refuseBuild('capture_zero_atoms');

  // Dedicated recent-turn digest (additive; see RecentTurnAtom). Same single governed write —
  // this rides inside the existing turn-summary value; NO new mutation is introduced.
  const recentTurnText = buildRecentTurnText(atoms);
  // Door tag: include ONLY a valid slug; anything else is dropped (capture never fails over a tag,
  // and an absent tag reads honestly as door-unknown downstream).
  const origin = typeof input.origin === 'string' && ORIGIN_SLUG_RE.test(input.origin) ? input.origin : undefined;
  const value: TurnSummaryValue = {
    schema: TURN_SUMMARY_SCHEMA,
    at,
    model: model.slice(0, MAX_MODEL_CHARS),
    ...(origin ? { origin } : {}),
    atoms,
    ...(recentTurnText.length > 0
      ? { recentTurn: { text: recentTurnText, at, advisoryOnly: true as const, grantsAuthority: false as const } }
      : {}),
    advisoryOnly: true,
    grantsAuthority: false,
  };
  let bytes: string;
  try {
    bytes = JSON.stringify(value);
  } catch {
    return refuseBuild('capture_value_unserializable');
  }
  if (bytes.length > MAX_TURN_SUMMARY_CHARS) return refuseBuild('capture_value_too_large');
  return { ok: true, value };
}

/** Attach the core receipt stamp to an already-built value, WITHOUT ever failing the capture:
 *  the stamped value must still honor MAX_TURN_SUMMARY_CHARS; on overflow (or an unserializable
 *  stamp) the ORIGINAL value travels unstamped — identification metadata never costs a memory.
 *  Pure; exported for tests. */
export function withCoreStamp(value: TurnSummaryValue, stamp: CoreReceiptStampV1 | null): TurnSummaryValue {
  if (!stamp) return value;
  const stamped: TurnSummaryValue = { ...value, core: stamp };
  try {
    if (JSON.stringify(stamped).length > MAX_TURN_SUMMARY_CHARS) return value;
  } catch {
    return value;
  }
  return stamped;
}

/** Key shape: `turn.<compact-utc-timestamp>.<useSeq>` — lowercase, MEM_KEY_RE-safe, unique per
 *  write (useSeq is strictly monotonic per manifest; duplicate keys are additionally harmless at
 *  the kernel: it inserts, and recall serves the oldest row). Exported for tests. */
export function makeTurnKey(atIso: string, useSeq: number): string {
  const ts = atIso.toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 40);
  const seq = Number.isInteger(useSeq) && useSeq >= 0 ? String(useSeq) : 'x';
  return `turn.${ts}.${seq}`;
}

/** One consumable use of the capture manifest, handed out by the ceremony adapter. The subject
 *  seed stays inside `signConsume`'s closure — key material never crosses this boundary. */
export interface CaptureUseLease {
  manifestId: string;
  subjectId: string;
  /** Must equal the kernel manifest's CURRENT usedCount — strictly monotonic; the caller
   *  serializes captures so two turns can never race one seq. */
  useSeq: number;
  /** Sign the kernel's consumeHead(req) under the aumlokSubjectPop domain. */
  signConsume: (req: Record<string, unknown>) => Promise<string>;
  /** Called exactly once iff the kernel accepted the write (advance the local seq). */
  onSuccess?: () => void;
}

export interface CaptureTurnDeps {
  ownerRootId: string;
  deploymentUrl: string;
  invoke: MemoryAppendDeps['invoke'];
  /** Provide the next manifest use (ceremony adapter). May throw / reject — that is a refusal. */
  nextUse: () => Promise<CaptureUseLease>;
  /** Injectable clock (kernel freshness window is ±60s on req.timestamp). */
  now?: () => number;
}

export type CaptureTurnResult = MemoryAppendResult;

const refuseCapture = (reason: string): CaptureTurnResult => ({
  ok: false,
  advisoryOnly: true,
  grantsAuthority: false,
  refused: reason,
  transportInvoked: false,
});

/**
 * Capture one completed turn: distill → lease a manifest use → build the governed request →
 * memoryAppend. Returns memoryAppend's envelope verbatim (success or kernel refusal) or a typed
 * pre-transport refusal. NEVER throws — the door calls this fire-and-forget.
 */
export async function captureTurn(input: TurnSummaryInput, deps: CaptureTurnDeps): Promise<CaptureTurnResult> {
  try {
    const built = buildTurnSummaryValue(input);
    if (!built.ok) return refuseCapture(built.refused);

    // ONE CORE MEMORY (#45/#244): stamp WHICH core instance + namespace this write intends, plus
    // the door's thread/commit when provided. Built here because only captureTurn knows the
    // deployment; a null stamp (malformed inputs, oversize) means the value travels unstamped —
    // the capture itself never fails over identification metadata.
    const value = withCoreStamp(
      built.value,
      buildCoreReceiptStamp({
        deploymentUrl: deps.deploymentUrl,
        ownerRootId: deps.ownerRootId,
        provenance: 'distilled-turn',
        at: input.at,
        ...(input.thread !== undefined ? { thread: input.thread } : {}),
        ...(input.sourceCommit !== undefined ? { sourceCommit: input.sourceCommit } : {}),
      }),
    );

    let lease: CaptureUseLease;
    try {
      lease = await deps.nextUse();
    } catch (e) {
      return refuseCapture(`capture_lease_refused:${e instanceof Error ? e.message : String(e)}`);
    }

    const key = makeTurnKey(input.at, lease.useSeq);
    if (!MEM_KEY_RE.test(key)) return refuseCapture('capture_key_invalid');

    const req = {
      action: 'memory.write' as const,
      ring: 'local-write' as const,
      key,
      ownerRootId: deps.ownerRootId,
      resource: `mem:${deps.ownerRootId}`,
      // manifest extras memoryAppend passes through for the KERNEL to verify:
      v: 1,
      manifestId: lease.manifestId,
      subjectId: lease.subjectId,
      intentCodec: 'json_action_v1',
      useSeq: lease.useSeq,
      timestamp: (deps.now ?? Date.now)(),
    };

    let subjectSig: string;
    try {
      subjectSig = await lease.signConsume(req);
    } catch (e) {
      return refuseCapture(`capture_sign_failed:${e instanceof Error ? e.message : String(e)}`);
    }

    const result = await memoryAppend(
      { req, subjectSig, value },
      { deploymentUrl: deps.deploymentUrl, invoke: deps.invoke },
    );
    if (result.ok) {
      try { lease.onSuccess?.(); } catch { /* seq bookkeeping must never turn a success into a throw */ }
    }
    return result;
  } catch (e) {
    // belt-and-braces: no path above should throw, but the fire-and-forget contract is absolute.
    return refuseCapture(`capture_unexpected:${e instanceof Error ? e.message : String(e)}`);
  }
}

/** A capture result NEVER grants authority — the mechanical guarantee mirrored across governed surfaces. */
export function captureGrantsAuthority(_r?: CaptureTurnResult): false {
  return false;
}
