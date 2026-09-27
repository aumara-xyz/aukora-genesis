/**
 * FORGET, THE OFF SWITCHES, AND RETENTION — all triggered by the owner's words or taps, NEVER by the model's judgment.
 * (Design §6, revision 2.)
 *
 * THE THREE RULES THAT ARE EASY TO GET WRONG, and are therefore explicit here:
 *
 *  1. **RETENTION NEVER PURGES.** §6.4: "Expired notes are never purged automatically." A retention rule marks a note
 *     expired; only "Empty expired" (which shows the size) or Forget erases bytes. A retention pass that deleted would
 *     be a deletion nobody asked for, triggered by a clock.
 *  2. **THE READ PATH DISTINGUISHES FORGOTTEN FROM DAMAGED** (§6.2). "Tombstone present, object missing" is FORGOTTEN.
 *     "No tombstone, object missing" is DAMAGED — undetermined, and counted. Collapsing the two would let a lost object
 *     read as a deliberate forgetting, which is the opposite of an audit trail.
 *  3. **A VOICE FORGET NEEDS ALL THREE CONDITIONS** (§6.1): the owner's text carries the marker; the target handle WAS
 *     INJECTED IN THAT REQUEST; and the turn carried no outside words other than the memory frame. When the third
 *     fails, she says "Pick it in Memory" rather than guessing which note he meant.
 *
 * AND ONE GUARANTEE, COMPUTED RATHER THAN PROMISED: `insideStateDir` answers whether a path is inside the user's state
 * directory — the property Fable's court list asks for — by resolving `..` textually, so a caller can refuse a write
 * that would land outside before it opens anything.
 *
 * NOTHING HERE READS OR WRITES. Every fact it needs arrives as an argument.
 *
 * @module @aukora/dsh-plugin-kira/memory-forget
 */
import { SIGNING_CEILING } from './memory-tiers.mjs'

/** The controls of §6.1, and what each one stops. Closed vocabulary, so a control cannot be half-applied. */
export const CONTROLS = Object.freeze({
  pause: Object.freeze({ stopsCapture: true, stopsRecall: true, keepsNotes: true }),
  'off-the-record': Object.freeze({ stopsCapture: true, stopsRecall: true, writesRequestStore: false }),
  'someone-is-here': Object.freeze({ stopsCapture: true, stopsRecallPersonal: true }),
  hide: Object.freeze({ keepsSearchable: true, injects: false }),
})

/**
 * THE OWNER'S OWN WORDS THAT STOP CAPTURE, read by KIRA as well as by the face (2026-09-27, "remember everything").
 *
 * The apps face reads these phrases before it emits an Auma Live turn (`plugins/aukora-face/apps/src/auma-live/memory-control.ts`),
 * but the TEXT CHAT path never passed through that face: its capture read the ask and kept only marker sentences, so "off the
 * record" was honoured there by accident — an unmarked sentence was never kept anyway. Once every owner turn is remembered, that
 * accident is gone, so the capture itself reads the phrases. Same phrases as the face, mapped onto this module's closed `CONTROLS`
 * vocabulary. Each one covers THE TURN IT IS SAID IN, exactly as the face applies it; nothing here keeps a standing pause.
 */
