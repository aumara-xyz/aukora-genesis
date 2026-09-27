/**
 * A TURN IS NOT A SEQ — and the migration that treated them as one handed out receipts over the wrong events.
 *
 * **MEASURED 2026-09-26, on a real session.** A queue record cites `content.turn = {sessionId, turn}`. The migration looked
 * up the event whose `seq` equals that `turn`. For a record citing turn 294:
 *
 *     the event at seq 294 = {"type":"step/end","seq":294,"time":1790064235299,"data":{"turn":2,"step":5}}
 *
 * A STEP BOUNDARY INSIDE TURN 2. The two numberings are not the same, and the gap grows with the session: cited turns 53,
 * 57 and 59 resolve to seq 8088, 8533 and 8683 at `turn/start` events. Every "linked" record under that rule carried a
 * receipt over an unrelated event — not a missing receipt, which is a gap, but a WRONG one, which is a false claim of
 * provenance on the tier that exists to be tracked.
 *
 * THE REAL LINK IS TWO STEPS: the cited turn → that turn's events (from its `turn/start` to its `turn/end`) → the event
 * whose line contains the record's text. This module is that rule, pure, so a court can drive it and the CLI cannot
 * quietly invent a shortcut again.
 *
 * AND IT REFUSES RATHER THAN GUESSING. A cited turn that is not in the session is `turn-not-found`; a turn that is present
 * but does not contain the text is `text-not-in-turn`. Both are answers; neither is a link.
 *
 * @module @aukora/dsh-plugin-kira/memory-turn-index
 */
import { MEMORY_TIERS } from './memory-tiers.mjs' // keeps this module in the plugin's import graph for the boundary court

/** The record's own words, as far as a match is concerned: long enough to be specific, short enough to survive a rewrap. */
export const MATCH_CHARS = 40

/**
 * Index a session's events by CONVERSATION TURN, from `turn/start` to `turn/end`.
 *
 * An event outside any turn is not indexed: it belongs to no turn a record could cite, and putting it in the nearest one
 * would be the same mistake as reading `seq` as a turn, one layer along.
 * @param {ReadonlyArray<{seq: number|null, line: string}>} events
 * @returns {Map<number, ReadonlyArray<{seq: number|null, line: string}>>}
 */
export function indexTurns(events) {
  const byTurn = new Map()
  let current = null
  for (const event of events ?? []) {
    let parsed
    try {
      parsed = JSON.parse(event.line)
    } catch {
      continue
    }
    const turn = parsed?.data?.turn
    if (parsed?.type === 'turn/start' && Number.isInteger(turn)) {
      current = turn
      if (!byTurn.has(current)) byTurn.set(current, [])
      byTurn.get(current).push(event)
      continue
    }
    if (parsed?.type === 'turn/end') {
      if (current !== null) byTurn.get(current)?.push(event)
      current = null
      continue
    }
    if (current !== null) byTurn.get(current)?.push(event)
  }
  return byTurn
}

/**
 * Resolve a citation to the event it means.
 * @param {{sessionId: string, turn: number, text: string, byTurn: Map<number, ReadonlyArray<{seq: number|null, line: string}>>}} input
 * @returns {{ok: true, event: {seq: number|null, line: string}, seq: number|null} | {ok: false, why: string}}
 */
export function resolveCitedTurn(input) {
  const { turn, text, byTurn } = input ?? {}
  if (!Number.isInteger(turn)) return { ok: false, why: 'no-turn-reference' }
  const needle = String(text ?? '').slice(0, MATCH_CHARS)
  if (needle === '') return { ok: false, why: 'statement-empty' }
  const events = byTurn?.get(turn)
  if (events === undefined) return { ok: false, why: 'turn-not-found' }
  const hit = events.find(event => event.line.includes(needle))
  if (hit === undefined) return { ok: false, why: 'text-not-in-turn' }
  return { ok: true, event: hit, seq: hit.seq }
}

/**
 * THE DEFECT, AS A FUNCTION — kept so a reader can see what was wrong and so a court can assert it.
 *
 * It answers the event whose `seq` equals the cited turn, which is what the migration used to do. It is exported ON
 * PURPOSE: a defect that was found by measurement deserves to be reproducible by name rather than described in a comment.
 * @param {{turn: number, events: ReadonlyArray<{seq: number|null, line: string}>}} input
 * @returns {{seq: number|null, line: string}|null}
 */
export function bySeqInsteadOfTurn(input) {
  const { turn, events } = input ?? {}
  return (events ?? []).find(event => event.seq === turn) ?? null
}

/** Re-exported so callers read the tier vocabulary from wherever they are. */
export const RECALLABLE = MEMORY_TIERS
