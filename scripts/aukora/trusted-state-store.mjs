// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Aukora
/**
 * PORT: https://github.com/aumara-xyz/aukora, packages/kernel-node/src/trustedStateStore.ts
 * Commit: def297fc146bf3c448df4d0f4e78358d65345436
 * Original SHA-256: see vendor/authority/reference/PROVENANCE.json
 * Unmodified reference: vendor/authority/reference/trustedStateStore.ts.
 * Each trailing @source L marker maps a statement to the original. Type-only declarations became JSDoc;
 * access modifiers/type assertions were erased. PORT comments identify the POSIX path replacement and the
 * Genesis state-file/external-high-water seams. The original default behavior is retained for reference checks.
 * The Genesis caller places its witness outside state/. Same UID can rewrite both; Airlock holding the
 * witness is the planned close. Nothing here attests a person or enforces GitHub main.
 */
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
import { openSync, writeSync, fsyncSync, closeSync, renameSync, readFileSync, mkdirSync, rmSync, lstatSync, fstatSync, constants as FS } from 'node:fs'; // @source L22
import { decide as kernelDecide, assertTrustedState } from '../../vendor/authority/lib/index.js'; // @source L24
import { parseStrictText } from '../../plugins/aukora-kira/lib/strict-read.mjs';

/** @type {1} */
export const STORE_SCHEMA_VERSION = 1; // @source L26

// No-follow / directory open flags. On platforms lacking them (Windows) they degrade to 0 — Windows symlink
// creation itself requires privilege, so the POSIX case is where the TOCTOU defense is load-bearing.
const O_NOFOLLOW = FS.O_NOFOLLOW ?? 0; // @source L30
const O_DIRECTORY = FS.O_DIRECTORY ?? 0; // @source L31
/** @typedef {import('../../vendor/authority/src/schema.ts').TrustedStateV1} TrustedStateV1 */
/** @typedef {import('../../vendor/authority/src/schema.ts').KernelRequestV1} KernelRequestV1 */
/** @typedef {import('../../vendor/authority/src/schema.ts').KernelResultV1} KernelResultV1 */
/**
 * Content-free descriptor of the effect an authorization prepares. No bytes, keys, or plaintext.
 * @typedef {object} PreparedEffectV1 Original interface: L34-L42.
 * @property {string} effectId Caller-supplied stable id.
 * @property {string} consumptionId Authorization id consumed for this effect.
 * @property {string} descriptorKind Effect class, for example git-candidate.
 * @property {string} targetPath
 * @property {string} contentHash Hash of intended bytes, which live elsewhere.
 * @property {number} receiptCountAfter
 * @property {number} preparedAtMs
 */
/**
 * @typedef {object} PersistedTrustedRecordV1 Original interface: L45-L49.
 * @property {1} storeSchema
 * @property {TrustedStateV1} state
 * @property {ReadonlyArray<PreparedEffectV1>} prepared
 */

export class RollbackRefusedError extends Error {} // @source L51
export class WriterLockedError extends Error {} // @source L52
export class TrustedStoreCorruptError extends Error {} // @source L53
/** The state dir/file resolved through a symlink or is not an owner-only real directory (path-swap / TOCTOU). */
export class TrustedStoreUnsafePathError extends Error {} // @source L55

/** @typedef {(label: 'journal-write'|'journal-fsync'|'rename'|'dir-fsync'|'highwater') => void} CrashHook Original L58. */
/** @type {CrashHook} */
const NO_CRASH = () => {}; // @source L59
/** @typedef {{ok:true, decision:KernelResultV1['decision'], prepared:PreparedEffectV1, record:PersistedTrustedRecordV1}|{ok:false, decision:KernelResultV1['decision']}} AuthorizeOutcome Original L61-L63. */
/**
 * @typedef {object} TrustedStoreOptions Original interface: L65-L69; PORT options documented below.
 * @property {typeof kernelDecide} [decide] Real pure kernel by default; injection is for tests.
 * @property {CrashHook} [crashHook]
 * @property {string} [stateFile] PORT: replace the existing Genesis file; do not create a second state path.
 * @property {string} [lockFile] PORT: share the existing Genesis writer lock during migration.
 * @property {{read: () => number, write: (count: number) => void}} [highWater] PORT: externally retained witness.
 * @property {(fd:number, body:string) => void} [journalWrite] PORT: Genesis completes short journal writes.
 */

