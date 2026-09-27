/**
 * ONE HEAVY RUN AT A TIME, ENFORCED RATHER THAN REQUESTED.
 *
 * *** A RULE IN A MESSAGE IS NOT A GATE. *** The Mac has 16 GB and swap reached 10 GB, and lanes were asked to
 * be careful. Every lane obeyed in good faith and the machine still drowned, because NOTHING MADE TWO
 * CONCURRENT RUNS IMPOSSIBLE — they were merely discouraged. This takes an exclusive lock before a heavy
 * command runs and releases it on every exit path.
 *
 * WHY A LOCK FILE AND NOT `flock`: Node has no `flock(2)`, and a platform binary would be one more thing to
 * install on a host we are trying not to perturb. `O_EXCL` gives the same mutual exclusion for this workload:
 * the holder's identity is IN the file, so a waiter can say WHO holds it rather than only THAT it is held.
 *
 * *** AND A DEAD HOLDER MUST NOT HOLD THE LOCK FOR EVER. *** A `SIGKILL` runs no handler, so the file stays.
 * Reclaiming it is the dangerous half — deleting a LIVE holder's lock would let two heavy runs overlap, which
 * is the whole thing being prevented — SO THE PID IS PROVEN GONE BEFORE ANYTHING IS REMOVED: `process.kill(pid,
 * 0)` throwing `ESRCH` is the only evidence accepted. `EPERM` means the process EXISTS and belongs to someone
 * else, and it is treated as alive.
 */
import { closeSync, existsSync, fsyncSync, linkSync, mkdirSync, openSync, readdirSync, readFileSync, renameSync, unlinkSync, writeSync } from 'node:fs'
import { homedir } from 'node:os'
import { basename, dirname, join } from 'node:path'

/** Owner-only, under the user cache, so nothing about a run is world-readable. */
export const HEAVY_RUN_DIR = join(homedir(), '.cache', 'aukora')
/**
 * *** OVERRIDABLE, AND THE COURT IS WHY. *** My first version hard-coded this path, and the court that tests
 * the lock set `AUKORA_HEAVY_RUN_LOCK` to a scratch file — so IT MANIPULATED ONE FILE WHILE THE MODULE USED
 * ANOTHER, and two arms failed for a reason that had nothing to do with locking. Worse, a court that could
 * only use the real path WOULD TAKE THE REAL LOCK WHILE IT RAN, stopping every other lane: a court for a
 * resource gate must not consume the resource it is testing.
 */
export const HEAVY_RUN_LOCK = process.env.AUKORA_HEAVY_RUN_LOCK ?? join(HEAVY_RUN_DIR, 'heavy-run.lock')

/** A short, non-secret description of what a process is running, for a waiter to print. */
function argvHead(argv) {
  const parts = (Array.isArray(argv) ? argv : []).slice(0, 4).map(String)
  const joined = parts.join(' ')
  return joined.length > 120 ? `${joined.slice(0, 117)}...` : joined
}

/** True when the process exists. `EPERM` counts as alive: it exists and is not ours to judge. */
export function pidIsAlive(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return false
  try {
    process.kill(pid, 0)
    return true
  } catch (error) {
    return error?.code !== 'ESRCH'
  }
}

/** What the lock file says, or null when it is absent or unreadable. */
export function readHolder(lockPath = HEAVY_RUN_LOCK) {
  try {
    const parsed = JSON.parse(readFileSync(lockPath, 'utf8'))
    return typeof parsed?.pid === 'number' ? parsed : null
  } catch {
    return null
  }
}

/**
 * Take the lock, waiting until it is free.
 *
 * @param {{lockPath?: string, pollMs?: number, onWait?: Function, now?: Function}} [options]
 * @returns {Promise<{release: Function, reclaimed: (object|null)}>}
 */
