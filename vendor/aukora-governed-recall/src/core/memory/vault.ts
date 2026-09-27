// φ — the seal-and-destroy vault. Ported and reduced from `@aukora/kira`'s `src/vault.ts` (aukora-one,
// `organs/kira`). See `docs/MEMORY-PORT.md` and `PROVENANCE.md`.
//
// ══ WHAT CRYPTO-SHREDDING MEANS ══
//
// Each memory is sealed under its own AES-256-GCM key (real crypto lives in `fileVaultAdapter.ts`; this
// file is the pure contract). Forgetting a memory destroys that key. The ciphertext may survive — in a
// backup, a snapshot, a worn flash cell — and stays unreadable, because the key it needs no longer
// exists anywhere this vault can reach.
//
// HONEST LIMITS, stated because this is exactly where such a claim overreaches:
//   · a key copied out before the shred is beyond any guarantee this module can make;
//   · the custodian is where erasure actually happens — one that keeps a copy defeats everything below;
//   · this proves deletion FROM THIS VAULT, and says nothing about a screenshot, a log line elsewhere,
//     or a model that already read the plaintext.
//
// ══ WHAT WAS LEFT OUT ══
//
// The donor gates every read behind a LOGGED LEASE, because its `derive` events let a producer register
// an artifact's lineage as anything it liked — so reading is forced through the ledger to make an
// unregistered derivative unreadable by construction. This reduction has no `derive`, no artifact
// taxonomy and no lineage to protect, so there is nothing for a lease to gate: `releaseKey` here checks
// only that the memory is known and not forgotten. If a derivative-producing feature is ever added to
// this ledger, the lease mechanism must come back with it — this file does not silently reintroduce the
// donor's own fixed bug by omission, because it never re-creates the condition (unregistered lineage)
// that bug depended on.
//
// ══ ORDERING: GOVERN BEFORE EXECUTE ══
//
// `shred` REQUIRES an already-accepted tombstone naming its target. Destroying a key first and
// recording the tombstone second would let a caller destroy a key and then have the record refused —
// keys gone with no accepted record explaining why. The ledger is the authority over the irreversible
// act, and the only ordering that survives a caller who stops halfway.

import { tombstoneClosure, type CommittedEvent, type ContentRef } from './eventLog';

export const VAULT_SCHEMA = 'aukora-phi-memory-vault-v1' as const;

const HEX64 = /^[0-9a-f]{64}$/;

export type VaultReason =
  | 'vault:target-unknown'
  | 'vault:target-forgotten'
  | 'vault:content-shredded'
  | 'vault:content-absent'
  | 'vault:custodian-refused'
  | 'vault:shred-unrecorded'
  | 'vault:custody-unreadable';

export class VaultRefusal extends Error {
  readonly reasonClass: VaultReason;
  constructor(reasonClass: VaultReason) {
    // Content-free: the constructor cannot receive a value, so it cannot echo one.
    super(`memory vault refused: ${reasonClass}`);
    this.name = 'VaultRefusal';
    this.reasonClass = reasonClass;
  }
}

/**
 * The custody port — where real erasure happens. Minimal on purpose: `destroy` is the whole security
 * story, and a custodian that merely forgets its own reference rather than destroying key material has
 * silently broken the guarantee. No code above this interface can detect that; the adapter that
 * implements it against a real filesystem is the one that needs auditing (`fileVaultAdapter.ts`).
 */
export interface KeyCustodian {
  readonly kind: string;
  /** Does a key still exist for this handle? MAY throw `VaultRefusal('vault:custody-unreadable')` when
   *  custody cannot be determined at all — an indeterminate answer must never read as "absent". */
  has(keyRef: string): boolean;
  /** Release the key. The only egress for private material. */
  release(keyRef: string): Uint8Array | null;
  /** Destroy it. After this, the ciphertext addressed by it is undecryptable. */
  destroy(keyRef: string): boolean;
}

/** Sealed bytes, addressed by their own digest. The vault never sees plaintext. */
export interface SealedObject {
  readonly ciphertextDigest: string;
  readonly keyRef: string;
  readonly byteLength: number;
}

export interface ObjectStore {
  has(ciphertextDigest: string): boolean;
  get(ciphertextDigest: string): SealedObject | null;
  put(object: SealedObject): void;
  /** Remove the ciphertext too, where the medium allows it. Best effort by nature. */
  drop(ciphertextDigest: string): boolean;
}

export interface VaultState {
  readonly custodian: KeyCustodian;
  readonly store: ObjectStore;
}

export function openVault(custodian: KeyCustodian, store: ObjectStore): VaultState {
  return { custodian, store };
}

function requireHex(v: unknown, code: VaultReason): asserts v is string {
  if (typeof v !== 'string' || !HEX64.test(v)) throw new VaultRefusal(code);
}

function ledgerView(events: readonly CommittedEvent[]): { known: Map<string, ContentRef>; forgotten: Set<string> } {
  const known = new Map<string, ContentRef>();
  const forgotten = new Set<string>();
  for (const c of events) {
    const e = c.event;
    if (e.kind === 'insert' || e.kind === 'correct') known.set(e.occurrenceId, e.content);
    else if (e.kind === 'tombstone') {
      forgotten.add(e.target);
      for (const id of e.erased) forgotten.add(id);
    }
  }
  return { known, forgotten };
}

