// THE SHELL'S HALF OF THE CROSSING: draw seven words, take them back, answer with a verdict.
//
// WHY THIS FILE IS NAMED FOR THE VERB AND NOT FOR THE ACT. It is the `draw` half of the two verbs
// `apps/aukora-desktop/aumlok-bridge-preload.cjs` mounts on the app window, and it holds no window,
// no page and no surface of its own — nothing here can be opened. `createAumlokDraw` is created by the
// bridge in the main process and registered on the same `ipcMain` the state read already uses. The
// name is deliberately the verb, because a second file named after the act reads as the separate
// surface the spec removed, however little of it there is.
//
// WHERE THE PHRASE LIVES, AND WHERE IT DOES NOT. The seven words are drawn HERE, in the main process,
// out of the word lists the organ ships in the release the shell is already serving. They travel to
// the page ONCE, for display, and they come back ONCE, typed. They are never written to a file, never
// put in a log line, never sent to a backend, never placed on the clipboard, and never echoed in a
// reply: `draw` answers with the words, and EVERY OTHER ANSWER this module can produce is one of the
// fixed machine-readable names in `DRAW_REFUSE`, which is a constant of this file and cannot
// carry a phrase byte by construction. Per-word hashes are deliberately NOT kept either — a seven-word
// phrase drawn from a public list is minutes of offline work to brute force from any small digest, so
// a "commitment" here would be a weaker thing wearing the name of a strong one.
//
// THE DRAWN PHRASE IS HELD IN MEMORY, IN ONE SLOT, ONLY UNTIL IT IS ANSWERED. That is the smallest
// life a phrase can have while still being checkable: the shell must be able to tell the words it
// drew from words that were typed, and it can only do that by still knowing them. The slot is keyed to
// the webContents that drew it, is consumed by the first submit (right or wrong), and dies with the
// window.
//
// THIS FILE WRITES NOTHING, AND THAT IS NOW A PROPERTY RATHER THAN A GAP. A correct type-back PERFORMS
// THE BIND, and the binding is written by the organ — `plugins/aukora-aumlok/lib/bind-v3.mjs`, reached
// through the library the shell loads out of the release. MEASURED, this module's own surface is still
// four functions and it still imports no writer; what changed is that `submit` no longer answers
// VERIFIED for a ceremony it did not perform. It answered exactly that, and wrote nothing, which is how
// Peter's seven words vanished and his screen returned to "Give me my phrase" with no record and no
// refusal: the shell told the screen a success it had not achieved.
//
// WHY THE LIST IS READ OUT OF THE RELEASE. The organ's themed lists and its anchor list are data the
// release already carries; the shell reads those bytes rather than keeping a second copy that could
// disagree with the one a record is eventually derived against. If the release does not carry them,
// the answer is a refusal BY NAME, never a fallback list.
//
// AND SO IS THE BIND CEREMONY. The same release carries `plugins/aukora-aumlok/lib/bind-v3.mjs`, and
// `submit` calls that module rather than deriving anything here: a root derived in the shell and a root
// derived in the organ would be two answers to "what identity do these seven words name", and this
// repository has already paid once for two writers of one format.
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { randomInt } from 'node:crypto'

/** The names this shell refuses by. Every one of them is a constant of this file, so no refusal can
 * carry phrase material: the reply is the name, and the name is written here. */
export const DRAW_REFUSE = Object.freeze({
  /** The caller is not the application window. */
  FORBIDDEN_SENDER: 'aumlok:forbidden-sender',
  /** A ceremony was asked for that this shell does not run. */
  INTENT_UNKNOWN: 'aumlok:ceremony-intent-unknown',
  /** A submit arrived with no draw behind it, or with the draw already answered. */
  NO_PENDING_DRAW: 'aumlok:no-pending-draw',
  /** The words typed back are not the words that were drawn. ONE refusal, nothing written. */
  PHRASE_MISMATCH: 'aumlok:phrase-mismatch',
  /** The typed words are not seven lower-case words and are not compared at all. */
  PHRASE_SHAPE: 'aumlok:phrase-shape',
  /** The release carries no word lists, so no phrase can be drawn. */
  NO_LISTS: 'aumlok:word-lists-absent',
  /** The lists are present but no anchor is drawable from them. */
  NO_ANCHOR: 'aumlok:no-drawable-anchor',
  /** The phrase was drawn and the words came back exactly as drawn, and the binding was written. */
  VERIFIED: 'aumlok:ceremony-verified',
  /** The words matched but this shell has no bind ceremony to perform, so nothing can be written. */
  CEREMONY_ABSENT: 'aumlok:ceremony-absent',
  /** The binding could not be written; the ceremony's own name carries the errno after it. */
  WRITE_FAILED: 'aumlok:bind-write-failed',
  /** The binding was written but cannot be read back, so it is not a binding. */
  RECORD_UNREADABLE: 'aumlok:bind-record-unreadable',
})

