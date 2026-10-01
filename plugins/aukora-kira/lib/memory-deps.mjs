/**
 * THE FOUR DEPENDENCIES THE ROUTES NEED — built from the store, and REFUSING when the store cannot be read.
 *
 * `memory-mount.mjs` refuses to mount without these; this is where they come from. The distinction it enforces is the
 * whole reason this file exists: a `listNotes` that returned `[]` because a directory was unreadable would tell AK-UI's
 * client "you have no memories", which is a claim about the owner's life, when the truth is a claim about a file. So every
 * function here THROWS on an unreadable store and the mount's contract turns that into a refusal rather than an answer.
 *
 * IT READS THROUGH THE ONE AUDITED BOUNDARY. `strict-read.mjs` is the plugin's single filesystem route (ruling A); this
 * module does not open a second one, and it does not import a writer. Forgetting writes through `appendJournalLine`, which
 * is that boundary's own append, because a tombstone nobody can find in the journal is a deletion nobody can account for.
 *
 * THE SIGNING GATE IS NOT OPENED HERE. `trustNotes` answers with the closed gate and the ceiling it would need, exactly as
 * the route already did — the one difference being that this is now reachable by a client, so the refusal has to be the
 * thing a client sees rather than a 404.
 *
 * @module @aukora/dsh-plugin-kira/memory-deps
 */
import { readdirSync, unlinkSync } from 'node:fs'
import { FORGET_IS_LOCAL_ONLY, FORGET_MARKER, SIGNED_ERASURE_CEILING, insideStateDir } from './memory-forget.mjs'
import { AURA_RECORD_DOMAIN, auraEntryHash } from './memory-owner.mjs'
import { KIRA_ROUTES } from './memory-routes.mjs'
import { STORE_PATHS, objectFileName } from './memory-store.mjs'
import { RECALL_TIERS, SIGNING_CEILING, SIGNING_ENABLED } from './memory-tiers.mjs'
import { verifyRecord } from './memory-verify.mjs'
// `readJsonStrict` IS THE READER THAT ALREADY EXISTS: it refuses duplicate keys, an oversized artifact and excessive
// nesting where a plain `JSON.parse` would accept them. I nearly wrote a `readArtifact` wrapper for this — the skill's own
// corollary says to grep the release for one first, and the grep is what found it.
// AND IT REACHES THE FILESYSTEM ONLY THROUGH THE BOUNDARY: `listJsonFiles` is the boundary's own listing, added
// because this module importing `node:fs` was refused BY NAME by `kira-recall` — the widening the boundary exists to
// catch, caught by a court rather than by a reviewer.
import { appendJournalLine, listJsonFiles, readJsonStrict, readLinesIfPresent, stateExists, withFileLock } from './strict-read.mjs'
// THE FORGOTTEN SET COMES FROM THE CHAIN, not from a field on the note: the tombstone IS the `forget` entry.
import { forgottenIds, noteStates } from './memory-forget.mjs'
import { nextEntry } from './memory-journal.mjs'
import { contentFreeTombstone } from './memory-law.mjs'
import { signedRecallRecord } from './recall-filter/filter.mjs'
import { readTrackedMemory } from './tracked-memory.mjs'
import { readCaptureEventStreamed } from './session-read.mjs'

/**
 * THE CHAIN'S OWN ANSWER FOR ONE REMEMBERED NOTE: the `entryHash` its chain entry carries, read from the chain file and checked.
 *
 * `verifyNote` used to pass `() => found?.aura?.entryHash`, which is the note's own field: the chain check compared the note with
 * itself, so a deleted or rewritten chain still read VERIFIED. This reads the unsigned tier's chain (`remembered/aura.jsonl`), and
 * then `aura.jsonl`, where a note captured before the two chains were split (2026-09-27) has its entry.
 *
 * Every CHAINED line up to and including the note's entry must link (`prev` is the previous chained line's `hash`, genesis
 * `AURA_RECORD_DOMAIN`) and must rehash to its own `hash`. A line with no `hash` is a legacy unchained line (migration,
 * old housekeeping; `scripts/kira/repair-aura-tail.mjs` resumes the chain after them): it is skipped, and it cannot vouch for a note.
 *
 * @param {string} stateDir - the store root.
 * @param {string} id - the note id.
 * @returns {string|null} the entryHash the chain holds for the note; null when no chain holds an entry for it (MISSING); a
 *   `chain-…` sentence when the chain up to the entry does not verify (the verifier then answers CHANGED).
 */