/** Release the key for one memory's content, if it is known, live, and its ciphertext is on file. */
export function releaseKey(vault: VaultState, events: readonly CommittedEvent[], memoryId: string): Uint8Array {
  const { known, forgotten } = ledgerView(events);
  const ref = known.get(memoryId);
  if (ref === undefined) throw new VaultRefusal('vault:target-unknown');
  if (forgotten.has(memoryId)) throw new VaultRefusal('vault:target-forgotten');
  if (!vault.store.has(ref.ciphertextDigest)) throw new VaultRefusal('vault:content-absent');
  if (!vault.custodian.has(ref.keyRef)) throw new VaultRefusal('vault:content-shredded');
  const key = vault.custodian.release(ref.keyRef);
  if (key === null) throw new VaultRefusal('vault:custodian-refused');
  return key;
}

export interface ShredReport {
  readonly target: string;
  readonly shredded: readonly string[];
  readonly alreadyGone: readonly string[];
  /** Ids whose custodian REFUSED to destroy the key. Distinct from `alreadyGone` — "it was already
   *  deleted" and "deletion failed" are opposite facts, and folding them together lets a failure read
   *  as a success. */
  readonly destroyFailed: readonly string[];
  readonly ciphertextRetained: readonly string[];
  /** False if ANY key survived a destroy attempt. The one field to check. */
  readonly complete: boolean;
  readonly advisoryOnly: true;
  readonly grantsAuthority: false;
}

/**
 * Destroy the keys for `target` and everything its closure covers. Requires an already-accepted
 * tombstone naming `target` — see the module header on ordering.
 */
export function shred(vault: VaultState, events: readonly CommittedEvent[], target: string): ShredReport {
  requireHex(target, 'vault:target-unknown');
  const { known } = ledgerView(events);
  if (!known.has(target)) throw new VaultRefusal('vault:target-unknown');

  const recorded = events.some((c) => c.event.kind === 'tombstone' && c.event.target === target);
  if (!recorded) throw new VaultRefusal('vault:shred-unrecorded');

  const ids = [target, ...tombstoneClosure(events, target)];
  const shredded: string[] = [];
  const alreadyGone: string[] = [];
  const destroyFailed: string[] = [];
  const ciphertextRetained: string[] = [];

  for (const id of ids) {
    const ref = known.get(id);
    if (ref === undefined) continue;
    // An indeterminate custody answer is a failed destroy, not an absent one — see `KeyCustodian.has`.
    let present: boolean;
    try { present = vault.custodian.has(ref.keyRef); } catch { destroyFailed.push(id); continue; }
    if (!present) { alreadyGone.push(id); continue; }
    if (vault.custodian.destroy(ref.keyRef)) shredded.push(id); else destroyFailed.push(id);
    if (!vault.store.drop(ref.ciphertextDigest)) ciphertextRetained.push(ref.ciphertextDigest);
  }

  return Object.freeze({
    target,
    shredded: Object.freeze(shredded.sort()),
    alreadyGone: Object.freeze(alreadyGone.sort()),
    destroyFailed: Object.freeze(destroyFailed.sort()),
    complete: destroyFailed.length === 0,
    ciphertextRetained: Object.freeze([...new Set(ciphertextRetained)].sort()),
    advisoryOnly: true as const,
    grantsAuthority: false as const,
  });
}

/** Is this memory readable right now, for a retrieval layer deciding what to surface? */
export function isReadable(vault: VaultState, events: readonly CommittedEvent[], memoryId: string): boolean {
  const { known, forgotten } = ledgerView(events);
  const ref = known.get(memoryId);
  if (ref === undefined || forgotten.has(memoryId)) return false;
  if (!vault.store.has(ref.ciphertextDigest)) return false;
  try { return vault.custodian.has(ref.keyRef); } catch { return false; }
}

/**
 * Does key material for this memory still exist, regardless of what the LEDGER claims about it?
 *
 * Deliberately not `isReadable`: that answers a retrieval question and short-circuits on `forgotten`,
 * which would make a completeness audit structurally unable to report a failure (a tombstone puts the
 * whole closure into `forgotten` before this is ever asked). This asks custody directly, and is what
 * `erasureCertificate.ts`'s `residualKeys` uses.
 */
export function keyMaterialSurvives(vault: VaultState, events: readonly CommittedEvent[], memoryId: string): boolean {
  const { known } = ledgerView(events);
  const ref = known.get(memoryId);
  if (ref === undefined) return false;
  // Deliberately NOT caught — an audit that cannot reach custody must fail loudly, not return the
  // flattering answer. The opposite choice from `isReadable`: that decides what to show, this decides
  // what to certify.
  return vault.custodian.has(ref.keyRef);
}

/** HARD: holding a key is not permission. Constant, by construction. */
export function vaultGrantsAuthority(): false {
  return false;
}

/** An in-memory custodian and store, for tests only. Never for real custody. */
export function ephemeralCustodian(): KeyCustodian & { readonly issued: Map<string, Uint8Array> } {
  const issued = new Map<string, Uint8Array>();
  return {
    kind: 'ephemeral-memory',
    issued,
    has: (r) => issued.has(r),
    release: (r) => issued.get(r) ?? null,
    destroy: (r) => issued.delete(r),
  };
}

export function ephemeralStore(): ObjectStore & { readonly objects: Map<string, SealedObject> } {
  const objects = new Map<string, SealedObject>();
  return {
    objects,
    has: (d) => objects.has(d),
    get: (d) => objects.get(d) ?? null,
    put: (o) => { objects.set(o.ciphertextDigest, o); },
    drop: (d) => objects.delete(d),
  };
}