export const OWNER_CONTROL_PHRASES = Object.freeze([
  Object.freeze(['pause', /\bstop remembering\b/iu]),
  Object.freeze(['off-the-record', /\boff the record\b/iu]),
  Object.freeze(['someone-is-here', /\bsomeone(?:'s| is) here\b/iu]),
])

/** The face's intent names (`memory-control.ts`) mapped onto `CONTROLS`, so a control the face carries is honoured here too. */
export const FACE_CONTROL_INTENTS = Object.freeze({ 'stop-remembering': 'pause', 'off-record': 'off-the-record', 'someone-here': 'someone-is-here' })

/**
 * The capture-stopping control the owner's words carry, or null.
 * @param {string} text - the owner's own words for one turn.
 * @returns {string|null} a `CONTROLS` key whose `stopsCapture` is true, or null.
 */
export function ownerControlIn(text) {
  if (typeof text !== 'string' || text.trim() === '') return null
  for (const [control, pattern] of OWNER_CONTROL_PHRASES) {
    if (pattern.test(text)) return control
  }
  return null
}

/** The marker the owner's own words must carry for a voice forget (§6.1). */
export const FORGET_MARKER = /forget that/iu

/** What a voice forget that fails condition 3 answers with (§6.1). */
export const PICK_IT_IN_MEMORY = 'Pick it in Memory'

/** The ceiling on a signed erasure (§6.3): the chain keeps an unsalted digest, guessable for short text. */
export const SIGNED_ERASURE_CEILING = 'SIGNED_ERASURE_LEAVES_DIGEST'

/**
 * WHAT FORGET DOES NOT REACH, printed wherever a forget is reported (§6.5). A forget that reported only what it removed
 * would be a forget that overstated itself.
 */
export const FORGET_IS_LOCAL_ONLY = Object.freeze([
  'copies the provider received (zero-retention is their promise, not something we can verify)',
  'Time Machine, APFS snapshots, iCloud and swap',
  'lane session logs (kept untouched by the harness; filtered from [recall] only)',
  'voice/weight adapters already trained on past conversations',
  'the other kira-memory roots on this Mac, until Peter removes them',
  'anything Peter copied elsewhere',
  'the Signed erasure digest',
])

/** A named refusal. Refusals are for malformed input or a closed gate, never for an outcome. */
export class KiraForgetError extends Error {
  /**
   * @param {string} code - stable machine-readable refusal code suffix.
   * @param {string} message - human-readable refusal.
   */
  constructor(code, message) {
    super(`kira.forget: ${message}`)
    this.name = 'KiraForgetError'
    this.code = `kira.forget:${code}`
  }
}

/** @param {string} code @param {string} message @returns {never} */
function refuse(code, message) {
  throw new KiraForgetError(code, message)
}

/**
 * Whether a voice forget is honored, and what to say when it is not (§6.1).
 * @param {{ownerText: string, targetHandle: string, injectedHandles: ReadonlyArray<string>, outsideWords: ReadonlyArray<string>}} input
 * @returns {{honored: true, handle: string} | {honored: false, why: string, soSay: string}}
 */
export function voiceForgetDecision(input) {
  const { ownerText, targetHandle, injectedHandles = [], outsideWords = [] } = input ?? {}
  if (!FORGET_MARKER.test(String(ownerText ?? ''))) {
    return { honored: false, why: 'no-marker', soSay: PICK_IT_IN_MEMORY }
  }
  if (!injectedHandles.includes(String(targetHandle))) {
    // Condition 2 is what stops her forgetting a note that was not in front of him in this turn.
    return { honored: false, why: 'handle-not-injected-in-this-request', soSay: PICK_IT_IN_MEMORY }
  }
  const otherOutsideWords = outsideWords.filter(one => one !== 'memory')
  if (otherOutsideWords.length > 0) {
    // Condition 3, narrowed as §6.1 explains: the memory frame itself does not disqualify the turn, or forget would never
    // work on the turns where it matters.
    return { honored: false, why: 'turn-carried-outside-words', soSay: PICK_IT_IN_MEMORY }
  }
  return { honored: true, handle: String(targetHandle) }
}

/**
 * Everything a Remembered forget must erase (§6.2), as a list a caller can work through.
 *
 * IT IS A CHECKLIST RATHER THAN A PROMISE. The design names seven places, including EVERY request record containing the
 * span rather than only the evidence turn — a sentence can sit in about forty later bodies — and the queue file of an
 * old lane note. Returning the list means a caller that skips one can be seen to have skipped it.
 * @param {Readonly<Record<string, unknown>>} note
 * @param {{requestRecords?: ReadonlyArray<string>, frames?: ReadonlyArray<string>, ring?: boolean, dreamPatterns?: ReadonlyArray<string>, queueFile?: string|null, requestRecordsOwnedBy?: string}} inventory
 * @returns {{items: ReadonlyArray<{what: string, ref: string}>, redactionApiOwnedBy: string}}
 */
export function erasurePlanFor(note, inventory = {}) {
  if (note === null || typeof note !== 'object') refuse('note-missing', 'a forget is about a note')
  const { requestRecords = [], frames = [], ring = false, dreamPatterns = [], queueFile = null, requestRecordsOwnedBy = 'AUMA' } = inventory
  const items = [
    { what: 'object-and-salt', ref: String(note.id ?? '') },
    { what: 'derived-layers', ref: 'index, enrichment, usage, topics' },
  ]
  // EVERY request record containing the span, not only the evidence turn: the ring is what makes one sentence appear in
  // forty later bodies, and the design is explicit that all of them go.
  for (const record of requestRecords) items.push({ what: 'request-record', ref: String(record) })
  for (const frame of frames) items.push({ what: 'kira-frame', ref: String(frame) })
  if (ring) items.push({ what: 'live-ring-and-carry-over', ref: String(note.id ?? '') })
  for (const pattern of dreamPatterns) items.push({ what: 'dream-pattern', ref: String(pattern) })
  if (queueFile !== null && queueFile !== undefined) items.push({ what: 'queue-file', ref: String(queueFile) })
  return { items: Object.freeze(items), redactionApiOwnedBy: requestRecordsOwnedBy }
}

/**
 * The read path's two cases (§6.2). This is the rule that keeps an audit trail honest.
 * @param {{tombstone: boolean, objectPresent: boolean}} state
 * @returns {{verdict: string, counted: boolean}}
 */
/**
 * THE IDS THIS STORE HAS FORGOTTEN, read from the chain's own `forget` entries — because the tombstone IS the entry, which is what
 * `forgetNote` says when it answers "the tombstone is the journal entry above".
 *
 * *** AND THIS IS THE HALF THAT WAS MISSING UNTIL kira-123 ITEM 4. *** `forgetNote` wrote the tombstone and its comment said the
 * object file "is renamed by the caller's own store cycle" — and NOTHING renamed it, while `listNotes` had no forgotten filter at all.
 * So a forgotten note stayed in the store, stayed in the Memory app's list, and stayed in recall: three of the four things forgetting
 * is supposed to do. `memory-tiers.mjs:21` states the intent in the design's own words — "it leaves recall, and the tombstone stays"
 * — and now the read paths honour it.
 *
 * FAIL-CLOSED IN THE DIRECTION THAT MATTERS: an unreadable chain THROWS rather than answering "nothing is forgotten". Answering with
 * an empty set would put forgotten records back in front of the owner, which is the one outcome a forget must never have.
 *
 * @param {string} stateDir @param {(file: string) => ReadonlyArray<string>} readLines
 * @returns {ReadonlySet<string>}
 */
export function forgottenIds(stateDir, readLines) {
  if (typeof stateDir !== 'string' || stateDir === '') refuse('state-dir-missing', 'the forgotten set is read from the chain inside the state directory')
  if (typeof readLines !== 'function') refuse('reader-missing', 'the forgotten set needs the chain reader; without one it cannot tell a forgotten record from a present one')
  const ids = new Set()
  for (const line of readLines(`${stateDir}/remembered/journal.jsonl`)) {
    if (line === '') continue
    let entry
    try { entry = JSON.parse(line) } catch { continue }
    if (entry?.op === 'forget' && typeof entry.id === 'string') ids.add(entry.id)
  }
  return ids
}

/**
 * THE KEPT SET, REPLAYED FROM THE CHAIN — §2.1's promise has no field to live in.
 *
 * §2.1's Changes row: *"Superseded, merged, hidden or expired automatically, journaled and undoable. **A Kept or often-recalled note is never silently
 * replaced.**"* §3.6 gives the journal a `keep` op, one of the design's twelve. But §2.2's moves table has no `→ Kept` row and §3.6's record shape has no `kept`
 * field — so Kept has nowhere to be STORED, and `retentionDecision`'s guard below has been reading a field no code in this tree writes. It is the third of its
 * kind tonight, after `note.recalls` and the dropped `relation`.
 *
 * THE ANSWER IS THE ONE §5.1 ALREADY USES FOR USAGE: a derived layer, rebuilt from the journal and living outside the hashed bytes. This replays the chain for
 * `keep` entries exactly the way `forgottenIds` above replays it for `forget` entries — so the day an owner control appends a `keep` op, the behaviour §2.1
 * promises works with no further change here.
 */
export function keptIds(stateDir, readLines) {
  if (typeof stateDir !== 'string' || stateDir === '') refuse('state-dir-missing', 'the kept set is read from the chain inside the state directory')
  if (typeof readLines !== 'function') refuse('reader-missing', 'the kept set needs the chain reader; without one it cannot tell a kept note from any other')
  const ids = new Set()
  for (const line of readLines(`${stateDir}/remembered/journal.jsonl`)) {
    if (line === '') continue
    let entry
    try { entry = JSON.parse(line) } catch { continue }
    if (entry?.op === 'keep' && typeof entry.id === 'string') ids.add(entry.id)
  }
  return ids
}

/**
 * THE STATE OF EVERY CHANGED NOTE, REPLAYED FROM THE CHAIN — because nothing else records it.
 *
 * §2.2 moves a Remembered note to `superseded`, `hidden` or `expired`, and §2.1 says those moves are automatic and journaled. But `MEMORY_TIERS` is
 * `['remembered','signed','proposal','forgotten']` — there is no superseded tier, no hidden tier and no expired tier — AND HOUSEKEEPING NEVER REWRITES A NOTE, which is
 * its own loudest rule. So a note that a merge superseded is still `remembered` on disk, still listed and still recallable: measured, `RECALL_TIERS` is
 * remembered/signed and nothing filtered a superseded note out of anything. The state exists ONLY in the chain, and this replays it.
 *
 * RESTORE AND UNHIDE PUT A NOTE BACK, which is the other half of the undo: it appends the `restore` op and this is what makes the op MEAN something. A note's state is
 * therefore its LAST move in the chain, not the presence of any move — the difference between an undo that works and one that only writes a line.
 *
 * @param {string} stateDir
 * @param {(file: string) => Iterable<string>} readLines
 * @returns {Map<string, string>} id → one of `superseded`, `hidden`, `expired`, `archived`
 */
export function noteStates(stateDir, readLines) {
  if (typeof stateDir !== 'string' || stateDir === '') refuse('state-dir-missing', 'the changed-note states are read from the chain inside the state directory')
  if (typeof readLines !== 'function') refuse('reader-missing', 'the states need the chain reader; without one a superseded note cannot be told from a current one')
  const moved = { supersede: 'superseded', hide: 'hidden', expire: 'expired', archive: 'archived' }
  const back = { restore: null, unhide: null }
  const states = new Map()
  for (const line of readLines(`${stateDir}/remembered/journal.jsonl`)) {
    if (line === '') continue
    let entry
    try { entry = JSON.parse(line) } catch { continue }
    const op = String(entry?.op ?? '')
    const id = typeof entry?.id === 'string' ? entry.id : null
    if (id === null) continue
    if (moved[op] !== undefined) states.set(id, moved[op])
    else if (back[op] === null && states.has(id)) states.set(id, null)
  }
  for (const [id, state] of [...states]) if (state === null) states.delete(id)
  return states
}

export function readPathVerdict(state) {
  const tombstone = state?.tombstone === true
  const present = state?.objectPresent === true
  if (present) return { verdict: 'ok', counted: false }
  if (tombstone) return { verdict: 'forgotten', counted: false }
  return { verdict: 'damaged', counted: true }
}

/** Duration parsing for retention: `7d`, `90d`, `30d-after-due`, `never`. */
export function expiryOf(note, rule, now) {
  const after = rule?.expireAfter
  if (after === undefined || after === 'never') return null
  const days = /^(\d+)d$/u.exec(String(after))
  if (days !== null) {
    const from = String(note?.validFrom ?? now)
    const at = new Date(`${from}T00:00:00Z`)
    if (Number.isNaN(at.getTime())) return null
    at.setUTCDate(at.getUTCDate() + Number(days[1]))
    return at.toISOString().slice(0, 10)
  }
  const due = /^(\d+)d-after-due$/u.exec(String(after))
  if (due !== null && typeof note?.validTo === 'string') {
    const at = new Date(`${note.validTo}T00:00:00Z`)
    if (Number.isNaN(at.getTime())) return null
    at.setUTCDate(at.getUTCDate() + Number(due[1]))
    return at.toISOString().slice(0, 10)
  }
  return null
}

/**
 * The retention decision for one note (§6.4): the FIRST matching rule wins, Signed is never touched, and the answer
 * carries `purge: false` — ALWAYS — because retention marks and never erases.
 * @param {Readonly<Record<string, unknown>>} note
 * @param {{rules: ReadonlyArray<Record<string, unknown>>}} policy
 * @param {{now: string}} context
 * @returns {{rule: string|null, expiresAt: string|null, purge: false, why: string}}
 */
/**
 * HOW MANY TIMES THIS NOTE'S STATEMENT HAS BEEN SEEN AGAIN, from §5.1's derived layer.
 *
 * The note's OWN `recalls` field is read first and the layer second, and both are needed: nothing in this tree writes `recalls`, so a rule
 * that trusted it alone saw every note as never recalled — while a store settled before the layer existed still carries whatever a caller put
 * there. `usage` is the layer as housekeeping builds it: a Map, or a plain object keyed by note id.
 *
 * @param {Record<string, unknown>} note @param {Map<string, number>|Record<string, number>|undefined} usage
 * @returns {number}
 */
function seenAgainFor(note, usage) {
  const own = Number(note?.recalls ?? 0)
  if (own > 0) return own
  if (usage === undefined || usage === null) return 0
  const id = String(note?.id ?? '')
  const from = typeof usage.get === 'function' ? usage.get(id) : usage[id]
  return Number(from ?? 0)
}

export function retentionDecision(note, policy, context) {
  if (note === null || typeof note !== 'object') refuse('note-missing', 'retention is decided per note')
  if (note.tier === 'signed') return { rule: null, expiresAt: null, purge: false, why: 'retention never touches a signed note' }
  const rules = policy?.rules
  if (!Array.isArray(rules)) refuse('policy-malformed', 'the retention policy is a JSON document with a `rules` array')
  for (const rule of rules) {
    if (rule?.category !== undefined && rule.category !== note.category) continue
    if (Array.isArray(rule?.attributedTo) && !rule.attributedTo.includes(note.attributedTo)) continue
    if (typeof rule?.confidenceBelow === 'number' && !(Number(note.confidence) < rule.confidenceBelow)) continue
    // *** `neverRecalled` MEANS "THIS NOTE HAS NEVER BEEN USED", AND THIS GUARD COULD NOT KNOW THAT. *** It read `note.recalls`, which no
    // code in this tree has ever written, so EVERY note passed as unused — and a note the owner keeps needing was expired by a rule whose
    // whole purpose is to protect notes nobody uses. The count now comes from §5.1's derived layer, which is the thing housekeeping refreshes.
    if (rule?.neverRecalled === true && seenAgainFor(note, context?.usage) > 0) continue
    // *** KEPT IS READ FROM THE DERIVED LAYER WHEN ONE IS GIVEN, AND FROM THE RECORD ONLY AS A FALLBACK. *** `note.kept` is a field no code in this tree writes —
    // §2.2 has no `→ Kept` move and §3.6's shape has no `kept` key — so this guard has been comparing against `false` for every note that ever existed. A caller
    // holding the chain passes `context.keptIds` (see `keptIds` above, which replays the `keep` op); the old reading is kept as the fallback so nothing that
    // already passes `note.kept` by hand, court fixtures included, changes behaviour.
    const isKept = context?.keptIds instanceof Set ? context.keptIds.has(String(note.id)) : note.kept === true
    if (rule?.kept !== undefined && rule.kept !== isKept) continue
    return { rule: String(rule?.name ?? ''), expiresAt: expiryOf(note, rule, context?.now), purge: false, why: 'the first matching rule wins; the bytes stay until someone says Empty expired or Forget' }
  }
  return { rule: null, expiresAt: null, purge: false, why: 'no rule matched, so the note is untouched' }
}

/**
 * A signed erasure is REFUSED while the signing gate is closed (§6.3 and §2.4), and it names its ceiling.
 * @returns {never}
 */
export function signedErase() {
  refuse('signed-erase-refused', `erasure by signature does not ship until the owner is required in person (§2.4 keeps ${SIGNING_CEILING}), and its ceiling would be ${SIGNED_ERASURE_CEILING} even then`)
}

/**
 * Whether a path is inside the user's state directory — the guarantee Fable's court list asks for, computed from the
 * path alone so a caller can refuse before opening anything.
 * @param {string} path
 * @param {string} stateDir
 * @returns {boolean}
 */
export function insideStateDir(path, stateDir) {
  if (typeof path !== 'string' || typeof stateDir !== 'string' || path === '' || stateDir === '') return false
  const resolve = one => {
    const parts = one.split('/')
    const out = []
    for (const part of parts) {
      if (part === '' || part === '.') continue
      if (part === '..') { out.pop(); continue }
      out.push(part)
    }
    return `/${out.join('/')}`
  }
  const target = resolve(path)
  const root = resolve(stateDir)
  return target === root || target.startsWith(`${root}/`)
}