// ══ A FAIR QUEUE, BECAUSE THE LOCK HAD NONE ════════════════════════════════════════════════════════════════
// *** MEASURED: THE LOCK IS `link`/`wx` ON EEXIST, SO RELEASE ORDER IS WHOEVER POLLS FIRST. *** ONE JOB WAITED
// TWO AND A HALF HOURS AND NEVER RAN, and a priority cut is not guaranteed to be next. THAT IS NOT A QUEUE; IT
// IS A RACE WITH A LONG MEMORY.
//
// THE DESIGN, AND WHY EACH PIECE IS THE SIMPLEST THING THAT WORKS:
//   * A WAITER TAKES A TICKET -- an exclusive-created file in the lock's own directory, so taking one is atomic
//     by the same mechanism the lock itself uses.
//   * *** THE TICKET NAME IS `<priority>-<timestamp>-<pid>`, ZERO-PADDED, SO LEXICAL ORDER IS QUEUE ORDER. ***
//     A timestamp is monotonic to the millisecond WITHOUT A SHARED COUNTER, which matters because a counter file
//     is a second thing to lock; the pid breaks same-millisecond ties deterministically.
//   * ONLY THE LOWEST LIVE TICKET MAY ACQUIRE. Everyone else waits, so the race is replaced by an order.
//   * A DEAD WAITER'S TICKET IS REAPED THE SAME WAY A DEAD HOLDER IS -- `pidIsAlive` on the pid in the name --
//     BECAUSE A QUEUE THAT A `kill -9` CAN BLOCK FOR EVER IS WORSE THAN NO QUEUE AT ALL.
//   * `AUKORA_HEAVY_RUN_PRIORITY=1` SORTS AHEAD OF EVERY NORMAL TICKET (for a release cut or a live fix), and
//     the flag is written into the lock record so a reader can see WHY something went first.
// ══ THE MIXED-VERSION WINDOW, DOCUMENTED WHERE THE DECISION IS MADE ═════════════════════════════════════════
// *** A WAITER STILL RUNNING THE OLD CODE TAKES NO TICKET, SO IT IS INVISIBLE TO THE GATE. *** That is the one
// real limitation of this queue and it is written here rather than left in a commit message, because a commit
// message is not where the next reader looks before changing the gate.
//
// ASKED FOR AND ANSWERED: SHOULD THE NEW CODE REFUSE TO WAIT BEHIND A HOLDER THAT HAS NO TICKET RECORD?
// *** NO, AND REFUSING WOULD BE UNSAFE. *** THE HOLDER IS ALREADY RUNNING -- refusing does not stop it, does not
// release its lock and does not make it take a ticket. **IT ONLY MEANS THE NEW WAITER NEVER RUNS AT ALL**, WHICH
// CONVERTS A FAIRNESS DELAY INTO A PERMANENT REFUSAL: strictly worse than the unfairness this replaces, and it
// would arrive exactly during a rollout, when several versions are live at once.
//
// SO THE GATE IS DELIBERATELY PERMISSIVE ABOUT AN ABSENT TICKET, AND THE WINDOW CLOSES BY ITSELF as old waiters
// drain. **NOTHING ABOUT THE LOCK FILE CHANGES EITHER WAY -- the holder record carries no ticket, so an
// unticketed waiter keeps racing exactly as it did before, and a ticketed one simply discovers it is not next.**
// THE COST OF THE WINDOW IS BOUNDED AND NAMED: UNTILED WAITERS ARE UNFAIRLY SERVED, AND THEY ARE NOT STARVED --
// they still poll and still acquire, in whatever order the race gives them.
export const TICKET_PRIORITY_PREFIX = '0'
export const TICKET_NORMAL_PREFIX = '1'

/** This process's ticket name, or null when ticketing is off. */
function ticketPath(lockPath) {
  const priority = process.env.AUKORA_HEAVY_RUN_PRIORITY === '1'
  // PADDED TO 15 DIGITS: `Date.now()` IS 13, AND PADDING MEANS A SHORTER NUMBER CAN NEVER SORT AFTER A LONGER
  // ONE BY ACCIDENT.
  const stamp = String(Date.now()).padStart(15, '0')
  const pid = String(process.pid).padStart(7, '0')
  return join(dirname(lockPath), `.ticket-${priority ? TICKET_PRIORITY_PREFIX : TICKET_NORMAL_PREFIX}-${stamp}-${pid}`)
}

