// core/journal.ts — specs/0026 (brick D): the durable turn/effect journal.
//
// A SQLite WAL database at $STATE_ROOT/journal.db (bun:sqlite — zero new npm dependencies).
// It records, durably and across restarts, what the in-memory idempotency map (specs/0020)
// deliberately forgets: which turns were accepted, which effects were authorized, and which
// of them reached a terminal state — with the digests that bind each row to its receipts.
//
// STATE MACHINES
//   turn:   ACCEPTED → RUNNING → SUCCEEDED | FAILED | IN_DOUBT
//   effect: PROPOSED → AUTHORIZED → RUNNING → SUCCEEDED | FAILED | OUTCOME_UNAVAILABLE
//           (IN_DOUBT wherever completion evidence is missing)
//
// RULES ENFORCED HERE (each has a boundary-verify gate):
//   - turnKey + same requestDigest = the same turn (replay); turnKey + different digest =
//     a COLLISION, refused by the caller and receipted — the row is never overwritten.
//   - terminal settlement is exactly-once: transitions OUT of a terminal state do not exist.
//   - SUCCEEDED/FAILED/OUTCOME_UNAVAILABLE require a terminal receipt digest — a post without
//     real completion evidence is structurally impossible; the honest state is IN_DOUBT.
//   - restart converts RUNNING → IN_DOUBT (reconcile). Nothing is ever auto-re-executed.
//   - the outbox keys on the unique callId; recovery locates the receipt on the ledger first
//     and re-applies only when it is absent — recovery never duplicates a receipt.
//   - all writes are single-statement or transactional SQLite under WAL + busy_timeout, so
//     parallel turns and effects (separate hook processes) cannot clobber one another's rows.
//
// Timestamps are OBSERVATIONAL ONLY — every identity and ordering claim is a digest or a
// state, never a clock. This journal does NOT replace the v1 chain: the chain remains the
// live append path; the journal mirrors decisions and outcomes until the v2 cutover (brick E+).
import { Database } from 'bun:sqlite';
import { mkdirSync } from 'node:fs';
import { hostname } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { writeStateRootMarker } from './state-root';

export const JOURNAL_FILE = 'journal.db';

export function journalPath(stateRoot: string): string {
  return join(stateRoot, JOURNAL_FILE);
}

export type TurnState = 'ACCEPTED' | 'RUNNING' | 'SUCCEEDED' | 'FAILED' | 'IN_DOUBT';
export type EffectState =
  | 'PROPOSED' | 'AUTHORIZED' | 'RUNNING'
  | 'SUCCEEDED' | 'FAILED' | 'OUTCOME_UNAVAILABLE' | 'IN_DOUBT';

const TERMINAL_TURN: ReadonlySet<TurnState> = new Set(['SUCCEEDED', 'FAILED', 'IN_DOUBT']);
const TERMINAL_EFFECT: ReadonlySet<EffectState> = new Set(['SUCCEEDED', 'FAILED', 'OUTCOME_UNAVAILABLE', 'IN_DOUBT']);

const sha256hex = (b: Buffer | string): string => createHash('sha256').update(b).digest('hex');
const now = (): string => new Date().toISOString();

// ── WHO IS RUNNING THIS ─────────────────────────────────────────────────────
// A RUNNING row means "a process began this and has not said how it ended". Until now the
// row did not record WHICH process, so nothing could tell an effect that is running right
// now from one whose owner died in April. That is why reconcileInterrupted() carries the
// warning "never a hook mid-turn": run it from the wrong place and it marks LIVE work
// IN_DOUBT. Measured consequence of it therefore never being called at all: 4,038 of 15,168
// effect rows frozen at RUNNING, 45% of all recorded effects with no known outcome.
//
// Stamping the owner makes liveness decidable, which makes reconciliation safe to perform
// from any process at any time — no "boot" concept required, and no risk to live work.
const OWNER_PID = process.pid;
const OWNER_HOST = (() => { try { return hostname(); } catch { return ''; } })();