/**
 * THE NAMES THE CEREMONY REFUSES BY, MIRRORED SO THE SCREEN CAN RECOGNISE THEM.
 *
 * `bind-v3.mjs` owns these strings and the shell does not paraphrase them: a refusal crosses to the
 * screen verbatim, which is the point of a named refusal. This list exists only so a court reading the
 * shell's own constants can tell a ceremony refusal from a shell one — it is a copy for comparison, and
 * the ceremony remains the author. It is deliberately NOT used to rewrite what crosses.
 */
export const BIND_REFUSE = Object.freeze({
  DIRECTORY_ABSENT: 'aumlok:bind-directory-absent',
  PHRASE_MALFORMED: 'aumlok:bind-phrase-malformed',
  WRITE_FAILED: 'aumlok:bind-write-failed',
  RECORD_UNREADABLE: 'aumlok:bind-record-unreadable',
  ALREADY_BOUND: 'aumlok:bind-already-bound',
})

/** How long a refusal name may be. The face drops anything over 128 characters, so this is its bound. */
const REFUSAL_LIMIT = 128

/**
 * Read a refusal name off a thrown value, or answer `null` so the caller invents nothing.
 *
 * MEASURED, AND THIS IS WHY IT IS NOT `error.code`: a plain `TypeError` in modern Node carries
 * `code === 'ERR_INVALID_ARG_TYPE'`. A shell that passed `error.code` straight through therefore put a
 * raw Node identifier on the screen where the item requires a NAME of the shell's own — and this
 * screen's whole defect was that it said nothing useful. Only a value this product chose counts, and a
 * value the product chose always begins with the `aumlok:` prefix.
 * @param {unknown} cause - whatever was thrown.
 * @returns {string|null} the name, or null when this was not one of ours.
 */
function refusalName(cause) {
  const code = cause?.code
  if (typeof code !== 'string' || !code.startsWith('aumlok:') || code.length > REFUSAL_LIMIT) {
    return null
  }
  return code
}

/**
 * The errno from a failure, as a short suffix for a refusal name, or nothing at all.
 *
 * A REFUSAL NAME THAT SWALLOWED THE ERRNO WOULD BE A WORSE REFUSAL. `aumlok:bind-write-failed` alone
 * says the write failed; `aumlok:bind-write-failed:EACCES` says it was permissions and not a full disk,
 * which is the difference between two different mornings. The suffix is held to the shape of an errno
 * so a long or hostile message cannot ride into the name.
 * @param {unknown} cause - whatever was thrown.
 * @returns {string} the suffix, including its leading colon, or an empty string.
 */
function errnoSuffix(cause) {
  const code = cause?.code
  if (typeof code !== 'string' || !/^[A-Z][A-Z0-9]{1,15}$/u.test(code)) return ''
  return `:${code}`
}

/** The plan's phrase: one six-letter anchor and six words, typed back in order, anchor first. */
export const PHRASE_LENGTH = 7

/** The letters each of the six rows must start with, and the theme each row is drawn from. */
const ROW_THEMES = Object.freeze(['NATURE', 'NATURE', 'PEOPLE', 'PEOPLE', 'SPIRIT', 'SPIRIT'])

/** The only shape a word of a phrase can have, matching the face's own reader exactly. */
const WORD = /^[a-z]{4,9}$/u
/** The only shape an anchor can have: six lower-case letters, the length the anchor list is cut to. */
const ANCHOR = /^[a-z]{6}$/u

/**
 * Draw one word from a list, using the process's own CSPRNG rather than `Math.random`.
 *
 * The phrase IS the key material in v3 — the root is derived from it — so its unpredictability may not
 * be weaker than the KDF that follows it. `randomInt` is `node:crypto`, rejection-sampled and uniform;
 * `Math.random` is neither uniform-and-documented nor unpredictable.
 * @param {readonly string[]} list - the words to choose from; must be non-empty.
 * @returns {string} one word.
 */
function drawOne(list) {
  return list[randomInt(list.length)]
}

/**
 * Read one JSON data file out of the release, or answer nothing at all.
 *
 * A file that is absent or malformed yields `null` and the caller refuses by name. There is no
 * fallback list: a second copy of the word lists is a second answer to "what can a phrase be made of".
 * @param {string} releaseDir - the release the shell is serving.
 * @param {string} name - the data file's name under `plugins/aukora-aumlok/data`.
 * @returns {unknown} the parsed value, or null.
 */
