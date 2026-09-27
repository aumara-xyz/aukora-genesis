/**
 * WHERE THE APPROVAL HISTORY COMES FROM.
 *
 * The log is a file on disk that only the host can read (digests only, mode 0600, under `state/logs` — the shape sent
 * to AUMLOK). A browser cannot open it, so the view reads a route this face's host half serves, and the route reads
 * the log. **UNTIL THAT ROUTE AND AUMLOK'S LOG LAND**, the source below is the fixture —
 * `tests/fixtures/aukora-approval-log.fixture.json`, the exact shape I sent them — and the view says which source it
 * is reading rather than presenting a fixture as history.
 *
 * @module approvals-api
 */

import { approvalRowsOf } from './approvals-model.ts'
import type { ApprovalEntry, ApprovalRow } from './approvals-model.ts'

/** The route the host half serves. Absent until it lands, which the view reports rather than hiding. */
export const APPROVALS_ROUTE = '/api/aukora/approvals'

/**
 * *** WHERE KIRA'S PENDING MEMORIES COME FROM, AND WHY THE CARD READS IT DIRECTLY. ***
 *
 * *The card is served from the same origin as the route, so the shortest honest wire is a second fetch rather than a
 * proxy through the layout host — and a proxy would be a second place that decides what the owner is looking at.*
 *
 * *** THE ROUTE CARRIES THE EXACT BYTES. *** *An approval binds BYTES, so a card built from a summary would show the
 * owner one sentence and hand the settle a different document. `bytes` is what the row renders; every other field on the
 * entry is a convenience beside it.*
 */
export const KIRA_PENDING_ROUTE = '/api/kira/pending'

/** *** THE APPROVAL ROUTE, WHICH PROPOSES AND CANNOT SETTLE. *** *See `approvePending` below.* */
export const KIRA_APPROVE_ROUTE = '/api/kira/approve'

/** One pending memory, as the route describes it — with the bytes an approval would bind. */
export interface PendingMemory {
  readonly recordId: string
  /** *** THE EXACT BYTES. *** The document the settle binds, and the only thing the owner can judge. */
  readonly bytes: string
  readonly subject: string | null
  readonly kind: string | null
  readonly createdAt: string | null
}

/** What the view reads from. A court passes its own; the app passes the live one. */
export interface ApprovalsSource {
  readonly read: () => Promise<ApprovalsRead>
}

/**
 * What a read produced — **including the three facts that are not the entries.**
 *
 * `absent` is the one that matters most: a machine with no log yet and a machine whose owner has approved nothing are
 * different facts, and a view that renders both as "nothing has been approved yet" tells a person something false
 * about their own past. `skipped` is the same kind of fact at a smaller scale — lines that are there and could not be
 * read — and `mode` is how a log the whole machine can read becomes something somebody can notice.
 */
export interface ApprovalsRead {
  readonly entries: readonly ApprovalEntry[]
  /** True when there is no log at all. **Not the same as an empty log, and never rendered as one.** */
  readonly absent: boolean
  /** Lines that were present and could not be understood. */
  readonly skipped: number
  /** The log file's permission bits, or null when there is no file. */
  readonly mode: number | null
  readonly from: 'log' | 'fixture' | 'none'
  /**
   * *** WHAT IS WAITING FOR THE OWNER, WITH ITS BYTES. ***
   *
   * *`absent` and `unreadable` are DIFFERENT FACTS and neither is an empty list: a queue nobody could read must not read
   * as a queue with nothing in it, or the owner concludes he has nothing to approve because a route was missing.*
   */
  readonly pending: readonly PendingMemory[]
  /** True when the pending route could not be read at all. **Not the same as an empty queue.** */
  readonly pendingAbsent: boolean
  /** How many queued files did not verify, so a damaged queue cannot read as a shorter one. */
  readonly pendingUnreadable: number
}

/** Why the history could not be read, in the three ways this codebase distinguishes. */
export type ApprovalsProblem = 'absent' | 'refused' | 'failed'

/** A failure that names itself and carries nothing from the log — not a digest, not a subject, not a path. */
export class ApprovalsError extends Error {
  readonly problem: ApprovalsProblem
  readonly status: number

  constructor(problem: ApprovalsProblem, status: number) {
    super(`approvals: ${problem} (${String(status)})`)
    this.name = 'ApprovalsError'
    this.problem = problem
    this.status = status
  }
}