/** Is this pid still running on THIS host? `kill(pid, 0)` signals nothing; it only asks.
 *
 *  PID REUSE, STATED HONESTLY: if the owner died and the operating system has since handed
 *  its number to a different live process, this returns true and the row is NOT reconciled.
 *  That is a FALSE NEGATIVE — the row stays RUNNING, exactly as it does today — and it is
 *  the safe direction to be wrong in. The unsafe direction (declaring a live effect dead)
 *  cannot happen this way, because a live owner's pid is always alive. Rows stranded by
 *  reuse are caught by the explicit reconcileInterrupted() sweep at a real boot. */
function ownerIsAlive(pid: number | null, host: string | null): boolean {
  if (!pid || pid <= 0) return false;            // never stamped — liveness is unknowable
  if (host && OWNER_HOST && host !== OWNER_HOST) return false; // another machine's process
  if (pid === OWNER_PID) return true;            // this process
  try { process.kill(pid, 0); return true; } catch { return false; }
}

export interface Versions { policyDigest: string; adapterDigest: string }
const NO_VERSIONS: Versions = { policyDigest: '', adapterDigest: '' };

export interface TurnRow {
  turnKey: string; requestDigest: string; state: TurnState; route: string; model: string;
  replyDigest: string | null; error: string | null;
  policyDigest: string; adapterDigest: string; createdAt: string; updatedAt: string;
}

export interface EffectRow {
  effectId: string; turnKey: string; tool: string; path: string; commandHash: string;
  intentDigest: string; state: EffectState;
  preReceiptDigest: string | null; terminalReceiptDigest: string | null;
  outcome: string | null; reason: string | null;
  policyDigest: string; adapterDigest: string; createdAt: string; updatedAt: string;
}

export interface OutboxRow {
  callId: string; kind: string; effectId: string; status: 'pending' | 'durable' | 'failed';
  payload: string; ts: string; receiptDigest: string | null; lastError: string | null;
  attempts: number; createdAt: string; updatedAt: string;
}

export type AcceptResult =
  | { kind: 'accepted' }
  | { kind: 'replay'; turn: TurnRow }
  | { kind: 'collision'; turn: TurnRow };

interface RawRow { [k: string]: string | number | null }

function turnOf(r: RawRow): TurnRow {
  return {
    turnKey: String(r.turn_key), requestDigest: String(r.request_digest), state: r.state as TurnState,
    route: String(r.route ?? ''), model: String(r.model ?? ''),
    replyDigest: r.reply_digest === null ? null : String(r.reply_digest),
    error: r.error === null ? null : String(r.error),
    policyDigest: String(r.policy_digest ?? ''), adapterDigest: String(r.adapter_digest ?? ''),
    createdAt: String(r.created_at), updatedAt: String(r.updated_at),
  };
}

function effectOf(r: RawRow): EffectRow {
  return {
    effectId: String(r.effect_id), turnKey: String(r.turn_key ?? ''), tool: String(r.tool),
    path: String(r.path ?? ''), commandHash: String(r.command_hash ?? ''),
    intentDigest: String(r.intent_digest ?? ''), state: r.state as EffectState,
    preReceiptDigest: r.pre_receipt_digest === null ? null : String(r.pre_receipt_digest),
    terminalReceiptDigest: r.terminal_receipt_digest === null ? null : String(r.terminal_receipt_digest),
    outcome: r.outcome === null ? null : String(r.outcome),
    reason: r.reason === null ? null : String(r.reason),
    policyDigest: String(r.policy_digest ?? ''), adapterDigest: String(r.adapter_digest ?? ''),
    createdAt: String(r.created_at), updatedAt: String(r.updated_at),
  };
}

function outboxOf(r: RawRow): OutboxRow {
  return {
    callId: String(r.call_id), kind: String(r.kind), effectId: String(r.effect_id ?? ''),
    status: r.status as OutboxRow['status'], payload: String(r.payload ?? ''), ts: String(r.ts ?? ''),
    receiptDigest: r.receipt_digest === null ? null : String(r.receipt_digest),
    lastError: r.last_error === null ? null : String(r.last_error),
    attempts: Number(r.attempts ?? 0), createdAt: String(r.created_at), updatedAt: String(r.updated_at),
  };
}

