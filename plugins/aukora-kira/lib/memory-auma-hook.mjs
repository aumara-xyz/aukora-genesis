/**
 * AUMA LIVE TURNS — the second producer of remembered notes.
 *
 * **FABLE'S kira-122 ITEM 3:** *"your capture listens at `agent/turn-stopping`, but Auma Live's replies are direct provider fetches
 * and never fire it. Confirm whether AUMA emits `auma.turnFinished` at HEAD … If not, tell AUMA the exact hook you need and build
 * the consumer against it."*
 *
 * *** IT HAS LANDED AT HEAD, AND THIS PARAGRAPH ONCE SAID THE OPPOSITE. *** Measured 2026-09-26 21:5x: the app declares the event at
 * `apps/src/index.ts:65`, documents it at `:77`, and **EMITS it at `:607`** — so the sentence that stood here, *"the event does not exist at
 * HEAD"*, was true when it was written and false by the time anyone read it again. Left corrected rather than deleted, because the distinction it
 * got wrong is the one that matters: **HEAD is not what runs.** The RELEASE named by `~/Library/Application Support/AUKORA/config.json` carries
 * `turn-finished` ZERO times in `apps/lib/index.js`, and none of KIRA's three memory hooks at all — which is exactly why kira-123 item 1's live
 * check waits on the cutover and a green court here is not a claim about Peter's running app.
 *
 * The consumer listens for the name I asked for AND for Fable's original spelling, because the name is AUMA's to choose and a consumer that only
 * answers to one spelling is a consumer that silently captures nothing the day someone picks the other.
 *
 * *** THE PAYLOAD IS REFUSED BY NAME, NEVER ACCEPTED WITH A HOLE IN IT. *** Every field this needs is named in the refusal, so a
 * mismatched emit fails loudly in a court instead of quietly in Peter's store — and `line`, THE EXACT CANONICAL EVENT LINE, is the
 * one that matters most: the receipt is a digest of those bytes, and a line re-serialised between the store and the emit mints
 * receipts that read CHANGED the first time anyone checks them.
 *
 * @module @aukora/dsh-plugin-kira/memory-auma-hook
 */
import { createTrackedMemory } from './tracked-memory.mjs'
import { openVikingHome, readBridgeConfig } from './recall-openviking.mjs'
import { CONTROLS, ownerControlIn } from './memory-forget.mjs'
import { STORE_PATHS, planStoreWrite, objectFileName } from './memory-store.mjs'
// THE LOG'S OWN WRITER, for the aura appends below: `planStoreWrite` writes exactly what it is given, and this path was giving it unchained lines.
import { chainAuraEntries } from './memory-owner.mjs'
import { boundedNotes, consumeTurn } from './memory-capture-hook.mjs'
import { FACE_CONTROL_INTENTS, voiceForgetDecision } from './memory-forget.mjs'
// THE SECRET SHAPES COME FROM THE ONE PLACE THEY ARE DEFINED, so the capture path and the compaction path cannot drift apart.
import { FORBIDDEN_WINDOW_DIGESTS, SECRET_PATTERNS } from './compaction-export.mjs'
// `canonicalInstant` LIVES IN `memory-tiers.mjs`, not in the capture hook — checked rather than assumed, the way the remembered
// hook's own imports showed it.
import { sha256Hex, canonicalInstant, forgetRecord } from './memory-tiers.mjs'
import { nextEntry } from './memory-journal.mjs'
import { appendJournalLine, durableWrite, ensureDirectory, readLinesIfPresent, readTextStrict, withFileLock } from './strict-read.mjs'

/** The name I asked AUMA for, and the spelling Fable's item used. Both are consumed; neither is guessed at. */
export const AUMA_TURN_EVENTS = Object.freeze(['auma/turn-finished', 'auma.turnFinished'])

const INSTANT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/u

export class KiraAumaTurnError extends Error {
  constructor(code, message) {
    super(`kira.auma: ${message}`)
    this.name = 'KiraAumaTurnError'
    this.code = `kira.auma:${code}`
  }
}

/** @param {string} code @param {string} message @returns {never} */
function refuse(code, message) {
  throw new KiraAumaTurnError(code, message)
}