const STATE_FILE = 'trusted-state.json'; // @source L71
const HIGHWATER_FILE = 'receipt-highwater.json'; // @source L72
const LOCK_FILE = 'writer.lock'; // @source L73
const TMP_FILE = 'trusted-state.tmp'; // @source L74

// PORT for upstream L23/L89: POSIX lexical join for this store's fixed child names, without node:path.
// Like path.posix.join, dot segments are normalized before any filesystem lookup (including symlink ancestors).
/** @param {string} dir @param {string} name @returns {string} */
function joinDirectoryChild(dir, name) {
  const full = dir ? `${dir}/${name}` : name;
  const absolute = full.startsWith('/');
  const parts = [];
  for (const part of full.split('/')) {
    if (!part || part === '.') continue;
    if (part === '..' && parts.length && parts.at(-1) !== '..') parts.pop();
    else if (part !== '..' || !absolute) parts.push(part);
  }
  return `${absolute ? '/' : ''}${parts.join('/')}` || '.';
}
export class TrustedStateStore { // @source L76
  locked = false; // @source L77
  /** @type {number|null} */
  dirFd = null; // @source L78
  pinnedDev = -1;   // dev+ino of the state dir at open — every lifetime op re-verifies against these // @source L79
  pinnedIno = -1; // @source L80

  /** @param {string} dir @param {TrustedStoreOptions} [opts] */
  constructor(dir, opts = {}) { // @source L84
    this.dir = dir; // @source L84: TypeScript parameter property initialization.
    this.stateFile = opts.stateFile ?? STATE_FILE; // PORT: retain the existing Genesis state filename.
    this.lockFile = opts.lockFile ?? LOCK_FILE; // PORT: retain the existing Genesis writer lock.
    this.highWater = opts.highWater; // PORT: the witness is outside the state root.
    this.journalWrite = opts.journalWrite ?? writeSync; // PORT: preserve original single-write default at L293.
    /** @type {typeof kernelDecide} Original declaration L81. */
    this.decide = opts.decide ?? kernelDecide; // @source L85
    /** @type {CrashHook} Original declaration L82. */
    this.crash = opts.crashHook ?? NO_CRASH; // @source L86
  } // @source L87

  /** @param {string} name @returns {string} */
  p(name) { return joinDirectoryChild(this.dir, name); } // @source L89

