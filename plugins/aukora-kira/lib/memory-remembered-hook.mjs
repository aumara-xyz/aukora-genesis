/**
 * REMEMBERED CAPTURE AT THE TURN BOUNDARY — the tier that needs no approval, written where a turn actually ends.
 *
 * **WHY THIS IS A SIBLING OF `autostage-hook.mjs` RATHER THAN A CHANGE TO IT.** That hook already listens at
 * `agent/turn-stopping`, picks the turn's own real ask with `lastRealAsk`, and hands a candidate to the PENDING QUEUE — the
 * approval route. Peter's complaint is that route: three settled, one hundred and twenty-five waiting, and nobody told him he
 * had to approve anything. This hook listens at the SAME boundary with the SAME selector and writes a **remembered** note:
 * automatic, unsigned, receipt-backed, usable in recall at once. The two paths coexist on purpose — `trusted` is still the
 * route to authority, and it stays optional.
 *
 * FABLE'S ITEM (3) NAMES `auma.turnFinished`, WHICH DOES NOT EXIST: measured across plugins, packages and notes, zero matches.
 * The real boundary is `agent/turn-stopping`, a serial dispatch where the handler takes one parameter and calls no `next`.
 * This hook uses that, and the event name is stated here so a reader comparing the two does not think a subscription is
 * missing.
 *
 * *** NO LINE, NO RECEIPT, NO NOTE. *** A remembered note's whole claim is that a verifier can re-read the event it came from
 * and re-hash it. The digest path in the sibling hook carries only the ask TEXT, which cannot be re-hashed to anything — so
 * this hook reads the exact canonical event line through the audited boundary and refuses to write when it cannot. A
 * remembered note with no receipt would be a note nobody can check, which is precisely what the tier exists to prevent.
 *
 * EVERY FAULT COSTS A RECORD, NEVER A TURN: the whole body is inside one guard whose only outlet is a warning, following the
 * sibling hook's rule, because a turn is a person's work and a capture is bookkeeping.
 *
 * @module @aukora/dsh-plugin-kira/memory-remembered-hook
 */
import { dirname } from 'node:path'
import { AUTOSTAGE_READER_SERVICE, isRealAsk, lastRealAsk, sessionIdOfAgent } from './autostage-hook.mjs'
import { setLaneDoorMessageIds } from './autostage-hook.mjs'
import { laneDoorMessageIds } from './lane-door-messages.mjs'
import { STORE_PATHS, planStoreWrite } from './memory-store.mjs'
import { nextEntry } from './memory-journal.mjs'
import { chainAuraEntries } from './memory-owner.mjs'
import { sha256Hex, canonicalInstant } from './memory-tiers.mjs'
import { MAX_NOTES_PER_TURN, boundedNotes, consumeTurn } from './memory-capture-hook.mjs'
// THE SECRET SHAPES COME FROM THE ONE PLACE THEY ARE DEFINED, so the capture path and the compaction path cannot drift apart.
import { FORBIDDEN_WINDOW_DIGESTS, SECRET_PATTERNS } from './compaction-export.mjs'
import { appendJournalLine, durableWrite, ensureDirectory, readLinesIfPresent, withFileLock } from './strict-read.mjs'
import { readSessionEventStreamed } from './session-read.mjs'

/** The directory holding a file, for a durability sync. The boundary derives this too; naming it here keeps the call explicit. */

/** How many notes one turn may remember. The contract's "small bound": a turn is a turn, not a corpus. */
// THE BOUND IS DEFINED ONCE, in the module that decides what a turn yields; this re-export keeps the name this hook has always had.
export { MAX_NOTES_PER_TURN, boundedNotes } from './memory-capture-hook.mjs'

/**
 * Register the remembered-capture listener on a Cordis context.
 *
 * @param {{on?: Function, reflect?: {get?: Function}, logger?: {warn?: Function}}} ctx
 * @param {{stateDir: string, sessionsRoot: string, policyOf: () => Promise<{subject: string, privacy: string}>,
 *          readerService?: string, logger?: {warn?: Function}, seen?: Map<string, string>, now?: () => number}} options
 * @returns {() => void} a disposer, following `ctx.on`'s own contract.
 */