function readDataFile(releaseDir, name) {
  try {
    return JSON.parse(readFileSync(join(releaseDir, 'plugins', 'aukora-aumlok', 'data', name), 'utf8'))
  } catch {
    return null
  }
}

/**
 * The per-letter word pools, indexed by theme then by the letter a row must start with.
 *
 * The shipped shape is `{v, themes: {NATURE: {a: [...], ...}, PEOPLE: {...}, SPIRIT: {...}},
 * provenance}`. Anything else yields an empty table, which makes every draw refuse by name rather
 * than silently drawing from a list this module failed to understand.
 * @param {unknown} themes - the parsed `aumlok-themes.json`.
 * @returns {Record<string, Record<string, string[]>>} the pools.
 */
export function indexThemePools(themes) {
  const table = {}
  const source = themes !== null && typeof themes === 'object' ? themes.themes : undefined
  if (source === null || typeof source !== 'object') return table
  for (const theme of ['NATURE', 'PEOPLE', 'SPIRIT']) {
    const buckets = source[theme]
    if (buckets === null || typeof buckets !== 'object') continue
    const pool = {}
    for (const letter of Object.keys(buckets)) {
      const words = buckets[letter]
      if (!Array.isArray(words)) continue
      const clean = words.filter(word => typeof word === 'string' && WORD.test(word))
      if (clean.length > 0) pool[letter.toLowerCase()] = clean
    }
    table[theme] = pool
  }
  return table
}

/**
 * The anchors this shell may draw: six lower-case letters, each of which has a non-empty pool in every
 * theme and every row that letter will be used by.
 *
 * THE ANCHOR IS ONLY USABLE IF THE WHOLE PHRASE CAN BE BUILT FROM IT. An anchor whose letter has no
 * SPIRIT words would draw six words and then fail on row five, so it is not an anchor this generator
 * can use — and the honest answer is to leave it out of the drawable set rather than to retry until
 * something works.
 * @param {unknown} anchors - the parsed `aumlok-anchors.json`.
 * @param {Record<string, Record<string, string[]>>} pools - the indexed theme pools.
 * @returns {string[]} the drawable anchors.
 */
export function drawableAnchors(anchors, pools) {
  const list = Array.isArray(anchors) ? anchors
    : anchors !== null && typeof anchors === 'object' && Array.isArray(anchors.anchors) ? anchors.anchors
      : []
  const usable = []
  for (const candidate of list) {
    if (typeof candidate !== 'string' || !ANCHOR.test(candidate)) continue
    let ok = true
    for (let row = 0; row < ROW_THEMES.length && ok; row++) {
      const pool = pools[ROW_THEMES[row]]?.[candidate[row]]
      if (!Array.isArray(pool) || pool.length === 0) ok = false
    }
    if (ok) usable.push(candidate)
  }
  return usable
}

/**
 * Build one phrase from an anchor and the pools, refusing rather than repeating a word.
 *
 * A REPEATED WORD IS NOT A PHRASE. Seven words with a duplicate in them are fewer than seven words of
 * choice and would be typed back as a puzzle about which position the duplicate belonged to, so a row
 * whose pool is exhausted by the words already drawn refuses the whole phrase by name.
 * @param {string} anchor - the six-letter anchor.
 * @param {Record<string, Record<string, string[]>>} pools - the indexed theme pools.
 * @returns {{ok: true, words: string[]}|{ok: false, reason: string}} the phrase, or a refusal.
 */
export function composePhrase(anchor, pools) {
  const words = []
  for (let row = 0; row < ROW_THEMES.length; row++) {
    const pool = pools[ROW_THEMES[row]]?.[anchor[row]] ?? []
    const free = pool.filter(word => !words.includes(word))
    if (free.length === 0) return { ok: false, reason: DRAW_REFUSE.NO_ANCHOR }
    words.push(drawOne(free))
  }
  return { ok: true, words }
}

/**
 * The draw this shell runs, held as one object with no disk and no network.
 *
 * ONE PENDING DRAW AT A TIME, KEYED TO ITS OWNER. `draw` replaces whatever was pending, because two
 * phrases in flight is two things a person could be typing; `submit` consumes the slot whether it
 * matches or not, so a wrong guess cannot be retried against the same drawn phrase by a script. And
 * the slot is only ever readable by the window that drew it: the caller passes the sender, and a
 * different sender is refused by name rather than told there is a phrase in flight.
 * @param {{readFile?: (releaseDir: string, name: string) => unknown}} [options] - an injection point
 *   for the release's bytes, used by courts that measure this module without a release on disk.
 * @returns the draw.
 */