  /** Read a file WITHOUT following a symlink in its final component (a swapped-in symlink is refused, ELOOP). */
  /** @param {string} path @returns {string} */
  readNoFollow(path) { // @source L92
    const fd = openSync(path, FS.O_RDONLY | O_NOFOLLOW); // @source L93
    try { return readFileSync(fd, 'utf8'); } finally { closeSync(fd); } // @source L94
  } // @source L95

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
  /** @returns {void} */
  openProtectedDir() { // @source L109
    /** @type {ReturnType<typeof lstatSync>|null} */
    let st = null; // @source L110
    try { st = lstatSync(this.dir); } // @source L111
    catch (e) { if (e.code !== 'ENOENT') throw e; } // @source L112
    if (st === null) { // @source L113
      // create ONLY the final component (non-recursive) so we never create through a symlinked ancestor
      try { mkdirSync(this.dir, { mode: 0o700 }); } // @source L115
      catch (e) { if (e.code !== 'EEXIST') throw e; } // @source L116
    } else if (st.isSymbolicLink()) { // @source L117
      throw new TrustedStoreUnsafePathError(`trusted-state dir is a symlink: ${this.dir}`); // @source L118
    } else if (!st.isDirectory()) { // @source L119
      throw new TrustedStoreUnsafePathError(`trusted-state path is not a directory: ${this.dir}`); // @source L120
    } // @source L121
    // The load-bearing gate: open the dir itself no-follow + as a directory, and HOLD the fd.
    /** @type {number} */
    let fd; // @source L123
    try { fd = openSync(this.dir, FS.O_RDONLY | O_DIRECTORY | O_NOFOLLOW); } // @source L124
    catch (e) { // @source L125
      const c = e.code; // @source L126
      if (c === 'ELOOP' || c === 'ENOTDIR') throw new TrustedStoreUnsafePathError(`trusted-state dir is a symlink or not a directory: ${this.dir}`); // @source L127
      throw e; // @source L128
    } // @source L129
    const s = fstatSync(fd); // @source L130
    if (process.platform !== 'win32') { // @source L131
      const uid = typeof process.getuid === 'function' ? process.getuid() : null; // @source L132
      if ((uid !== null && s.uid !== uid) || (s.mode & 0o077) !== 0) { // @source L133
        closeSync(fd); // @source L134
        throw new TrustedStoreUnsafePathError(`trusted-state dir is not owner-only (uid=${s.uid}, mode=${(s.mode & 0o777).toString(8)})`); // @source L135
      } // @source L136
    } // @source L137
    this.pinnedDev = s.dev; this.pinnedIno = s.ino; // pin the inode; every later op re-verifies against it // @source L138
    this.dirFd = fd; // @source L139
  } // @source L140

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
  /** @returns {void} */
  assertDir() { // @source L155
    /** @type {number} */
    let fd; // @source L156
    try { fd = openSync(this.dir, FS.O_RDONLY | O_DIRECTORY | O_NOFOLLOW); } // @source L157
    catch (e) { // @source L158
      const c = e.code; // @source L159
      if (c === 'ELOOP' || c === 'ENOTDIR' || c === 'ENOENT') throw new TrustedStoreUnsafePathError(`trusted-state dir replaced after open (${c})`); // @source L160
      throw e; // @source L161
    } // @source L162
    try { // @source L163
      const s = fstatSync(fd); // @source L164
      if (s.dev !== this.pinnedDev || s.ino !== this.pinnedIno) throw new TrustedStoreUnsafePathError('trusted-state dir inode changed after open'); // @source L165
    } finally { closeSync(fd); } // @source L166
  } // @source L167

  /**
   * Acquire → read → RELEASE a protected read pin. Opens the state dir itself O_NOFOLLOW|O_DIRECTORY (a symlink
   * prefix fails ELOOP → refused, never followed), verifies it — inode-pin match when OPENED, owner-only when
   * standalone — then reads `fileName` no-follow through that verified dir, and always releases the transient fd.
   * Returns null when the dir OR the file does not exist (a fresh/empty store — not an error, and no `existsSync`
   * precheck: a direct O_NOFOLLOW open with ENOENT handling is the only race-free probe). Throws
   * TrustedStoreUnsafePathError on a symlink/replaced dir or a symlinked file. NOTE: the dir verify and the file
   * open are separate syscalls (no openat) — same sub-syscall residual documented on assertDir.
   */
  /** @param {string} fileName @returns {string|null} */
  protectedRead(fileName) { // @source L178
    /** @type {number} */
    let dfd; // @source L179
    try { dfd = openSync(this.dir, FS.O_RDONLY | O_DIRECTORY | O_NOFOLLOW); } // @source L180
    catch (e) { // @source L181
      const c = e.code; // @source L182
      if (c === 'ENOENT') return null; // no state dir yet ⇒ empty store // @source L183
      if (c === 'ELOOP' || c === 'ENOTDIR') throw new TrustedStoreUnsafePathError(`trusted-state dir is a symlink or not a directory: ${this.dir}`); // @source L184
      throw e; // @source L185
    } // @source L186
    try { // @source L187
      const s = fstatSync(dfd); // @source L188
      if (this.dirFd !== null) { // @source L189
        if (s.dev !== this.pinnedDev || s.ino !== this.pinnedIno) throw new TrustedStoreUnsafePathError('trusted-state dir inode changed after open'); // @source L190
      } else if (process.platform !== 'win32') { // @source L191
        const uid = typeof process.getuid === 'function' ? process.getuid() : null; // @source L192
        if ((uid !== null && s.uid !== uid) || (s.mode & 0o077) !== 0) throw new TrustedStoreUnsafePathError('trusted-state dir is not owner-only'); // @source L193
      } // @source L194
      try { return this.readNoFollow(this.p(fileName)); } // @source L195
      catch (e) { // @source L196
        const c = e.code; // @source L197
        if (c === 'ENOENT') return null; // file not written yet // @source L198
        if (c === 'ELOOP') throw new TrustedStoreUnsafePathError(`${fileName} is a symlink`); // @source L199
        throw e; // @source L200
      } // @source L201
    } finally { closeSync(dfd); } // @source L202
  } // @source L203

