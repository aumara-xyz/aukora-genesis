// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Aukora
/**
 * TrustedStateStore — the PROTECTED, crash-safe, single-writer persistence for the kernel's constitutional
 * trusted state (Diamond overnight, issue #21). It lives OUTSIDE Convex and OUTSIDE model-facing code.
 *
 * THE LOAD-BEARING GUARANTEE: consumed authorization IDs and the kernel receipt head survive REAL process death
 * and refuse rollback. The store composes the kernel's PURE `decide()` (the existing consume + head-advance
 * reducer — unchanged) with an atomic, journalled, fsync'd commit, so a decision is durable BEFORE any Git
 * effect. A crash before the commit leaves the PRIOR state (nothing consumed); a crash after it leaves the new
 * state (consumed exactly once) — never a torn in-between.
 *
 * NEVER stored here: proposal plaintext, private keys, signing material, model state, or Convex authority — the
 * persisted `TrustedStateV1` is the kernel's own content-free shape (roots, consumed ids, receipt head), plus a
 * content-free PREPARED effect descriptor (hashes + a path + a class).
 *
 * HONEST LIMIT (in scope tonight): rollback refusal compares the loaded state's `receiptHead.count` against a
 * retained high-water file. A single restore of the state file alone is refused. A CONSISTENT two-file rewrite
 * (state + high-water together) is the same completeness limit a plain hash chain has — closed only by an
 * external monotonic source (signed head / hardware root), which is explicitly OUT of tonight's scope.
 */
import { openSync, writeSync, fsyncSync, closeSync, renameSync, readFileSync, mkdirSync, rmSync, lstatSync, fstatSync, constants as FS } from 'node:fs';
import { join } from 'node:path';
import { decide as kernelDecide, assertTrustedState, type TrustedStateV1, type KernelRequestV1, type KernelResultV1 } from '@aukora/kernel';

export const STORE_SCHEMA_VERSION = 1 as const;

// No-follow / directory open flags. On platforms lacking them (Windows) they degrade to 0 — Windows symlink
// creation itself requires privilege, so the POSIX case is where the TOCTOU defense is load-bearing.
const O_NOFOLLOW = FS.O_NOFOLLOW ?? 0;
const O_DIRECTORY = FS.O_DIRECTORY ?? 0;

/** Content-free descriptor of the effect an authorization prepares. No bytes, no keys, no plaintext. */
export interface PreparedEffectV1 {
  readonly effectId: string;         // caller-supplied stable id (e.g. a 64-hex hash)
  readonly consumptionId: string;    // the authorization id consumed for this effect
  readonly descriptorKind: string;   // a class, e.g. 'git-candidate'
  readonly targetPath: string;
  readonly contentHash: string;      // hash of the intended bytes; the bytes live elsewhere
  readonly receiptCountAfter: number;
  readonly preparedAtMs: number;
}

/** The on-disk record: the kernel trusted state + the append-only prepared effects + the store schema tag. */
export interface PersistedTrustedRecordV1 {
  readonly storeSchema: typeof STORE_SCHEMA_VERSION;
  readonly state: TrustedStateV1;
  readonly prepared: readonly PreparedEffectV1[];
}

export class RollbackRefusedError extends Error {}
export class WriterLockedError extends Error {}
export class TrustedStoreCorruptError extends Error {}
/** The state dir/file resolved through a symlink or is not an owner-only real directory (path-swap / TOCTOU). */
export class TrustedStoreUnsafePathError extends Error {}

/** Crash-injection seam: called before each durable step with a label; a throw simulates power loss there. */
export type CrashHook = (label: 'journal-write' | 'journal-fsync' | 'rename' | 'dir-fsync' | 'highwater') => void;
const NO_CRASH: CrashHook = () => {};

export type AuthorizeOutcome =
  | { readonly ok: true; readonly decision: KernelResultV1['decision']; readonly prepared: PreparedEffectV1; readonly record: PersistedTrustedRecordV1 }
  | { readonly ok: false; readonly decision: KernelResultV1['decision'] };

export interface TrustedStoreOptions {
  /** Injected for tests; defaults to the real kernel `decide` (production path is byte-identical). */
  readonly decide?: typeof kernelDecide;
  readonly crashHook?: CrashHook;
}