/** The live source: the route, and nothing invented when it does not answer. */
export function httpApprovals(): ApprovalsSource {
  return {
    read: async () => {
      let response: Response
      try {
        response = await fetch(APPROVALS_ROUTE)
      } catch {
        throw new ApprovalsError('absent', 0)
      }
      if (!response.ok) throw new ApprovalsError(response.status === 404 ? 'absent' : 'refused', response.status)
      const body: unknown = await response.json()
      const shaped = body !== null && typeof body === 'object' ? (body as Record<string, unknown>) : {}
      const entries = Array.isArray(shaped.entries) ? (shaped.entries as ApprovalEntry[]) : []
      // **THE ROUTE'S THREE FACTS ARE CARRIED, NOT DROPPED.** My first version returned the entries and the word
      // `log` unconditionally, which meant a machine with no log at all read as a real, empty history — the exact
      // statement this goal forbids. `absent` decides the word now, so the view cannot get it wrong on its own.
      const absent = shaped.absent === true
      return {
        entries,
        absent,
        skipped: typeof shaped.skipped === 'number' && Number.isFinite(shaped.skipped) ? shaped.skipped : 0,
        mode: typeof shaped.mode === 'number' ? shaped.mode : null,
        from: absent ? 'none' : 'log',
        ...(await readPending()),
      }
    },
  }
}

/**
 * Read Kira's pending queue, and *** NEVER TURN A FAILURE INTO AN EMPTY LIST. ***
 *
 * *A route that did not answer, a route that refused and a route that said "nothing is waiting" are three different facts,
 * and collapsing them tells the owner something false about his own memory: that he has nothing to approve. So a failure
 * returns `pendingAbsent: true` with an empty list, and the view says so.*
 */
async function readPending(): Promise<Pick<ApprovalsRead, 'pending' | 'pendingAbsent' | 'pendingUnreadable'>> {
  let response: Response
  try {
    response = await fetch(KIRA_PENDING_ROUTE)
  } catch {
    return { pending: [], pendingAbsent: true, pendingUnreadable: 0 }
  }
  if (!response.ok) return { pending: [], pendingAbsent: true, pendingUnreadable: 0 }
  const body: unknown = await response.json()
  const shaped = body !== null && typeof body === 'object' ? (body as Record<string, unknown>) : {}
  const rows = Array.isArray(shaped.entries) ? shaped.entries : []
  const pending: PendingMemory[] = []
  let unreadable = 0
  for (const row of rows) {
    if (row === null || typeof row !== 'object') continue
    const entry = row as Record<string, unknown>
    // *** A ROW WITHOUT BYTES IS NOT SHOWN AS A ROW WITH NONE. *** *It is counted as unreadable, because a queue file that
    // does not verify must make the queue look DAMAGED rather than SHORTER.*
    if (typeof entry.recordId !== 'string' || typeof entry.bytes !== 'string') { unreadable += 1; continue }
    pending.push({
      recordId: entry.recordId,
      bytes: entry.bytes,
      subject: typeof entry.subject === 'string' ? entry.subject : null,
      kind: typeof entry.kind === 'string' ? entry.kind : null,
      createdAt: typeof entry.createdAt === 'string' ? entry.createdAt : null,
    })
  }
  return { pending, pendingAbsent: false, pendingUnreadable: unreadable }
}

/**
 * *** APPROVE ONE PENDING MEMORY. ***
 *
 * **THIS PROPOSES AND CANNOT SETTLE, AND THAT IS THE DESIGN RATHER THAN A LIMITATION.** *`settleAuthorized` refuses a
 * store belonging to another uid, so nothing on this side of the socket can write a memory. The click becomes a FROZEN
 * PROPOSAL, the owner answers it in person, and the daemon calls Kira's own settle — one chain, and this end holds no
 * authority.* *** SO A `true` HERE MEANS "THE OWNER WILL BE ASKED", NEVER "IT IS WRITTEN". ***
 */
export async function approvePending(
  recordId: string,
): Promise<{ ok: boolean; code: string | undefined; because: string | undefined }> {
  try {
    const response = await fetch(KIRA_APPROVE_ROUTE, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ id: recordId }),
    })
    const body: unknown = await response.json().catch(() => null)
    const shaped = body !== null && typeof body === 'object' ? (body as Record<string, unknown>) : {}
    return { ok: shaped.ok === true, code: typeof shaped.code === 'string' ? shaped.code : undefined,
      because: typeof shaped.because === 'string' ? shaped.because : undefined }
  } catch (error) {
    return { ok: false, code: 'approvals-api:unreachable', because: String((error as Error)?.message ?? error).slice(0, 160) }
  }
}

/** A source that reads the fixture, for a court or a development build. **It says so in `from`.** */
export function fixtureApprovals(entries: readonly ApprovalEntry[], pending: readonly PendingMemory[] = []): ApprovalsSource {
  return { read: async () => ({ entries, absent: false, skipped: 0, mode: null, from: 'fixture', pending, pendingAbsent: false, pendingUnreadable: 0 }) }
}

/** The rows a view should draw, given whatever the source answered. An unreadable log is an empty history, not a crash. */
export function rowsOfAnswer(answer: { readonly entries: readonly ApprovalEntry[] } | null | undefined): readonly ApprovalRow[] {
  return approvalRowsOf(answer?.entries ?? [])
}