  /** Acquire the single-writer lock (atomic O_EXCL). A lock held by a DEAD pid is reclaimed; a live one refuses. */
  /** @returns {void} */
  open() { // @source L206
    this.openProtectedDir(); // no-follow + owner-only verification BEFORE any journal write (TOCTOU closure) // @source L207
    const lock = this.p(this.lockFile); // @source L208; PORT: same lock path during Genesis migration.
    for (let attempt = 0; attempt < 2; attempt++) { // @source L209
      try { // @source L210
        this.assertDir(); // the dir still resolves to the pinned inode (no post-open swap) before touching the lock // @source L211
        const fd = openSync(lock, FS.O_CREAT | FS.O_EXCL | FS.O_WRONLY | O_NOFOLLOW, 0o600); // atomic create, no-follow // @source L212
        writeSync(fd, String(process.pid)); fsyncSync(fd); closeSync(fd); // @source L213
        this.locked = true; // @source L214
        return; // @source L215
      } catch (err) { // @source L216
        const code = err.code; // @source L217
        if (code === 'ELOOP') { this.releaseDirFd(); throw new TrustedStoreUnsafePathError('writer.lock is a symlink'); } // @source L218
        if (code !== 'EEXIST') { this.releaseDirFd(); throw err; } // @source L219
        /** @type {string} */
        let raw; // @source L220
        try { raw = this.readNoFollow(lock).trim(); } // @source L221
        catch (e) {
          // PORT (Genesis, 2026-09-28): the holder released between our EEXIST and this read. Try the O_EXCL again;
          // two losses end in WriterLockedError, which callers already treat as a held lock.
          if (e.code === 'ENOENT') continue
          this.releaseDirFd(); if (e.code === 'ELOOP') throw new TrustedStoreUnsafePathError('writer.lock is a symlink'); throw e; } // @source L222
        const holder = Number(raw); // @source L223
        // Single-writer: a lock held by ANY LIVE pid (including another instance in this same process) refuses.
        // Only a lock whose holder is a POSITIVE integer pid that is provably DEAD (a crashed writer) is reclaimed.
        // An empty/partial/non-positive lock is a writer that has O_EXCL-created the file but not yet fsync'd its
        // pid — a LIVE contended lock, NOT stale. Treat it as held (refuse + let the caller's retry loop wait for
        // the holder to finish and release), never delete it — that TOCTOU would admit two writers.
        if (raw === '' || !Number.isInteger(holder) || holder <= 0 || this.pidAlive(holder)) { // @source L229
          this.releaseDirFd(); // @source L230
          throw new WriterLockedError(`trusted store locked (holder ${raw || 'in-progress'})`); // @source L231
        } // @source L232
        this.assertDir(); // reassert the pinned dir immediately before the stale-lock unlink (path mutation) // @source L233
        rmSync(lock, { force: true }); // stale lock (dead pid) — reclaim, then retry once // @source L234
      } // @source L235
    } // @source L236
    this.releaseDirFd(); // @source L237
    throw new WriterLockedError('could not acquire trusted store writer lock'); // @source L238
  } // @source L239

  /** @returns {void} */
  releaseDirFd() { // @source L241
    if (this.dirFd !== null) { try { closeSync(this.dirFd); } catch { /* best effort */ } this.dirFd = null; } // @source L242
  } // @source L243