export function registerRememberedCapture(ctx, options = {}) {
  const { stateDir, sessionsRoot, policyOf } = options
  const logger = options.logger ?? ctx?.logger
  if (typeof ctx?.on !== 'function') return () => {}
  if (typeof stateDir !== 'string' || typeof sessionsRoot !== 'string' || typeof policyOf !== 'function') {
    // REFUSED BY NAME rather than registered and failing per turn: a capture hook with nowhere to write would warn on every
    // turn of every session, which is noise a reader learns to ignore.
    logger?.warn?.('aukora-kira: remembered capture not registered (stateDir, sessionsRoot and policyOf are all required)')
    return () => {}
  }
  // **TELL THE PREDICATE WHICH MESSAGES THE LANE DOOR CAUSED, BEFORE ANY TURN IS READ.**
  //
  // *Without this the id check is inert and the exclusion is the text prefix alone* — **which is the state this item
  // exists to leave.** *Loaded once here rather than per turn:* the file is append-only and grows slowly, **and a hook
  // that re-read it on every turn would put a file read on the path of every session.**
  //
  // **A STATE ROOT THAT HOLDS NO DOOR FILE YIELDS AN EMPTY SET**, so a machine where no lane has ever spoken behaves
  // exactly as before — *the prefix still applies, and nothing Peter says is lost.*
  // FIXED ON MERGE (Fable, 2026-09-27): the door writes under the SHELL's state root (<state>/lane-door/), and this store sits
  // at <state>/home/kira-memory, so the root is two levels up; reading at stateDir found nothing. And the set is re-read per
  // turn (below), because a set loaded once at registration misses every message the door sends after the app starts.
  const laneDoorRoot = dirname(dirname(stateDir))
  setLaneDoorMessageIds(laneDoorMessageIds(laneDoorRoot))
  // SESSION → THE LAST ASK CAPTURED, mirroring the staging hook's own gate.
  const seenTurns = options.seen ?? new Map()
  const readerService = options.readerService ?? AUTOSTAGE_READER_SERVICE
  let warnedNoReader = false

  return ctx.on('agent/turn-stopping', async payload => {
    try {
      setLaneDoorMessageIds(laneDoorMessageIds(laneDoorRoot))
      const sessionId = sessionIdOfAgent(payload?.agent)
      if (sessionId === null) return
      const turn = Number.isInteger(payload?.turn) ? payload.turn : null
      if (turn === null) return
      // *** DEDUPED ON THE ASK, NOT ON THE TURN, AND THAT IS A MEASURED LIMIT RATHER THAN A CHOICE. *** The surface's
      // `user/message` disposition carries `['role', 'id', 'content', 'source']` and NO turn field, so a message cannot be
      // attributed to the turn that is stopping — `lastRealAsk`'s own docstring says so, and the sibling hook dedupes on the
      // ask for the same reason. Keying on the turn here would have re-remembered the same sentence on every later turn of
      // the session: a memory multiplier, and the worst kind, because each copy would carry a valid receipt.
      if (seenTurns.has(sessionId)) { /* session already handled */ }

      // *** `ctx.get` FIRST, BECAUSE `ctx.reflect` IS AN UNDECLARED PROPERTY ACCESS. *** That is the same defect Fable found
      // in the mount (`ctx.webServer` read as a property), and it bit here too: on a bare Context `ctx.reflect` is simply
      // undefined, the hook returned early, and nothing said why. `ctx.get` is the sanctioned read for a service this
      // plugin does not inject; the property is kept as a fallback for a context that exposes it.
      // *** FIXED 2026-09-27 (red team): `reflect` is a ROOT PROPERTY of a Cordis context, never a provided service, and the
      // service is named `sessionQuery`. `ctx.get('reflect')` was always undefined and 'session-query' never existed, so this hook
      // returned here on every turn and captured nothing, silently. The same lookup the working auto-stage hook uses. ***
      const reflect = /** @type {{reflect?: {get?: (name: string, required: boolean) => unknown}}} */ (ctx).reflect
      const reader = typeof reflect?.get === 'function' ? reflect.get(readerService, false) : undefined
      if (reader === undefined || reader === null) {
        if (!warnedNoReader) { warnedNoReader = true; logger?.warn?.(`aukora-kira: remembered capture found no ${readerService} service; nothing is captured`) }
        return
      }
      const surface = await reader.readSurface(sessionId)
      const events = Array.isArray(surface?.events) ? surface.events : []
      const ask = lastRealAsk(events)
      // AN ABSENT ASK IS THE COMMON CASE, NOT A FAULT: our own recall injection and the board's status block are messages in
      // this stream too, and `isRealAsk` is the same predicate the staging hook uses, imported rather than re-implemented so
      // the two paths can never disagree about what a person said.
      if (ask === '') return
      const event = [...events].reverse().find(one => isRealAsk(one))
      const seq = Number.isInteger(event?.seq) ? event.seq : null
      if (seq === null) return
      // *** ONE CAPTURE PER ASK EVENT, KEYED BY ITS SEQ, NOT BY ITS TEXT (2026-09-27, "remember everything"). *** An agent turn
      // fires this hook many times per ask, so a key is needed; keyed by the TEXT, the owner saying "continue" twice in a row was
      // remembered once. The event's own seq names the ask, so two asks with the same words are two turns.
      if (seenTurns.get(sessionId) === seq) return
      seenTurns.set(sessionId, seq)

      const read = await readSessionEventStreamed({ stateRoot: sessionsRoot, sessionId, seq })
      const line = read?.line ?? null
      if (typeof line !== 'string' || line === '') {
        // NO LINE, NO RECEIPT, NO NOTE. This is the tier's whole claim, and it is refused rather than approximated.
        logger?.warn?.(`aukora-kira: remembered capture skipped (the event for ${sessionId} seq ${String(seq)} could not be read as a line)`)
        return
      }

      const policy = await policyOf()
      // THE EVENT'S OWN TIME, because that is the canonical record: the surface event carries `{type, seq, time, data}` and its
      // `time` is what the receipt's `at` must say. The first version took the time from the boundary's read, which answered a
      // different clock and made the note disagree with the line it came from.
      const stamp = Number.isFinite(event?.time) ? event.time : (Number.isFinite(read?.time) ? read.time : (options.now?.() ?? Date.now()))
      const at = canonicalInstant(stamp)
      // THE UNSIGNED TIER'S OWN CHAIN (the original memory law, `memory-law.mjs`): a remembered note is never chained into the
      // approved `aura.jsonl`, which is what the public export copies. Settle no longer shares this file, so the lock below
      // serializes the unsigned-tier writers only.
      const auraFile = `${stateDir}/${STORE_PATHS.rememberedAura}`
      // ONE WRITER AT A TIME ON THE CHAIN (2026-09-27, red team). The lock is held from reading the log's length (the index
      // each note records) to the last append, so every entry names the head it follows. The lock file lives beside the
      // chain, in `remembered/`, so that directory must exist before the lock is taken.
      ensureDirectory(stateDir)
      ensureDirectory(`${stateDir}/${STORE_PATHS.remembered}`)
      const remembered = withFileLock(auraFile, () => {
        // *** A TURN ALREADY REMEMBERED IS NOT REMEMBERED AGAIN AFTER A RESTART. *** The seq key above lives in memory; a goal
        // lane re-armed after a restart runs an agent turn with no new ask, and its last ask would be captured a second time.
        // The journal's `turn` anchor (the digest of the exact event line, no words) is what survives, as the Auma hook uses it.
        const journalFile = `${stateDir}/${STORE_PATHS.journal}`
        const turnDigest = sha256Hex(line)
        const alreadyAnchored = readLinesIfPresent(journalFile).some(one => {
          try {
            const entry = JSON.parse(one)
            return entry?.op === 'turn' && String(entry?.id) === turnDigest
          } catch { return false }
        })
        if (alreadyAnchored) return []
        const auraIndex = readLinesIfPresent(auraFile).length
        const captured = consumeTurn(
          { sessionId, sessionTitle: 'auma', seq, at, turn, text: ask, canonicalEventLine: line },
          { subject: String(policy?.subject ?? ''), privacy: String(policy?.privacy ?? 'local'), observedAt: at, auraIndex, validFrom: at.slice(0, 10), forbidden: FORBIDDEN_WINDOW_DIGESTS, secretPatterns: SECRET_PATTERNS },
        )
        // *** A DROPPED CANDIDATE SAYS WHY, AND NEVER SAYS WHAT. *** The bare 64-hex pattern drops notes that quote a digest,
        // which is the right trade (a false positive costs a record; a leaked key costs everything) — but a silent drop cannot be told
        // from a broken extractor, so each one is reported by RULE with a SHA-256 OF THE STATEMENT as its identifier. The statement
        // itself is never logged: the log is exactly where a leaked key would travel.
        for (const drop of captured.dropped ?? []) {
          logger?.warn?.(`aukora-kira: a candidate was not remembered (${String(drop.rule)}): statement sha256 ${sha256Hex(String(drop.statement ?? '')).slice(0, 16)}… — the text is deliberately not logged`)
        }
        // THE BOUND AND ITS REPORT COME FROM ONE PLACE, so the court that drives them drives what RUNS.
        const notes = boundedNotes(captured.notes, { logger })
        if (notes.length === 0) return notes
        // THE TURN'S ANCHOR, FIRST: a digest and a seq, never the words. The notes below chain after it.
        {
          const prior = readLinesIfPresent(journalFile)
          let previous = null
          if (prior.length > 0) {
            try { previous = JSON.parse(prior[prior.length - 1]) } catch { throw new Error('aukora-kira: the remembered journal tail is not JSON; refusing to append an unchained entry') }
          }
          appendJournalLine({ file: journalFile, line: JSON.stringify(nextEntry({ previous, op: 'turn', id: turnDigest, objectDigest: turnDigest, actor: 'kira.capture/v1', reason: `turn ${String(sessionId)} seq ${String(seq)} was remembered`, at })) })
        }

        // ONE PLAN, THEN THE WRITES: a note and its journal line travel together, so a caller cannot write a note the store
        // cannot account for — the rule `planStoreWrite` refuses a mismatch over.
        const plan = planStoreWrite({
          stateDir,
          notes,
          // CHAINED FROM THE JOURNAL'S TAIL (2026-09-27, red team), as memory-auma-hook.mjs does: an unhashed 'remember' line
          // is not one of the journal's ops and verifyChain reads it as DAMAGED, so the first captured turn would have broken it.
          journalLines: (() => {
            const prior = readLinesIfPresent(`${stateDir}/${STORE_PATHS.journal}`)
            let chained = null
            if (prior.length > 0) {
              try { chained = JSON.parse(prior[prior.length - 1]) } catch { throw new Error('aukora-kira: the remembered journal tail is not JSON; refusing to append an unchained entry') }
            }
            return notes.map(note => {
              const entry = nextEntry({ previous: chained, op: 'add', id: note.id, objectDigest: String(note.id).slice(4), actor: 'kira.capture/v1', reason: 'remembered from a conversation turn', at })
              chained = entry
              return JSON.stringify(entry)
            })
          })(),
          // *** AND NOT `JSON.stringify`: THE PLAN ENCODES IT EXACTLY ONCE. *** This line stringified the entry and `planStoreWrite` encoded the
          // string again, so every aura entry this path wrote was double-encoded — the same defect the migration's first apply produced, alive
          // in the path Peter's conversations go through. It also lacked `entryHash`, so the chain could not confirm the note's own entry.
          // CHAINED, as memory-auma-hook.mjs does: an unhashed line here left an unchained TAIL, and the next settle refused AURA_TAIL_TORN
          // (measured live 2026-09-27). One call for the batch, so each entry names the one before it.
          auraAppends: chainAuraEntries(stateDir, notes.map(note => ({ op: 'remember', id: note.id, at, tier: note.tier, by: 'kira.capture/v1', index: note.aura?.index, entryHash: note.aura?.entryHash, digest: String(note.id).slice(4) })), { file: auraFile }),
        })
        // THE DIRECTORIES FIRST: the store's first write needs `remembered/` to exist, and creating it is a named act here
        // rather than something the writer does quietly to any path it is handed.
        for (const dir of plan.dirs) ensureDirectory(dir)
        for (const write of plan.writes) durableWrite(write.file, write.contents, { dir: stateDir })
        // `durableAppend` READS `options.readExisting` UNCONDITIONALLY, so every caller must hand it an options object or it
        // throws inside itself with a message about a property rather than about the argument. Passing `{}` is the honest
        // call; the trap is worth an arm of its own and is noted in the commit.
        // *** THE SAME BUG THE MIGRATION FOUND, IN THE PATH PETER'S CONVERSATIONS GO THROUGH. *** `durableAppend` concatenates raw
        // bytes and terminates nothing, so a turn's notes would reach the journal as ONE line with no separators — a chain that is
        // not a chain. `appendJournalLine` writes `${line}\n` under `O_APPEND` and fsync, and REFUSES a line that already carries a
        // newline, so the shape is enforced rather than hoped for.
        for (const append of plan.appends) appendJournalLine({ file: append.file, line: append.line })
        return notes
      })
      if (remembered.length === 0) return
      // REPORTED, NOT SILENT: a reader of the log can see what was remembered and how many, which is the only way to notice a
      // capture path that has quietly stopped producing notes.
      options.onRemembered?.({ sessionId, turn, seq, remembered: remembered.length, ids: remembered.map(note => note.id) })
    } catch (error) {
      // THE ONLY OUTLET. A capture fault costs a record; it must never cost the turn.
      logger?.warn?.(`aukora-kira: remembered capture skipped (${error?.message ?? String(error)})`)
    }
  })
}
