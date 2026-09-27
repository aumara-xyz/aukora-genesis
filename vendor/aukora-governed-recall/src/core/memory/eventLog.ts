// φ — the memory event log. Ported, deliberately reduced, from `@aukora/kira`'s `src/eventLog.ts`
// (aukora-one, `organs/kira`). See `docs/MEMORY-PORT.md` and `PROVENANCE.md` for the exact lineage and
// for what was left out and why.
//
// ══ WHAT THIS IS ══
//
// An append-only, hash-chained log of four event kinds: GENESIS opens it, INSERT adds a memory,
// CORRECT revises one (superseding it without erasing the record that it existed), and TOMBSTONE
// forgets one — plus everything that revised it. The log never holds plaintext; every content-bearing
// event carries a `ContentRef` — a digest, a vault key handle, a length — never the words themselves.
//
// ══ THE RULE THIS FILE INHERITS FROM ITS DONOR ══
//
// NEVER ACCEPT A VALUE YOU SHOULD OWN. A caller cannot supply an `occurrenceId`: `appendEvent` mints
// every identifier itself, from the log's own state, so an id minted for one position can never be
// replayed at another. The `*Draft` types below have no id fields at all — the donor's own history is
// six separate defects that all had this same shape, so the fix is structural rather than a check.
//
// ══ WHAT WAS LEFT OUT, ON PURPOSE ══
//
// The donor's `derive`, `lease`, `reinsert` and `checkpoint` event kinds, its per-device identity
// (`deviceId`/`deviceSeq`), its anchor machinery (`sequentialWork`/beacon/publication), and its
// `codeRoot` attestation are ALL absent. That is the lease/derivative-lineage system the task asked to
// leave out, plus multi-device merge machinery this single-writer door has no use for. `correct` is
// kept — a plain revision, no lease, no artifact taxonomy — because without it `tombstoneClosure` below
// has nothing to close over and becomes a one-line stub instead of a real, testable feature.
//
// ══ WHAT THIS IS NOT ══
//
// Advisory only. `grantsAuthority` is `false` on every committed value, literally, not merely by
// convention — matching AUKORA ONE's Ring-3 rule that memory never authorizes. Nothing here reaches
// `core/authority/` and nothing here should ever be asked to.

import { domainHash } from './hash';
import { leafHash, rootFromLeafHashes } from './merkle';

export const MEMORY_LOG_SCHEMA = 'aukora-phi-memory-log-v1' as const;

/** Domain separation tags — one per hash ROLE, so no value crafted for one role collides as another. */
export const DOMAIN = Object.freeze({
  occurrence: 'aukora.phi.memory.occurrence.v1',
  event: 'aukora.phi.memory.event.v1',
  head: 'aukora.phi.memory.head.v1',
});

const HEX64 = /^[0-9a-f]{64}$/;
const IDENT = /^[a-z0-9][a-z0-9._:-]{0,127}$/;
const ISO_UTC_MS = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;

export class MemoryLogError extends Error {
  readonly reasonClass: string;
  constructor(reasonClass: string) {
    // Content-free by construction: the constructor takes one slug and nothing else, so a refusal
    // raised while handling a memory cannot echo the memory into an error message or a log line.
    super(`memory log refused: ${reasonClass}`);
    this.name = 'MemoryLogError';
    this.reasonClass = reasonClass;
  }
}

function requireHex(value: unknown, code: string): asserts value is string {
  if (typeof value !== 'string' || !HEX64.test(value)) throw new MemoryLogError(code);
}
function requireIdent(value: unknown, code: string): asserts value is string {
  if (typeof value !== 'string' || !IDENT.test(value)) throw new MemoryLogError(code);
}
function requireIso(value: unknown, code: string): asserts value is string {
  if (typeof value !== 'string' || !ISO_UTC_MS.test(value)) throw new MemoryLogError(code);
}