export function createAumlokDraw(options = {}) {
  // THE RELEASE'S BYTES ARRIVE THROUGH ONE FUNCTION, so a court can measure this module without a
  // release on disk while the shell in the app always reads the release it is serving.
  const readData = typeof options.readData === 'function' ? options.readData
    : typeof options.readFile === 'function' ? options.readFile : readDataFile
  // THE BIND CEREMONY, INJECTABLE FOR THE SAME REASON THE RELEASE READER IS: a court measures
  // `bind-v3.mjs` directly and needs no library handle, while the app reaches the ceremony through the
  // organ library it loads out of the release. NOTHING IS RE-IMPLEMENTED HERE — the default is the
  // library's own function, and with neither present the submit refuses by name.
  const ceremony = typeof options.ceremony === 'function' ? options.ceremony : undefined
  /** The one drawn phrase, or null. `{owner, intent, words}`. */
  let pending = null

  /** Load the drawable anchors and pools out of the release, or answer a refusal by name. */
  function lists(releaseDir) {
    const themes = readData(releaseDir, 'aumlok-themes.json')
    const anchors = readData(releaseDir, 'aumlok-anchors.json')
    if (themes === null || anchors === null) return { ok: false, reason: DRAW_REFUSE.NO_LISTS }
    const pools = indexThemePools(themes)
    const usable = drawableAnchors(anchors, pools)
    if (usable.length === 0) return { ok: false, reason: DRAW_REFUSE.NO_ANCHOR }
    return { ok: true, anchors: usable, pools }
  }

  return {
    /**
     * Draw the seven words for one ceremony, once.
     *
     * THE REPLY IS THE WORDS OR A NAME, AND NOTHING BETWEEN. A refusal carries `reason` from the
     * constants above and no `words` key at all, so a draw that failed can never put a partial phrase
     * on the screen.
     * @param {unknown} owner - the webContents asking; only this one may submit the drawn phrase.
     * @param {unknown} intent - `bind` or `refresh`.
     * @param {string} releaseDir - the release to read the word lists out of.
     * @returns {{ok: true, words: string[], anchor: string}|{ok: false, reason: string}} the draw.
     */
    draw(owner, intent, releaseDir) {
      if (intent !== 'bind' && intent !== 'refresh') return { ok: false, reason: DRAW_REFUSE.INTENT_UNKNOWN }
      const loaded = lists(typeof releaseDir === 'string' ? releaseDir : '')
      if (loaded.ok !== true) return { ok: false, reason: loaded.reason }
      // A FEW ATTEMPTS, AND THEN A REFUSAL BY NAME. An anchor can be drawable and still have a row
      // whose remaining words are all used, so the draw retries across anchors rather than repeating
      // a word; if every attempt collides, nothing is drawn and the reason says so.
      for (let attempt = 0; attempt < 12; attempt++) {
        const anchor = drawOne(loaded.anchors)
        const composed = composePhrase(anchor, loaded.pools)
        if (composed.ok !== true) continue
        const words = [anchor, ...composed.words]
        pending = { owner, intent, words }
        return { ok: true, words, anchor }
      }
      return { ok: false, reason: DRAW_REFUSE.NO_ANCHOR }
    },

    /**
     * Take the typed words back, perform the ceremony, and answer with a verdict.
     *
     * ONE REFUSAL, AND NOTHING WRITTEN WRONGLY. Words that are not seven lower-case words are refused
     * by a DIFFERENT name without being compared, so the reply cannot be used as an oracle for how
     * close a guess was. A wrong type-back consumes the pending draw, returns exactly one content-free
     * name, and touches no file.
     *
     * A CORRECT TYPE-BACK NOW PERFORMS THE BIND, AND THAT IS THE WHOLE OF THIS CHANGE. It used to
     * answer VERIFIED and write nothing, which the screen rendered as a success over an empty
     * directory. The derivation, the genesis, the record and the seeds belong to the organ —
     * `bind-v3.mjs`, the sibling of `refresh-v3.mjs` — and this module reaches them through the
     * library the shell loads out of the release, so a record written from this screen and one written
     * from a terminal route are the same module's bytes.
     *
     * THE WORDS GO NO FURTHER THAN THEY MUST. They are compared here and passed once to the ceremony;
     * they are not logged, not echoed and not written. The verdict carries no phrase byte by
     * construction, and a refusal carries the ceremony's own name and its errno and nothing else.
     *
     * @param {unknown} owner - the webContents submitting.
     * @param {unknown} intent - the ceremony the words belong to.
     * @param {unknown} words - the seven typed words, in order, anchor first.
     * @param {{handle?: unknown, directory?: unknown, library?: unknown, boundAt?: unknown}} [context] -
     *   the PUBLIC handle (X8: half of the key, typed first on a new machine), where the binding goes,
     *   and the organ library that writes it. Absent means this shell cannot bind, which is a named
     *   refusal rather than a silent success.
     * @returns {Promise<{ok: boolean, reason?: string}>} the verdict, and never a phrase byte.
     */
    async submit(owner, intent, words, context = {}) {
      if (intent !== 'bind' && intent !== 'refresh') return { ok: false, reason: DRAW_REFUSE.INTENT_UNKNOWN }
      // `drawSpent: true` FROM HERE ON (2026-09-29): the words the screen holds can no longer bind, so the screen must
      // ask for new ones rather than invite a retry that can only answer `no-pending-draw` (measured on a fresh Mac).
      // It is set on EVERY answer after the slot is gone — shape, mismatch, verified, ceremony refusal alike — so it
      // says nothing about how close a guess was. Decided here, at the moment of consumption, not read back later.
      if (pending === null) return { ok: false, reason: DRAW_REFUSE.NO_PENDING_DRAW, drawSpent: true }
      if (pending.owner !== owner) return { ok: false, reason: DRAW_REFUSE.FORBIDDEN_SENDER }
      if (pending.intent !== intent) return { ok: false, reason: DRAW_REFUSE.INTENT_UNKNOWN }
      const offered = Array.isArray(words) ? words : null
      if (offered === null || offered.length !== PHRASE_LENGTH
        || !offered.every(word => typeof word === 'string' && WORD.test(word))) {
        pending = null
        return { ok: false, reason: DRAW_REFUSE.PHRASE_SHAPE, drawSpent: true }
      }
      const expected = pending.words
      // THE SLOT IS CONSUMED EITHER WAY, BEFORE THE COMPARISON IS ACTED ON. A submit that could be
      // repeated would be a guessing oracle against one drawn phrase, and the phrase is the key.
      pending = null
      for (let at = 0; at < PHRASE_LENGTH; at++) {
        if (offered[at] !== expected[at]) return { ok: false, reason: DRAW_REFUSE.PHRASE_MISMATCH, drawSpent: true }
      }

      // ── THE WORDS MATCHED. NOW THE BINDING IS PERFORMED OR REFUSED BY NAME. ──────────────────────
      const directory = context?.directory
      const bind = typeof ceremony === 'function' ? ceremony : context?.library?.bindV3
      if (typeof bind !== 'function') {
        // NO CEREMONY, SO NO BINDING — AND THAT IS SAID, NOT SWALLOWED. A release that predates this
        // module carries no `bind-v3.mjs`, and the honest answer is this name rather than a verdict and
        // no write, which is precisely what Peter's screen did.
        return { ok: false, reason: DRAW_REFUSE.CEREMONY_ABSENT, drawSpent: true }
      }
      try {
        const bound = await bind({
          words: offered,
          // THE HANDLE CROSSES WITH THE WORDS AND IS NOT KEPT HERE EITHER. It is public, so a log line
          // naming it is not a leak — but this module logs nothing about a submit, and the ceremony is
          // the one that judges its shape and refuses by name.
          handle: context?.handle,
          directory,
          boundAt: typeof context?.boundAt === 'string' && context.boundAt.length > 0
            ? context.boundAt : new Date().toISOString(),
        })
        return { ok: true, reason: DRAW_REFUSE.VERIFIED, subject: bound?.projection?.subject ?? null, drawSpent: true }
      } catch (error) {
        // THE CEREMONY'S OWN NAME, PASSED THROUGH UNCHANGED. `bind-v3.mjs` refuses by name and appends
        // the errno when there is one; this is the single place that name becomes the screen's sentence.
        // A THROW THAT IS NOT ONE OF OURS STILL GETS A NAME: a raw `TypeError` message on the screen is
        // not a named refusal, and leaving it unnamed would put the sentence up with nothing in it.
        return {
          ok: false,
          reason: refusalName(error) ?? `${DRAW_REFUSE.WRITE_FAILED}${errnoSuffix(error)}`,
          drawSpent: true,
        }
      }
    },

    /** Forget the pending phrase. Called when the window it belongs to goes away. */
    forget() {
      pending = null
    },

    /** Whether a phrase is in flight. A boolean by construction: it cannot carry a word. */
    isPending() {
      return pending !== null
    },
  }
}