export function rememberedChainEntry(stateDir, id) {
  for (const file of [`${stateDir}/${STORE_PATHS.rememberedAura}`, `${stateDir}/${STORE_PATHS.aura}`]) {
    let prev = AURA_RECORD_DOMAIN
    for (const [index, line] of readLinesIfPresent(file).entries()) {
      let entry
      try { entry = JSON.parse(line) } catch { entry = null }
      if (entry === null || typeof entry !== 'object' || Array.isArray(entry)) return `chain-unreadable:${file}:${String(index + 1)}`
      if (typeof entry.hash !== 'string') continue
      const { prev: named, hash, ...fields } = entry
      if (named !== prev || auraEntryHash(prev, fields) !== hash) return `chain-broken:${file}:${String(index + 1)}`
      prev = hash
      if (fields.id === id && (fields.op === 'add' || fields.op === 'remember') && typeof fields.entryHash === 'string') return fields.entryHash
    }
  }
  return null
}

/**
 * EVERY NOTE THE CHAIN VOUCHES FOR, in one pass: id -> the entryHash its `add`/`remember` entry carries. The same walk as
 * `rememberedChainEntry`, so the two cannot disagree: lines link and rehash up to the entry, a break in the unsigned tier's chain
 * vouches for nothing after it (and the pre-split `aura.jsonl` is then not consulted), an unchained legacy line vouches for nothing.
 * @param {string} stateDir
 * @returns {Map<string, string>}
 */
export function chainedRememberedIds(stateDir) {
  const vouched = new Map()
  for (const file of [`${stateDir}/${STORE_PATHS.rememberedAura}`, `${stateDir}/${STORE_PATHS.aura}`]) {
    let prev = AURA_RECORD_DOMAIN
    for (const line of readLinesIfPresent(file)) {
      let entry
      try { entry = JSON.parse(line) } catch { entry = null }
      if (entry === null || typeof entry !== 'object' || Array.isArray(entry)) return vouched
      if (typeof entry.hash !== 'string') continue
      const { prev: named, hash, ...fields } = entry
      if (named !== prev || auraEntryHash(prev, fields) !== hash) return vouched
      prev = hash
      if ((fields.op === 'add' || fields.op === 'remember') && typeof fields.entryHash === 'string' && !vouched.has(fields.id)) vouched.set(String(fields.id), fields.entryHash)
    }
  }
  return vouched
}

/**
 * Whether a queue entry (or a set-aside copy of one) holds the same turn as a remembered note.
 *
 * SAME SESSION AND THE SAME WORDS (either containing the other, whitespace and case folded). The session is the guard: forgetting
 * a short note ("yes") must not reach into another conversation's queue entry that happens to contain the word. The turn number
 * is NOT enough on its own, because the harness's turn counter is per process and restarts. The content is read where the
 * current entry keeps it (`record.content`) and where older staging shapes kept it.
 * @param {Readonly<Record<string, unknown>>} note - the note being forgotten.
 * @returns {(entry: unknown) => boolean}
 */
export function queueEntryMatcher(note) {
  const flat = text => (typeof text === 'string' ? text.replace(/\s+/gu, ' ').trim().toLowerCase() : '')
  const sessionId = typeof note?.source?.sessionId === 'string' ? note.source.sessionId : null
  const words = flat(note?.statement ?? note?.text)
  return entry => {
    if (sessionId === null || entry === null || typeof entry !== 'object') return false
    const content = entry.record?.content ?? entry.value?.content ?? entry.content
    if (content === null || typeof content !== 'object') return false
    if (content.turn?.sessionId !== sessionId) return false
    const queued = flat(content.note)
    return words !== '' && queued !== '' && (queued.includes(words) || words.includes(queued))
  }
}

/** A named refusal: a dependency that cannot answer honestly raises, and the route reports it. */
export class KiraDepsError extends Error {
  /**
   * @param {string} code - stable machine-readable refusal code suffix.
   * @param {string} message - human-readable refusal.
   */
  constructor(code, message) {
    super(`kira.deps: ${message}`)
    this.name = 'KiraDepsError'
    this.code = `kira.deps:${code}`
  }
}

/** How many note objects one listing may read, so a large store cannot be read into memory by a query. */
export const MAX_LISTED = 500

/**
 * Build the four dependencies for a state directory.
 * @param {{stateDir: string, sessionsRoot?: string, now?: () => string, approverDid?: string, readOwner?: {read: Function}}} input - `approverDid` is the PINNED approver key; a settled record is labelled as approved with it only when its spent approval names the same key.
 * @returns {{listNotes: Function, verifyNote: Function, forgetNote: Function, trustNotes: Function}}
 */

