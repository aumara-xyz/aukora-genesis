/**
 * CARRY-OVER, READ LIVE FIRST — and the honest answer about whether anything was carried.
 *
 * TWO DEFECTS, ONE READER.
 *
 * ① **SHE GETS ZERO PRIOR TURNS ON A NEW THREAD, AND THE ERRORS ARE SWALLOWED.** The old path went straight to
 * the durable store and wrapped both the listing and each per-session read in `catch { … }` — so a failure was
 * indistinguishable from an empty result, and there is no way to tell "he has said nothing before" from "we
 * could not read what he said". **A conversation that is LIVE IS ALREADY IN MEMORY**, and reading it costs
 * nothing and cannot fail the way a filesystem read can, so live is consulted first and cold is the fallback.
 *
 * ② **THE PROMPT LIES ABOUT IT.** `presenceSystemOpening` adds "A fresh conversation opens holding the spoken
 * turns of the most recent one" whenever the two CONFIG values are set — `spokenMemoryReach > 0` and a
 * persistence resolver exists — and says it **whether or not a single turn was carried.** A sentence about
 * what happened must be printed because it happened, so the claim is now a function of the RESULT:
 * `carryOverClaim(carried)` returns the sentence only when turns were actually carried, and `''` otherwise.
 *
 * WHY THIS IS PLAIN `.js`: the caller is TypeScript in a bundle a court cannot import, and both rules here are
 * small enough to live where the tests are. A rule that can only be grepped is not measured.
 *
 * @module carry-over
 */

/**
 * The sentence the system opening may print, and the ONLY way it may be printed.
 *
 * @param {number} carried - how many prior turns were actually carried into this conversation
 * @returns {string} the claim when turns were carried, and nothing at all when none were
 */
export function carryOverClaim(carried: number): string {
  const count = typeof carried === 'number' && Number.isFinite(carried) ? carried : 0
  if (count <= 0) return ''
  return ' A fresh conversation opens holding the spoken turns of the most recent one, so what was said to you '
    + 'keeps reaching you across sessions.'
}

/**
 * The newest recorded spoken turns from a LIVE session, excluding this one.
 *
 * **THE LIVE STORE IS A MAP OF `{id, snapshotEvents()}`, and the same shape the durable path produces is built
 * here** so the caller does not care which source answered: a single "read turns out of an event log" function
 * serves both.
 *
 * @param {Iterable<{id: string, snapshotEvents: () => readonly object[]}>} live - the in-memory sessions
 * @param {string} excludeId - the fresh session, which is not a prior conversation
 * @param {(events: readonly object[]) => readonly object[]} turnsFrom - reads spoken turns out of one event log
 * @returns {{turns: readonly object[], from: string|null, error: string|null}}
 */
export function priorTurnsFromLive<T>(
  live: Iterable<{ id: string; snapshotEvents: () => readonly unknown[] }> | null | undefined,
  excludeId: string,
  // **THE CALLBACK IS TOLD WHICH SESSION IT IS READING, AND WITHOUT THAT IT CANNOT DO ITS JOB.** `turnsFrom`
  // received only the events, so a caller wanting to consult the CANDIDATE's own recorded file had no id to pass and
  // **passed the new session's instead** — which is empty by definition, because carry-over exists for a session
  // that has no history yet. **The own-file step therefore never ran on the live path**, and only the candidate's
  // LEGACY events were ever read. A callback that cannot name its subject will be given the wrong one.
  turnsFrom: (events: readonly unknown[], sessionId: string) => readonly T[],
): { turns: readonly T[]; from: string | null; error: string | null } {
  let newest: { turns: readonly T[]; from: string; error: null } | null = null
  try {
    for (const session of live ?? []) {
      if (session === null || typeof session !== 'object') continue
      if (String(session.id) === String(excludeId)) continue
      if (typeof session.snapshotEvents !== 'function') continue
      const turns = turnsFrom(session.snapshotEvents(), String(session.id))
      if (!Array.isArray(turns) || turns.length === 0) continue
      // The live store carries no timestamps this reader can trust across sessions, so the LAST session with
      // turns wins rather than the one with the greatest recorded time. A live conversation is by definition
      // the one someone is having now.
      newest = { turns, from: String(session.id), error: null }
    }
  } catch (cause) {
    return { turns: [], from: null, error: `the live session store could not be read: ${String((cause as Error)?.message ?? cause)}` }
  }
  return newest ?? { turns: [], from: null, error: null }
}