/**
 * 32-byte-wide per-event salt, hex. Presence and width are enforced here; ENTROPY cannot be — this
 * module is pure (no randomness), so the salt always arrives from a caller. See the donor's own long
 * note on why an unsalted content-free leaf is enumerable; the adapter that calls into this log is
 * responsible for supplying `randomBytes(32)` (`core/memory/ledger.ts`'s `nonce()`). This module can
// only enforce presence and width, and that much is pinned by `test/memory-eventlog.test.ts`; the
// adapter's entropy SOURCE is pinned by nothing, which is a gap rather than a guarantee.
 */
function requireLeafNonce(v: unknown): asserts v is string {
  if (typeof v !== 'string' || !HEX64.test(v)) throw new MemoryLogError('leaf-nonce-invalid');
}

/** A pointer to encrypted content. The log never holds plaintext. */
export interface ContentRef {
  readonly ciphertextDigest: string;
  readonly keyRef: string;
  readonly byteLength: number;
}

function validateContentRef(ref: unknown): asserts ref is ContentRef {
  if (ref === null || typeof ref !== 'object') throw new MemoryLogError('content-ref-malformed');
  const r = ref as Record<string, unknown>;
  requireHex(r.ciphertextDigest, 'content-digest-invalid');
  requireIdent(r.keyRef, 'content-key-ref-invalid');
  if (!Number.isSafeInteger(r.byteLength) || (r.byteLength as number) < 0) {
    throw new MemoryLogError('content-length-invalid');
  }
}

// ══ EVENTS ══ — drafts carry no identifier the log is responsible for minting.

export interface GenesisEvent {
  readonly leafNonce: string;
  readonly kind: 'genesis';
  readonly schema: typeof MEMORY_LOG_SCHEMA;
  readonly logId: string;
  readonly at: string;
}
export interface InsertEvent {
  readonly leafNonce: string;
  readonly kind: 'insert';
  readonly occurrenceId: string;
  readonly content: ContentRef;
  readonly consentScope: string;
  readonly at: string;
}
export interface CorrectEvent {
  readonly leafNonce: string;
  readonly kind: 'correct';
  readonly occurrenceId: string;
  readonly supersedes: string;
  readonly content: ContentRef;
  readonly consentScope: string;
  readonly at: string;
}
export interface TombstoneEvent {
  readonly leafNonce: string;
  readonly kind: 'tombstone';
  readonly target: string;
  readonly erased: readonly string[];
  readonly at: string;
}

export type MemoryEvent = GenesisEvent | InsertEvent | CorrectEvent | TombstoneEvent;

export interface CommittedEvent {
  readonly seq: number;
  readonly event: MemoryEvent;
  readonly eventHash: string;
  readonly head: string;
  readonly advisoryOnly: true;
  readonly grantsAuthority: false;
}

export interface InsertDraft {
  readonly kind: 'insert';
  readonly content: ContentRef;
  readonly consentScope: string;
  readonly at: string;
}
export interface CorrectDraft {
  readonly kind: 'correct';
  readonly supersedes: string;
  readonly content: ContentRef;
  readonly consentScope: string;
  readonly at: string;
}
export interface TombstoneDraft {
  readonly kind: 'tombstone';
  readonly target: string;
  readonly erased: readonly string[];
  readonly at: string;
}

export type MemoryDraft = InsertDraft | CorrectDraft | TombstoneDraft;

// ══ IDENTITY — minted by the log, never accepted from a caller ══

function mintId(logId: string, seq: number, ciphertextDigest: string): string {
  return domainHash(DOMAIN.occurrence, { logId, seq, ciphertextDigest });
}

function hashEvent(event: MemoryEvent): string {
  return domainHash(DOMAIN.event, event);
}

export function nextHead(previousHead: string | null, eventHash: string): string {
  if (previousHead !== null) requireHex(previousHead, 'previous-head-invalid');
  requireHex(eventHash, 'event-hash-invalid');
  return domainHash(DOMAIN.head, { previousHead, eventHash });
}

/**
 * A custody handle may name exactly one memory, ever. Two genuinely different memories sharing one
 * `keyRef` would mean destroying one silently destroys the other's key — the donor's round-10 defect,
 * found by design review rather than by a failing test. Cheap to check here; expensive to discover live.
 */