/**
 * One finished reply, read into the shape the capture pipeline consumes — or a refusal naming exactly what was missing.
 *
 * @param {unknown} payload
 * @returns {Readonly<{sessionId: string, sessionTitle: string, seq: number, at: string, turn: number, text: string, canonicalEventLine: string, quotedFrom: string}>}
 */
export function readAumaTurn(payload) {
  const problems = []
  if (typeof payload?.sessionId !== 'string' || payload.sessionId === '') problems.push('sessionId (string)')
  if (!Number.isInteger(payload?.seq)) problems.push('seq (integer)')
  if (!Number.isInteger(payload?.turn)) problems.push('turn (integer)')
  if (typeof payload?.at !== 'string' || !INSTANT.test(payload.at)) problems.push('at (canonical seconds-precision UTC instant, e.g. 2026-09-26T10:31:00Z)')
  // THE LINE IS NOT OPTIONAL AND IS NOT RECONSTRUCTED. Without the exact bytes there is no receipt to mint, and a digest over a
  // re-serialised line would verify as CHANGED against the store it came from.
  if (typeof payload?.line !== 'string' || payload.line === '') problems.push('line (the EXACT canonical event line, byte for byte)')
  // THE QUOTE CHECK RUNS AGAINST WHAT THE OWNER SAID, so the owner's text is preferred and the reply's text is the fallback. Which
  // one was used is carried on the turn so a reader can tell — an extractor quoting Peter's own words out of Auma's reply would be
  // putting words in his mouth.
  const ownerText = typeof payload?.ownerText === 'string' && payload.ownerText !== ''
  const text = ownerText ? payload.ownerText : (typeof payload?.text === 'string' ? payload.text : '')
  if (text === '') problems.push('ownerText or text (string)')
  if (problems.length > 0) {
    refuse('payload-incomplete', `the turn-finished payload is missing: ${problems.join('; ')} — refused rather than stored with a hole in it`)
  }
  return Object.freeze({
    sessionId: payload.sessionId,
    sessionTitle: typeof payload.sessionTitle === 'string' && payload.sessionTitle !== '' ? payload.sessionTitle : 'auma',
    seq: payload.seq,
    at: payload.at,
    turn: payload.turn,
    text,
    canonicalEventLine: payload.line,
    quotedFrom: ownerText ? 'ownerText' : 'text',
    // *** `control` IS EMITTED FOR THIS CONSUMER AND WAS BEING IGNORED. *** The app's own comment above the field says why it survives the suppression check:
    // *"`remember` and `forget` still emit — they are instructions ABOUT memory rather than refusals of it, and KIRA's pipeline is where a marked turn or a forget
    // request is acted on."* Measured 2026-09-27: nothing in KIRA read it. It now sets §3.3 rule 2's policy flag below, and a probe proved it arrives intact.
    //
    // *** AND THE SHAPE WAS WRONG, SO IT NEVER ARRIVED AT ALL (Fable, 2026-09-28, and AUMA's court pinned the truth). *** This line read
    // `typeof payload.control === 'string' ? payload.control : ''`, and the FACE EMITS AN OBJECT — `{ intent, matched } | null`, shipping since 96f2b2c88 and asserted in
    // `tests/laya-auma-turn-finished.test.mjs:163`. An object fell into the `''` branch, so `turn.control === 'remember'` below was never true and **neither `remember that` nor
    // `forget that` ever reached this pipeline.** The object form is now the primary one, the string form is kept for faces older than 96f2b2c88, and **any other shape REFUSES BY
    // NAME** rather than being coerced into "no control" — a coercion to silence is how an owner's explicit instruction becomes a turn that looks ordinary.
    control: controlIntentOf(payload.control),
  })
}

/**
 * The owner's memory control, from the face's `control` field — in the face's shape, an older face's shape, or a named refusal.
 *
 * `{intent, matched}` is what the face emits now; a bare `'remember'` string is what faces before 96f2b2c88 emitted; `null` is the face's own "no control in this turn", which is
 * legitimate and not a refusal. Anything else is a shape this consumer has never been measured against, and it refuses.
 *
 * @param {unknown} control
 * @returns {string} the intent, or `''` when the turn carried none.
 * @throws {KiraAumaTurnError} `AUMA_CONTROL_MALFORMED` for a shape that is neither.
 */