/**
 * READ THE PRIOR CONVERSATION, LIVE FIRST, AND SAY WHAT WENT WRONG WHEN NOTHING WAS FOUND.
 *
 * **A FAILURE IS REPORTED RATHER THAN SWALLOWED**, and that is a behaviour change with a reason: the old code
 * returned `[]` for an unreadable directory, a damaged log and an owner who had genuinely never spoken, so the
 * one question a person asks — "why does she not remember?" — had no answer available anywhere. The errors are
 * collected and returned; the caller decides what to do with them, and the turn still answers either way.
 *
 * @param {Readonly<{
 *   live?: Iterable<{id: string, snapshotEvents: () => readonly object[]}>,
 *   sessionId: string,
 *   turnsFrom: (events: readonly object[]) => readonly object[],
 *   listCold?: () => Promise<readonly {id: string, createdAt?: number, origin?: string}[]>,
 *   readCold?: (id: string) => Promise<readonly object[]>,
 *   reach?: number,
 * }>} input
 * @returns {Promise<{turns: readonly object[], source: 'live'|'cold'|'none', from: string|null, errors: readonly string[]}>}
 */
export async function readPriorConversation<T>(input: {
  live?: Iterable<{ id: string; snapshotEvents: () => readonly unknown[] }> | null
  sessionId: string
  turnsFrom: (events: readonly unknown[]) => readonly T[]
  listCold?: () => Promise<readonly { id: string; createdAt?: number; origin?: string }[]>
  readCold?: (id: string) => Promise<readonly unknown[]>
  reach?: number
}): Promise<{ turns: readonly T[]; source: 'live' | 'cold' | 'none'; from: string | null; errors: readonly string[] }> {
  const errors: string[] = []

  // ① LIVE FIRST. It cannot fail the way a cold read can, and the conversation someone just had is the one
  //    most likely to matter.
  const live = priorTurnsFromLive(input.live, input.sessionId, input.turnsFrom)
  if (live.error !== null) errors.push(live.error)
  if (live.turns.length > 0) {
    return { turns: live.turns, source: 'live', from: live.from, errors }
  }

  // ② COLD, AND EVERY FAILURE NAMED.
  const reach = typeof input.reach === 'number' && input.reach > 0 ? input.reach : 0
  if (reach === 0 || typeof input.listCold !== 'function' || typeof input.readCold !== 'function') {
    return { turns: [], source: 'none', from: null, errors }
  }
  let headers: readonly { id: string; createdAt?: number; origin?: string }[]
  try {
    headers = await input.listCold()
  } catch (cause) {
    errors.push(`the prior-conversation list could not be read: ${String((cause as Error)?.message ?? cause)}`)
    return { turns: [], source: 'none', from: null, errors }
  }
  const candidates = (Array.isArray(headers) ? headers : [])
    .filter(header => header !== null && typeof header === 'object')
    .filter(header => String(header.id) !== String(input.sessionId) && header.origin !== 'subagent')
    .sort((a, b) => (Number(b.createdAt) || 0) - (Number(a.createdAt) || 0))
    .slice(0, reach)
  for (const header of candidates) {
    let events: readonly unknown[]
    try {
      events = await input.readCold(String(header.id))
    } catch (cause) {
      // NAMED, not skipped silently: one damaged log must not block the next candidate, but the reader has to
      // be able to say that it happened.
      errors.push(`the log of ${String(header.id)} could not be read: ${String((cause as Error)?.message ?? cause)}`)
      continue
    }
    const turns = input.turnsFrom(Array.isArray(events) ? events : [])
    if (Array.isArray(turns) && turns.length > 0) {
      return { turns, source: 'cold', from: String(header.id), errors }
    }
  }
  return { turns: [], source: 'none', from: null, errors }
}