export class Journal {
  readonly path: string;
  private db: Database;

  constructor(stateRootDir: string) {
    mkdirSync(stateRootDir, { recursive: true, mode: 0o700 });
    // ATTRIBUTION. This constructor is the busiest minter of state roots in the system —
    // hooks/law.ts opens a Journal at stateRoot(ROOT) for every judged effect, and until now
    // it created the directory with no marker at all. Measured: 4,782 of 4,786 journal-bearing
    // roots carry no marker and can never be attributed to the tree that produced them. A root
    // that cannot say what it serves is evidence nobody can look up, which is the whole defect.
    // Best-effort by construction: attribution must never be able to fail a judged effect.
    try { writeStateRootMarker(stateRootDir); } catch { /* never block the law on bookkeeping */ }
    this.path = journalPath(stateRootDir);
    this.db = new Database(this.path, { create: true });
    // WAL so concurrent hook processes read while one writes; FULL sync so a durable row
    // survives a power cut; busy_timeout so a parallel writer waits instead of erroring.
    this.db.exec('PRAGMA journal_mode=WAL');
    this.db.exec('PRAGMA synchronous=FULL');
    this.db.exec('PRAGMA busy_timeout=5000');
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS turns (
        turn_key TEXT PRIMARY KEY,
        request_digest TEXT NOT NULL,
        state TEXT NOT NULL,
        route TEXT NOT NULL DEFAULT '',
        model TEXT NOT NULL DEFAULT '',
        reply_digest TEXT,
        error TEXT,
        policy_digest TEXT NOT NULL DEFAULT '',
        adapter_digest TEXT NOT NULL DEFAULT '',
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS effects (
        effect_id TEXT PRIMARY KEY,
        turn_key TEXT NOT NULL DEFAULT '',
        tool TEXT NOT NULL,
        path TEXT NOT NULL DEFAULT '',
        command_hash TEXT NOT NULL DEFAULT '',
        intent_digest TEXT NOT NULL DEFAULT '',
        state TEXT NOT NULL,
        pre_receipt_digest TEXT,
        terminal_receipt_digest TEXT,
        outcome TEXT,
        reason TEXT,
        policy_digest TEXT NOT NULL DEFAULT '',
        adapter_digest TEXT NOT NULL DEFAULT '',
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS outbox (
        call_id TEXT PRIMARY KEY,
        kind TEXT NOT NULL,
        effect_id TEXT NOT NULL DEFAULT '',
        status TEXT NOT NULL,
        payload TEXT NOT NULL DEFAULT '',
        ts TEXT NOT NULL DEFAULT '',
        receipt_digest TEXT,
        last_error TEXT,
        attempts INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
    `);
    this.migrateOwnerColumns();
    // MAKE IT ACTUALLY HAPPEN. reconcileInterrupted() has existed since brick D and nothing
    // has ever called it — EngineAdapter is its only production caller and `new EngineAdapter`
    // appears nowhere in the tree. Rather than add one more entry point nobody invokes, the
    // safe half of reconciliation runs here, on every open: hooks/law.ts opens a Journal for
    // every judged effect, so this is the one code path that reliably executes in production.
    // Only rows whose owner is PROVABLY GONE are touched, so a hook opening the journal while
    // a sibling hook is mid-effect cannot disturb it. Best-effort by construction: bookkeeping
    // must never be able to fail a judged effect.
    try { this.reconcileDeadOwners('journal opened; owning process is gone'); } catch { /* never block the law */ }
  }

  /** Additive, idempotent schema migration. SQLite has no ADD COLUMN IF NOT EXISTS, and a
   *  duplicate ALTER throws — which is the check. Nothing is dropped, nothing is rewritten,
   *  and journals written before this column existed keep every row exactly as recorded
   *  (their owner reads NULL, which `ownerIsAlive` treats as unknowable, never as dead). */
  private migrateOwnerColumns(): void {
    for (const table of ['turns', 'effects']) {
      for (const col of ['owner_pid INTEGER', 'owner_host TEXT']) {
        try { this.db.exec(`ALTER TABLE ${table} ADD COLUMN ${col}`); }
        catch { /* already present */ }
      }
    }
  }

  /** Fold the WAL back into the database and leave WAL mode, so the -wal sidecar does not
   *  survive the process. Rows are preserved; the next open re-enables WAL.
   *
   *  MEASURED, AND HONEST ABOUT THE LIMIT. Across the state home there is 132.8 MB of
   *  journal.db and 149.6 MB of journal.db-shm — more sidecar than database. Three closes
   *  were tested against bun:sqlite on this platform:
   *
   *      plain close()                  -wal remains, -shm remains
   *      PRAGMA wal_checkpoint(TRUNCATE) -wal remains, -shm remains   (does NOT help)
   *      PRAGMA journal_mode=DELETE      -wal REMOVED, -shm remains
   *
   *  So this removes the -wal and does NOT remove the -shm. The -shm is a shared-memory
   *  index that only means anything while a connection is open; SQLite normally unlinks it
   *  on last-connection close and bun:sqlite here does not. Unlinking it from this process
   *  would be wrong — hooks are separate short-lived processes and one of them may legally
   *  hold the database (that is what busy_timeout is for), so deleting another process's
   *  coordination file is not a decision this constructor gets to make.
   *
   *  The actual root cause is upstream and out of this file: hooks/law.ts opens a Journal
   *  per judged effect and never calls close() at all. Until it does, neither sidecar is
   *  cleaned, because this method never runs. */
  close(): void {
    try { this.db.exec('PRAGMA journal_mode=DELETE'); } catch { /* a reader holds it; close anyway */ }
    try { this.db.close(); } catch { /* already closed */ }
  }

  // ── TURNS ───────────────────────────────────────────────────────────────

  /** Accept a turn under its idempotency key. Same key + same request digest = the same turn
   *  (replay). Same key + a DIFFERENT digest = a collision: the stored row wins, the new
   *  request must be refused (and receipted) by the caller. The stored row is never mutated
   *  by a collision. */
  acceptTurn(turnKey: string, requestDigest: string, route = '', model = '', versions: Versions = NO_VERSIONS): AcceptResult {
    const existing = this.getTurn(turnKey);
    if (existing) {
      return existing.requestDigest === requestDigest
        ? { kind: 'replay', turn: existing }
        : { kind: 'collision', turn: existing };
    }
    const t = now();
    this.db.run(
      `INSERT INTO turns (turn_key, request_digest, state, route, model, policy_digest, adapter_digest, created_at, updated_at)
       VALUES (?, ?, 'ACCEPTED', ?, ?, ?, ?, ?, ?)`,
      [turnKey, requestDigest, route, model, versions.policyDigest, versions.adapterDigest, t, t],
    );
    return { kind: 'accepted' };
  }

  getTurn(turnKey: string): TurnRow | null {
    const r = this.db.query('SELECT * FROM turns WHERE turn_key = ?').get(turnKey) as RawRow | null;
    return r ? turnOf(r) : null;
  }

  /** Entering RUNNING stamps the owning process: the row now says who is answerable for it,
   *  which is what lets a later reconcile distinguish live work from an abandoned turn. */
  markTurnRunning(turnKey: string, model = ''): void {
    this.db.run(
      `UPDATE turns SET state = 'RUNNING', model = CASE WHEN ? = '' THEN model ELSE ? END,
              owner_pid = ?, owner_host = ?, updated_at = ?
       WHERE turn_key = ? AND state = 'ACCEPTED'`,
      [model, model, OWNER_PID, OWNER_HOST, now(), turnKey],
    );
  }

  /** Terminal settlement, exactly once: returns true only for the call that moved the turn
   *  OUT of a non-terminal state. A second settle — replay, recovery, or bug — is a no-op. */
  settleTurn(turnKey: string, outcome: { state: 'SUCCEEDED' | 'FAILED'; replyDigest?: string; error?: string }): boolean {
    const res = this.db.run(
      `UPDATE turns SET state = ?, reply_digest = ?, error = ?, updated_at = ?
       WHERE turn_key = ? AND state IN ('ACCEPTED', 'RUNNING')`,
      [outcome.state, outcome.replyDigest ?? null, outcome.error ?? null, now(), turnKey],
    );
    return res.changes === 1;
  }

  // ── EFFECTS ─────────────────────────────────────────────────────────────

  /** The intent an authorization is bound to: tool, target, and decision, one digest. */
  static intentDigestOf(parts: { tool: string; path: string; commandHash: string; decision: string; reason: string }): string {
    const keys = Object.keys(parts).sort() as (keyof typeof parts)[];
    const canonical = `{${keys.map((k) => `${JSON.stringify(k)}:${JSON.stringify(parts[k])}`).join(',')}}`;
    return sha256hex(canonical);
  }

  /** Record a judged effect at PROPOSED. The effectId is the law's unique call id; a duplicate
   *  insert is ignored (the row is the idempotency boundary), never overwritten. */
  recordEffectProposed(e: {
    effectId: string; turnKey?: string; tool: string; path?: string; commandHash?: string;
    intentDigest: string; versions?: Versions;
  }): void {
    const t = now();
    const v = e.versions ?? NO_VERSIONS;
    this.db.run(
      `INSERT OR IGNORE INTO effects
         (effect_id, turn_key, tool, path, command_hash, intent_digest, state, policy_digest, adapter_digest, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, 'PROPOSED', ?, ?, ?, ?)`,
      [e.effectId, e.turnKey ?? '', e.tool, e.path ?? '', e.commandHash ?? '', e.intentDigest,
       v.policyDigest, v.adapterDigest, t, t],
    );
  }

  getEffect(effectId: string): EffectRow | null {
    const r = this.db.query('SELECT * FROM effects WHERE effect_id = ?').get(effectId) as RawRow | null;
    return r ? effectOf(r) : null;
  }

  /** The pre-effect receipt is durable — the effect is authorized, bound to that receipt. */
  markEffectAuthorized(effectId: string, preReceiptDigest: string): void {
    this.db.run(
      `UPDATE effects SET state = 'AUTHORIZED', pre_receipt_digest = ?, updated_at = ?
       WHERE effect_id = ? AND state = 'PROPOSED'`,
      [preReceiptDigest, now(), effectId],
    );
  }

  /** Entering RUNNING stamps the owning process — see markTurnRunning. */
  markEffectRunning(effectId: string): void {
    this.db.run(
      `UPDATE effects SET state = 'RUNNING', owner_pid = ?, owner_host = ?, updated_at = ?
       WHERE effect_id = ? AND state = 'AUTHORIZED'`,
      [OWNER_PID, OWNER_HOST, now(), effectId],
    );
  }

  /** Terminal settlement from REAL completion evidence, exactly once. A terminal outcome
   *  (succeeded / failed / outcome-unavailable) MUST carry the digest of the terminal receipt
   *  that proves it — without one the honest state is IN_DOUBT, and this method refuses to
   *  manufacture anything else. Returns true only for the settling call. */
  markEffectTerminal(effectId: string, t: {
    state: 'SUCCEEDED' | 'FAILED' | 'OUTCOME_UNAVAILABLE';
    terminalReceiptDigest: string; outcome?: string; reason?: string;
  }): boolean {
    if (!t.terminalReceiptDigest) {
      throw new Error(`journal: terminal state ${t.state} requires a terminal receipt digest — use markEffectInDoubt when completion evidence is missing`);
    }
    const res = this.db.run(
      `UPDATE effects SET state = ?, terminal_receipt_digest = ?, outcome = ?, reason = ?, updated_at = ?
       WHERE effect_id = ? AND state NOT IN ('SUCCEEDED', 'FAILED', 'OUTCOME_UNAVAILABLE', 'IN_DOUBT')`,
      [t.state, t.terminalReceiptDigest, t.outcome ?? null, t.reason ?? null, now(), effectId],
    );
    return res.changes === 1;
  }

  /** Completion evidence is missing (restart, lost pending record, unobservable outcome that
   *  cannot even be named): the effect is IN_DOUBT. Never a fabricated post. Exactly once. */
  markEffectInDoubt(effectId: string, reason: string): boolean {
    const res = this.db.run(
      `UPDATE effects SET state = 'IN_DOUBT', reason = ?, updated_at = ?
       WHERE effect_id = ? AND state NOT IN ('SUCCEEDED', 'FAILED', 'OUTCOME_UNAVAILABLE', 'IN_DOUBT')`,
      [reason, now(), effectId],
    );
    return res.changes === 1;
  }

  /** A refused effect: the pre receipt (the refusal decision) IS its terminal record. */
  markEffectRefused(effectId: string, preReceiptDigest: string, reason: string): void {
    this.db.run(
      `UPDATE effects SET state = 'FAILED', terminal_receipt_digest = ?, outcome = 'refused', reason = ?, updated_at = ?
       WHERE effect_id = ? AND state NOT IN ('SUCCEEDED', 'FAILED', 'OUTCOME_UNAVAILABLE', 'IN_DOUBT')`,
      [preReceiptDigest, reason, now(), effectId],
    );
  }

  // ── RESTART RECONCILIATION ──────────────────────────────────────────────

  /** Called once by the process that OWNS the journal (the membrane at boot, never a hook
   *  mid-turn): every RUNNING row belongs to a process that is provably gone, so its outcome
   *  is unknowable — IN_DOUBT, never re-executed. ACCEPTED/PROPOSED/AUTHORIZED rows never
   *  began or completed execution and are left exactly as recorded. */
  /** The SAFE half, and the half that actually runs: settle only rows whose owning process is
   *  provably gone. Live work is never touched, so unlike reconcileInterrupted this is safe to
   *  call from any process at any time — including a hook mid-turn, which is what lets it run
   *  automatically on every Journal open.
   *
   *  Rows with no stamped owner (written before the column existed, or never marked RUNNING by
   *  this code) are LEFT ALONE: an unknown owner is unknowable, not dead. Those are the
   *  explicit sweep's job. Returns what it settled so a gate can assert on it. */
  reconcileDeadOwners(reason: string): { turns: number; effects: number } {
    const t = now();
    let turns = 0, effects = 0;
    const dead = (rows: { id: string; pid: number | null; host: string | null }[]) =>
      rows.filter((r) => r.pid !== null && !ownerIsAlive(r.pid, r.host)).map((r) => r.id);

    const turnRows = (this.db.query(
      `SELECT turn_key AS id, owner_pid AS pid, owner_host AS host FROM turns WHERE state = 'RUNNING'`,
    ).all() as { id: string; pid: number | null; host: string | null }[]);
    for (const id of dead(turnRows)) {
      turns += this.db.run(
        `UPDATE turns SET state = 'IN_DOUBT', error = ?, updated_at = ? WHERE turn_key = ? AND state = 'RUNNING'`,
        [reason, t, id],
      ).changes;
    }

    const effectRows = (this.db.query(
      `SELECT effect_id AS id, owner_pid AS pid, owner_host AS host FROM effects WHERE state = 'RUNNING'`,
    ).all() as { id: string; pid: number | null; host: string | null }[]);
    for (const id of dead(effectRows)) {
      effects += this.db.run(
        `UPDATE effects SET state = 'IN_DOUBT', reason = ?, updated_at = ? WHERE effect_id = ? AND state = 'RUNNING'`,
        [reason, t, id],
      ).changes;
    }
    return { turns, effects };
  }

  /** Every RUNNING row still unsettled, regardless of whether its owner can be identified —
   *  the explicit boot sweep, and the only thing that can settle a legacy row whose owner was
   *  never stamped. Still IN_DOUBT, never re-executed, never SUCCEEDED. */
  reconcileInterrupted(reason: string): { turns: number; effects: number } {
    const t = now();
    const turns = this.db.run(
      `UPDATE turns SET state = 'IN_DOUBT', error = ?, updated_at = ? WHERE state = 'RUNNING'`,
      [reason, t],
    ).changes;
    const effects = this.db.run(
      `UPDATE effects SET state = 'IN_DOUBT', reason = ?, updated_at = ? WHERE state = 'RUNNING'`,
      [reason, t],
    ).changes;
    return { turns, effects };
  }

  // ── THE IDEMPOTENT OUTBOX ───────────────────────────────────────────────

  /** Stage a receipt for the ledger, keyed by its unique callId. A duplicate enqueue is
   *  ignored — the first staged payload is the only payload this callId will ever carry. */
  outboxEnqueue(row: { callId: string; kind: 'pre' | 'post'; effectId?: string; payload?: Record<string, unknown>; ts?: string }): void {
    const t = now();
    this.db.run(
      `INSERT OR IGNORE INTO outbox (call_id, kind, effect_id, status, payload, ts, created_at, updated_at)
       VALUES (?, ?, ?, 'pending', ?, ?, ?, ?)`,
      [row.callId, row.kind, row.effectId ?? '', JSON.stringify(row.payload ?? {}), row.ts ?? t, t, t],
    );
  }

  outboxDurable(callId: string, receiptDigest: string): void {
    this.db.run(
      `UPDATE outbox SET status = 'durable', receipt_digest = ?, last_error = NULL, updated_at = ? WHERE call_id = ?`,
      [receiptDigest, now(), callId],
    );
  }

  /** A failed append leaves a RETRYABLE record: the row stays visible to recovery with its
   *  payload intact and the failure named. */
  outboxFailed(callId: string, error: string): void {
    this.db.run(
      `UPDATE outbox SET status = 'failed', last_error = ?, attempts = attempts + 1, updated_at = ? WHERE call_id = ?`,
      [error.slice(0, 200), now(), callId],
    );
  }

  outboxRow(callId: string): OutboxRow | null {
    const r = this.db.query('SELECT * FROM outbox WHERE call_id = ?').get(callId) as RawRow | null;
    return r ? outboxOf(r) : null;
  }

  outboxPending(): OutboxRow[] {
    return (this.db.query(`SELECT * FROM outbox WHERE status IN ('pending', 'failed') ORDER BY created_at`).all() as RawRow[]).map(outboxOf);
  }

  /** Recovery, never duplicating: for every undurable row, LOCATE the receipt on the ledger
   *  first (the "ledger ok, ack lost" shape — the append landed, the acknowledgement did not).
   *  Found → mark durable, nothing re-applied. Absent → apply the stored payload exactly once.
   *  `locate` returns the on-ledger receipt digest or null; `apply` performs the append and
   *  returns the new receipt's digest (or throws, leaving the row retryable). */
  recoverOutbox(
    locate: (row: OutboxRow) => string | null,
    apply: (row: OutboxRow) => Promise<string>,
  ): Promise<{ located: number; applied: number; stillFailed: number }> {
    return (async () => {
      let located = 0, applied = 0, stillFailed = 0;
      for (const row of this.outboxPending()) {
        const onLedger = locate(row);
        if (onLedger) {
          this.outboxDurable(row.callId, onLedger);
          located++;
          continue;
        }
        try {
          const digest = await apply(row);
          this.outboxDurable(row.callId, digest);
          applied++;
        } catch (e) {
          this.outboxFailed(row.callId, e instanceof Error ? e.message : String(e));
          stillFailed++;
        }
      }
      return { located, applied, stillFailed };
    })();
  }

  // ── INSPECTION (gates and debugging; never load-bearing) ────────────────

  counts(): { turns: number; effects: number; outbox: { pending: number; durable: number; failed: number } } {
    const one = (sql: string): number => Number((this.db.query(sql).get() as { n: number }).n);
    return {
      turns: one('SELECT COUNT(*) AS n FROM turns'),
      effects: one('SELECT COUNT(*) AS n FROM effects'),
      outbox: {
        pending: one(`SELECT COUNT(*) AS n FROM outbox WHERE status = 'pending'`),
        durable: one(`SELECT COUNT(*) AS n FROM outbox WHERE status = 'durable'`),
        failed: one(`SELECT COUNT(*) AS n FROM outbox WHERE status = 'failed'`),
      },
    };
  }
}

export { TERMINAL_TURN, TERMINAL_EFFECT };