  /** @returns {void} */
  close() { // @source L245
    // Remove the lock only if the dir still resolves to the pinned inode — a swapped-prefix cleanup would unlink
    // through the replacement. If the dir was replaced, we leave the (now-orphaned, old-inode) lock and just drop
    // our fd; the old inode's lock is unreachable by path anyway.
    if (this.locked) { // @source L249
      try { this.assertDir(); rmSync(this.p(this.lockFile), { force: true }); } catch { /* swapped/gone — skip path cleanup */ } // @source L250; PORT: same lock path.
      this.locked = false; // @source L251
    } // @source L252
    this.releaseDirFd(); // @source L253
  } // @source L254

  /** @param {number} pid @returns {boolean} */
  pidAlive(pid) { try { process.kill(pid, 0); return true; } catch { return false; } } // @source L256

  /** @returns {number} */
  readHighWater() { // @source L258
    if (this.highWater) return this.highWater.read(); // PORT: replace local high-water; no second witness.
    const text = this.protectedRead(HIGHWATER_FILE); // acquire→read→release a protected read pin (no existsSync) // @source L259
    if (text === null) return 0; // @source L260
    const n = Number(JSON.parse(text).count); // @source L261
    return Number.isSafeInteger(n) && n >= 0 ? n : 0; // @source L262
  } // @source L263

  /** Durable read + rollback refusal. A fresh store returns `genesis`. A loaded count below the high-water is a rollback. */
  /** @param {TrustedStateV1} genesis @returns {PersistedTrustedRecordV1} */
  load(genesis) { // @source L266
    const text = this.protectedRead(this.stateFile); // PORT: replace STATE_FILE (original path by default). // @source L267
    if (text === null) { // @source L268
      assertTrustedState(genesis); // fail-closed on a bad genesis // @source L269
      // PORT: a missing/restored-away state must not bypass the externally retained high-water.
      if (this.highWater) {
        const highWater = this.readHighWater();
        if (genesis.receiptHead.count < highWater) {
          throw new RollbackRefusedError(`trusted state rolled back: loaded count ${genesis.receiptHead.count} < high-water ${highWater}`);
        }
      }
      return { storeSchema: STORE_SCHEMA_VERSION, state: genesis, prepared: [] }; // @source L270
    } // @source L271
    /** @type {PersistedTrustedRecordV1} */
    let rec; // @source L272
    try { rec = parseStrictText(text, this.p(this.stateFile)); } // @source L273; PORT: retain strict JSON refusal.
    catch (e) { throw new TrustedStoreCorruptError(`trusted state unparseable: ${String(e).slice(0, 80)}`); } // @source L274
    if (rec.storeSchema !== STORE_SCHEMA_VERSION) throw new TrustedStoreCorruptError('unknown store schema (migration required)'); // @source L275
    assertTrustedState(rec.state); // reuse the kernel's fail-closed validator (sorted ids, coherent head, canonical roots) // @source L276
    const highWater = this.readHighWater(); // @source L277
    if (rec.state.receiptHead.count < highWater) { // @source L278
      throw new RollbackRefusedError(`trusted state rolled back: loaded count ${rec.state.receiptHead.count} < high-water ${highWater}`); // @source L279
    } // @source L280
    return rec; // @source L281
  } // @source L282