const STATE_FILE = 'trusted-state.json';
const HIGHWATER_FILE = 'receipt-highwater.json';
const LOCK_FILE = 'writer.lock';
const TMP_FILE = 'trusted-state.tmp';

export class TrustedStateStore {
  private locked = false;
  private dirFd: number | null = null;
  private pinnedDev = -1;   // dev+ino of the state dir at open — every lifetime op re-verifies against these
  private pinnedIno = -1;
  private readonly decide: typeof kernelDecide;
  private readonly crash: CrashHook;

  constructor(private readonly dir: string, opts: TrustedStoreOptions = {}) {
    this.decide = opts.decide ?? kernelDecide;
    this.crash = opts.crashHook ?? NO_CRASH;
  }

  private p(name: string): string { return join(this.dir, name); }

  /** Read a file WITHOUT following a symlink in its final component (a swapped-in symlink is refused, ELOOP). */
  private readNoFollow(path: string): string {
    const fd = openSync(path, FS.O_RDONLY | O_NOFOLLOW);
    try { return readFileSync(fd, 'utf8'); } finally { closeSync(fd); }
  }

  /**
   * TOCTOU closure at the store-opening boundary (R54 v4). An earlier caller may canonicalize the path, but the
   * store re-resolves it here at USE time — so the invariant lives HERE, where the journal is actually opened:
   *  - the state dir is opened O_NOFOLLOW|O_DIRECTORY and the fd is HELD for the store's lifetime — a dir swapped
   *    to a symlink between any check and this open fails ELOOP (refused); the fd pins the inode, and the same fd
   *    is reused for the durable dir-fsync (never re-resolving `dir` by path during commit);
   *  - an OWNER-ONLY contract is verified via fstat on that fd (POSIX: owned by this uid, no group/other bits);
   *  - every journal file (lock, tmp, state, high-water) is opened O_NOFOLLOW, so a swapped file symlink is refused.
   * Threat assumption: the state dir and its ANCESTORS are owned by the operator and not writable by other users
   * (the standard safe-path contract). The store never creates or traverses attacker-mutable components: it
   * mkdirs only the final component NON-recursively (the parent must be pre-provisioned by the owner).
   */
  private openProtectedDir(): void {
    let st: ReturnType<typeof lstatSync> | null = null;
    try { st = lstatSync(this.dir); }
    catch (e) { if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw e; }
    if (st === null) {
      // create ONLY the final component (non-recursive) so we never create through a symlinked ancestor
      try { mkdirSync(this.dir, { mode: 0o700 }); }
      catch (e) { if ((e as NodeJS.ErrnoException).code !== 'EEXIST') throw e; }
    } else if (st.isSymbolicLink()) {
      throw new TrustedStoreUnsafePathError(`trusted-state dir is a symlink: ${this.dir}`);
    } else if (!st.isDirectory()) {
      throw new TrustedStoreUnsafePathError(`trusted-state path is not a directory: ${this.dir}`);
    }
    // The load-bearing gate: open the dir itself no-follow + as a directory, and HOLD the fd.
    let fd: number;
    try { fd = openSync(this.dir, FS.O_RDONLY | O_DIRECTORY | O_NOFOLLOW); }
    catch (e) {
      const c = (e as NodeJS.ErrnoException).code;
      if (c === 'ELOOP' || c === 'ENOTDIR') throw new TrustedStoreUnsafePathError(`trusted-state dir is a symlink or not a directory: ${this.dir}`);
      throw e;
    }
    const s = fstatSync(fd);
    if (process.platform !== 'win32') {
      const uid = typeof process.getuid === 'function' ? process.getuid() : null;
      if ((uid !== null && s.uid !== uid) || (s.mode & 0o077) !== 0) {
        closeSync(fd);
        throw new TrustedStoreUnsafePathError(`trusted-state dir is not owner-only (uid=${s.uid}, mode=${(s.mode & 0o777).toString(8)})`);
      }
    }
    this.pinnedDev = s.dev; this.pinnedIno = s.ino; // pin the inode; every later op re-verifies against it
    this.dirFd = fd;
  }