/** The pid encoded in a ticket name, or null when it cannot be read. */
function ticketPid(name) {
  const m = /-(\d{7})$/u.exec(name)
  return m === null ? null : Number(m[1])
}

/**
 * Take a ticket and return its path, or null when the ticket could not be taken.
 * ATOMIC BY EXCLUSIVE CREATE: the same primitive as the lock, so it cannot half-exist.
 */
function takeTicket(lockPath) {
  const path = ticketPath(lockPath)
  try {
    const fd = openSync(path, 'wx', 0o600)
    try { writeSync(fd, `${JSON.stringify({ pid: process.pid, priority: process.env.AUKORA_HEAVY_RUN_PRIORITY === '1', at: new Date().toISOString() })}\n`) } finally { closeSync(fd) }
    return path
  } catch (error) {
    if (error?.code === 'EEXIST') return path // our own name already exists from a previous attempt: it is ours
    return null
  }
}

/**
 * The name of the lowest live ticket, or null when there are none.
 * *** DEAD TICKETS ARE REMOVED WHILE LOOKING, SO THE QUEUE CANNOT ACCUMULATE GHOSTS. ***
 */
function lowestLiveTicket(lockPath, readdirSync) {
  const dir = dirname(lockPath)
  let names
  try { names = readdirSync(dir) } catch { return null }
  const tickets = names.filter(n => n.startsWith('.ticket-')).sort()
  for (const name of tickets) {
    const pid = ticketPid(name)
    if (pid === null || !pidIsAlive(pid)) {
      // REAPED EXACTLY LIKE A DEAD HOLDER: the pid is in the name, so liveness is answerable without opening it.
      try { unlinkSync(join(dir, name)) } catch { /* another waiter reaped it first */ }
      continue
    }
    return name
  }
  return null
}