  /** Crash-safe atomic commit: write tmp → fsync → atomic rename → fsync dir → advance high-water. */
  /** @param {PersistedTrustedRecordV1} record @returns {void} */
  commit(record) { // @source L285
    if (!this.locked) throw new WriterLockedError('commit without the writer lock'); // @source L286
    const tmp = this.p(TMP_FILE); // @source L287
    const body = JSON.stringify(record); // @source L288
    this.crash('journal-write'); // @source L289
    this.assertDir(); // dir still the pinned inode before writing the tmp journal // @source L290
    const fd = openSync(tmp, FS.O_CREAT | FS.O_WRONLY | FS.O_TRUNC | O_NOFOLLOW, 0o600); // no-follow: a swapped tmp symlink is refused // @source L291
    try { // @source L292
      this.journalWrite(fd, body); // @source L293; PORT: Genesis supplies writeAll; original writeSync by default.
      this.crash('journal-fsync'); // @source L294
      fsyncSync(fd); // @source L295
    } finally { closeSync(fd); } // @source L296
    this.crash('rename'); // @source L297
    this.assertDir(); // reassert the pinned inode immediately before the rename (a swap in the sub-syscall window // @source L298
                      // between this check and the rename is the documented residual; wider windows are closed)
    renameSync(tmp, this.p(this.stateFile)); // PORT: same journal commit, configurable existing state filename. // @source L300
    // fsync the directory so the rename itself is durable across power loss — via the HELD dir fd (pinned inode,
    // never re-resolving `dir` by path, which would reopen the TOCTOU window).
    this.crash('dir-fsync'); // @source L303
    try { if (this.dirFd !== null) fsyncSync(this.dirFd); } catch (error) { // @source L304
      if (this.highWater) throw error; // PORT: Genesis requires the state rename durable before advancing its witness.
      /* original: dir fsync best-effort on some FS */
    }
    this.crash('highwater'); // @source L305
    this.assertDir(); // dir still the pinned inode before the high-water write // @source L306
    if (this.highWater) { this.highWater.write(record.state.receiptHead.count); return; } // PORT: replace local write.
    const hwFd = openSync(this.p(HIGHWATER_FILE), FS.O_CREAT | FS.O_WRONLY | FS.O_TRUNC | O_NOFOLLOW, 0o600); // @source L307
    try { writeSync(hwFd, JSON.stringify({ count: record.state.receiptHead.count })); fsyncSync(hwFd); } finally { closeSync(hwFd); } // @source L308
  } // @source L309

  /**
   * THE atomic authorizeAndPrepare transaction. Loads the durable state, runs the kernel `decide()` (replay,
   * authorization, and receipt-head advance are ITS law over the durable consumed set), and on `allowed`
   * persists the next state + the PREPARED effect atomically BEFORE returning — so the caller performs the Git
   * effect only after the consumption is durable. A refusal persists nothing.
   */
  /**
   * @param {{genesis:TrustedStateV1, request:KernelRequestV1, policyBytes:Uint8Array,
   *   effect:{effectId:string, descriptorKind:string, targetPath:string, contentHash:string}, nowMs:number}} args
   * @returns {AuthorizeOutcome}
   */
  authorizeAndPrepare(args) { // @source L317-L323
    const current = this.load(args.genesis); // @source L324
    const result = this.decide(args.request, current.state, args.policyBytes, args.nowMs); // @source L325
    if (result.decision.status !== 'allowed') { // @source L326
      return { ok: false, decision: result.decision }; // @source L327
    } // @source L328
    /** @type {PreparedEffectV1} */
    const prepared = { // @source L329
      effectId: args.effect.effectId, // @source L330
      consumptionId: args.request.consumptionId ?? '', // @source L331
      descriptorKind: args.effect.descriptorKind, // @source L332
      targetPath: args.effect.targetPath, // @source L333
      contentHash: args.effect.contentHash, // @source L334
      receiptCountAfter: result.nextState.receiptHead.count, // @source L335
      preparedAtMs: args.nowMs, // @source L336
    }; // @source L337
    /** @type {PersistedTrustedRecordV1} */
    const record = { // @source L338
      storeSchema: STORE_SCHEMA_VERSION, // @source L339
      state: result.nextState, // @source L340
      prepared: [...current.prepared, prepared], // @source L341
    }; // @source L342
    this.commit(record); // durable BEFORE any Git effect the caller runs next // @source L343
    return { ok: true, decision: result.decision, prepared, record }; // @source L344
  } // @source L345

  /** Sanity: the persisted files are owner-only (0600). Returns the octal perms of the state file, or null. */
  /** @returns {number|null} */
  statePerms() { // @source L348
    /** @type {number} */
    let fd; // @source L349
    try { fd = openSync(this.p(this.stateFile), FS.O_RDONLY | O_NOFOLLOW); } // PORT: same configured state file. // @source L350
    catch (e) { if (e.code === 'ENOENT') return null; throw e; } // @source L351
    try { return fstatSync(fd).mode & 0o777; } finally { closeSync(fd); } // @source L352
  } // @source L353
} // @source L354

/** The store persists and refuses; it grants no authority (the kernel `decide` it wraps already grants none). */
/** @returns {false} */
export function trustedStateStoreGrantsAuthority() { // @source L357
  return false; // @source L358
} // @source L359
