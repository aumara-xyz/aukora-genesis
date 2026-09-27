// φ — the memory ledger. NEW glue code, not a port: wires the ported event log, vault and certificate
// (`eventLog.ts`, `vault.ts`, `fileVaultAdapter.ts`, `erasureCertificate.ts`) to a durable JSONL file
// under `.aukora/memory/`, mirroring the pattern `surface/conversation.ts` already uses for the plain
// conversation store. See `docs/MEMORY-PORT.md`.
//
// ══ WHAT THIS ADDS OVER conversation.ts ══
//
// `conversation.jsonl` is plaintext, append-only, and has no way to forget a line without editing the
// file by hand. This ledger seals each turn under its own AES-256-GCM key, and forgetting a turn is
// real key destruction with a checkable certificate — not a line removed from a file that anyone
// editing it could equally have added.
//
// ══ HOW EACH WRITE IS MADE DURABLE, AND WHAT THAT DOES NOT COVER ══
//
// The log is small (one φ conversation's worth of turns), so every write here rewrites the WHOLE log
// file atomically via `durableWrite.ts`'s `publishFileDurably` rather than appending — simpler than an
// append-with-recovery scheme, and it reuses the exact primitive that already defends against the
// short-write bug named in that file's header.
//
// What it does NOT cover: concurrent writers. `writeChain` below serialises calls WITHIN one running
// process (a plain promise queue — not a filesystem lock), which is enough for one φ door handling
// requests one at a time. It is NOT the donor's cross-process `LOCK` file — that machinery is explicitly
// not ported (see `docs/MEMORY-PORT.md`). Two φ processes pointed at the same `.aukora/memory/` WILL
// race each other. That is a named, honest gap, not a silent one.

import { existsSync, mkdirSync, readFileSync } from 'fs';
import { randomBytes } from 'crypto';
import { join, dirname } from 'path';

import {
  openLog, appendEvent, verifyChain, isKnownAndLive, tombstoneClosure,
  type CommittedEvent, type MemoryDraft,
} from './eventLog';
import { openVault, shred, releaseKey, type VaultState } from './vault';
import { openFileVaultDirs, sealBytes, openBytes, type FileVaultDirs } from './fileVaultAdapter';
import { issueErasureCertificate, type ErasureCertificate } from './erasureCertificate';
import { publishFileDurably } from './durableWrite';
import { liveRecords, liveDigest, type LiveRecord } from './projection';

/**
 * The repository root, read LIVE on every call — the same seam `surface/conversation.ts` uses, for the
 * same reason: a test must be able to point this at a scratch tree via `AUKORA_FORGE_REPO` without
 * tearing down the module cache.
 *
 * `core/memory/ledger.ts` sits TWO directories under the root (`core/memory/`), so it climbs twice —
 * matching `core/forge/review.ts`, not `surface/conversation.ts`'s one hop. `conversation.ts`'s own
 * header names the defect that comes from getting this number wrong. The fix there was a TEST that
 * resolves the default root with `AUKORA_FORGE_REPO` unset and asserts the result carries
 * `aukora.law.json` (`test/conversation.test.ts`). No such case exists here, and `repoRoot()` below
 * performs no check at all — it returns the two-hop join unconditionally. The hop count is correct;
 * "the same check is repeated here" was not.
 */
function repoRoot(): string {
  const bunDir = (import.meta as unknown as { dir?: string }).dir;
  const fromEnv = process.env.AUKORA_FORGE_REPO;
  if (fromEnv) return fromEnv;
  const here = bunDir ?? dirname(new URL(import.meta.url).pathname);
  return join(here, '..', '..');
}

const MEMORY_DIR = (): string => join(repoRoot(), '.aukora', 'memory');
const LOG_PATH = (): string => join(MEMORY_DIR(), 'log.jsonl');

const nonce = (): string => randomBytes(32).toString('hex');
const now = (): string => new Date().toISOString();

/** In-process serialisation only — see the module header on what this does and does not defend. */
let writeChain: Promise<unknown> = Promise.resolve();
function serialize<T>(fn: () => T): Promise<T> {
  const run = writeChain.then(fn, fn);
  writeChain = run.then(() => undefined, () => undefined);
  return run;
}

/** Read the log, dropping anything malformed rather than trusting it — the `conversation.ts` rule. */
function loadEvents(): CommittedEvent[] {
  if (!existsSync(LOG_PATH())) return [];
  const raw = readFileSync(LOG_PATH(), 'utf8');
  const out: CommittedEvent[] = [];
  for (const line of raw.split('\n')) {
    const t = line.trim();
    if (!t) continue;
    try { out.push(JSON.parse(t) as CommittedEvent); } catch { /* drop a broken line; keep the rest */ }
  }
  return out;
}

/** Rewrite the whole log atomically. See the module header: this is a rewrite, not an append. */
function persistEvents(events: readonly CommittedEvent[]): void {
  mkdirSync(MEMORY_DIR(), { recursive: true, mode: 0o700 });
  const text = events.map((e) => JSON.stringify(e)).join('\n') + (events.length ? '\n' : '');
  const tmp = join(MEMORY_DIR(), `.log.${process.pid}.${randomBytes(6).toString('hex')}.tmp`);
  publishFileDurably(tmp, LOG_PATH(), Buffer.from(text, 'utf8'), 0o600);
}

