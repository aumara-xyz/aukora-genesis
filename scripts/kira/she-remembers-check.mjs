/**
 * SHE REMEMBERS — the after-cutover check.
 *
 * **FABLE'S kira-122 ITEM 4:** *"A small script, `scripts/kira/she-remembers-check.mjs`, for after tonight's cutover: it asks recall
 * a question about something captured earlier today, prints what came back (tier, source and verify state; no private text in logs),
 * and exits non-zero if nothing captured today is recalled."*
 *
 * WHAT IT ASKS, AND WHY IT ASKS IT THIS WAY: it goes through `routeRequest` — THE FACE'S OWN ROUTES, `GET /api/kira/memories` and
 * `POST /api/kira/memories/verify` — rather than reading `remembered/` directly. A check that reads the store proves the store
 * holds files; a check that goes through the routes proves the path AK-UI will use actually answers. Those are different claims and
 * tonight is about the second one.
 *
 * *** IT PRINTS METADATA AND NEVER TEXT. *** No statement, no quote, no session title. The question of whether she remembers is
 * answered by the presence of a record captured today, its tier, its receipt state and its verify answer — and the check runs after
 * a cutover, which is exactly when logs get pasted into places a private sentence should not go.
 *
 * EXIT CODES: 0 when at least one record captured TODAY is recalled; 1 when none is; 2 when the store or the routes cannot be read
 * at all. A check that cannot tell "nothing was captured" from "I could not look" is worse than no check.
 *
 *   node scripts/kira/she-remembers-check.mjs                          # the newest records, no question
 *   node scripts/kira/she-remembers-check.mjs --question "…"           # ranked by a question, as recall does
 *   node scripts/kira/she-remembers-check.mjs --state <dir> --today 2026-09-26
 *
 * @module @aukora/dsh-plugin-kira/she-remembers-check
 */
import { homedir } from 'node:os'
import { join } from 'node:path'

import { KIRA_ROUTES, routeRequest } from '../../plugins/aukora-kira/lib/memory-routes.mjs'
import { buildRouteDeps } from '../../plugins/aukora-kira/lib/memory-deps.mjs'
// The states §2.2 moves a note to, replayed from the chain — the reader's first real caller.
import { noteStates } from '../../plugins/aukora-kira/lib/memory-forget.mjs'
import { readLinesIfPresent } from '../../plugins/aukora-kira/lib/strict-read.mjs'

const argv = process.argv.slice(2)
const value = name => { const i = argv.indexOf(name); return i >= 0 ? argv[i + 1] : undefined }

const stateHome = value('--state') ?? join(homedir(), 'Library', 'Application Support', 'AUKORA', 'state', 'home')
const question = value('--question') ?? ''
const limit = Number(value('--limit') ?? 200)
// TODAY IS THE LOCAL DAY, because "earlier today" is what a person means and the store keeps UTC instants. The script prints which
// day it used, so a check that fails at 00:30 local cannot be mistaken for a check that failed at noon.
const today = value('--today') ?? new Date().toLocaleDateString('en-CA')
const localDay = instant => {
  const parsed = Date.parse(String(instant ?? ''))
  return Number.isFinite(parsed) ? new Date(parsed).toLocaleDateString('en-CA') : null
}

const stateDir = join(stateHome, 'kira-memory')
// THE STATES ARE READ ONCE, FROM THE CHAIN, THE WAY EVERY OTHER DERIVED LAYER IS: `stateDir` here is the same `kira-memory` directory the forgotten set and the kept
// set are read from, so `${stateDir}/remembered/journal.jsonl` is the chain this check's own routes read. A moved note is invisible on disk — MEMORY_TIERS has no tier
// for superseded, hidden or expired — so without this line the check would report a superseded record exactly like a current one.
const states = noteStates(stateDir, readLinesIfPresent)
let deps
try {
  deps = buildRouteDeps({ stateDir, sessionsRoot: stateHome })
} catch (error) {
  console.log(`kira.she-remembers:CANNOT-READ — the routes could not be built for ${stateDir}: ${String(error?.message ?? error)}`)
  process.exit(2)
}

let listed
try {
  listed = await routeRequest({ method: 'GET', path: KIRA_ROUTES.list, query: { tier: 'remembered', q: question, limit: String(limit) } }, deps)
} catch (error) {
  console.log(`kira.she-remembers:CANNOT-READ — the list route refused: ${String(error?.message ?? error)}`)
  process.exit(2)
}
const items = Array.isArray(listed?.body?.items) ? listed.body.items : []
const fromToday = items.filter(one => localDay(one?.createdAt) === today || localDay(one?.observedAt) === today)

console.log(`kira.she-remembers: ${stateDir}`)
console.log(`  day asked about          ${today} (local)`)
console.log(`  question                 ${question === '' ? '(none: the newest records, unranked)' : JSON.stringify(question)}`)
console.log(`  recalled                 ${String(items.length)} remembered record(s), of which ${String(fromToday.length)} were captured today`)
console.log('')

/** ONE LINE PER RECORD: metadata only. `verify` goes through the route, so the answer is the one the face would get. */
for (const one of fromToday.slice(0, 20)) {
  let verify = 'not asked'
  try {
    const answer = await routeRequest({ method: 'POST', path: KIRA_ROUTES.verify, body: { id: one.id } }, deps)
    const body = answer?.body ?? {}
    verify = `${String(body.source ?? 'unknown')}${body.failed === undefined ? '' : ` (${String(body.failed)})`}`
  } catch (error) {
    verify = `refused (${String(error?.code ?? error?.message ?? error)})`
  }
  const source = one?.source ?? {}
  const where = source.state === 'UNLINKED'
    ? `UNLINKED, cited ${String(source.sessionId ?? '').slice(0, 22)}… turn ${String(source.citedTurn ?? '')}`
    : `${String(source.sessionId ?? '').slice(0, 22)}… seq ${String(source.seq ?? '')}`
  // *** AND THE NOTE'S OWN STATE, WHICH LIVES ONLY IN THE CHAIN. *** §2.2 moves a Remembered note to superseded, hidden or expired and `MEMORY_TIERS` has no tier for
  // any of them, so a note a merge replaced reads exactly like a current one on disk and in the list. This check is the one that answers "does she remember", so it
  // is the right place to say what each record's state actually is — and it makes the post-cutover run able to distinguish "her recall is empty" from "her recall is
  // refusing records that were moved", which are very different answers to the same question.
  const state = states.get(String(one.id))
  console.log(`  ${String(one.id).slice(0, 20)}…  tier ${String(one.tier)}${state === undefined ? '' : `  state ${state}`}  label ${JSON.stringify(String(one.label ?? ''))}  verify ${verify}`)
  console.log(`      source ${where}`)
}

console.log('')
if (fromToday.length === 0) {
  console.log(`kira.she-remembers: NOTHING CAPTURED TODAY IS RECALLED — ${String(items.length)} record(s) came back and none of them is from ${today}.`)
  console.log('  That is a failure of tonight\'s whole point, not an empty result: she should have remembered something by now.')
  process.exit(1)
}
console.log(`kira.she-remembers: SHE REMEMBERS — ${String(fromToday.length)} record(s) captured today came back through the face's own routes.`)