  /**
   * Re-verify, RIGHT BEFORE every path-based lifetime op, that `this.dir` still resolves to the SAME directory
   * inode pinned at open — closing the post-open replacement gap (rename the real dir aside, drop a symlink at the
   * old pathname). O_NOFOLLOW ⇒ a dir swapped to a symlink fails ELOOP; the dev+ino compare ⇒ a dir swapped to a
   * DIFFERENT real directory is refused. Every child open (lock/tmp/state/high-water) and the rename + cleanup are
   * guarded by this, so a swapped prefix can never redirect a write.
   *
   * HONEST RESIDUAL (narrowed truthfully): Node exposes no `openat`/`renameat`, so the re-verification and the
   * immediately-following op are SEPARATE syscalls, not one atomic step — a separate process could swap the
   * directory in the sub-syscall window between them. That residual is reachable ONLY by an actor able to rename
   * the dir, which the owner-only dir + ancestor-ownership contract denies to any OTHER user; the trusted operator
   * is out of scope. Between-operation replacement over a wider window (the reviewed gap) IS closed.
   */
  private assertDir(): void {
    let fd: number;
    try { fd = openSync(this.dir, FS.O_RDONLY | O_DIRECTORY | O_NOFOLLOW); }
    catch (e) {
      const c = (e as NodeJS.ErrnoException).code;
      if (c === 'ELOOP' || c === 'ENOTDIR' || c === 'ENOENT') throw new TrustedStoreUnsafePathError(`trusted-state dir replaced after open (${c})`);
      throw e;
    }
    try {
      const s = fstatSync(fd);
      if (s.dev !== this.pinnedDev || s.ino !== this.pinnedIno) throw new TrustedStoreUnsafePathError('trusted-state dir inode changed after open');
    } finally { closeSync(fd); }
  }

  /**
   * Acquire → read → RELEASE a protected read pin. Opens the state dir itself O_NOFOLLOW|O_DIRECTORY (a symlink
   * prefix fails ELOOP → refused, never followed), verifies it — inode-pin match when OPENED, owner-only when
   * standalone — then reads `fileName` no-follow through that verified dir, and always releases the transient fd.
   * Returns null when the dir OR the file does not exist (a fresh/empty store — not an error, and no `existsSync`
   * precheck: a direct O_NOFOLLOW open with ENOENT handling is the only race-free probe). Throws
   * TrustedStoreUnsafePathError on a symlink/replaced dir or a symlinked file. NOTE: the dir verify and the file
   * open are separate syscalls (no openat) — same sub-syscall residual documented on assertDir.
   */
  private protectedRead(fileName: string): string | null {
    let dfd: number;
    try { dfd = openSync(this.dir, FS.O_RDONLY | O_DIRECTORY | O_NOFOLLOW); }
    catch (e) {
      const c = (e as NodeJS.ErrnoException).code;
      if (c === 'ENOENT') return null; // no state dir yet ⇒ empty store
      if (c === 'ELOOP' || c === 'ENOTDIR') throw new TrustedStoreUnsafePathError(`trusted-state dir is a symlink or not a directory: ${this.dir}`);
      throw e;
    }
    try {
      const s = fstatSync(dfd);
      if (this.dirFd !== null) {
        if (s.dev !== this.pinnedDev || s.ino !== this.pinnedIno) throw new TrustedStoreUnsafePathError('trusted-state dir inode changed after open');
      } else if (process.platform !== 'win32') {
        const uid = typeof process.getuid === 'function' ? process.getuid() : null;
        if ((uid !== null && s.uid !== uid) || (s.mode & 0o077) !== 0) throw new TrustedStoreUnsafePathError('trusted-state dir is not owner-only');
      }
      try { return this.readNoFollow(this.p(fileName)); }
      catch (e) {
        const c = (e as NodeJS.ErrnoException).code;
        if (c === 'ENOENT') return null; // file not written yet
        if (c === 'ELOOP') throw new TrustedStoreUnsafePathError(`${fileName} is a symlink`);
        throw e;
      }
    } finally { closeSync(dfd); }
  }