function ensureOpen(events: CommittedEvent[]): CommittedEvent[] {
  if (events.length > 0) return events;
  const logId = `phi-memory-${randomBytes(8).toString('hex')}`;
  return [openLog({ logId, at: now(), leafNonce: nonce() })];
}

function dirsAndVault(): { dirs: FileVaultDirs; vault: VaultState } {
  const dirs = openFileVaultDirs(MEMORY_DIR());
  return { dirs, vault: openVault(dirs.custodian, dirs.store) };
}

export interface RememberedTurn {
  readonly occurrenceId: string;
  readonly at: string;
}

/**
 * Seal one conversation turn into the ledger. Best effort — a failure here must never fail the caller,
 * matching `conversation.ts`'s own rule that a missing memory is worse only if the caller claims it was
 * written.
 */
export async function rememberTurn(input: {
  role: 'user' | 'assistant';
  content: string;
  engine?: string;
}): Promise<RememberedTurn | null> {
  try {
    return await serialize(() => {
      const { dirs } = dirsAndVault();
      let events = ensureOpen(loadEvents());
      const at = now();
      const plaintext = Buffer.from(JSON.stringify({
        role: input.role, content: input.content, engine: input.engine ?? null, at,
      }), 'utf8');
      const content = sealBytes(dirs, plaintext);
      const committed = appendEvent(events, {
        kind: 'insert', content, consentScope: 'conversation-turn', at,
      } as MemoryDraft, nonce());
      events = [...events, committed];
      persistEvents(events);
      const occurrenceId = (committed.event as { occurrenceId: string }).occurrenceId;
      return { occurrenceId, at };
    });
  } catch {
    return null;
  }
}

/**
 * Forget one memory and everything superseding it, and prove it. Returns `null` if `occurrenceId` is
 * not known or is already forgotten — that is a normal, honest answer, not an error.
 */
export async function forgetOccurrence(occurrenceId: string): Promise<ErasureCertificate | null> {
  return serialize(() => {
    const before = ensureOpen(loadEvents());
    if (!isKnownAndLive(before, occurrenceId)) return null;

    const targetIndex = before.findIndex((c) => {
      const e = c.event;
      return (e.kind === 'insert' || e.kind === 'correct') && e.occurrenceId === occurrenceId;
    });
    if (targetIndex === -1) return null;

    const closure = tombstoneClosure(before, occurrenceId);
    const tombstone = appendEvent(before, {
      kind: 'tombstone', target: occurrenceId, erased: closure, at: now(),
    } as MemoryDraft, nonce());
    const after = [...before, tombstone];

    // Persist the tombstone BEFORE touching custody — `vault.ts`'s `shred` refuses without it, and this
    // ordering is what makes that refusal load-bearing rather than decorative.
    persistEvents(after);

    const { vault } = dirsAndVault();
    const report = shred(vault, after, occurrenceId);
    const tombstoneIndex = after.length - 1;
    return issueErasureCertificate({ before, after, targetIndex, tombstoneIndex, report, vault, at: now() });
  });
}

/** Recover a turn's plaintext. Throws `VaultRefusal` if it is forgotten, absent, or the key is gone. */
export async function recallTurn(occurrenceId: string): Promise<{
  role: 'user' | 'assistant'; content: string; engine: string | null; at: string;
} | null> {
  return serialize(() => {
    const events = loadEvents();
    if (events.length === 0) return null;
    const known = events.find((c) => {
      const e = c.event;
      return (e.kind === 'insert' || e.kind === 'correct') && e.occurrenceId === occurrenceId;
    });
    if (known === undefined) return null;
    const { dirs, vault } = dirsAndVault();
    const key = releaseKey(vault, events, occurrenceId);
    const ref = (known.event as { content: { ciphertextDigest: string; keyRef: string; byteLength: number } }).content;
    const plaintext = openBytes(dirs, ref, key);
    return JSON.parse(Buffer.from(plaintext).toString('utf8'));
  });
}

/**
 * WHAT THE LEDGER STILL ASSERTS, and a digest over it.
 *
 * `verifyLedger` below answers a different question — is the event chain intact — and appending a
 * tombstone changes that chain's head whether the tombstone erased anything or not. So it cannot be
 * used to prove a forget: it would go green on an append that did nothing.
 *
 * This is the recomputation. Replay the log, report what survives, hash that. A forget moves it
 * because the SET IS SMALLER, and nothing was deleted from the log to make that true.
 */
export function liveLedgerRecords(): LiveRecord[] {
  return liveRecords(loadEvents());
}

export function liveLedgerDigest(): string {
  return liveDigest(loadEvents());
}

/** Verify the ledger's own hash chain end to end. */
export function verifyLedger(): { ok: true } | { ok: false; brokenAt: number; reasonClass: string } {
  return verifyChain(loadEvents());
}

/** The store path. Exported so the suites can read the real log location and assert against it rather
 *  than assume it — `test/memory-ledger.test.ts` compares this against a hand-built path, which is a
 *  different use from `conversation.ts`'s namesake (that one exists for the single test that must see
 *  the DEFAULT root rather than the override). */
export function storePathForTest(): string {
  return LOG_PATH();
}