function requireFreshKeyRef(view: LogView, ref: ContentRef): void {
  if (view.keyRefs.has(ref.keyRef)) throw new MemoryLogError('key-ref-reused');
}

interface LogView {
  readonly logId: string;
  /** Every id the log has minted, mapped to the content it currently points at. */
  readonly known: Map<string, string>;
  readonly forgotten: Set<string>;
  readonly keyRefs: Map<string, string>;
}

function viewOf(events: readonly CommittedEvent[]): LogView {
  const first = events[0];
  if (first === undefined || first.event.kind !== 'genesis') throw new MemoryLogError('log-not-opened');
  const { logId } = first.event;

  const known = new Map<string, string>();
  const forgotten = new Set<string>();
  const keyRefs = new Map<string, string>();

  for (const c of events) {
    const e = c.event;
    if (e.kind === 'insert' || e.kind === 'correct') {
      known.set(e.occurrenceId, e.content.ciphertextDigest);
      if (!keyRefs.has(e.content.keyRef)) keyRefs.set(e.content.keyRef, e.occurrenceId);
    } else if (e.kind === 'tombstone') {
      forgotten.add(e.target);
      for (const id of e.erased) forgotten.add(id);
    }
  }
  return { logId, known, forgotten, keyRefs };
}

/**
 * Everything that must be forgotten alongside `target`: every `correct` whose chain of `supersedes`
 * edges reaches it, to a fixed point. Forgetting the original without forgetting a correction of it
 * would leave the corrected content — which still carries the original forward — readable.
 */
export function tombstoneClosure(events: readonly CommittedEvent[], target: string): string[] {
  requireHex(target, 'target-invalid');
  const doomed = new Set<string>([target]);
  let grew = true;
  while (grew) {
    grew = false;
    for (const c of events) {
      const e = c.event;
      if (e.kind !== 'correct' || doomed.has(e.occurrenceId)) continue;
      if (doomed.has(e.supersedes)) { doomed.add(e.occurrenceId); grew = true; }
    }
  }
  doomed.delete(target);
  return [...doomed].sort();
}

/** Open a new log. The genesis event fixes the log's identity for all time. */
export function openLog(input: { logId: string; at: string; leafNonce: string }): CommittedEvent {
  requireIdent(input.logId, 'log-id-invalid');
  requireIso(input.at, 'event-time-invalid');
  requireLeafNonce(input.leafNonce);
  const event: GenesisEvent = {
    kind: 'genesis', leafNonce: input.leafNonce, schema: MEMORY_LOG_SCHEMA, logId: input.logId, at: input.at,
  };
  const eventHash = hashEvent(event);
  return Object.freeze({
    seq: 0, event, eventHash, head: nextHead(null, eventHash),
    advisoryOnly: true as const, grantsAuthority: false as const,
  });
}