  /** Acquire the single-writer lock (atomic O_EXCL). A lock held by a DEAD pid is reclaimed; a live one refuses. */
  open(): void {
    this.openProtectedDir(); // no-follow + owner-only verification BEFORE any journal write (TOCTOU closure)
    const lock = this.p(LOCK_FILE);
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        this.assertDir(); // the dir still resolves to the pinned inode (no post-open swap) before touching the lock
        const fd = openSync(lock, FS.O_CREAT | FS.O_EXCL | FS.O_WRONLY | O_NOFOLLOW, 0o600); // atomic create, no-follow
        writeSync(fd, String(process.pid)); fsyncSync(fd); closeSync(fd);
        this.locked = true;
        return;
      } catch (err) {
        const code = (err as NodeJS.ErrnoException).code;
        if (code === 'ELOOP') { this.releaseDirFd(); throw new TrustedStoreUnsafePathError('writer.lock is a symlink'); }
        if (code !== 'EEXIST') { this.releaseDirFd(); throw err; }
        let raw: string;
        try { raw = this.readNoFollow(lock).trim(); }
        catch (e) { this.releaseDirFd(); if ((e as NodeJS.ErrnoException).code === 'ELOOP') throw new TrustedStoreUnsafePathError('writer.lock is a symlink'); throw e; }
        const holder = Number(raw);
        // Single-writer: a lock held by ANY LIVE pid (including another instance in this same process) refuses.
        // Only a lock whose holder is a POSITIVE integer pid that is provably DEAD (a crashed writer) is reclaimed.
        // An empty/partial/non-positive lock is a writer that has O_EXCL-created the file but not yet fsync'd its
        // pid — a LIVE contended lock, NOT stale. Treat it as held (refuse + let the caller's retry loop wait for
        // the holder to finish and release), never delete it — that TOCTOU would admit two writers.
        if (raw === '' || !Number.isInteger(holder) || holder <= 0 || this.pidAlive(holder)) {
          this.releaseDirFd();
          throw new WriterLockedError(`trusted store locked (holder ${raw || 'in-progress'})`);
        }
        this.assertDir(); // reassert the pinned dir immediately before the stale-lock unlink (path mutation)
        rmSync(lock, { force: true }); // stale lock (dead pid) — reclaim, then retry once
      }
    }
    this.releaseDirFd();
    throw new WriterLockedError('could not acquire trusted store writer lock');
  }

  private releaseDirFd(): void {
    if (this.dirFd !== null) { try { closeSync(this.dirFd); } catch { /* best effort */ } this.dirFd = null; }
  }

  close(): void {
    // Remove the lock only if the dir still resolves to the pinned inode — a swapped-prefix cleanup would unlink
    // through the replacement. If the dir was replaced, we leave the (now-orphaned, old-inode) lock and just drop
    // our fd; the old inode's lock is unreachable by path anyway.
    if (this.locked) {
      try { this.assertDir(); rmSync(this.p(LOCK_FILE), { force: true }); } catch { /* swapped/gone — skip path cleanup */ }
      this.locked = false;
    }
    this.releaseDirFd();
  }

  private pidAlive(pid: number): boolean { try { process.kill(pid, 0); return true; } catch { return false; } }

  private readHighWater(): number {
    const text = this.protectedRead(HIGHWATER_FILE); // acquire→read→release a protected read pin (no existsSync)
    if (text === null) return 0;
    const n = Number(JSON.parse(text).count);
    return Number.isSafeInteger(n) && n >= 0 ? n : 0;
  }

  /** Durable read + rollback refusal. A fresh store returns `genesis`. A loaded count below the high-water is a rollback. */
  load(genesis: TrustedStateV1): PersistedTrustedRecordV1 {
    const text = this.protectedRead(STATE_FILE); // protected read pin; null ⇒ no dir/file yet ⇒ genesis (no existsSync)
    if (text === null) {
      assertTrustedState(genesis); // fail-closed on a bad genesis
      return { storeSchema: STORE_SCHEMA_VERSION, state: genesis, prepared: [] };
    }
    let rec: PersistedTrustedRecordV1;
    try { rec = JSON.parse(text) as PersistedTrustedRecordV1; }
    catch (e) { throw new TrustedStoreCorruptError(`trusted state unparseable: ${String(e).slice(0, 80)}`); }
    if (rec.storeSchema !== STORE_SCHEMA_VERSION) throw new TrustedStoreCorruptError('unknown store schema (migration required)');
    assertTrustedState(rec.state); // reuse the kernel's fail-closed validator (sorted ids, coherent head, canonical roots)
    const highWater = this.readHighWater();
    if (rec.state.receiptHead.count < highWater) {
      throw new RollbackRefusedError(`trusted state rolled back: loaded count ${rec.state.receiptHead.count} < high-water ${highWater}`);
    }
    return rec;
  }

  /** Crash-safe atomic commit: write tmp → fsync → atomic rename → fsync dir → advance high-water. */
  private commit(record: PersistedTrustedRecordV1): void {
    if (!this.locked) throw new WriterLockedError('commit without the writer lock');
    const tmp = this.p(TMP_FILE);
    const body = JSON.stringify(record);
    this.crash('journal-write');
    this.assertDir(); // dir still the pinned inode before writing the tmp journal
    const fd = openSync(tmp, FS.O_CREAT | FS.O_WRONLY | FS.O_TRUNC | O_NOFOLLOW, 0o600); // no-follow: a swapped tmp symlink is refused
    try {
      writeSync(fd, body);
      this.crash('journal-fsync');
      fsyncSync(fd);
    } finally { closeSync(fd); }
    this.crash('rename');
    this.assertDir(); // reassert the pinned inode immediately before the rename (a swap in the sub-syscall window
                      // between this check and the rename is the documented residual; wider windows are closed)
    renameSync(tmp, this.p(STATE_FILE)); // rename() itself is a single atomic syscall — the durability point
    // fsync the directory so the rename itself is durable across power loss — via the HELD dir fd (pinned inode,
    // never re-resolving `dir` by path, which would reopen the TOCTOU window).
    this.crash('dir-fsync');
    try { if (this.dirFd !== null) fsyncSync(this.dirFd); } catch { /* dir fsync best-effort on some FS */ }
    this.crash('highwater');
    this.assertDir(); // dir still the pinned inode before the high-water write
    const hwFd = openSync(this.p(HIGHWATER_FILE), FS.O_CREAT | FS.O_WRONLY | FS.O_TRUNC | O_NOFOLLOW, 0o600);
    try { writeSync(hwFd, JSON.stringify({ count: record.state.receiptHead.count })); fsyncSync(hwFd); } finally { closeSync(hwFd); }
  }

  /**
   * THE atomic authorizeAndPrepare transaction. Loads the durable state, runs the kernel `decide()` (replay,
   * authorization, and receipt-head advance are ITS law over the durable consumed set), and on `allowed`
   * persists the next state + the PREPARED effect atomically BEFORE returning — so the caller performs the Git
   * effect only after the consumption is durable. A refusal persists nothing.
   */
  authorizeAndPrepare(args: {
    genesis: TrustedStateV1;
    request: KernelRequestV1;
    policyBytes: Uint8Array;
    effect: { effectId: string; descriptorKind: string; targetPath: string; contentHash: string };
    nowMs: number;
  }): AuthorizeOutcome {
    const current = this.load(args.genesis);
    const result = this.decide(args.request, current.state, args.policyBytes, args.nowMs);
    if (result.decision.status !== 'allowed') {
      return { ok: false, decision: result.decision };
    }
    const prepared: PreparedEffectV1 = {
      effectId: args.effect.effectId,
      consumptionId: args.request.consumptionId ?? '',
      descriptorKind: args.effect.descriptorKind,
      targetPath: args.effect.targetPath,
      contentHash: args.effect.contentHash,
      receiptCountAfter: result.nextState.receiptHead.count,
      preparedAtMs: args.nowMs,
    };
    const record: PersistedTrustedRecordV1 = {
      storeSchema: STORE_SCHEMA_VERSION,
      state: result.nextState,
      prepared: [...current.prepared, prepared],
    };
    this.commit(record); // durable BEFORE any Git effect the caller runs next
    return { ok: true, decision: result.decision, prepared, record };
  }

  /** Sanity: the persisted files are owner-only (0600). Returns the octal perms of the state file, or null. */
  statePerms(): number | null {
    let fd: number;
    try { fd = openSync(this.p(STATE_FILE), FS.O_RDONLY | O_NOFOLLOW); } // no existsSync; no-follow (a symlink surfaces ELOOP)
    catch (e) { if ((e as NodeJS.ErrnoException).code === 'ENOENT') return null; throw e; }
    try { return fstatSync(fd).mode & 0o777; } finally { closeSync(fd); }
  }
}

/** The store persists and refuses; it grants no authority (the kernel `decide` it wraps already grants none). */
export function trustedStateStoreGrantsAuthority(): false {
  return false;
}