function controlIntentOf(control) {
  if (control === null || control === undefined) return ''
  if (typeof control === 'string') return control
  if (typeof control === 'object' && !Array.isArray(control)) {
    const intent = /** @type {{intent?: unknown}} */ (control).intent
    if (typeof intent === 'string') return intent
    refuse('AUMA_CONTROL_MALFORMED', 'the turn\'s `control` object carries no string `intent`, so which memory instruction the owner gave cannot be '
      + 'read; the object form is `{ intent, matched }` since 96f2b2c88. Refusing rather than reading it as no control.')
  }
  refuse('AUMA_CONTROL_MALFORMED', `the turn's \`control\` is a ${Array.isArray(control) ? 'array' : typeof control}, which is neither the face's object form `
    + 'nor an older face\'s string form. Refusing rather than reading it as no control.')
}

/**
 * Register the consumer. THE RETURN VALUE IS THE DISPOSER, following `ctx.on`'s own contract, so the whole thing belongs to the
 * fiber that registered it and a stop removes it.
 *
 * @param {{on: (name: string, handler: (payload: unknown) => unknown) => (() => void)}} ctx
 * @param {object} [options]
 * @returns {() => void}
 */
export function registerAumaTurnCapture(ctx, options = {}) {
  const { stateDir, policyOf, logger, now, onRemembered, events = AUMA_TURN_EVENTS } = options
  if (typeof ctx?.on !== 'function') refuse('ctx-without-on', 'the consumer needs a context whose `on` can subscribe to the turn-finished event')
  if (typeof stateDir !== 'string' || stateDir === '') refuse('state-dir-missing', 'the store is inside the user\'s state directory, so a capture without one has nowhere to write')
  let memory

  const capture = async payload => {
    try {
      const turn = readAumaTurn(payload)
      const key = `${turn.sessionId}\u0000${String(turn.turn)}`
      const policy = typeof policyOf === 'function' ? await policyOf() : {}
      const at = canonicalInstant(turn.at)
      if ((turn.quotedFrom === 'ownerText' && ownerControlIn(turn.text)) || policy.offTheRecord || Object.entries(CONTROLS).some(([k,v]) => v.stopsCapture && policy.controls?.[k])) return
      if (FACE_CONTROL_INTENTS[turn.control]) return
      ensureDirectory(`${stateDir}/${STORE_PATHS.remembered}`)
      const journalFile = `${stateDir}/${STORE_PATHS.journal}`
      const auraFile = `${stateDir}/${STORE_PATHS.rememberedAura}`
      withFileLock(auraFile, () => {
        // *** §6.1's VOICE FORGET: THE DECISION IS MINE, THE CALLER WAS MISSING, AND THIS IS THE CALLER. ***
        //
        // Measured 2026-09-29 with AUMA: `voiceForgetDecision` had ONE hit in this lane — its own declaration — while every input it takes was already on the wire. `forget that` reached
        // this pipeline and stopped one function short of the store. **And the action is a HIDE, not an erase**: §6.1 says *"the note is hidden at once, and a chip asks 'Forget: …?
        // [Forget] [Keep]'"* — so this makes the note stop being recalled the moment he says it, and the bytes stay until the owner taps. **A voice forget that deleted would be a delete
        // nobody confirmed, which is the thing the chip exists to prevent.**
        //
        // Everything below is read OFF THE PAYLOAD: `ownerText`, `memoryInjected` (the handles she was shown, with tiers), `spokenMemory` (the outside words). **Nothing is invented**,
        // which is the property AUMA's own court asserts about its side of this wire.
        if (turn.quotedFrom === 'ownerText' && turn.control === 'forget') {
          const injected = Array.isArray(payload?.memoryInjected) ? payload.memoryInjected : []
          // THE PAIR LIST MY OWN ADAPTER RETURNS (`[[id, handle]]`), accepted when a face passes it through. Either shape resolves the handle; neither is guessed.
          const pairs = Array.isArray(payload?.handles) ? payload.handles : []
          const idFor = handle => {
            const direct = injected.find(one => String(one?.handle ?? '') === handle && typeof one?.id === 'string')
            if (direct !== undefined) return String(direct.id)
            const pair = pairs.find(one => Array.isArray(one) && String(one[1]) === handle)
            return pair === undefined ? null : String(pair[0])
          }
          const ownerWords = String(payload?.ownerText ?? payload?.text ?? '')
          // THE NAMED NOTE, ELSE THE LAST ONE SHE WAS SHOWN — *"the named or last-recalled note"*. A handle in his words is explicit; otherwise the most recent thing in front of her
          // is what "that" refers to.
          const named = /\b([ms]\d{1,3})\b/u.exec(ownerWords)
          const targetHandle = named !== null ? named[1] : (injected.length === 0 ? '' : String(injected[injected.length - 1]?.handle ?? ''))
          const decision = voiceForgetDecision({
            ownerText: ownerWords,
            targetHandle,
            injectedHandles: injected.map(one => String(one?.handle ?? '')),
            outsideWords: (Array.isArray(payload?.spokenMemory) ? payload.spokenMemory : []).map(one => String(one?.kind ?? '')),
          })
          if (decision.honored !== true) {
            // A REFUSAL IS REPORTED BY NAME AND THE TURN CARRIES ON: a forget that was not authorised is not an error, it is the guard working, and the owner's words still belong to
            // the turn. The `soSay` line is the face's to speak; the reason is the log's to keep.
            logger?.warn?.(`aukora-kira: a spoken forget was not carried out (${String(decision.why)})`)
          } else {
            const id = idFor(String(decision.handle))
            if (id === null) {
              // *** THE ONE FIELD THE WIRE DOES NOT CARRY, REFUSED BY NAME RATHER THAN GUESSED.*** The handle came off the event; the note id did not. Resolving it by re-deriving the
              // frame's handle assignment in here would be this hook inventing a mapping the face owns, so it refuses instead — **and the owner's forget is lost rather than silently
              // misapplied to a note nobody named.**
              logger?.warn?.(`aukora-kira: a spoken forget was authorised for ${String(decision.handle)} but the turn carried no note id for that handle, so nothing was hidden`)
            } else {
              const lines = readLinesIfPresent(journalFile)
              let previous = null
              if (lines.length > 0) {
                try {
                  previous = JSON.parse(lines[lines.length - 1])
                } catch {
                  refuse('journal-tail-unreadable', 'the journal\'s last line is not JSON, so a hide cannot name its predecessor — refusing rather than appending to a damaged chain')
                }
              }
              const hideEntry = nextEntry({
                previous, op: 'hide', id, objectDigest: String(id).slice(4), actor: 'kira.voice-forget/v1',
                reason: '§6.1: the owner said "forget that" about a note she was shown in this request', at,
              })
              // ══ **THE TOMBSTONE, WHICH IS THE FORGOTTEN-TIER RECORD (aumlok-134)** ═════════════════════════════
              //
              // **THE HIDE STOPPED ONE FUNCTION SHORT OF THE STORE, AND §6.1 SAYS THE ERASE IS THE OWNER'S OWN ACT.**
              // I first read the chip sentence as *"the erase waits for a person"* and left `forgetRecord` uncalled —
              // **THAT READING WAS WRONG.** §6.1's own words are *"only 'Empty expired' (which shows the size) or
              // **Forget erases bytes**"*, and the sentence about a clock is about a RETENTION PASS, not about the
              // owner speaking. **THE SPOKEN FORGET *IS* THE OWNER ASKING.**
              //
              // AND §6.2 SAYS WHY THE TOMBSTONE IS NOT OPTIONAL: *"'Tombstone present, object missing' is FORGOTTEN.
              // 'No tombstone, object missing' is DAMAGED"* — so a hide with no tombstone leaves a note that has
              // **vanished without a record of anyone having asked**, which is the deletion-silently this whole path
              // exists to prevent. The tombstone's hash is the receipt.
              // **THE NOTE'S OWN RECORD, READ FROM THE STORE, AND A NAMED REFUSAL IF IT IS NOT THERE.** A tombstone
              // needs the record it tombstones; *a forget that invented a record for an id it could not find would
              // tombstone a note nobody has — the same class of error as a hide applied to a note nobody named.*
              const notePath = `${stateDir}/${STORE_PATHS.remembered}/${objectFileName(id)}`
              let noteRecord = null
              try {
                noteRecord = JSON.parse(readTextStrict(notePath))
              } catch (cause) {
                refuse('forget-target-unreadable',
                  `"forget that" was authorised for ${String(id).slice(0, 12)}… and its record could not be read from `
                  + `the store (${String(cause?.code ?? cause)}), so no tombstone can be written. REFUSING rather than `
                  + 'hiding a note whose record is missing: *a hide with no tombstone leaves an absence nobody can '
                  + 'audit, which is the deletion-silently §6.2 exists to separate from FORGOTTEN*')
              }
              // THE ORIGINAL MEMORY LAW'S TOMBSTONE (2026-09-27): `forgetRecord` returns `{id, tier: 'forgotten', tombstone:
              // {kind, recordId, at}, forgotten: {at, tombstoneHash}}` and NOTHING of the note — no statement, no quote, no
              // source, no reason. It used to spread the whole record into the "tombstone", so the words stayed on disk.
              const tombstone = forgetRecord(noteRecord, { at })
              // THE OBJECT FILE IS REWRITTEN WITH THE TOMBSTONE, so the tier a reader sees is `forgotten`, the object is
              // still there (an absence that is auditable is the point), and the words are not.
              if (typeof notePath === 'string' && notePath !== '') {
                durableWrite(notePath, `${JSON.stringify(tombstone)}\n`)
              }
              const auraEntries = chainAuraEntries(stateDir, [{
                op: 'hide', id, at, by: 'kira.voice-forget/v1',
                because: '§6.1: a spoken forget hides the note at once, and writes the tombstone that makes the '
                  + 'forgetting auditable — the erase of the bytes is the owner\'s',
                tombstoneHash: String(tombstone.forgotten.tombstoneHash),
              }], { file: auraFile })
              appendJournalLine({ file: journalFile, line: JSON.stringify(hideEntry) })
              for (const one of auraEntries) appendJournalLine({ file: auraFile, line: JSON.stringify(one) })
              logger?.warn?.(`aukora-kira: a spoken forget hid ${String(id).slice(0, 12)}… at once (§6.1) and replaced its object with the law's content-free tombstone`)
            }
          }
        }
      })
      memory = options.memory ? (typeof options.memory === 'function' ? options.memory() : options.memory)
        : memory ?? createTrackedMemory({ stateDir, subject: policy.subject, policyOf,
            config: options.config ?? readBridgeConfig(openVikingHome(stateDir)), fetch: options.fetch })
      const result = turn.quotedFrom === 'ownerText' ? await memory.captureTurn(turn, { ...policy, attributedTo: 'owner-voice',
        sourceKind: 'auma-live/model-request', explicitRemember: turn.control === 'remember' }) : { remembered: 0 }
      if (result.remembered) onRemembered?.({ sessionId: turn.sessionId, turn: turn.turn, ...result })
      // The voice reply is a distinct agent report. Its source is the emitted reply, not a fabricated assistant session line.
      if (typeof payload.text === 'string' && payload.text.trim()) {
        const reply = await memory.remember({ text: payload.text, from: 'auma-live', at,
          migrationKey: `auma-reply:${turn.sessionId}:${turn.seq}:${sha256Hex(turn.canonicalEventLine)}`,
          source: { state: 'UNLINKED', cited: false, because: 'host auma/turn-finished reply; request line identifies the turn, not the reply bytes' } })
        if (reply.remembered) onRemembered?.({ sessionId: turn.sessionId, turn: turn.turn, ...reply })
      }
    } catch (error) {
      // THE ONLY OUTLET, and it is loud rather than silent: a capture fault costs a record and must never cost the reply. The
      // refusal names the field, so a mismatched emit is visible in the log rather than only in the absence of memories.
      // THE CODE TRAVELS WITH THE MESSAGE, so a person reading the log can grep the refusal by name. The court caught this: the
      // message named the missing FIELD and never the refusal, which is half a diagnostic.
      logger?.warn?.(`aukora-kira: auma turn capture skipped (${String(error?.code ?? 'unknown')}): ${String(error?.message ?? error)}`)
    }
  }

  const disposers = []
  for (const name of events) {
    const dispose = ctx.on(name, payload => capture(payload))
    if (typeof dispose === 'function') disposers.push(dispose)
  }
  if (disposers.length === 0) refuse('nothing-subscribed', 'no event name could be subscribed, so this consumer would never fire')
  return () => { for (const dispose of disposers) dispose() }
}