export async function acquireHeavyRun(options = {}) {
  const lockPath = options.lockPath ?? HEAVY_RUN_LOCK
  const pollMs = options.pollMs ?? 500
  mkdirSync(join(lockPath, '..'), { recursive: true, mode: 0o700 })
  let reclaimed = null
  let announced = false
  // *** THE TICKET IS TAKEN ONCE, BEFORE THE LOOP, AND HELD FOR THE WHOLE WAIT. *** Taking it inside the loop
  // would let a waiter silently move to the BACK of the queue every time it retried -- which is the unfairness
  // this replaces, wearing the costume of a fix.
  let myTicket = null
  if (process.env.AUKORA_HEAVY_RUN_NO_TICKET !== '1') myTicket = takeTicket(lockPath)
  try {
  for (;;) {
    try {
      // *** THE METADATA IS WRITTEN TO A TEMP FILE AND RENAMED INTO PLACE, AND THAT IS FINDING 7. ***
      // `openSync(lockPath, 'wx')` FOLLOWED BY `writeSync` CREATES THE LOCK AND THEN FILLS IT IN. A PROCESS THAT
      // DIED BETWEEN THE TWO -- a kill, a power cut, an OOM -- LEFT A ZERO-BYTE LOCK FILE, and `readHolder`
      // parses it, fails, and RETURNS NULL. The reclaim below only acts on `holder !== null`, SO AN EMPTY LOCK WAS
      // NEVER RECLAIMED AND THE LOCK WAS WEDGED FOREVER, WITH EVERY LANE POLLING IT UNBOUNDED.
      // `rename` IS ATOMIC WITHIN A DIRECTORY: the lock either does not exist or holds COMPLETE metadata, so
      // THERE IS NO STATE IN WHICH IT EXISTS AND CANNOT BE READ -- which is what makes the unwedgeable window go
      // away rather than merely being detected.
      // ══ TICKET GATE: ONLY THE LOWEST LIVE TICKET MAY TRY TO ACQUIRE ═════════════════════════════════════════
    // *** THIS IS THE WHOLE FAIRNESS FIX. WITHOUT IT, WHOEVER POLLS FIRST WINS REGARDLESS OF WHO ASKED FIRST --
    // measured: one job waited two and a half hours and never ran. *** The gate is checked BEFORE the atomic
    // link, so a waiter that is not next does not even contend; the link remains the mutual exclusion, and the
    // ticket only decides the ORDER OF ATTEMPTS.
    // *** AND IT CANNOT WEDGE: a ticket whose pid is dead is reaped by `lowestLiveTicket`, SO A `kill -9` ON A
    // WAITER RELEASES ITS PLACE THE SAME WAY A `kill -9` ON THE HOLDER RELEASES THE LOCK. If no ticket can be
    // read at all, the gate is skipped rather than blocking -- A QUEUE THAT CANNOT BE READ MUST NOT BECOME A
    // LOCK, because that would turn a fairness fix into the wedge it was meant to remove.
    if (myTicket !== null) {
      const next = lowestLiveTicket(lockPath, readdirSync)
      if (next !== null && next !== basename(myTicket)) {
        if (!announced) { announced = true; options.onWait?.(readHolder(lockPath), next) }
        await new Promise(resolvePromise => setTimeout(resolvePromise, pollMs))
        continue
      }
    }
    const tmp = `${lockPath}.${String(process.pid)}.tmp`
      const fd = openSync(tmp, 'wx', 0o600)
      writeSync(fd, `${JSON.stringify({
        pid: process.pid, argv: argvHead(process.argv), startedAt: new Date().toISOString(),
      }, null, 2)}\n`)
      // *** THE FSYNC IS PART OF THE PATTERN, NOT A REFINEMENT OF IT (beta-104 item 1). *** `link` MAKES THE
      // LOCK APPEAR ATOMICALLY *TO OTHER PROCESSES*, AND IT DOES NOT MAKE THE BYTES DURABLE. On a crash the
      // directory entry can survive the contents, WHICH IS THE SAME ZERO-BYTE LOCK THIS PATTERN EXISTS TO
      // ABOLISH -- reached by a different route. So: write, fsync the FILE, close, then link, then fsync the
      // DIRECTORY so the name itself is durable.
      fsyncSync(fd)
      closeSync(fd)
      try {
        // `link` + `unlink` rather than `rename`: RENAME SILENTLY REPLACES AN EXISTING LOCK, WHICH WOULD DESTROY
        // THE MUTUAL EXCLUSION THIS WHOLE FUNCTION EXISTS FOR. `link` FAILS WITH EEXIST EXACTLY AS `wx` DID.
        linkSync(tmp, lockPath)
      } catch (error) {
        try { unlinkSync(tmp) } catch { /* gone */ }
        throw error
      }
      unlinkSync(tmp)
      // AND THE DIRECTORY, SO THE NAME SURVIVES A CRASH. A durable file with a non-durable name is a lock that
      // is there and then is not.
      try {
        const dfd = openSync(dirname(lockPath), 'r')
        try { fsyncSync(dfd) } finally { closeSync(dfd) }
      } catch { /* a filesystem that refuses a directory fsync: the file fsync above still holds */ }
      let released = false
      return {
        reclaimed,
        release() {
          if (released) return
          released = true
          // *** RELEASE CHECKS THAT THE LOCK IS STILL OURS (FINDING 6). *** This used to `unlinkSync(lockPath)`
          // unconditionally -- SO A HOLDER THAT HAD BEEN RECLAIMED WHILE STILL RUNNING, OR ONE RELEASING LATE,
          // DELETED THE LOCK SOMEONE ELSE HAD JUST ACQUIRED. A release that removes another process's lock is a
          // DOUBLE-GRANT IN THE OTHER DIRECTION.
          const now = readHolder(lockPath)
          if (now !== null && now.pid !== process.pid) return
          try { unlinkSync(lockPath) } catch { /* already gone */ }
        },
      }
    } catch (error) {
      if (error?.code !== 'EEXIST') throw error
    }
    const holder = readHolder(lockPath)
    // *** AN UNPARSEABLE LOCK IS RECLAIMED, AND THAT IS THE OTHER HALF OF FINDING 7. *** I fixed the WRITE first
    // -- metadata now goes to a temp file and is linked into place, so no lock written by THIS code can be
    // incomplete. But a lock that ALREADY EXISTS empty, from a crash under the old code or from any other
    // writer, still parsed to `null` and was still NEVER RECLAIMED: I had made the wedge UNREACHABLE WITHOUT
    // MAKING IT RECOVERABLE, and the court hung for ten minutes on exactly that file.
    //
    // A LOCK NOBODY CAN PARSE CANNOT BELONG TO A LIVE HOLDER, BECAUSE A LIVE HOLDER'S LOCK IS ALWAYS COMPLETE.
    // So it is claimed exactly like a proven-dead one, by the same atomic rename.
    const unreadable = holder === null && existsSync(lockPath)
    if (unreadable || (holder !== null && !pidIsAlive(holder.pid))) {
      // *** RECLAIM IS ATOMIC, AND THAT IS FINDING 6. *** Reading the holder and unlinking its pathname were TWO
      // OPERATIONS, so two processes could both read the same dead holder, both decide to reclaim, and THE
      // SECOND `unlinkSync` COULD REMOVE THE LOCK THE FIRST HAD JUST ACQUIRED -- A DOUBLE-GRANT, on the one
      // mechanism every heavy run in this repository depends on.
      // `rename` MOVES THE PATHNAME AND EXACTLY ONE CALLER CAN WIN IT: the loser gets ENOENT and loops. The
      // winner then re-reads the file it now owns and confirms it still names the dead holder, because the dead
      // holder's own release may have removed it in between.
      const claimed = `${lockPath}.reclaim-${String(process.pid)}`
      try {
        renameSync(lockPath, claimed)
      } catch {
        continue // somebody else won the reclaim, or the lock is gone: re-enter the loop either way
      }
      const after = readHolder(claimed)
      try { unlinkSync(claimed) } catch { /* gone */ }
      if (unreadable) {
        // It was unparseable before the rename and is expected to be unparseable after: the only thing that
        // mattered is that WE won the rename, which the call above proves.
        reclaimed = { pid: null, argv: '<unreadable lock>', startedAt: null }
      } else if (after !== null && after.pid === holder.pid && !pidIsAlive(after.pid)) {
        reclaimed = holder
      }
      continue
    }
    if (!announced) {
      announced = true
      options.onWait?.(holder)
    }
    await new Promise(resolvePromise => setTimeout(resolvePromise, pollMs))
  }

  } finally {
    // THE TICKET IS REMOVED ON THE WAY OUT, WHETHER WE WON OR THREW. A ticket left behind by a crashed waiter is
    // reaped by pid anyway, but leaving one we KNOW is finished makes the queue shorter for everybody behind us.
    if (myTicket !== null) { try { unlinkSync(myTicket) } catch { /* already reaped */ } }
  }
}

/**
 * Take the lock, run `body`, and release it whatever happens.
 *
 * THE RELEASE IS IN A `finally` AND ON THE SIGNALS, because the two ways a lock leaks are an exception and a
 * `SIGTERM`, and only one of them is a `finally`. A `SIGKILL` cannot be handled by anything — that is what the
 * reclaim path above is for, and it is why the pid is written into the file.
 *
 * @param {Function} body
 * @param {object} [options]
 */
export async function withHeavyRun(body, options = {}) {
  const lock = await acquireHeavyRun(options)
  const handlers = new Map()
  for (const signal of ['SIGINT', 'SIGTERM', 'SIGHUP']) {
    const handler = () => { lock.release(); process.exit(130) }
    handlers.set(signal, handler)
    process.on(signal, handler)
  }
  try {
    return await body(lock)
  } finally {
    for (const [signal, handler] of handlers) process.off(signal, handler)
    lock.release()
  }
}