/** The last entry on disk, or null — the `previous` a new chain entry links to. Null on any fault, because a tombstone that refuses to
 *  be written is worse than one that starts a fresh link, and the chain's own verifier is what catches a real break. */
function previousEntryFor(readLinesIfPresent, stateDir) {
  const prior = readLinesIfPresent(`${stateDir}/${STORE_PATHS.journal}`)
  if (prior.length === 0) return null
  try { return JSON.parse(prior[prior.length - 1]) } catch { return null }
}

export function buildRouteDeps(input) {
  // *** `stateDir` MEANS THE STORE ROOT, AND THE SESSIONS LIVE SOMEWHERE ELSE. *** Fable's item (2), measured: the
  // composition passes `dshHomePath('kira-memory')`, so a deployed `stateDir` IS the store root — and this module used to
  // join it with paths that ALSO began `kira-memory/`, reading `…/kira-memory/kira-memory/remembered`, which does not exist.
  // `ENOENT` there became `[]`, and `[]` says "you have no memories". A wrong path was reporting itself as an empty life.
  //
  // The session events are NOT under the store root; they live beside it, in `<home>/sessions`, so they get their own name.
  const { stateDir, sessionsRoot, approverDid } = input ?? {}
  if (typeof stateDir !== 'string' || stateDir === '') {
    throw new KiraDepsError('state-dir-missing', 'the routes answer for a store, and a store needs a state directory')
  }
  // THE HOME IS THE MISSING THING THAT MUST REFUSE. A store root that was never created is a real answer — Kira is new, and
  // `[]` is true. A HOME that does not exist is a misconfiguration, and answering `[]` there would tell the owner he has no
  // memories because a path was wrong. So the home is checked first, and only its absence refuses.
  const home = stateDir.replace(/\/[^/]+$/u, '')
  // *** `sessionsRoot` IS THE HOME, NOT `<home>/sessions`. *** The boundary's `findSessionFile` looks under `${stateRoot}/sessions`,
  // so passing `<home>/sessions` here would search `<home>/sessions/sessions` — THE SAME DOUBLING THAT ITEM (2) WAS ABOUT, in the
  // one place I had just fixed it. A default is one meaning too.
  const sessions = typeof sessionsRoot === 'string' && sessionsRoot !== '' ? sessionsRoot : home
  if (!stateExists(home)) {
    throw new KiraDepsError('state-home-missing', `the state home ${home} does not exist, so a store under it has never been created and this is a misconfiguration rather than an empty memory`)
  }
  const rememberedDir = `${stateDir}/${STORE_PATHS.remembered}`
  // THE AUTO-STAGED QUEUE, where a turn's words also wait for approval. The owner's default is `<store>/queue`.
  const queueDir = typeof input?.queueDir === 'string' && input.queueDir !== '' ? input.queueDir : `${stateDir}/queue`

  // *** THE DIRECTORY DECIDES THE TIER, NOT THE FILE (2026-09-27). *** A note's `tier` is not inside the bytes its id covers, and
  // this list passed the file's own `tier` through, so a note file in `remembered/` that said `signed` was shown in the Signed
  // portal (and refused Forget as signed). Nothing under `remembered/` is signed: Signed memories come only from the owner's
  // verified read below. So every object read from here is the Remembered tier, whatever it says about itself.
  const asRemembered = note => (note !== null && typeof note === 'object' && !Array.isArray(note) ? { ...note, tier: 'remembered' } : note)

  /** Read ONE note object by id, straight from its own file name: forget and verify must reach every note, not the first MAX_LISTED. */
  const objectById = id => {
    let name
    try { name = objectFileName(id) } catch { return undefined }
    const file = `${rememberedDir}/${name}`
    if (!insideStateDir(file, stateDir) || !stateExists(file)) return undefined
    let note
    try { note = asRemembered(readJsonStrict(file)) } catch { note = null }
    // A FILE THAT DOES NOT PARSE, OR THAT CARRIES ANOTHER NOTE'S ID, is not this note: verify answers MISSING, and forget
    // still erases the file its id names.
    if (note === null || typeof note !== 'object' || note.id !== id) return { id, tier: 'remembered', unreadable: true, statement: '', observedAt: null }
    return note
  }

  /** Read every note object, or REFUSE. An empty result means an empty store, never an unreadable one. */
  const objects = () => {
    let names
    try {
      names = listJsonFiles(rememberedDir)
    } catch (error) {
      // ANYTHING ELSE IS A REFUSAL. This is the line that keeps "unreadable" from looking like "empty", and the boundary
      // hands the code through so the caller can say which.
      throw new KiraDepsError('store-unreadable', `the remembered store could not be read (${String(error?.code ?? error?.name ?? 'unknown')}), which is NOT the same as having no memories`)
    }
    const out = []
    for (const name of names.slice(0, MAX_LISTED)) {
      const file = `${rememberedDir}/${name}`
      if (!insideStateDir(file, stateDir)) continue
      try {
        out.push(asRemembered(readJsonStrict(file)))
      } catch {
        // A note whose bytes do not parse is REPORTED as unreadable rather than skipped: skipping it would make the store
        // look smaller than it is, which is the same failure as answering an empty list.
        out.push({ id: `unreadable:${name}`, tier: 'remembered', unreadable: true, statement: '', observedAt: null })
      }
    }
    return out
  }

  // *** A FORGOTTEN RECORD LEAVES THE LIST, AND THE SET IS READ PER CALL. *** My first version computed it ONCE, when these deps were
  // built — and forgetting happens AFTER that, so in the live system (deps built at mount, a forget minutes or days later) the set
  // would always be the one from startup and the filter would never once work. The probe caught it: the tombstone was written and the
  // list still showed the note. A read path must ask the store what is true NOW.
  const forgottenNow = () => forgottenIds(stateDir, readLinesIfPresent)
  // *** A HIDDEN NOTE IS HIDDEN IN THE LIST TOO, AND IT WAS NOT. *** §6.1 ends a spoken forget with *"the note is hidden at once, and a chip asks 'Forget: …? [Forget] [Keep]'"* — and
  // measured 2026-09-29, after the voice-forget caller was wired, a hidden note **still came back from this route and from a search for its own words**. The injection path already
  // excludes it (`states` reaches `recallFilter`), so the gap was here: this filter knew about `forget` and nothing else. `noteStates` replays the same chain for every §2.2 move, and
  // `restore`/`unhide` clear the entry, so a note put back is listed again with no special case.
  const hiddenNow = () => noteStates(stateDir, readLinesIfPresent)

  // Settled content and signing metadata come only from the owner's verified read.
  // Never reconstruct signed records by walking keys/objects or trusting receipt files here.
  const settledRecords = async () => {
    if (typeof input.readOwner?.read !== 'function') {
      throw new KiraDepsError('verified-reader-missing', 'signed memories require the deployment read owner')
    }
    const snapshot = await input.readOwner.read()
    if (snapshot?.availability !== 'found' && snapshot?.availability !== 'empty') {
      throw new KiraDepsError('store-unverified', `the settled store could not be verified (${String(snapshot?.reason ?? 'unknown')})`)
    }
    const pinned = typeof approverDid === 'string' && approverDid !== '' ? approverDid : null
    const shortDid = did => `did:key:…${did.slice(-8)}`
    return snapshot.records.map(entry => {
      const { record, citation, settlement } = entry
      const did = settlement?.approverDid ?? null
      const label = did === null ? 'no approval record'
        : did === pinned ? 'approved in the AUKORA popup with the pinned key'
        : pinned === null ? `settled with ${shortDid(did)} (no approver key is pinned to compare)`
        : `settled with an earlier key (${shortDid(did)})`
      const at = Number.isFinite(settlement?.issuedAt) ? settlement.issuedAt * 1000 : null
      return {
        ...signedRecallRecord(entry, snapshot.records),
        id: record.recordId, tier: 'signed', kind: record.kind,
        statement: typeof record.content?.note === 'string' ? record.content.note : JSON.stringify(record.content),
        createdAt: record.createdAt, observedAt: record.createdAt, label: 'signed',
        source: { ...record.source, sessionTitle: `${label}, Aura entry ${String(citation.auraSequence)}`, at },
        aura: { index: citation.auraSequence, entryHash: citation.auraEntryHash, verifiedHead: citation.verifiedHead },
        citation, trusted: at === null ? null : { at },
      }
    })
  }

  const listNotes = async ({ tiers, q, limit, before, now } = {}) => {
    // *** AN UNREADABLE NOTE IS A FAULT, NOT SOMETHING TO FILTER AWAY. *** `objects()` reports one as `unreadable: true` — "rather
    // than skipped, because skipping it would make the store look smaller than it is" — and this function then filtered exactly
    // those entries out, so the promise held by the module's own docstring ("every function here THROWS on an unreadable store")
    // was decorative. Measured 2026-09-26: a single unreadable note made `listNotes` answer `[]`, which is a claim about the
    // owner's life when the truth was a claim about a file.
    const broken = objects().filter(note => note.unreadable === true)
    if (broken.length > 0) {
      throw new KiraDepsError('store-unreadable', `${String(broken.length)} note(s) in the remembered store could not be read (${broken.map(note => String(note.id)).join(', ')}), which is not the same as having none`)
    }
    const asked = Array.isArray(tiers) && tiers.length > 0 ? tiers : [...RECALL_TIERS]
      // *** A QUESTION IS NOT A SUBSTRING, AND THIS FILTER USED TO REQUIRE IT TO BE ONE. *** The first version read `String(note.statement).includes(needle)` with the whole `q` as the needle, so a
      // question could only match a statement containing it VERBATIM: measured 2026-09-29, `--question "what does the owner prefer in the mornings"` recalled 0 records from a store holding
      // *"the owner prefers short answers in the mornings"*, while the same store WITHOUT the question recalled one — because `needle === ''` short-circuits to true. The terms are matched
      // individually instead, which is what a search box does and what this route's `q` has always claimed to be.
      const needle = String(q ?? '').trim().toLowerCase()
      const terms = needle.split(/\s+/u).filter(Boolean)
      // *** BOTH SETS ARE REPLAYED ONCE PER CALL, NOT ONCE PER NOTE. *** These two filters each called a function that re-read and re-parsed the WHOLE journal, and a filter
      // predicate runs per note — so listing N notes over a journal of L lines cost N x L parses, for answers that cannot change while the list is being built. Measured on a 400-note
      // store with a 1000-line chain: 573 ms before, 28 ms after. §3.5 makes the same point about the chain head — *"verify once per turn"* — and this is that shape one layer down:
      // **an answer that is constant for the duration of a request is computed once for the request.** They must sit ABOVE the chain: my first version put them inside it, which ended
      // the expression at the first `const` — the `.slice()` and `.map()` below became dead code, and the route answered 400 items where it had answered 50.
      const forgottenSet = forgottenNow()
      const hiddenStates = hiddenNow()
    const policy = typeof input.readOwner?.describe === 'function' ? await input.readOwner.describe() : null
    return liveRemembered().notes
      .filter(note => !policy || (note.subject === policy.subject && policy.permittedPrivacy?.includes(note.privacy)))
      .filter(note => note.unreadable !== true && asked.includes(note.tier))
      .filter(note => !forgottenSet.has(String(note.id)))
      // A HIDDEN NOTE LEAVES THE LIST AT ONCE — the state the voice forget writes, and the half of §6.1 this route was missing.
      .filter(note => hiddenStates.get(String(note.id)) !== 'hidden')
      .filter(note => (terms.length === 0 ? true : terms.some(term => String(note.statement ?? '').toLowerCase().includes(term))))
      .filter(note => (before === null || before === undefined ? true : String(note.observedAt ?? '') < String(before)))
      .slice(0, Number(limit) > 0 ? Number(limit) : MAX_LISTED)
      // *** THE NOTE'S OWN LABEL SURVIVES, WHICH IS FABLE'S kira-122 REQUIREMENT. *** This used to overwrite `label` with the tier,
      // so a migrated note rendered as plain `remembered` and the face would have had no way to say that its source was never
      // found. The label the builder wrote (`remembered, source not found`) is the one a person needs; the tier falls back in.
      .map(note => ({ ...note, tier: String(note.tier), label: String(note.label ?? note.tier), text: String(note.statement ?? '') }))
  }

  const verifyNote = async ({ id }) => {
    // Signed IDs must reach the owner even if an unsigned object claims the same ID.
    if (String(id).startsWith('kira:')) {
      const signed = (await settledRecords()).find(note => note.id === id)
      return signed === undefined
        ? { id, source: 'MISSING', because: 'no note with that id is in the store' }
        : { id, source: 'VERIFIED', citation: signed.citation, because: 'the settled record, receipt and Aura chain verify' }
    }
    // *** §6.2's ORDER: "tombstone present, object missing" READS AS FORGOTTEN — so the tombstone is consulted BEFORE the object is looked for. *** This checked the object
    // first and returned `MISSING — no note with that id is in the store` the moment the file was gone, which was invisible until the erase actually removed bytes: with the
    // file still on disk the note was found, the tombstone below was reached, and the answer said `forgotten`. The first forget that truly erased its object turned the
    // answer into "no such note" — §6.2's "no tombstone, object missing" case, which reads as DAMAGED. A record the owner deliberately forgot must not be reported as damage.
    if (forgottenNow().has(String(id))) {
      return { id, source: 'MISSING', failed: 'source-not-found', forgotten: true, because: 'this record was forgotten, so its receipt is not served' }
    }
    const found = objectById(id)
    if (found === undefined || found.unreadable === true) return { id, source: 'MISSING', because: 'no note with that id is in the store' }
    const source = found.source ?? found.evidence?.[0] ?? {}
    // *** A DECLARED-UNLINKED RECEIPT IS A DECLARED STATE, NOT DAMAGE — AND THIS ROUTE SAID `CHANGED`. *** Measured 2026-09-26 while fixing
    // this court's unawaited arms: a note whose receipt declares `state: 'UNLINKED'` came back from here as CHANGED, because with no session
    // and no `aura.entryHash` the verifier's chain check fails and CHANGED is what a failed check is called. The COMMAND
    // (`scripts/kira/verify-memory.mjs`) has answered UNLINKED for exactly this record since kira-123 — so the CLI and the API disagreed
    // about the same bytes, and the Memory app reads the API: a record that was never linked would have been shown to Peter as DAMAGED.
    // One vocabulary, and the declared state is reported as itself.
    if (source?.state === 'UNLINKED') {
      return { id, source: 'UNLINKED', declared: true, because: 'the record declares that it was never linked to an event, so there is no source to re-read — this is a declared state, not damage' }
    }
    let line = null
    if (typeof source.sessionId === 'string' && Number.isInteger(source.seq)) {
      // THE SESSIONS ROOT, NOT THE STORE ROOT: session events are written by the harness beside the store, and reading
      // them from the store directory is how a receipt would answer MISSING for a session that is right there.
      const event = await readCaptureEventStreamed({ stateRoot: sessions, source })
      line = event === null || event === undefined ? null : event.line
    }
    // *** A REFUSAL IS NOT "MISSING". *** `verifyRecord` refuses when there is nothing to check against — a note with no
    // source, or a forged receipt — and an unhandled refusal would reach the client as a 500. Answering MISSING would be
    // just as wrong in the other direction: MISSING says the source cannot be FOUND, while this says there was never
    // anything to find it against. The contract's three answers stay three; the refusal is reported as its own named
    // outcome beside them, because collapsing it into MISSING would turn "unverifiable" into "your bytes are gone".
    try {
      // THE CHAIN READER READS THE CHAIN. It was `() => found?.aura?.entryHash`: the note's own field compared with itself,
      // so a deleted or rewritten chain still answered VERIFIED.
      const answer = verifyRecord(found, () => line, () => rememberedChainEntry(stateDir, String(found.id)))
      return { id, source: answer.source, failed: answer.failed ?? null }
    } catch (error) {
      return { id, source: 'UNVERIFIABLE', refused: String(error?.code ?? error?.name ?? 'unknown'), because: String(error?.message ?? '').slice(0, 200) }
    }
  }

  const forgetNote = args => withFileLock(`${stateDir}/${STORE_PATHS.rememberedAura}`, () => forgetNoteLocked(args))
  const forgetNoteLocked = ({ id, reason }) => {
    const found = objectById(id)
    if (found === undefined) return { id, forgotten: false, because: 'no note with that id is in the store' }
    if (found.tier === 'signed') {
      // §6's ceiling: a signed record is not erased by a route; it leaves a digest, and that is the owner's decision.
      return { id, forgotten: false, refused: 'signed-erasure-is-the-owners', ceiling: SIGNED_ERASURE_CEILING }
    }
    const at = (input.now ?? (() => new Date().toISOString()))()
    // *** THE TOMBSTONE IS THE ORIGINAL MEMORY LAW'S, AND IT CARRIES NO WORDS (2026-09-27). *** `contentFreeTombstone` is the
    // vendored `tombstoneCommitment({recordId, at})`. This entry used to write the caller's `reason` into the append-only journal —
    // MEASURED on a scratch store: `reason: "forget \"I prefer my spare key hidden under the blue pot\""`, the note's own words,
    // chained and unremovable after the object itself was erased. The route still accepts a reason; it is not written. The entry's
    // `objectDigest` is the hash of the tombstone, which is the object this forget writes.
    void reason
    const { tombstone, hash: tombstoneHash } = contentFreeTombstone({ id: String(found.id), at: String(at) })
    appendJournalLine({
      file: `${stateDir}/${STORE_PATHS.journal}`,
      // *** CHAINED, NOT MERELY APPENDED. *** This entry carried `previous: null` and NO `hash`, so the `forget` line was not linked
      // to the chain at all, and `verifyChain` REFUSED THE WHOLE JOURNAL the moment a record was forgotten — measured by probing the four
      // consequences end to end and finding `seq` undefined and no hash on the entry. It goes through the journal's own `nextEntry`, which
      // computes `seq`, `prev` and `hash` from what is actually on disk.
      line: JSON.stringify(nextEntry({
        previous: previousEntryFor(readLinesIfPresent, stateDir),
        op: 'forget', id, at, actor: 'kira.forget-route/v1',
        reason: '', objectDigest: tombstoneHash,
      })),
    })
    // *** THE BYTES NOW GO, AND THIS IS THE HALF THAT WAS NEVER IMPLEMENTED. *** The comment here used to end at "the object file is renamed by the caller's own store
    // cycle" — and MEASURED, there is no such cycle: nothing on this path calls `unlink` or `rmSync` anywhere in the plugin, and a real forget of a real note, run against a
    // COPY of Peter's store, left the object file exactly where it was while the route answered `forgotten: true`, the list dropped it, and verify said `MISSING`. §6.2 says a
    // forget removes *"the object file and its salt"* together, and §6.5's first guarantee is *"the bytes are gone from the canonical Kira store"*. A tombstone that hides a
    // record from three readers while leaving its bytes on disk is a filter, not a forget.
    //
    // WRITTEN AFTER THE TOMBSTONE, NEVER BEFORE: if the removal fails, the record is still consistently forgotten — hidden from the list, from recall and from verify — and a
    // crash between the two leaves a tombstone with bytes, which is the state this code used to stop at. The salts travel inside the object file, so removing it removes them;
    // a separate `.salt` is removed too if a store ever grows one.
    let objectsRemoved = false
    for (const name of [objectFileName(id), objectFileName(id).replace(/\.json$/u, '.salt')]) {
      const victim = `${stateDir}/${STORE_PATHS.remembered}/${name}`
      // `insideStateDir(path, stateDir)` — PATH FIRST. My first version passed them the other way round, so the guard was false for every note, the loop `continue`d, and the
      // removal silently did nothing: a guard whose failure mode is "skip the work" needs the arguments read rather than assumed.
      if (!insideStateDir(victim, stateDir)) continue
      try {
        unlinkSync(victim)
        objectsRemoved = true
      } catch (error) {
        if (error?.code !== 'ENOENT') throw error
      }
    }
    // *** THE AUTO-STAGED QUEUE COPY GOES TOO (2026-09-27). *** A text-chat turn is captured twice: as this note, and as an
    // auto-staged queue entry waiting for approval (`autostage.mjs`, `content.note` = the ask). The forget removed the note and
    // left the same words in `queue/`. The matching entry is the same session and the same turn, or the same session and the
    // same words. An entry that has since been APPROVED is a Signed memory now and is not erased here; it is named instead.
    const queueRemoved = []
    const notReached = []
    const matchesNote = queueEntryMatcher(found)
    let queueNames = []
    try {
      queueNames = listJsonFiles(queueDir)
    } catch (error) {
      notReached.push({ what: 'queue', ref: queueDir, because: `the auto-staged queue could not be listed (${String(error?.code ?? 'unreadable')}), so a copy there may remain` })
    }
    for (const name of queueNames) {
      const file = `${queueDir}/${name}`
      let entry
      try { entry = readJsonStrict(file) } catch { continue }
      if (!matchesNote(entry)) continue
      const recordId = typeof entry?.recordId === 'string' ? entry.recordId : name.replace(/\.json$/u, '')
      if (stateExists(`${stateDir}/keys/${recordId}.json`)) {
        notReached.push({ what: 'signed-copy', ref: recordId, because: 'this queue copy was approved in the popup and is a Signed memory now; a Signed memory is not erased by this route' })
        continue
      }
      try {
        unlinkSync(file)
        queueRemoved.push(recordId)
      } catch (error) {
        if (error?.code === 'ENOENT') continue
        notReached.push({ what: 'queue-entry', ref: recordId, because: `the queue copy could not be removed (${String(error?.code ?? 'unknown')})` })
      }
    }
    // *** WHAT THIS FORGET DID NOT REACH, SAID IN ITS OWN ANSWER. *** Set-aside copies: the queue backups `migrate-queue.mjs`
    // writes beside the store (`queue-backup-*`), named file by file when they hold these words. Session logs: the turn itself.
    for (const dir of setAsideDirs()) {
      let names = []
      try { names = listJsonFiles(`${stateDir}/${dir}`) } catch { names = [] }
      for (const name of names) {
        let entry
        try { entry = readJsonStrict(`${stateDir}/${dir}/${name}`) } catch { continue }
        if (matchesNote(entry)) notReached.push({ what: 'set-aside-copy', ref: `${dir}/${name}`, because: 'a queue backup the migration set aside; forget does not edit backups, so these words are still there' })
      }
    }
    const source = found.source ?? {}
    notReached.push({
      what: 'session-log',
      ref: typeof source.sessionId === 'string'
        ? `session ${source.sessionId}${Number.isInteger(source.seq) ? ` seq ${String(source.seq)}` : ''}`
        : String(found.evidence?.[0]?.log ?? 'the conversation this note came from'),
      because: 'the turn itself stays in the harness session log (an Auma Live turn in her request file); forget does not rewrite logs',
    })
    for (const ref of FORGET_IS_LOCAL_ONLY) notReached.push({ what: 'outside-this-store', ref })
    return { id, forgotten: true, tombstone: { ...tombstone, hash: tombstoneHash }, localOnly: true, objectsRemoved, queueRemoved, notReached }
  }

  /**
   * THE LEDGER THE SEMANTIC INDEX ANSWERS TO (`recall-openviking.mjs`): every live remembered note, uncapped. Live means what
   * `listNotes` means (not forgotten, not hidden) AND chained: the file is the note its name says, and the remembered chain holds
   * its entry with the note's own entryHash. A note that fails any of these is not in the ledger, so a hit on it is never shown.
   * @returns {{notes: Array<Record<string, unknown>>, unreadable: number, unchained: number}}
   */
  const liveRemembered = ({ includeWithheld = false } = {}) => {
    const live = readTrackedMemory(stateDir)
    return { notes: includeWithheld ? [...live.notes, ...live.withheld] : live.notes, states: live.states,
      unreadable: live.withheld.filter(note => note.recallRefusal !== 'unchained').length,
      unchained: live.withheld.filter(note => note.recallRefusal === 'unchained').length }
  }

  /** The `queue-backup-*` directories `scripts/kira/migrate-queue.mjs --apply` sets aside beside the store. */
  const setAsideDirs = () => {
    try {
      return readdirSync(stateDir, { withFileTypes: true })
        .filter(entry => entry.isDirectory() && entry.name.startsWith('queue-backup-'))
        .map(entry => entry.name)
        .sort()
    } catch {
      return []
    }
  }

  const trustNotes = ({ ids }) => {
    // THE GATE IS CLOSED AND THE REFUSAL IS THE ANSWER, so a client sees why rather than a 404 that says nothing.
    return {
      id: KIRA_ROUTES.trust, status: 503, error: SIGNING_ENABLED === false ? 'kira.memory:signing-gate-closed' : 'kira.memory:unknown',
      ceiling: SIGNING_CEILING, ids: Array.isArray(ids) ? ids.slice(0, 500) : [],
      because: 'signing is off until the owner is required in person; a Remembered note is tracked, not approved',
    }
  }

  // *** THE PENDING READER AND THE APPROVAL PATH ARRIVE FROM THE CALLER, AND THAT IS THE BOUNDARY RATHER THAN A
  // CONVENIENCE. *** *This package allows `node:fs` to exactly one module (`memory-owner.mjs`) and to NO other, so a deps
  // module that opened the queue directory would be refused by the boundary court rather than by review. The reader lives
  // in the owner and the approval lives in the composition; this module only carries them.*
  // *** AND AN UNMOUNTED ONE IS `undefined` RATHER THAN A STUB: the route refuses by name when it is absent, because a
  // stub answering `{items: []}` would tell the owner he has nothing to approve when in fact nobody looked. ***
  return {
    listNotes, verifyNote, forgetNote, trustNotes, liveRemembered,
    // Withheld placeholders are for refusal accounting only, never the index ledger.
    recallCandidates: () => liveRemembered({ includeWithheld: true }).notes,
    recallState: () => ({ forgotten: forgottenNow(), states: hiddenNow() }),
    // The semantic bridge receives governed records only from this verified reader; it never
    // reconstructs them from keys, objects, or receipt files.
    liveMemory: () => liveRemembered().notes,
    pendingReview: typeof input?.pendingReview === 'function' ? input.pendingReview : undefined,
    approvePending: typeof input?.approvePending === 'function' ? input.approvePending : undefined,
  }
}

/** The forget phrase, re-exported so a caller can see the words this engine answers to. */
export const FORGET_WORDS = FORGET_MARKER