/** Append a draft. The log mints every identifier and verifies every reference. */
export function appendEvent(
  events: readonly CommittedEvent[],
  draft: MemoryDraft,
  leafNonce: string,
): CommittedEvent {
  if (draft === null || typeof draft !== 'object') throw new MemoryLogError('draft-malformed');
  requireIso((draft as { at: unknown }).at, 'event-time-invalid');
  requireLeafNonce(leafNonce);

  const view = viewOf(events);
  const seq = events.length;
  const prev = events[seq - 1];
  if (prev === undefined) throw new MemoryLogError('log-not-opened');
  const previousHead = prev.head;

  const requireLive = (id: unknown, code: string): void => {
    requireHex(id, code);
    if (!view.known.has(id as string)) throw new MemoryLogError(`${code}-unknown`);
    if (view.forgotten.has(id as string)) throw new MemoryLogError(`${code}-forgotten`);
  };

  let event: MemoryEvent;

  switch (draft.kind) {
    case 'insert': {
      validateContentRef(draft.content);
      requireIdent(draft.consentScope, 'consent-scope-invalid');
      requireFreshKeyRef(view, draft.content);
      event = {
        kind: 'insert',
        leafNonce,
        occurrenceId: mintId(view.logId, seq, draft.content.ciphertextDigest),
        content: draft.content,
        consentScope: draft.consentScope,
        at: draft.at,
      };
      break;
    }
    case 'correct': {
      validateContentRef(draft.content);
      requireIdent(draft.consentScope, 'consent-scope-invalid');
      requireLive(draft.supersedes, 'supersedes');
      requireFreshKeyRef(view, draft.content);
      event = {
        kind: 'correct',
        leafNonce,
        occurrenceId: mintId(view.logId, seq, draft.content.ciphertextDigest),
        supersedes: draft.supersedes,
        content: draft.content,
        consentScope: draft.consentScope,
        at: draft.at,
      };
      break;
    }
    case 'tombstone': {
      requireHex(draft.target, 'target-invalid');
      if (!view.known.has(draft.target)) throw new MemoryLogError('tombstone-unknown-target');
      if (view.forgotten.has(draft.target)) throw new MemoryLogError('tombstone-already-forgotten');
      if (!Array.isArray(draft.erased)) throw new MemoryLogError('erased-set-malformed');
      for (const id of draft.erased) {
        requireHex(id, 'erased-entry-invalid');
        if (!view.known.has(id)) throw new MemoryLogError('tombstone-unknown-erasure');
      }
      const required = tombstoneClosure(events, draft.target);
      const claimed = new Set(draft.erased);
      if (required.some((id) => !claimed.has(id))) throw new MemoryLogError('tombstone-incomplete-closure');
      event = {
        kind: 'tombstone', leafNonce, target: draft.target, erased: [...draft.erased].sort(), at: draft.at,
      };
      break;
    }
    default:
      throw new MemoryLogError('draft-kind-unknown');
  }

  const eventHash = hashEvent(event);
  return Object.freeze({
    seq, event, eventHash, head: nextHead(previousHead, eventHash),
    advisoryOnly: true as const, grantsAuthority: false as const,
  });
}

/** Verify the head chain end to end. Returns the first break, or ok. */
export function verifyChain(
  events: readonly CommittedEvent[],
): { ok: true } | { ok: false; brokenAt: number; reasonClass: string } {
  let previousHead: string | null = null;
  for (let i = 0; i < events.length; i += 1) {
    const c = events[i];
    if (c === undefined) return { ok: false, brokenAt: i, reasonClass: 'missing-entry' };
    if (c.seq !== i) return { ok: false, brokenAt: i, reasonClass: 'sequence-mismatch' };
    if (i === 0 && c.event.kind !== 'genesis') return { ok: false, brokenAt: 0, reasonClass: 'missing-genesis' };
    if (i > 0 && c.event.kind === 'genesis') return { ok: false, brokenAt: i, reasonClass: 'duplicate-genesis' };
    if (hashEvent(c.event) !== c.eventHash) return { ok: false, brokenAt: i, reasonClass: 'event-hash-mismatch' };
    if (nextHead(previousHead, c.eventHash) !== c.head) return { ok: false, brokenAt: i, reasonClass: 'head-mismatch' };
    previousHead = c.head;
  }
  return { ok: true };
}

/**
 * The log's own Merkle root, over the hex-decoded chain heads — computed HERE, not accepted as an
 * argument. A caller-injected root-computation function is a caller-injected VALUE one level of
 * indirection away, and `erasureCertificate.ts`'s whole job is to witness this log honestly, so the
 * root it certifies must be the log's own arithmetic.
 */
export function computeMemoryLogRoot(events: readonly CommittedEvent[]): string {
  return rootFromLeafHashes(events.map((c) => leafHash(Buffer.from(c.head, 'hex')))).toString('hex');
}

/** Does this id currently resolve to something the log has not forgotten? */
export function isKnownAndLive(events: readonly CommittedEvent[], id: string): boolean {
  try {
    const view = viewOf(events);
    return view.known.has(id) && !view.forgotten.has(id);
  } catch { return false; }
}

/** HARD: a memory log grants nothing. Constant, by construction. */
export function memoryLogGrantsAuthority(): false {
  return false;
}
