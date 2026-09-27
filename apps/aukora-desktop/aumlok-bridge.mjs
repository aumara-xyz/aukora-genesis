// The shell's half of AUMLOK in the app: the public state, the one-bit approval question, and the
// receipt. THIS FILE NO LONGER OPENS A CEREMONY WINDOW AND NO LONGER RUNS A CEREMONY.
//
// THE CEREMONY IS THE AUMLOK SCREEN INSIDE THE FACE, NOT A SEPARATE WINDOW. v2 opened a second
// BrowserWindow from three sites in this file — an opener, a mode whitelist and a page loaded from
// `aumlok-ceremony.html` — and that window, its page and its preload are gone. Binding now happens
// where the person already is: the app GENERATES seven words from real entropy, shows them ONCE on
// the Aumlok screen, and the person types them back. THE SAME SEVEN WORDS DERIVE THE SAME ROOT ON ANY
// MACHINE, and that IS the recovery. THE WINDOW IS NOT MERELY CLOSED, IT IS ABSENT: no second window
// and no session to open first — so there is nothing here that could open one.
//
// NO PHRASE ENTERS THIS FILE AT ALL. That is the strengthening, not a loss: v2 had to defend an IPC
// channel that received the phrase once, inward, and this process existed partly to keep that channel
// safe. A screen that renders its own words and reads its own typing hands the phrase to nothing but
// its own derivation. The shell carries the PUBLIC facts and one bit, and no more.
//
// WHY THE SHELL CARRIES THE APPROVAL AT ALL. An approval is the one thing this development cannot
// delegate to a page: it must be a modal that cannot be scrolled past, over the exact bytes, before a
// key signs them. `ask()` is that job, and it is deliberately the ONLY thing here that opens a window.
// Its answer is one bit, matched to its question by the challenge it echoes.
//
// WHY IT LOOKS INSIDE THE RELEASE AND NOT AT THIS CHECKOUT. The organ is loaded from the release the
// shell is serving (`plugins/aukora-aumlok/lib/**`), not from this tree and not from a copy — because
// two copies of a key-derivation path are two paths that can disagree. If the release does not carry
// it, the answer is a refusal BY NAME rather than a fallback that would derive a different root.
// THE OWNER DAEMON'S DETECTOR, imported rather than re-implemented: whether a daemon is installed and
// reachable is answered in ONE place, and the shell asks that place.
import { ownerDaemonStatus } from '../../plugins/aukora-owner-daemon/lib/detect.mjs'
import { APPROVAL_FIELD_ORDER, APPROVAL_FIELD_NOT_STATED } from './aumlok-signer.mjs'
import { submitProposal, settleBytesFor } from '../../plugins/aukora-owner-daemon/lib/client.mjs'

/**
 * THE REFUSAL THAT REPLACES AN IN-PROCESS SETTLE, and there is no fallback by design.
 *
 * When an owner daemon is installed and reachable, THIS PROCESS MUST NOT SETTLE. It submits the exact frozen
 * bytes over `submit.sock` and tells the screen the approval is pending, because a settle performed here is
 * authorised by nothing but this uid — the claim `SAME_UID` names and the daemon exists to retire. A
 * fallback that settled locally when the daemon was slow or unreachable would be the shell approving itself,
 * which is why the failure to reach the daemon is an ERROR rather than a slower path.
 */
export const SETTLE_REQUIRES_OWNER_DAEMON = 'aukora:settle-requires-owner-daemon'
/**
 * *** AN INSTALLED DAEMON THAT DID NOT ANSWER REFUSES; IT DOES NOT BECOME AN ABSENT ONE. ***
 *
 * This exists because the fall-through was an EXPLOIT AND NOT A DEGENERATE CASE. `ownerDaemonStatus()`
 * reported `installed: false` whenever the hello failed, and both handlers below test
 * `installed && reachable` before routing — so ANYONE WHO COULD MAKE THE HELLO FAIL GOT THE OLD
 * SAME-UID IN-PROCESS SETTLEMENT BACK. Filling the submit connections or stopping the socket is enough.
 * THE OBSTRUCTION DOES NOT HAVE TO FORGE ANYTHING; IT ONLY HAS TO MAKE THE DAEMON LOOK ABSENT.
 */
export const OWNER_DAEMON_UNREACHABLE = 'aukora:owner-daemon-unreachable'

/** The operation names the daemon binds a settle-class approval to, derived from the ceremony itself. */
function settleOperationOf(intent) {
  const ceremony = typeof intent === 'string' ? intent
    : (typeof intent?.ceremony === 'string' ? intent.ceremony : 'unknown')
  return { operation: `aumlok.${ceremony}`, scope: 'aukora-aumlok.ceremony' }
}
import { dirname, join, resolve } from 'node:path'

/**
 * Read the `id` and `config.directory` of each plugin row in a composition patch.
 *
 * WHY THIS IS NOT `js-yaml`, WHICH WOULD BE THE OBVIOUS CHOICE. This shell declares NO runtime
 * dependencies and imports only `node:` builtins and `electron`; a bare package import would be the
 * first, and `electron-builder` packs `dependencies`, which is empty — so `js-yaml` would be absent
 * from the packaged app and the shell would fail to start on the machine it was built for. Measured
 * 2026-09-22: `apps/aukora-desktop/package.json` has `"dependencies": {}`, and js-yaml 4.3.2 exists
 * under `node_modules` only as a local artifact.
 *
 * SO THE READER IS NARROW ON PURPOSE, AND SAYS SO. It understands the shape these overlays are
 * actually written in: a sequence of `- id: <name>` rows, each optionally followed by a `config:`
 * block containing `directory: <path>`. It handles quoted and unquoted scalars and trailing
 * comments. It does NOT implement anchors, multi-line scalars, flow mappings or nesting below
 * `config` — and it does not need to, because it is reading two fields out of files this project
 * writes. A patch whose structure is beyond it yields no directory, and the caller refuses by name
 * rather than guessing.
 * @param {string} text - the patch file's contents.
 * @returns {ReadonlyArray<{id: string, directory: string|null}>} the rows, in file order.
 */
export function readPatchPluginDirectories(text) {
  const rows = []
  let current = null
  let configIndent = null
  for (const raw of String(text).split('\n')) {
    const line = stripYamlComment(raw)
    const trimmed = line.trim()
    if (trimmed.length === 0) continue
    const indent = line.length - line.trimStart().length
    const idMatch = /^-\s+id\s*:\s*(.+)$/u.exec(trimmed)
    if (idMatch !== null) {
      current = { id: unquoteYamlScalar(idMatch[1]), directory: null }
      rows.push(current)
      configIndent = null
      continue
    }
    if (current === null) continue
    if (/^config\s*:/u.test(trimmed)) { configIndent = indent; continue }
    if (configIndent === null) continue
    if (indent <= configIndent) { configIndent = null; continue }
    const directoryMatch = /^directory\s*:\s*(.+)$/u.exec(trimmed)
    if (directoryMatch !== null) {
      const value = unquoteYamlScalar(directoryMatch[1])
      if (value.length > 0) current.directory = value
      configIndent = null
    }
  }
  return rows
}

/** Remove a trailing `# …` comment, respecting the two quote styles this project writes. */
function stripYamlComment(line) {
  let quote = null
  for (let index = 0; index < line.length; index += 1) {
    const character = line[index]
    if (quote !== null) { if (character === quote) quote = null; continue }
    if (character === '"' || character === "'") { quote = character; continue }
    if (character === '#') return line.slice(0, index)
  }
  return line
}

/** Remove one layer of matching quotes, if present. */
function unquoteYamlScalar(raw) {
  const value = raw.trim()
  const first = value[0]
  if ((first === '"' || first === "'") && value.length > 1 && value[value.length - 1] === first) {
    return value.slice(1, -1)
  }
  return value
}
import { readFileSync, existsSync, mkdirSync, renameSync, writeFileSync } from 'node:fs'
import { pathToFileURL } from 'node:url'
// THE DRAW HALF OF THE CROSSING, imported rather than re-implemented: one module owns the phrase's
// shape, its one in-memory slot and its refusal names, and this file owns the channel it arrives on.
import { DRAW_REFUSE, createAumlokDraw } from './aumlok-draw.mjs'
import { defaultAumlokDirectory, writeInstallSettingsOnFirstLink } from './install-settings.mjs'

/**
 * The COMPLETE IPC surface of this file, as a frozen set.
 *
 * Closed on purpose, and enumerated rather than described: a court asserts this exact list, so a
 * channel added later cannot arrive without a test noticing. THREE of these are callable from the
 * application's own page — `STATE`, which carries no phrase, and `DRAW`/`SUBMIT`, which are the ONE
 * crossing the seven words make and are reachable from that window alone. The other two exist only on
 * the approval window's private channel. The v2 channels — an opener, a word-table request, a
 * signing-session opener and a close — are GONE, and their absence is the point: nothing here opens a
 * second surface, and no phrase can reach a window that is not the app's own.
 */
export const APPROVAL_CHANNELS = Object.freeze({
  /** App page -> main. Read the public state. Carries no phrase. */
  STATE: 'aumlok:approval:state',
  /**
   * Approval window -> main. "What am I being asked about?"
   *
   * It returns the PUBLIC facts of the one pending question — the subject, the operation digest, the
   * window it is valid for — and nothing else. No phrase, no seed and no signature is reachable from
   * this reply, so the window can render it and a screenshot of it discloses no secret. The OPERATION
   * CONTENT is deliberately NOT sent: the digest is what the key signs, and putting a body of text in
   * front of a person invites them to approve prose that the digest does not cover.
   */
  ASK: 'aumlok:approval:ask',
  /**
   * Approval window -> main. THE ANSWER, and it is ONE BIT.
   *
   * It carries `{approve: true|false}` and the challenge it is answering. The challenge is echoed back
   * so an answer that arrives after its question was replaced cannot be applied to the new one — the
   * window is not trusted to be answering the current question, it is REQUIRED to say which one.
   */
  ANSWER: 'aumlok:approval:answer',
  /**
   * App page -> main. DRAW THE SEVEN WORDS FOR ONE CEREMONY.
   *
   * This is the one reply in the whole surface that legitimately carries the words, and it carries
   * them exactly once, to the window that asked. The draw is made in the MAIN PROCESS out of the word
   * lists the release ships, so the words are SHOWN FROM THE SHELL rather than fetched from a backend
   * or rendered by the page's own copy of a list. The reply is `{ok: true, words}` or `{ok: false,
   * reason}` where the reason is a constant of `aumlok-draw.mjs` — a name, never a word.
   */
  DRAW: 'aumlok:approval:draw',
  /**
   * App page -> main. HAND THE TYPED WORDS BACK.
   *
   * The words come back as an ARRAY OF SEVEN KEYS, in order, anchor first — the same shape the face's
   * own reader narrows — and the reply is `{ok, reason}` with a name from the draw module's own
   * constants. NO REPLY ON THIS CHANNEL EVER CONTAINS A PHRASE BYTE: the shell either accepted the
   * words it drew or it refused by name, and there is no third answer to give.
   */
  SUBMIT: 'aumlok:approval:submit',
})

/** Named refusals this module returns. Stable strings; a caller renders them, never parses prose. */
export const APPROVAL_REFUSE = Object.freeze({
  NO_DIRECTORY: 'aumlok:approval-directory-unknown',
  NO_LIBRARY: 'aumlok:approval-library-unavailable',
  WINDOW_OPEN: 'aumlok:approval-window-already-open',
  /**
   * There is no main window to dock the approval sheet into.
   *
   * THE SHEET IS PART OF THE APPLICATION'S WINDOW NOW, so a bridge asked for an approval before that window
   * exists cannot show one. Refusing by name is the honest answer: the alternative — a surface floating on
   * its own — is the separate black window this replaced.
   */
  NO_DOCK: 'aumlok:approval-no-window-to-dock-into',
  FORBIDDEN_SENDER: 'aumlok:approval-sender-not-the-application',
  BAD_MODE: 'aumlok:approval-mode-unknown',
  CANCELLED: 'aumlok:approval-cancelled',
  /**
   * A REQUEST WITH NO EXPIRY. Z1, from Peter's first real approval, 2026-09-23 21:29.
   *
   * The window he had just trusted said "Valid until —" and offered him Approve anyway. An approval
   * whose window nobody can name is an approval nobody can reason about, and the place to refuse it is
   * HERE — before a window exists — because a window that opens with nothing to show has already put
   * the question in front of a person.
   */
  NO_EXPIRY: 'aumlok:approval-no-expiry',
  /**
   * A REQUEST THAT CARRIES A SUMMARY OF ITS OWN. Z2's own court, in the place that draws the window.
   *
   * The words on the screen must be DERIVED FROM THE BYTES THE DIGEST COVERS. Text handed in by the
   * requesting side cannot be checked against those bytes here, and "we displayed it but did not check
   * it" is exactly the defect Z2 names — so a summary is REFUSED rather than rendered, and the only
   * description this bridge will pass on is the signer's own derivation of the operation's bytes.
   */
  SUMMARY_NOT_ACCEPTED: 'aumlok:approval-summary-not-accepted',
  /**
   * A QUESTION WITH NOTHING TO CHECK. Z2 (g), and the half of the words rule that lives in the window.
   *
   * The words check is `sha256("aukora:approval-words:v1" NUL line) == wordsDigest` and the line itself
   * is the signer's derivation of the operation's bytes, so a request that arrives with NO
   * `operationWitness` has no byte to hash: THE CHECK CANNOT RUN. Such a window shows an identity, a
   * digest and a live Approve button, and the yes that comes back is a signature the words check never
   * touched.
   *
   * IT IS REFUSED HERE AND NOT AT THE SIGNER, AND THAT IS MEASURED RATHER THAN ASSUMED. The seven
   * signed fields with no `operationContent` is the OLDER WIRE —
   * `tests/aukora-shell-signer.test.mjs` hand-builds exactly that line and asserts it is signed — so a
   * signer-side refusal would regress a court that is green today (it was tried, and it reddened that
   * court plus the Kira approval wire). The WINDOW is the only thing that can put an uncheckable
   * question in front of a person, so the window is where the rule is enforced.
   */
  NO_DESCRIPTION: 'aumlok:approval-no-description',
})

/**
 * The fields a caller might offer as its own description of the operation.
 *
 * ENUMERATED RATHER THAN GUESSED AT, because "we refuse a summary" has to mean something a reader can
 * check: these three names are the shapes a summary arrives in, and a request carrying any of them is
 * refused by {@link APPROVAL_REFUSE.SUMMARY_NOT_ACCEPTED}.
 */
const CALLER_DESCRIPTION_FIELDS = Object.freeze(['summary', 'words', 'wordsDigest'])

/**
 * Admit one request to the window, or refuse it BY NAME WITHOUT OPENING ONE.
 *
 * @param {unknown} request - what the signer handed the shell.
 * @returns {Readonly<{ok: true, challenge: string, expiresAt: number, witness: Readonly<Record<string, unknown>> | null}> | Readonly<{ok: false, reason: string}>} the admitted question, or the name of the refusal.
 */
/** The five labels the RECORD answers. `WHO` and `UNTIL` come from the request and are added by the caller. */
const RECORD_FIELD_LABELS = Object.freeze(APPROVAL_FIELD_ORDER.filter(label => label !== 'WHO' && label !== 'UNTIL'))

/**
 * Read the record's labelled values off a witness, keeping ONLY what is a non-empty string.
 *
 * **A MISSING OR MALFORMED VALUE BECOMES THE ABSENCE SENTENCE RATHER THAN AN EMPTY LABEL.** An empty cell reads as
 * "nothing here", which is a claim; the sentence reads as "this record does not say", which is the fact.
 * @param {unknown} fields - the witness's `fields`, if it carried any.
 * @returns {Readonly<Record<string, string>>} one entry per record-side label.
 */
function recordFieldValues(fields) {
  const out = {}
  for (const label of RECORD_FIELD_LABELS) {
    const value = (fields !== null && typeof fields === 'object') ? fields[label] : undefined
    out[label] = typeof value === 'string' && value.trim() !== '' ? value.trim() : APPROVAL_FIELD_NOT_STATED
  }
  return Object.freeze(out)
}

/**
 * THE CARD: all seven labels, in order, from the two places that hold them.
 *
 * **WHAT / WHERE / LIMIT / COST / IRREVERSIBLE come from the record the digest covers** (through the signer's own
 * derivation). **WHO and UNTIL come from the request** — the identity this window is bound to and the window's own
 * expiry — because the record does not name a person and the window is not the record's to state. No label is
 * filled from prose, and none is filled from a guess.
 * @param {Readonly<Record<string, string>>} recordFields - the five record-side values.
 * @param {unknown} subject - the request's subject.
 * @param {unknown} expiresAt - the request's expiry, as seconds.
 * @returns {ReadonlyArray<{label: string, value: string}>} the card, ready to render.
 */
export function approvalCardFields(recordFields, subject, expiresAt) {
  const said = value => (typeof value === 'string' && value.trim() !== '' ? value.trim() : APPROVAL_FIELD_NOT_STATED)
  const until = Number.isSafeInteger(expiresAt) && expiresAt > 0
    ? new Date(expiresAt * 1000).toISOString()
    : APPROVAL_FIELD_NOT_STATED
  const values = { ...recordFields, WHO: said(subject), UNTIL: until }
  return Object.freeze(APPROVAL_FIELD_ORDER.map(label => Object.freeze({ label, value: values[label] ?? APPROVAL_FIELD_NOT_STATED })))
}

export function admitApprovalQuestion(request) {
  const challenge = typeof request?.challenge === 'string' ? request.challenge : null
  if (challenge === null || challenge.length === 0) {
    // NO CHALLENGE, NO BINDING. An answer to this could not be told apart from an answer to anything
    // else, so it is refused rather than shown.
    return Object.freeze({ ok: false, reason: APPROVAL_REFUSE.BAD_MODE })
  }
  for (const field of CALLER_DESCRIPTION_FIELDS) {
    if (request?.[field] !== undefined) {
      return Object.freeze({ ok: false, reason: APPROVAL_REFUSE.SUMMARY_NOT_ACCEPTED })
    }
  }
  // AN EXPIRY IS REQUIRED, AND IT IS REQUIRED AS THE SIGNED FIELD. `owner-approval.mjs` parses
  // `expiresAt` with `readNonNegativeInteger`, so anything that is not a non-negative safe integer is
  // not a value this wire can carry — and a window showing nothing is the defect Z1 measured.
  const expiresAt = request?.expiresAt
  if (!Number.isSafeInteger(expiresAt) || expiresAt <= 0) {
    return Object.freeze({ ok: false, reason: APPROVAL_REFUSE.NO_EXPIRY })
  }
  const source = request?.operationWitness
  const words = typeof source?.words === 'string' && source.words.length > 0 ? source.words : null
  const wordsDigest = typeof source?.wordsDigest === 'string' && source.wordsDigest.length > 0
    ? source.wordsDigest
    : null
  const witness = words === null || wordsDigest === null
    ? null
    : Object.freeze({
      words,
      wordsDigest,
      wordsTruncated: source?.truncated === true,
      wordsOmittedChars: Number.isSafeInteger(source?.omittedChars) ? source.omittedChars : 0,
      // **THE LABELLED VALUES, READ THE SAME WAY THE WORDS ARE: only a non-empty string survives, and anything
      // else becomes the record's own sentence for "it does not answer this".** A caller cannot reach this object
      // with prose of its own — `CALLER_DESCRIPTION_FIELDS` above has already refused a summary by name — and a
      // malformed value here cannot become a blank label a person reads as "nothing to report".
      fields: recordFieldValues(source?.fields),
    })
  // A REQUEST THAT CANNOT BE CHECKED MUST NOT OPEN A WINDOW, AND THE CHECK NEEDS SOMETHING TO CHECK.
  // This refusal sits AFTER the expiry and summary gates on purpose, so a request that is ALSO missing
  // its expiry still answers `aumlok:approval-no-expiry` and one that carries its own summary still
  // answers `aumlok:approval-summary-not-accepted`: a new name must never swallow an older, more
  // specific one. What is left for this name is a well-formed question whose description never arrived.
  if (witness === null) {
    return Object.freeze({ ok: false, reason: APPROVAL_REFUSE.NO_DESCRIPTION })
  }
  return Object.freeze({ ok: true, challenge, expiresAt, witness })
}

/**
 * Where the approval window gets the signing session whose state it may report.
 *
 * IT IS A FUNCTION RATHER THAN A SESSION because the signer starts AFTER the bridge is installed: main
 * builds the bridge first, then awaits the shell signer, so a value captured at install time would be
 * null forever. `null` is returned when there is no signer, and the reply says `available: false`
 * rather than offering a control that would refuse.
 * @param {() => {session?: unknown} | null | undefined} getSigner - the shell's current signer, or nothing.
 * @returns {() => unknown} the session source the bridge reads.
 */
export function signingSessionSource(getSigner) {
  return () => {
    if (typeof getSigner !== 'function') return null
    try {
      return getSigner()?.session ?? null
    } catch {
      // A GETTER THAT THREW IS NOT A SESSION. Refusing by name beats letting an exception escape an IPC
      // handler, where the renderer sees a rejected promise and no reason.
      return null
    }
  }
}

/**
 * THE ONE REASON NAME WHOSE WORDS THIS SHELL TRANSLATES, AND WHY IT MAY NOT REPEAT THEM.
 *
 * The signing session is the release's own object, and its `reason` is normally passed through
 * verbatim — a screen must quote the session rather than paraphrase it. The exception is the one name
 * that still carries v2 vocabulary; it is translated here so the words a person reads are the v3
 * ones. A session that names its shutdown differently is passed through untouched, so this stays a
 * translation of one known string rather than a second opinion about why signing is shut.
 * @param {unknown} reason - the session's own reason name, or anything else.
 * @returns {unknown} the v3 name for that one fact, or the input unchanged.
 */
export function signingReasonName(reason) {
  return reason === 'aumlok:locked' ? 'aumlok:signing-shut' : reason
}

/**
 * Find the controller directory the RUNNING COMPOSITION is bound to.
 *
 * This reads it from the patch overlays the shell was actually started with, which is the only
 * answer that stays true: the mounted adapter reads `config.directory` from those same files, so a
 * record written anywhere else would bind a key the running app never looks at — and would look,
 * from the screen, exactly like success.
 *
 * The FIRST row wins, matching how a patch overlay resolves. A patch that cannot be read is skipped
 * rather than fatal: the caller refuses with `NO_DIRECTORY` if no row is found at all, which is the
 * honest failure, and a shell that refused to start because one unrelated overlay was malformed
 * would be a worse application.
 * @param {readonly string[]} patchPaths - the composition overlays, in application order.
 * @returns {{directory: string, source: string} | null} the binding, or null when none is declared.
 */
export function resolveAumlokDirectory(patchPaths) {
  for (const path of patchPaths ?? []) {
    let text
    try {
      text = readFileSync(path, 'utf8')
    } catch {
      continue
    }
    for (const row of readPatchPluginDirectories(text)) {
      if (row.id !== 'aukora-aumlok') continue
      if (row.directory !== null) return { directory: resolve(row.directory), source: path }
    }
  }
  return null
}

/**
 * Load the organ's v3 modules OUT OF THE RELEASE the shell is serving.
 *
 * A release is a directory the shell already resolved and printed; the plugin's shipped bytes live
 * at `plugins/aukora-aumlok/lib/**` inside it. Nothing is copied and nothing is re-implemented, so a
 * record written by the app and one written by the terminal route cannot drift: they are the same
 * module.
 *
 * THE MODULES BY NAME — NOT THE BARREL. The plugin's `index.mjs` re-exports these and would be the
 * obvious single import, but it also pulls in the Cordis service module and the whole adapter
 * surface, which this shell does not need and which it would then have to be able to resolve. Naming
 * the files keeps the dependency of the shell to the code the shell runs.
 *
 * THE LIST IS SHORT BECAUSE THE SHELL READS, DRAWS, AND PERFORMS ONE CEREMONY. It resolves the
 * controller directory, reads the PUBLIC half of the record to answer `state()`, and — since X1 — calls
 * `bindV3` to perform a first binding when the seven drawn words come back typed. `bind-v3.mjs` is on
 * this list because the ceremony is the organ's, not the shell's: a record written from the app screen
 * and one written from a terminal route must be the same module's bytes. The list is the WHOLE of what
 * the shell may call: a module left off it fails as a missing function, which reads from a screen like
 * a bug in a button rather than like a file left off a list.
 *
 * `owner-signer.mjs` WAS LEFT OFF IT, AND THAT IS THE WHOLE OF WHY PETER HAD NO SOCKET (2026-09-23).
 * The shell's signer — `aumlok-signer.mjs`, started by `main.mjs` at launch — needs
 * `createOwnerSigner`, which lives in that file and nowhere else. It was not here, so
 * `startShellSigner` was handed a library with no such function and refused BY NAME with
 * `aumlok:signer-organ-not-v3`; the socket the backend dials was never created. The refusal was
 * honest and the diagnosis was wrong for hours, because the list is in the loader and the refusal is
 * in the signer, and nothing connected them.
 *
 * WHICH OTHER FILES WERE CONSIDERED, AND WHY THEY ARE STILL NOT HERE (asked rather than assumed).
 * The organ directory also carries `machine-signer-v3.mjs`, `signer-channel.mjs` and
 * `signer-refusal.mjs`, and each was checked against the relative-import closure of what the shell
 * actually reaches:
 *
 *   owner-signer.mjs      ADDED. Its closure is `owner-approval.mjs`, `canonical.mjs` and
 *                         `validation.mjs` — all resolved inside the release, because the relative
 *                         import is relative to that file. Nothing here is hand-merged. It carries
 *                         `createOwnerSigner`, which is the function whose absence made the shell
 *                         refuse with `aumlok:signer-organ-not-v3`.
 *   owner-approval.mjs    ADDED, AS A NAMED SUB-LIBRARY RATHER THAN FLATTENED. This is the ONE WIRE the
 *                         signer speaks: `parseApprovalRequest`, `approvalSigningBytes`,
 *                         `createRefusedApprovalResponse`, `createSignedApprovalResponse`. MEASURED:
 *                         adding `owner-signer.mjs` alone was NOT enough — its relative import makes
 *                         `createOwnerSigner` work, but it does not put those names on the LIBRARY,
 *                         and `missingSignerOrgan` then reported `parseApprovalRequest` instead. So the
 *                         module is a second library under `library.library`, which also lets a release
 *                         that carries one and not the other be diagnosed by name instead of by a
 *                         half-built signer. There is no export-name collision between this file and
 *                         the four above (measured, 65 distinct names), so flattening would work today
 *                         — which is exactly why it is not done: a collision added later would silently
 *                         overwrite a function the shell is already calling.
 *   machine-signer-v3.mjs NOT ADDED. It is a DIFFERENT protocol for a different act:
 *                         `answerApprovalV3` signs `aukora:aumlok-machine-answer:v3` over
 *                         `{subject, epoch}` for the root-class path, while the socket the backend
 *                         speaks is the owner-approval wire in `owner-approval.mjs`. The shell needs
 *                         one function out of it — `readKeptMachineSeed` — and that function lives in
 *                         `record-v3.mjs`, already on the list. Adding this file would pull fifteen
 *                         modules (including the post-quantum generator) into the shell to reach
 *                         nothing it calls. `answerApprovalV3` IS the same machine key, and it is
 *                         worth saying so: two acts, one key, two domains.
 *   signer-channel.mjs    NOT ADDED. It is the BROKER's half — `createOwnerApprovalSession`,
 *                         `exchangeLine` — and the broker is the backend process, which never loads
 *                         this library. Putting it here would let the shell verify its own
 *                         signature, which is not a property anybody asked for.
 *   signer-refusal.mjs    NOT ADDED. Its whole content is `SIGNER_REFUSE` and `isNotReadyRefusal`,
 *                         read by the BROKER when a refusal comes off the wire. The signer's own
 *                         refusal names — the ones it writes — come from `owner-approval.mjs` above.
 * @param {string} releaseDir - the release root the backend was started from.
 * @returns {Promise<object>} the organ's exports, with `library` set to the wire codec's.
 */
export async function loadOrganLibrary(releaseDir) {
  const modules = {}
  for (const name of ['derive-v3.mjs', 'record-v3.mjs', 'store.mjs', 'bind-v3.mjs', 'owner-signer.mjs']) {
    const modulePath = join(releaseDir, 'plugins', 'aukora-aumlok', 'lib', name)
    if (!existsSync(modulePath)) {
      const error = new Error(`${APPROVAL_REFUSE.NO_LIBRARY}: ${modulePath} is not in this release`)
      error.code = APPROVAL_REFUSE.NO_LIBRARY
      throw error
    }
    Object.assign(modules, await import(pathToFileURL(modulePath).href))
  }
  // THE WIRE CODEC, KEPT AS ITS OWN LIBRARY. Not flattened into the object above: see the note on
  // `owner-approval.mjs` in the header. A release that carries the signer but not this file is
  // reported by `missingSignerOrgan` as `library.parseApprovalRequest` rather than producing a signer
  // that throws inside a socket handler.
  const wire = {}
  for (const name of ['owner-approval.mjs']) {
    const modulePath = join(releaseDir, 'plugins', 'aukora-aumlok', 'lib', name)
    if (!existsSync(modulePath)) {
      const error = new Error(`${APPROVAL_REFUSE.NO_LIBRARY}: ${modulePath} is not in this release`)
      error.code = APPROVAL_REFUSE.NO_LIBRARY
      throw error
    }
    Object.assign(wire, await import(pathToFileURL(modulePath).href))
  }
  return Object.assign(modules, { library: wire })
}

/**
 * Read the public state without touching any private half.
 *
 * THE HANDLE COMES OUT WITH IT, because it is public and because the shell needs it: a refresh is
 * salted with the same handle the record was bound under, and re-typing a public name on a machine
 * that already publishes it would be asking a person to remember something that is not a secret. It is
 * carried only when the record has one (the disposable fixtures derive from a seed, not from a handle),
 * so a record that predates the handle projects exactly the shape it always did.
 * @param {{loadLocalAumlokPublicControl: Function}} library - the organ library from the release.
 * @param {string|null} directory - the bound controller directory.
 * @returns {Readonly<{bound: boolean, reason?: string, subject?: string, handle?: string}>} the state.
 */
export function readBindingState(library, directory) {
  if (directory === null) return Object.freeze({ bound: false, reason: 'aumlok:adapter-unbound' })
  if (!existsSync(join(directory, 'local-control.json'))) {
    return Object.freeze({ bound: false, reason: 'aumlok:controller-absent' })
  }
  try {
    // THE MACHINE KEY THIS LAPTOP KEPT, READ HERE BECAUSE THIS IS THE PROCESS THAT MAY READ IT. A v3
    // record listing several machines does not say which one is this laptop, and the reader answers
    // `aumlok:record-names-no-machine` rather than guess. The shell already opens this file to sign
    // (`aumlok-signer.mjs` reads the seed at startup), so reading it here is the same act in the same
    // uid, and it is what makes a SECOND DEVICE read BOUND instead of refusing. ABSENT IS NOT AN ERROR:
    // a second laptop with no key for this identity passes null and the single-machine fallback still
    // answers, which is the shape every existing one-machine binding has.
    const projection = library
      .loadLocalAumlokPublicControl(directory, undefined, keptMachinePublicKeyOf(library, directory))
      .projection
    return Object.freeze({
      bound: true,
      subject: projection.subject,
      // THE WHOLE PROJECTION RIDES ALONG, AND Y2 IS WHY (2026-09-23). The screen's badge reads a
      // projection over the face's loopback route, and that route is served by the host process, which
      // is NOT this shell and cannot reach the organ's library or `node:fs` from its own build. So the
      // reader that already opens the record hands the projection over as data, and both readers of a
      // bound directory answer with the SAME nine fields — the eight of the v3 record plus the public
      // handle when the record carries one.
      control: projection,
      ...(typeof projection.handle === 'string' ? { handle: projection.handle } : {}),
    })
  } catch (error) {
    const reason = error?.code ?? 'aumlok:controller-unreadable'
    // THE SENTENCE TRAVELS WITH THE CODE, because a code is not an answer a person can act on. MEASURED
    // before this: a two-machine record reached the screen as `aumlok:record-names-no-machine` and
    // nothing else, so the one text that says which tool can read the record was thrown away one layer
    // below the screen that needed it. `LocalAumlokControlError`'s message is `<code>: <detail>` when it
    // has a detail, so the code is stripped from the front rather than printed twice.
    const message = typeof error?.message === 'string' ? error.message : ''
    const detail = message.startsWith(`${String(reason)}: `)
      ? message.slice(String(reason).length + 2)
      : (message === String(reason) ? '' : message)
    return Object.freeze({
      bound: false,
      reason,
      ...(detail === '' ? {} : { detail }),
    })
  }
}

/**
 * The public half of the machine key this directory kept, or null when it kept none.
 *
 * A THROWN READ IS AN ABSENT KEY HERE, AND THAT IS DELIBERATE AND NARROW. This value only ever goes to
 * `loadLocalAumlokPublicControl` as a HINT about which machine this laptop is; the record remains the
 * authority, and a key this function could not read simply leaves the caller where it was before the
 * parameter existed. What must NOT happen is the opposite: swallowing a failure and reporting a bound
 * controller as unbound. That cannot happen here, because a key that is absent or unreadable still
 * leaves the single-machine fallback and the named refusal in place.
 * @param {{readKeptMachineSeed?: Function}} library - the organ library the shell loaded.
 * @param {string} directory - the controller directory.
 * @returns {string|null} 64 hex, or null when this directory kept no readable machine key.
 */
function keptMachinePublicKeyOf(library, directory) {
  if (typeof library?.readKeptMachineSeed !== 'function') return null
  try {
    const kept = library.readKeptMachineSeed({ directory, custodian: 'file' })
    return typeof kept?.ed25519PublicKeyHex === 'string' ? kept.ed25519PublicKeyHex : null
  } catch {
    return null
  }
}

/**
 * THE STYLESHEETS THE APPROVAL WINDOW'S COLOURS COME FROM, IN THE ORDER THEY WIN, FOR ONE THEME.
 *
 * TWO LAYOUTS, BECAUSE THE SHELL AND A COURT READ DIFFERENT TREES. A RELEASE flattens the face
 * paths to `plugins/aukora-face-<name>/`, and the CHECKOUT keeps them nested at
 * `plugins/aukora-face/<name>/`. Reading both means a court exercises this exact code instead of
 * a variant of it, and a release is unaffected because the nested path simply is not there.
 *
 * AND THE FOUNDATION'S OWN STYLESHEET. The window names foundation tokens (`--dsw-alias-bg-layer-1/2`,
 * `--dsw-alias-border-l2`, `--dsw-alias-label-primary/secondary`) and carries no hex, and the face
 * bundles do NOT declare them — they live in Deep's `ui-theme` client, which the app loads and this
 * window does not. So those declarations resolved to nothing: an unpainted window is a bad place to
 * ask a person about a signature. Same two-layout rule as the faces.
 * @param {string} releaseDir - the release root.
 * @param {'dark'|'light'} theme - the theme whose declarations win.
 * @returns {string[]} the stylesheet texts, last one winning.
 */
function styledSources(releaseDir, theme) {
  const forTheme = cssText => theme === 'light' ? withoutDarkTheme(cssText) : cssText
  const sources = []
  for (const name of ['layout', 'aumlok']) {
    for (const candidate of [`aukora-face-${name}`, join('aukora-face', name)]) {
      try {
        sources.push(forTheme(readFileSync(join(releaseDir, 'plugins', candidate, 'lib', 'client.js'), 'utf8')))
        break
      } catch { /* not in this layout; the other may resolve the chain */ }
    }
  }
  for (const candidate of [join('packages', 'client', 'ui-theme', 'lib', 'client.js'),
    join('vendor', 'dsh', 'packages', 'client', 'ui-theme', 'lib', 'client.js')]) {
    try {
      sources.push(forTheme(readFileSync(join(releaseDir, candidate), 'utf8')))
      break
    } catch { /* not in this layout; the other may resolve it */ }
  }
  return sources
}

/**
 * THE FOUNDATION'S TOKEN SET IS DECLARED TWICE, AND ONLY ONE OF THE TWO IS EVER READ.
 *
 * MEASURED with this reader on the stylesheet the app loads: `body { --dsw-alias-bg-layer-1:
 * var(--dsw-static-neutral-bluish-00) }` is the LIGHT value, and `body[data-ds-dark-theme]`, later in
 * the same file, is the DARK one. A reader that takes the last definition — which is what this
 * function did before it knew about themes — returns the DARK values whatever the system theme is,
 * so a light window would have been painted with the dark palette. This drops the dark-theme blocks,
 * which is the whole of the difference for the light theme; `ceremonyTokenValues` follows one level
 * of `var()` and the light block is the remaining definition.
 * @param {string} cssText - one stylesheet, as written.
 * @returns {string} the same stylesheet with its dark-theme blocks removed.
 */
function withoutDarkTheme(cssText) {
  return String(cssText).replace(/[^{}]*\[data-ds-dark-theme\][^{}]*\{[^{}]*\}/gu, '')
}

/**
 * Resolve the face's colour tokens out of the face bundles the release carries.
 *
 * THE LAYOUT FACE DEFINES THE FOUNDATION TOKENS AND THE AUMLOK FACE REFERENCES THEM, so BOTH are read:
 * the aumlok bundle alone resolves to `{}` — a window with no colours, and a "no hex" court that
 * passes because the map is empty rather than because the window is honest. A bundle that cannot be
 * read is skipped rather than fatal.
 * @param {string} releaseDir - the release root.
 * @param {object} library - the organ library, for `ceremonyTokenValues`.
 * @param {'dark'|'light'} [theme] - the theme whose declarations win. DEFAULTS TO `'dark'`, which is
 *   what this reader resolved before the parameter existed: the dark block is the last definition, so
 *   a caller that names no theme gets exactly the bytes it got yesterday.
 * @returns {Readonly<Record<string, string>>} token name -> literal value.
 */
export function readFaceTokenValues(releaseDir, library, theme = 'dark') {
  const sources = styledSources(releaseDir, theme)
  return sources.length === 0 ? Object.freeze({}) : library.ceremonyTokenValues(...sources)
}

/**
 * THE ONE TOKEN THE WINDOW'S PRE-PAINT COLOUR NEEDS — AND IT IS READ SYNCHRONOUSLY, ON PURPOSE.
 *
 * `backgroundColor` is a BrowserWindow CONSTRUCTOR option, and the window is constructed in the same
 * turn a person's approval arrives. Going through `readFaceTokenValues` would mean loading the organ
 * library first, which is asynchronous: one tick between the request and the window, for a colour. So
 * the shell reads the one token it needs here.
 *
 * MEASURED BEFORE THIS EXISTED: the option was `backgroundColor: '#0B0E14'`, a hex that is the value
 * of NO token the window paints with — the dark surface token is `#232324` and the light one is
 * `#fff` — so the window pre-painted a colour the application never uses, in both themes.
 *
 * IT IS NOT A SECOND AUTHORITY: this is the same source list and the same last-definition-wins rule
 * as `ceremonyTokenValues`, restricted to one token. A release that carries no such token yields
 * `null`, and `null` means NO backgroundColor rather than a hex this module made up.
 * @param {string} releaseDir - the release root.
 * @param {'dark'|'light'} [theme] - the theme whose declarations win.
 * @returns {string|null} the CSS colour the window pre-paints with, or null when it cannot be read.
 */
/**
 * HOW OFTEN THE SHEET CHECKS THAT NOTHING IS PAINTED OVER IT.
 *
 * A quarter of a second is a compromise with a stated reason rather than a round number: a person reads the
 * digest and moves a pointer at human speed, so a foreign view that appears above the sheet is answered
 * long before a click can land through it — while the check itself is two array reads, which is nothing to
 * do four times a second for the few seconds an approval is on screen.
 */
const Z_ORDER_INTERVAL_MS = 250

/**
 * TAKE THE KEYBOARD WHILE THE SHEET IS OPEN, AND GIVE IT BACK WHEN IT CLOSES.
 *
 * A DOCKED SHEET IS NOT A MODAL WINDOW: nothing about being docked stops a keystroke from reaching the page
 * drawn behind it, so the conversation the sheet is covering would still accept typing — and a script in
 * that page would still receive the person's keys. `before-input-event` is the shell's own hook on the main
 * renderer; preventing it is what makes the sheet modal in the only sense that matters here.
 *
 * THE GUARD IS A FUNCTION WITH A DISPOSER so the court can drive it with stubs, and so "focus came back" is
 * one call rather than an assumption about what closing does.
 * @param {{webContents?: object}} win - the application window whose renderer must go deaf.
 * @param {{webContents?: object}} view - the approval surface, which takes focus.
 * @returns {() => void} the disposer: unblocks the keyboard and returns focus.
 */
export function guardKeyboard(win, view) {
  const content = win?.webContents
  const block = (event) => {
    // BLOCKED, NOT FORWARDED AND NOT INSPECTED: this is not a place to interpret keys, it is a place to stop
    // them. A shell that decided which keys were safe would be a second input path into a covered page.
    if (typeof event?.preventDefault === 'function') event.preventDefault()
  }
  if (content === null || content === undefined) return () => {}
  if (typeof content.on === 'function') content.on('before-input-event', block)
  if (typeof view?.webContents?.focus === 'function') view.webContents.focus()
  let disposed = false
  return () => {
    if (disposed) return
    disposed = true
    if (typeof content.removeListener === 'function') content.removeListener('before-input-event', block)
    if (typeof content.focus === 'function') content.focus()
  }
}

/**
 * WHETHER THE SHEET IS NO LONGER THE TOPMOST CHILD OF ITS PARENT.
 *
 * A `View` has no z-index: the paint order is the child ORDER, and the last child is on top. Anything that
 * adds a view to the main window after the sheet — a canvas, a menu, a future overlay — is therefore drawn
 * over the sheet, and a person could be asked to approve an operation through a surface something else is
 * painting on top of. That is a click-jacking shape and a lying-display shape at once, so the sheet has to
 * be re-added LAST whenever it is not last.
 *
 * THE RULE IS A FUNCTION RATHER THAN A CONDITION INLINE, because it is the part worth testing: the guard
 * around it is a timer, and a timer that calls the wrong predicate is worse than none.
 * @param {readonly unknown[]} children - the parent's children, in paint order.
 * @param {unknown} view - the approval surface.
 * @returns {boolean} true when the surface exists in the list and is not the last entry.
 */
export function needsRaise(children, view) {
  if (!Array.isArray(children) || view === null || view === undefined) return false
  const at = children.indexOf(view)
  return at !== -1 && at !== children.length - 1
}

/**
 * THE SHELL'S OWN PALETTE, used when the site's tokens cannot be trusted.
 *
 * These are the same values the sheet falls back to in its own CSS, in the one form the sheet and the
 * grammar both agree on. They are deliberately drab: a fallback exists to be readable, not to look right.
 */
export const SAFE_APPROVAL_TOKENS = Object.freeze({
  '--dsw-alias-bg-layer-1': 'rgb(27, 27, 28)',
  '--dsw-alias-bg-layer-2': 'rgb(35, 35, 36)',
  '--dsw-alias-border-l2': 'rgba(255, 255, 255, 0.12)',
  '--dsw-alias-label-primary': 'rgb(242, 242, 242)',
  '--dsw-alias-label-secondary': 'rgb(168, 168, 168)',
  '--dsw-font-family': '-apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif',
  // THE TWO TOKENS THE FACES REFERENCED AND NOTHING DEFINED, kept here as well as in the layout face so the
  // sheet cannot be left with a hole if the site's set arrives incomplete.
  '--dsw-font-family-mono': 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace',
  '--dsw-alias-label-error': 'rgb(242, 85, 90)',
  '--dsh-spatial-gap': '6px',
})

/** Text must reach this contrast against its background. The WCAG AA floor for body text. */
const MIN_CONTRAST = 4.5

/** The largest a spacing token may be, so a token cannot push content out of the card. */
const MAX_SIZE_PX = 64

/** Tokens that paint TEXT, and tokens that paint what text sits on. */
const TEXT_TOKENS = Object.freeze(['--dsw-alias-label-primary', '--dsw-alias-label-secondary'])
const SURFACE_TOKENS = Object.freeze(['--dsw-alias-bg-layer-1', '--dsw-alias-bg-layer-2'])

/**
 * One CSS colour as `[r, g, b, a]`, or null when it is not one.
 * @param {string} raw - the value.
 * @returns {number[]|null} the channels, 0-255 and alpha 0-1.
 */
function parseColour(raw) {
  const text = String(raw ?? '').trim().toLowerCase()
  if (text === 'transparent' || text === 'currentcolor' || text === 'inherit') return null
  const hex = /^#([0-9a-f]{3}|[0-9a-f]{6})$/u.exec(text)
  if (hex !== null) {
    const digits = hex[1].length === 3 ? hex[1].split('').map(part => part + part).join('') : hex[1]
    return [0, 2, 4].map(at => Number.parseInt(digits.slice(at, at + 2), 16)).concat([1])
  }
  const fn = /^rgba?\(\s*([0-9.]+)\s*[,\s]\s*([0-9.]+)\s*[,\s]\s*([0-9.]+)\s*(?:[,/]\s*([0-9.]+)\s*)?\)$/u.exec(text)
  if (fn === null) return null
  const channels = [fn[1], fn[2], fn[3]].map(Number)
  const alpha = fn[4] === undefined ? 1 : Number(fn[4])
  if (channels.some(channel => !Number.isFinite(channel) || channel < 0 || channel > 255)) return null
  if (!Number.isFinite(alpha) || alpha < 0 || alpha > 1) return null
  return [...channels, alpha]
}

/**
 * The colour composited over black, which is what a translucent value actually paints on this surface.
 * @param {number[]} colour - `[r, g, b, a]`.
 * @returns {number[]} opaque `[r, g, b]`.
 */
function overBlack(colour) {
  const [r, g, b, a] = colour
  return [r * a, g * a, b * a]
}

/**
 * WCAG relative-luminance contrast between two colours.
 * @param {number[]} one - `[r, g, b, a]`.
 * @param {number[]} two - `[r, g, b, a]`.
 * @returns {number} the contrast ratio.
 */
function contrast(one, two) {
  const luminance = (colour) => {
    const [r, g, b] = overBlack(colour).map((channel) => {
      const part = channel / 255
      return part <= 0.03928 ? part / 12.92 : ((part + 0.055) / 1.055) ** 2.4
    })
    return 0.2126 * r + 0.7152 * g + 0.0722 * b
  }
  const [light, dark] = [luminance(one), luminance(two)].sort((a, b) => b - a)
  return (light + 0.05) / (dark + 0.05)
}

/**
 * PUT THE SITE'S TOKENS THROUGH A GRAMMAR BEFORE THEY REACH A STYLESHEET.
 *
 * THE TOKENS COME FROM A BUNDLE THE SHELL DOES NOT OWN. They are the site's own values, and a value that is
 * `transparent`, that matches the background, or that carries a second declaration is a way to hide or
 * displace the text a person reads before approving — the one screen where "what is on it" is the security
 * property. So each value is PARSED rather than trusted:
 *
 *   - no value may carry `;`, `{`, `}` or `url(`, because that is not a value, it is more stylesheet;
 *   - a colour must parse as a colour, must be opaque where it paints text or the sheet's own surface;
 *   - text and the surface it sits on must reach 4.5:1, RECOMPUTED ON THE FINAL VALUES after substitution,
 *     so a pair that is only unreadable once the fallbacks are mixed in is still caught;
 *   - a size must be a bounded length, so a token cannot push the card out of the pane.
 *
 * A REFUSED TOKEN IS REPLACED, NOT DROPPED: the shell's own palette fills the hole, so the sheet is painted
 * by values that were checked rather than by whatever the browser defaults to, and every refusal is named in
 * `reasons` and logged. `fellBack` says whether anything at all was refused.
 * @param {Readonly<Record<string, string>>} values - the site's resolved token values.
 * @param {{warn?: (line: string) => void}} [log] - where refusals are reported.
 * @returns {{values: Record<string, string>, reasons: string[], fellBack: boolean}} the values to inject.
 */
export function safeApprovalTokens(values, log) {
  const reasons = []
  const accepted = {}
  for (const [name, raw] of Object.entries(values ?? {})) {
    const text = String(raw ?? '').trim()
    if (!/^--(dsw|dsh)-[a-z0-9-]+$/u.test(name) || text.length === 0) continue
    if (/[;{}]/u.test(text) || /url\(/iu.test(text)) {
      reasons.push(`${name} refused: the value carries a stylesheet delimiter or a url() (${text.slice(0, 60)})`)
      continue
    }
    if (TEXT_TOKENS.includes(name) || SURFACE_TOKENS.includes(name) || /border/u.test(name)) {
      const colour = parseColour(text)
      if (colour === null) {
        reasons.push(`${name} refused: ${text === 'transparent' || text === 'currentcolor' ? `the value is ${text}` : 'the value is not a colour'}`)
        continue
      }
      // TEXT AND THE SHEET'S SURFACE MUST BE OPAQUE. A translucent label is a label a background can erase,
      // and a translucent surface is one the page behind it shows through — which is a different screen.
      if ((TEXT_TOKENS.includes(name) || SURFACE_TOKENS.includes(name)) && colour[3] < 1) {
        reasons.push(`${name} refused: alpha ${String(colour[3])} is not opaque`)
        continue
      }
      accepted[name] = text
      continue
    }
    if (/gap|radius|spacing|size/u.test(name)) {
      const size = /^(?<number>[0-9]+(?:\.[0-9]+)?)(?<unit>px|rem|em)$/u.exec(text)
      const asPixels = size === null ? Number.NaN : Number(size.groups.number) * (size.groups.unit === 'px' ? 1 : 16)
      if (size === null || !Number.isFinite(asPixels) || asPixels > MAX_SIZE_PX) {
        reasons.push(`${name} refused: ${text} is not a bounded length (0-${String(MAX_SIZE_PX)}px)`)
        continue
      }
      accepted[name] = text
      continue
    }
    accepted[name] = text
  }
  // THE PALETTE FILLS EVERY HOLE, including the holes the site simply did not fill.
  const final = { ...SAFE_APPROVAL_TOKENS, ...accepted }
  const fellBack = reasons.length > 0
  for (const name of [...TEXT_TOKENS, ...SURFACE_TOKENS]) {
    const colour = parseColour(final[name])
    if (colour === null || colour[3] < 1) {
      reasons.push(`${name} fell back: the final value is not an opaque colour`)
      final[name] = SAFE_APPROVAL_TOKENS[name]
    }
  }
  // RECOMPUTED ON THE FINAL VALUES: the pairs that actually ship, after every substitution above.
  for (const text of TEXT_TOKENS) {
    for (const surface of SURFACE_TOKENS) {
      const ratio = contrast(parseColour(final[text]), parseColour(final[surface]))
      if (ratio < MIN_CONTRAST) {
        reasons.push(`${text} on ${surface} has contrast ${ratio.toFixed(2)}:1, below ${String(MIN_CONTRAST)}:1`)
        final[text] = safeLabelFor(surface, final)
      }
    }
  }
  for (const reason of reasons) log?.warn?.(`aumlok approval: ${reason}`)
  return { values: final, reasons, fellBack }
}

/**
 * A readable text colour for one surface, from the palette: the light label unless the surface is light.
 * @param {string} surfaceName - the surface token.
 * @param {Record<string, string>} values - the values in hand.
 * @returns {string} an opaque colour that contrasts with the surface.
 */
function safeLabelFor(surfaceName, values) {
  const surface = parseColour(values[surfaceName])
  const light = SAFE_APPROVAL_TOKENS['--dsw-alias-label-primary']
  const dark = 'rgb(16, 16, 18)'
  if (surface === null) return light
  return contrast(parseColour(light), surface) >= MIN_CONTRAST ? light : dark
}

/**
 * The `:root` block the approval sheet is painted with, from the site's resolved token values.
 *
 * ONLY THE TOKEN NAMESPACES THE SITE USES, and only values that RESOLVED: `readFaceTokenValues` follows one
 * level of `var()`, and anything still holding one is dropped. The filter is a function rather than a loop
 * inside the sheet's setup because a court can call it, and because "which tokens may be injected" is a
 * decision worth being able to test on its own.
 * @param {Readonly<Record<string, string>>} values - token name -> literal value.
 * @returns {string} the CSS to inject, or `''` when there is nothing to inject.
 */
export function approvalTokenCss(values) {
  const declarations = []
  for (const [name, value] of Object.entries(values ?? {})) {
    if (!/^--(dsw|dsh)-[a-z0-9-]+$/u.test(name)) continue
    const text = String(value ?? '').trim()
    if (text.length === 0 || text.includes('var(') || text.includes('{') || text.includes('}')) continue
    declarations.push(`${name}:${text}`)
  }
  return declarations.length === 0 ? '' : `:root{${declarations.join(';')}}`
}

function surfaceColour(releaseDir, theme = 'dark') {
  const declared = new Map()
  for (const cssText of styledSources(releaseDir, theme)) {
    for (const match of cssText.matchAll(/(--[a-z0-9-]+)\s*:\s*([^;}]+)[;}]/gu)) {
      declared.set(match[1], match[2].trim())
    }
  }
  const raw = declared.get('--dsw-alias-bg-layer-1')
  if (raw === undefined) return null
  const reference = /^var\(\s*(--[a-z0-9-]+)\s*(?:,\s*([^)]+))?\)$/u.exec(raw)
  if (reference === null) return raw
  const target = declared.get(reference[1]) ?? reference[2]
  // AN UNRESOLVED TOKEN IS NOT A COLOUR, exactly as in `ceremonyTokenValues`.
  if (target === undefined || target.startsWith('var(')) return null
  return target.trim()
}

/**
 * LIGHT OR DARK, FROM THE SHELL'S OWN nativeTheme AND FROM NOWHERE ELSE.
 *
 * The window cannot ask the system itself: it is a sandboxed renderer with no preload verb that
 * reaches the theme, and `matchMedia('(prefers-color-scheme: dark)')` inside it would be a SECOND
 * answer to a question the shell has already answered. A shell that hands over no nativeTheme gets
 * `'light'`, which is the same fact as `data-ds-dark-theme` being absent — the attribute is what the
 * face switches on, so a theme nobody set must not be silently dark.
 * @param {object} deps - the bridge's dependencies.
 * @returns {'dark'|'light'} the theme the window is to be drawn in.
 */
function windowTheme(deps) {
  const nativeTheme = deps.nativeTheme
  return nativeTheme !== null && nativeTheme !== undefined && nativeTheme.shouldUseDarkColors === true
    ? 'dark' : 'light'
}

/** Register the approval question's IPC surface and hand back a disposer.
 *
 * ONE WINDOW AT A TIME, AND IT IS MODAL. A second approval window would be a second chance to answer,
 * and the answer is one bit about one operation: two questions on screen at once would make "the
 * person said yes" ambiguous about WHICH operation.
 *
 * SENDER VALIDATION IS PER CHANNEL. `state` is callable only by the application's own window; `ask`
 * and `answer` only by the approval window. The application's page is served by the backend, so it
 * must not be able to reach the channel that settles a signature by guessing its name.
 *
 * @param {object} deps - the Electron surfaces and the shell's own facts.
 * @returns {{dispose: () => void, close: () => void, ask: Function, isApprovalOpen: () => boolean}} the bridge.
 */
export function installApprovalBridge(deps) {
  // `WebContentsView` IS WHAT AN APPROVAL IS DRAWN IN NOW: a view the shell owns and docks inside the
  // application's own window, rather than a window of its own that reads as a different application.
  const { WebContentsView, ipcMain, session, app, here, getWindow, getReleaseDir, getPatchPaths, log } = deps
  // THE DRAW IS BUILT HERE UNLESS ONE WAS HANDED IN. A court measures `aumlok-draw.mjs` directly and
  // passes its own instance; the app builds the shell's one and nothing else in this process can make
  // a second, so there is exactly one place a phrase can be drawn from and exactly one slot holding it.
  const draw = deps.draw ?? createAumlokDraw()
  // TWO SEAMS, AND EACH IS ONE LINE BECAUSE A SEAM THAT NEEDS MORE IS A REWRITE.
  //
  // `ownerDaemonStatus` IS INJECTABLE so a court can put the daemon PRESENT or ABSENT without installing one
  // at `/usr/local/etc/`. Its default is the REAL detector (`ownerDaemonStatus()` from
  // `plugins/aukora-owner-daemon/lib/detect.mjs`), which verifies a signed hello against the key recorded at
  // install — so the default is the honest answer and a caller that substitutes it is saying so explicitly.
  //
  // `readBindingState` IS INJECTABLE so the harness can drive SUBMIT without a bound identity on disk. It is
  // the same shape `draw` already had (`deps.draw ?? createAumlokDraw()`), for the same reason: the shell
  // builds the real one and a court hands in its own.
  const ownerDaemonStatusOf = deps.ownerDaemonStatus ?? ownerDaemonStatus
  const readState = deps.readBindingState ?? readBindingState
  let approval = null
  /** The resize listener that keeps the docked sheet over the pane, so it can be removed with it. */
  let dockedResize = null
  /** The timer that keeps the sheet topmost while it is docked. */
  let zOrderGuard = null
  /** The keyboard guard's disposer, kept so the main renderer's keys come back with the sheet's absence. */
  let keyboardGuard = null
  let approvalSession = null
  let library = null
  let directory = null

  const say = typeof log === 'function' ? log : () => {}

  /** The controller directory and the organ library, resolved once per bridge. */
  async function context() {
    if (library === null) library = await loadOrganLibrary(getReleaseDir())
    if (directory === null) {
      // A FRESH INSTALL NAMES NO KEY FOLDER until its first link writes the per-install settings file, so
      // the folder the ceremony writes into is `<state root>/aumlok` (the owner's layout). A patch that
      // declares one always wins, so a deployment that names its folder is unchanged.
      const stateRoot = typeof deps.getStateRoot === 'function' ? deps.getStateRoot() : null
      const binding = resolveAumlokDirectory(getPatchPaths())
        ?? (typeof stateRoot === 'string' && stateRoot !== ''
          ? { directory: defaultAumlokDirectory(stateRoot), source: 'default' } : null)
      if (binding === null) {
        const error = new Error(`${APPROVAL_REFUSE.NO_DIRECTORY}: no aukora-aumlok row in any `
          + 'composition patch declares config.directory, so this bridge has no destination')
        error.code = APPROVAL_REFUSE.NO_DIRECTORY
        throw error
      }
      directory = binding.directory
    }
    return { library, directory }
  }

  /**
   * THE FIRST LINK WRITES THE PER-INSTALL SETTINGS (install-settings.mjs), so Kira mounts on the next start.
   *
   * After the ceremony succeeded, never instead of it: the verdict the screen gets is the ceremony's, and a
   * settings file that could not be written costs a log line, not the binding. Written only when the support
   * root has no such file yet, from the public projection of the record just written.
   */
  function recordInstallSettings(lib, dir) {
    try {
      const supportRoot = typeof deps.getSupportRoot === 'function' ? deps.getSupportRoot() : null
      const stateRoot = typeof deps.getStateRoot === 'function' ? deps.getStateRoot() : null
      if (typeof supportRoot !== 'string' || supportRoot === '' || typeof stateRoot !== 'string' || stateRoot === '') {
        say('install settings not written: this shell was given no support root or state root')
        return
      }
      const result = writeInstallSettingsOnFirstLink({
        supportRoot, stateRoot, directory: dir, state: readBindingState(lib, dir),
      })
      say(result.written
        ? `install settings written: ${result.path} (Kira mounts on the next start)`
        : `install settings not written: ${String(result.reason)} (${result.path})`)
    } catch (error) {
      say(`install settings not written: ${String(error?.code ?? error?.message ?? error)}`)
    }
  }

  /** Only the application window may read the public state. */
  function fromApplication(event) {
    const owner = getWindow()
    return owner !== null && owner !== undefined && event.sender === owner.webContents
  }

  /** Only the approval window may ask what it is answering, or answer it. */
  function fromApproval(event) {
    return approval !== null && !approval.webContents.isDestroyed() && event.sender === approval.webContents
  }

  /**
   * PUT THE SHEET BACK ON TOP, IF SOMETHING IS ABOVE IT.
   *
   * Removal and re-addition rather than a z-index, because a `View` has no z-index: the last child is the
   * topmost one. Called from the guard below for as long as the sheet is docked, so a view added by anyone
   * else is answered by the next tick rather than by the person noticing they are approving something
   * through an overlay.
   */
  function raiseApproval() {
    const win = typeof getWindow === 'function' ? getWindow() : null
    const view = approval
    if (win === null || win === undefined || view === null) return
    const content = win.contentView
    if (content === null || content === undefined) return
    if (!needsRaise(content.children, view)) return
    content.removeChildView(view)
    content.addChildView(view)
  }

  /** Keep the docked sheet over the conversation pane as the window is resized. */
  function dockApproval() {
    const win = typeof getWindow === 'function' ? getWindow() : null
    if (win === null || win === undefined || approval === null) return
    const { width, height } = win.getContentBounds()
    // A CHILD VIEW'S BOUNDS ARE IN ITS PARENT'S SPACE, and the content view's origin is the window's
    // content area — so covering it means starting at zero with its size, whatever the window is doing.
    approval.setBounds({ x: 0, y: 0, width: Math.max(0, Math.floor(width)), height: Math.max(0, Math.floor(height)) })
  }

  /**
   * PAINT THE SHEET IN THE SITE'S OWN TOKENS.
   *
   * Read from the release's face bundles, exactly the way the pre-paint colour is read, and injected into
   * the sheet as a `:root` block: whatever `--dsw-…` the site declares is what the sheet's own
   * `var(--dsw-…)` references resolve to, so the sheet follows the site instead of carrying a copy of it.
   * A token that resolves to nothing, or to another `var()`, is DROPPED rather than injected: an unresolved
   * token is not a colour, and a sheet that inherited one would paint in whatever the browser defaulted to.
   */
  async function applySiteTokens(view, theme) {
    const release = typeof getReleaseDir === 'function' ? getReleaseDir() : null
    if (release === null || release === undefined) return
    const { library } = await context()
    // PUT THROUGH THE GRAMMAR FIRST: the site's values are parsed, bounded and contrast-checked, and any
    // refusal is logged and replaced from the shell's own palette.
    const safe = safeApprovalTokens(readFaceTokenValues(release, library, theme), { warn: line => say(line) })
    const css = approvalTokenCss(safe.values)
    if (css.length === 0) return
    await view.webContents.insertCSS(css)
  }

  /**
   * TAKE THE SHEET DOWN, AND LET ITS DESTRUCTION DECLINE.
   *
   * The question is settled by the `destroyed` listener the ask registers, which is why this function's job
   * is only to unmount: removing the child view and closing the contents. A sheet that is taken down leaves
   * the signer with `approve: false`, never waiting for a person who has gone.
   */
  function closeApproval() {
    const view = approval
    if (view === null) return
    // THE DECLINE IS RECORDED HERE, NOT ONLY ON THE DESTROY EVENT. `settleAsk` is settle-once, so the
    // listener the ask registers is a second chance rather than the mechanism: a renderer that never emits
    // `destroyed` — a hung process, a close that is queued — must not leave the signer waiting for an answer
    // from a person who has already been shown the sheet closing.
    settleAllAsks({ approve: false })
    approval = null
    if (zOrderGuard !== null) {
      clearInterval(zOrderGuard)
      zOrderGuard = null
    }
    // FOCUS AND THE KEYBOARD GO BACK TOGETHER, and the guard is disposed even when the view is already gone:
    // a listener left on the main renderer would keep a closed sheet's keyboard block in place.
    if (keyboardGuard !== null) {
      keyboardGuard()
      keyboardGuard = null
    }
    const win = typeof getWindow === 'function' ? getWindow() : null
    if (win !== null && win !== undefined && dockedResize !== null) {
      win.removeListener('resize', dockedResize)
      dockedResize = null
      try {
        win.contentView.removeChildView(view)
      } catch { /* already gone with the window */ }
    }
    if (!view.webContents.isDestroyed()) view.webContents.close()
  }

  /**
   * THE ONE PENDING QUESTION. `{challenge, facts, settle}` while an approval is on screen.
   *
   * **THE AMBIGUITY WAS REMOVED; THE BINDING WAS NOT.** A second question used to be refused (`ASK_BUSY`) because
   * "the answer is matched to the question by the challenge it echoes, so a window that was left open cannot answer
   * a question asked after it. Two questions at once would make 'the person said yes' ambiguous about WHICH
   * operation, and an ambiguity in this direction is an approval for something nobody looked at."
   *
   * Every word of that still holds, and the queue is how it holds with more than one question waiting: **each entry
   * carries its OWN challenge and its OWN derived line, a click NAMES the challenge it answers, and `settleAsk`
   * settles exactly the one that matches.** A window left open still cannot answer a question asked after it, and
   * "the person said yes" still means one named operation. **There is no path that settles several** — `settleAsk`
   * takes one challenge and settles one entry, so a batch approval is a shape this code cannot express rather than
   * a rule somebody has to remember not to break.
   */
  let pendingQueue = []

  /**
   * Settle ONE queued question, named by its challenge.
   *
   * SETTLE-ONCE IS KEPT PER ENTRY: the entry is REMOVED before it is settled, so a second answer naming the same
   * challenge finds nothing and is refused by name rather than settling a question twice.
   * @returns {boolean} whether a queued question was settled.
   */
  function settleAsk(challenge, answer) {
    const at = pendingQueue.findIndex(entry => entry.challenge === challenge)
    if (at === -1) return false
    const [entry] = pendingQueue.splice(at, 1)
    entry.settle(Object.freeze({ ...answer }))
    return true
  }

  /** End EVERY queued question. A window closing or being destroyed ends all of them, not just the newest. */
  function settleAllAsks(answer) {
    const queued = pendingQueue
    pendingQueue = []
    for (const entry of queued) entry.settle(Object.freeze({ ...answer }))
  }

  /**
   * OPEN THE ONE-BIT APPROVAL WINDOW, AND NOTHING ELSE OPENS A WINDOW HERE.
   *
   * This is the v2 ceremony window's machinery narrowed to its one surviving job. The window it opens
   * shows the PUBLIC facts of the pending question and returns ONE BIT. It draws no words, asks for
   * none, derives nothing and writes nothing: there is no phrase on this path to protect.
   */
  function openApprovalWindow() {
    if (approval !== null && !approval.webContents.isDestroyed()) {
      approval.webContents.focus()
      return { ok: false, reason: `${APPROVAL_REFUSE.WINDOW_OPEN}: an approval window is already open` }
    }
    // THE THEME IS THE SHELL'S. The window sets the same attribute the face switches on
    // (`data-ds-dark-theme`) and nothing in it hardcodes `color-scheme`.
    const theme = windowTheme(deps)
    const background = surfaceColour(getReleaseDir(), theme)
    // AN IN-MEMORY SESSION, AND ITS OWN. `persist:` is absent on purpose: the approval needs no
    // cookie, no cache and nothing that outlives it, and reusing the application's partition would
    // let the backend-served page share a storage area with the window that answers for a key.
    approvalSession = session.fromPartition('aukora-approval', { cache: false })
    approvalSession.setPermissionRequestHandler((_contents, _permission, callback) => callback(false))
    const options = {
      webPreferences: {
        session: approvalSession,
        preload: join(here, 'aumlok-approval-preload.cjs'),
        sandbox: true, contextIsolation: true, nodeIntegration: false,
        webSecurity: true, webviewTag: false, spellcheck: false,
        // NO DEVTOOLS: a console in the window whose answer authorizes a signature is a place that
        // answer can be read from by anything that can reach this app's debugging surface.
        devtools: false,
      },
    }
    // THE SURFACE IS A VIEW INSIDE THE APPLICATION'S OWN WINDOW, NOT A WINDOW OF ITS OWN.
    //
    // It used to be a separate always-on-top black window, and Peter's report was that it looked like a
    // different application. A `WebContentsView` owned by the shell and added to the main window's
    // `contentView` is the same document, the same preload and the same fences — drawn where the person is
    // already looking, over the conversation they were reading.
    const win = typeof getWindow === 'function' ? getWindow() : null
    if (win === null || win === undefined) return { ok: false, reason: APPROVAL_REFUSE.NO_DOCK }
    delete options.parent
    delete options.modal
    delete options.backgroundColor
    const view = new WebContentsView(options)
    approval = view
    if (deps.headless !== true) {
      win.contentView.addChildView(view)
      dockedResize = () => { dockApproval() }
      dockApproval()
      win.on('resize', dockedResize)
      // THE GUARD RUNS FOR AS LONG AS THE SHEET IS DOCKED, and only then: a timer that outlived the sheet
      // would be a timer holding a destroyed view. `unref` so it can never be the reason this process stays
      // alive — the sheet is not a reason for the application to keep running.
      zOrderGuard = setInterval(() => { raiseApproval() }, Z_ORDER_INTERVAL_MS)
      if (typeof zOrderGuard.unref === 'function') zOrderGuard.unref()
      // AND THE KEYBOARD BELONGS TO THE SHEET while it is on screen.
      keyboardGuard = guardKeyboard(win, view)
    }
    // THE SITE'S OWN TOKENS ARE INJECTED INTO THE SHEET, so what it is painted in changes when the site
    // changes. The one colour read synchronously above is the pre-paint colour; this is the rest of them,
    // and it lands as soon as the document has one.
    view.webContents.once('did-finish-load', () => {
      void applySiteTokens(view, theme).catch(() => { /* the sheet keeps its fallbacks, which are the site's own values as of the build */ })
    })
    // THE WINDOW NAVIGATES NOWHERE. It is a local file and it stays one: an open handler that denied
    // nothing would let a link, or a compromised renderer, turn it into a browser.
    view.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
    view.webContents.on('will-navigate', event => event.preventDefault())
    // A COURT OPENS THE REAL SHEET AND MUST NOT PUT IT ON A PERSON'S SCREEN. `headless` skips only the
    // docking; every other fact about the view — its session, preload, devtools setting, that it loads a
    // local file — is exactly what ships.
    view.webContents.once('destroyed', () => { if (approval === view) approval = null })
    view.webContents.loadFile(join(here, 'aumlok-approval.html'), { query: { theme } }).catch(error => {
      say(`aumlok approval: page failed to load: ${String(error?.message ?? error)}`)
      closeApproval()
    })
    return { ok: true }
  }

  /** What a screen needs to know about the signing session, in the session's OWN words. */
  function readSigningState() {
    const source = typeof deps.getSigningSession === 'function' ? deps.getSigningSession : null
    let session = null
    try {
      session = source === null ? null : source()
    } catch {
      session = null
    }
    if (session === null || session === undefined || typeof session.status !== 'function') {
      // NO SIGNER, SO THERE IS NOTHING TO OPEN. `available: false` is what stops a screen offering a
      // button that would refuse, and `locked: true` says signing is not open either way.
      return Object.freeze({ available: false, locked: true, reason: 'aumlok:signing-session-absent',
        expiresAt: null, remainingMs: 0, windowMs: null })
    }
    const status = session.status()
    // THE SESSION'S OWN FIELDS, NOT A SECOND OPINION. `reason` is the session's name for why it is shut,
    // which is exactly the distinction a screen needs and exactly the one it cannot invent. The one v2
    // name is translated; see `signingReasonName`.
    //
    // `locked` NO LONGER READS A SESSION FIELD, AND THAT IS THE v3 FACT RATHER THAN A TIDY-UP. It used
    // to read the open/shut boolean the deleted v2 session produced, and that field went with the
    // session: the v3 signer holds the root seed this machine kept after binding and signs without a
    // window, so there is no open/shut state to report and nothing that could report one.
    // The old read survived in code that can no longer be reached at all — `startShellSigner` returns
    // `{serving, reason, socketPath}`, which has no `session` for `signingSessionSource` to hand over,
    // so this function returns the absent-session answer above and never arrives here. Written the
    // other way round it would have been a permissive default, which is why it is spelled out: a
    // session that cannot state it is serving is not serving.
    return Object.freeze({
      available: true,
      locked: status.serving !== true,
      reason: signingReasonName(status.reason) ?? null,
      expiresAt: status.expiresAt ?? null,
      remainingMs: status.remainingMs ?? 0,
      windowMs: status.windowMs ?? null,
    })
  }

  ipcMain.handle(APPROVAL_CHANNELS.STATE, async (event) => {
    if (!fromApplication(event)) return { ok: false, reason: APPROVAL_REFUSE.FORBIDDEN_SENDER }
    try {
      const { library: lib, directory: dir } = await context()
      return { ok: true, directory: dir, ...readBindingState(lib, dir), signing: readSigningState() }
    } catch (error) {
      return { ok: false, reason: error?.code ?? String(error?.message ?? error) }
    }
  })

  /**
   * DRAW ONE PHRASE FOR THE APPLICATION'S OWN WINDOW, and for no other caller.
   *
   * THE WORDS GO TO THE PAGE AND NOWHERE ELSE. `fromApplication` is the same check `state` uses, and it
   * is the whole of the sender validation: the draw is bound to the webContents that asked, so a second
   * window that guessed this channel's name reaches the refusal and never the words.
   */
  ipcMain.handle(APPROVAL_CHANNELS.DRAW, (event, payload) => {
    // THE DRAW MODULE'S OWN NAME, not the approval module's: a court and a screen both match on the
    // name, and two names for one fact is how a refusal stops being recognisable.
    if (!fromApplication(event)) return { ok: false, reason: DRAW_REFUSE.FORBIDDEN_SENDER }
    // A MALFORMED PAYLOAD IS NOT A DRAW. An intent this shell does not run is refused by the draw
    // module's own name rather than being coerced into one of the two that exist.
    const intent = typeof payload === 'string' ? payload : payload?.intent
    try {
      return draw.draw(event.sender, intent, getReleaseDir())
    } catch (error) {
      say(`draw refused: ${String(error?.message ?? error)}`)
      return { ok: false, reason: String(error?.code ?? error?.message ?? error) }
    }
  })

  /**
   * TAKE THE TYPED WORDS BACK, PERFORM THE CEREMONY, and answer with a verdict carrying none of them.
   *
   * THE SENDER IS CHECKED TWICE AND THAT IS NOT REDUNDANT: here by the same window test as every other
   * channel, and inside the draw module by the webContents the pending phrase belongs to. The first
   * keeps another window off the channel at all; the second means a phrase drawn for one window can
   * never be answered by another, even if the window test were ever loosened.
   *
   * THE DESTINATION AND THE CEREMONY ARE RESOLVED BEFORE THE VERDICT, AND A FAILURE TO RESOLVE IS A
   * REFUSAL RATHER THAN A THROW. `context()` can refuse by name — no `aukora-aumlok` row declares a
   * `config.directory`, or the release carries no organ library — and the screen has to be TOLD that.
   * Letting it throw would land in the catch below and answer a raw message where a name belongs, and
   * answering nothing at all is the silent failure this whole path exists to remove.
   */
  ipcMain.handle(APPROVAL_CHANNELS.SUBMIT, async (event, payload) => {
    if (!fromApplication(event)) return { ok: false, reason: DRAW_REFUSE.FORBIDDEN_SENDER }
    // THE CALLER NAMES THE CEREMONY AND THE WORDS, IN THE FACE'S OWN ORDER. A payload that is not the
    // contracted shape reaches the draw module as `undefined` and is refused by its own name.
    const intent = payload === null || typeof payload !== 'object' ? undefined : payload.intent
    const words = payload !== null && typeof payload === 'object' && Array.isArray(payload.words)
      ? payload.words : null
    // THE HANDLE, AS TYPED, OR NOTHING. A payload that is not the contracted shape reaches the draw
    // module as `undefined` and is refused by the ceremony's own name. AN EMPTY FIELD IS "NOT TYPED"
    // RATHER THAN A MALFORMED HANDLE: on a new machine the ceremony then refuses by name, and on a
    // machine that is already bound the record's own handle is used below.
    const typedHandle = payload !== null && typeof payload === 'object'
      && typeof payload.handle === 'string' && payload.handle.length > 0
      ? payload.handle : undefined
    try {
      const { library, directory } = await context()
      // WHERE THE HANDLE COMES FROM, PER CEREMONY. A BIND carries the handle the person just typed —
      // on a new machine it is the first thing they type. A REFRESH does not ask for it again: the
      // record on disk already publishes it, so it is read from the same public state `state` reads.
      // A machine whose record carries none (or a bind that typed none) passes `undefined` straight
      // through, and the ceremony refuses BY NAME rather than deriving under a different contract.
      const handle = typedHandle ?? readState(library, directory).handle
      // ── THE ROUTING: A DAEMON PRESENT MEANS THIS PROCESS DOES NOT SETTLE ────────────────────────────
      // The check is BEFORE the ceremony, so nothing is drawn, nothing is signed and nothing is written
      // here. The bytes frozen in the daemon are the SAME bytes this handler would have handed the draw
      // (`settleBytesFor` is the one place that serialisation lives), so the owner answers the operation the
      // screen asked for rather than a summary of it.
      const daemon = await ownerDaemonStatusOf()
      // *** AN INSTALLATION THAT IS PRESENT AND DID NOT ANSWER REFUSES HERE, BEFORE THE CEREMONY. ***
      // Falling through to the in-process settle is what an agent gets by making the hello fail, so this
      // branch comes FIRST and writes nothing: no draw, no signature, no file.
      if (daemon?.installed === true && daemon?.reachable !== true) {
        say(`settle refused: an owner daemon is installed and did not answer — ${String(daemon.reason)}`)
        return {
          ok: false, reason: OWNER_DAEMON_UNREACHABLE,
          pending: { phase: 'awaiting-owner', authority: null, ceiling: daemon.ceiling ?? [],
            reason: 'this machine has an owner daemon and it could not be reached, so the shell will not '
              + 'settle in its place. NOTHING WAS WRITTEN. Restore the daemon and ask again.' },
        }
      }
      if (daemon?.installed === true && daemon?.reachable === true) {
        const bytes = settleBytesFor({ intent, words })
        const { operation, scope } = settleOperationOf(intent)
        const frozen = await submitProposal({
          socketPath: daemon.submitSocket,
          bytes, operation, scope,
          ledgerId: typeof handle === 'string' && handle.length > 0 ? handle : 'aumlok-no-handle',
        })
        say(`submit routed to the owner daemon: ${frozen.digest.slice(0, 16)}… awaiting the owner`)
        return {
          ok: false,
          reason: SETTLE_REQUIRES_OWNER_DAEMON,
          pending: {
            phase: 'awaiting-owner',
            nonce: frozen.nonce, digest: frozen.digest,
            operation, scope, ledgerId: typeof handle === 'string' ? handle : null,
            expiresAt: frozen.expiresAt,
            authority: null,
            ceiling: daemon.ceiling ?? [],
            reason: null,
          },
        }
      }
      const verdict = await draw.submit(event.sender, intent, words, { library, directory, handle })
      if (verdict?.ok === true) recordInstallSettings(library, directory)
      return verdict
    } catch (error) {
      say(`submit refused: ${String(error?.message ?? error)}`)
      // A NAME OF OURS, OR A NAME OF OURS. `error.code` is NOT safe to pass through on its own:
      // MEASURED, a plain `TypeError` in modern Node carries `ERR_INVALID_ARG_TYPE`, and putting that
      // on the screen where X1 requires a named refusal is the same class of defect as saying nothing.
      // Only an `aumlok:`-prefixed code is ours; anything else becomes the draw module's own name for a
      // ceremony that could not be performed.
      // **THREE NAMESPACES NOW, AND MISSING THE SECOND ONE FLATTENED A REAL REFUSAL.** MEASURED: with the
      // routing in place and the daemon unreachable, this catch reported `aumlok:ceremony-absent` — because
      // `aukora-owner:submit-unreachable` does not start with `aumlok:` and every name not ours was being
      // replaced. An operator would have read "no ceremony here" when the truth was "the owner daemon did
      // not answer", which is a different fact with a different remedy. The owner daemon's namespace and the
      // routing refusal pass through with their own names.
      const ours = typeof error?.code === 'string'
        && (error.code.startsWith('aumlok:')
          || error.code.startsWith('aukora-owner:')
          || error.code === SETTLE_REQUIRES_OWNER_DAEMON)
      const name = ours ? error.code : DRAW_REFUSE.CEREMONY_ABSENT
      return { ok: false, reason: name }
    }
  })

  ipcMain.handle(APPROVAL_CHANNELS.ASK, (event) => {
    if (!fromApproval(event)) return { ok: false, reason: APPROVAL_REFUSE.FORBIDDEN_SENDER }
    if (pendingQueue.length === 0) return { ok: false, reason: APPROVAL_REFUSE.CANCELLED }
    // THE PUBLIC FACTS, PLUS ONE DERIVED LINE. The identity, the digest and the window are the request's
    // own fields. `words`/`wordsDigest` are the SIGNER'S OWN derivation of the operation's bytes, handed
    // on so a person can read what they are approving — never a summary the requesting side chose, and
    // the page re-checks the digest before displaying the line. THE DIGEST IS STILL THE ONLY THING
    // SIGNED: none of this is inside the preimage and no verifier compares it.
    return Object.freeze({
      ok: true,
      // THE QUEUE, NEWEST FIRST, and each entry carries exactly the three things the view may show: the derived
      // line, its digest and the times. No raw text, no diff: the facts object never held one.
      queue: Object.freeze([...pendingQueue].reverse().map(entry => entry.facts)),
      // AND THE NEWEST FLAT, because a reader that knew only the single-question shape keeps working and reads the
      // question it would have seen before.
      ...pendingQueue[pendingQueue.length - 1].facts,
    })
  })

  ipcMain.handle(APPROVAL_CHANNELS.ANSWER, async (event, payload) => {
    if (!fromApproval(event)) return { ok: false, reason: APPROVAL_REFUSE.FORBIDDEN_SENDER }
    // ── AND THE ANSWER IS NOT AN AUTHORITY EITHER, WHEN A DAEMON IS PRESENT ──────────────────────────
    // A shell boolean was already not an approval; with an owner daemon installed it must not become one by
    // arriving on this channel instead. The person's answer here is NOT submitted as a proposal, because the
    // proposal was already frozen on the SUBMIT path — this refusal exists so that answering the sheet
    // cannot settle anything the daemon never saw. NO FALLBACK, and the same name as the SUBMIT refusal so a
    // screen reports one fact rather than two.
    //
    // **AND IT IS MEASURED, WHICH IT WAS NOT WHEN THIS REFUSAL WAS FIRST WRITTEN.** The gate is
    // `fromApproval`, which needs a live approval sheet — and the harness now OPENS THE REAL ONE through this
    // bridge's own `ask()`, with `deps.headless: true` (the seam that exists so a court can open the real
    // sheet without putting it on a person's screen). So the gate passes because there genuinely IS an
    // approval view and the event genuinely is from it, NOT because the check was stubbed.
    // `tests/aukora-aumlok-bridge-handlers.test.mjs` (e) holds both directions and (d) removes this very
    // block, so the refusal is a red arm rather than a claim.
    const daemonForAnswer = await ownerDaemonStatusOf()
    // AND THE SAME REFUSAL ON THE ANSWER PATH, for the same reason: an unreachable daemon must not hand this
    // handler the authority to answer a question the owner was asked to settle.
    if (daemonForAnswer?.installed === true && daemonForAnswer?.reachable !== true) {
      say(`answer refused: an owner daemon is installed and did not answer — ${String(daemonForAnswer.reason)}`)
      return {
        ok: false, reason: OWNER_DAEMON_UNREACHABLE,
        pending: { phase: 'awaiting-owner', authority: null, ceiling: daemonForAnswer.ceiling ?? [],
          reason: 'this machine has an owner daemon and it could not be reached, so the shell will not '
            + 'answer in its place. NOTHING WAS ANSWERED. Restore the daemon and ask again.' },
      }
    }
    if (daemonForAnswer?.installed === true && daemonForAnswer?.reachable === true) {
      say('answer refused: an owner daemon settles this, not the shell')
      return {
        ok: false, reason: SETTLE_REQUIRES_OWNER_DAEMON,
        pending: { phase: 'awaiting-owner', authority: null, ceiling: daemonForAnswer.ceiling ?? [],
          reason: 'the owner daemon is the authority; answer it there (console or phone)' },
      }
    }
    const answering = payload?.challenge
    if (pendingQueue.length === 0) {
      return { ok: false, reason: `${APPROVAL_REFUSE.CANCELLED}: no question is pending` }
    }
    // THE CHALLENGE IS REQUIRED, NOT TRUSTED, AND NOW IT SELECTS RATHER THAN MERELY MATCHING. A window left open
    // from an earlier question would otherwise answer a later one; naming the challenge is how that is made
    // impossible rather than unlikely, and with a queue it is what keeps the answer bound to ONE named operation.
    // A challenge that names nothing is refused BY NAME and settles nothing — it is not allowed to fall through to
    // whichever question happens to be newest.
    if (!pendingQueue.some(entry => entry.challenge === answering)) {
      return { ok: false, reason: `${APPROVAL_REFUSE.BAD_MODE}: the answer names challenge `
        + `${String(answering)}, and no queued question is that one` }
    }
    // ONLY AN EXPLICIT `true` APPROVES. A truthy value, a missing field or a string is a NO, because
    // the failure this whole path exists to prevent is an approval nobody gave.
    settleAsk(answering, { approve: payload?.approve === true })
    closeApproval()
    return { ok: true, approve: payload?.approve === true }
  })

  return {
    /**
     * Whether a one-bit approval window is open right now.
     *
     * Published for the eye (`apps/aukora-desktop/eye.mjs`), which photographs the app window and must
     * be shut while a question is on screen. It reports this bridge's OWN state rather than letting a
     * caller guess: the window is created and closed here, and nothing outside this module can tell
     * whether one exists.
     * @returns true while the approval window is open.
     */
    isApprovalOpen: () => approval !== null && !approval.webContents.isDestroyed(),
    /**
     * Whether a drawn phrase is in flight, as a BOOLEAN AND NEVER THE PHRASE.
     *
     * Published for the same reason `isApprovalOpen` is — a caller that must not photograph a screen
     * with words on it needs to be able to ask — and it is deliberately the only thing this bridge will
     * ever say about a pending draw.
     * @returns true while a drawn phrase is waiting to be typed back.
     */
    isDrawPending: () => draw.isPending(),
    /** Forget the pending phrase; used when the window that drew it goes away. */
    forgetDraw: () => draw.forget(),
    /**
     * Put ONE operation in front of a person and resolve with their answer.
     *
     * IT NEVER REJECTS AND NEVER APPROVES BY DEFAULT. Every way of not getting an answer — no window to
     * open, a question already on screen, the window closing unanswered — resolves
     * `{approve: false, unavailable}` or `{approve: false}`, and the caller decides which of those is
     * which. `unavailable` is reserved for "nobody could be asked": a person who saw the question and
     * said no is a different fact, and the signer keeps them apart on the wire.
     *
     * NO TIMER LIVES HERE. The wait is bounded by the SIGNER, which polls the request's own `expiresAt`
     * (`owner-signer.mjs`): a second bound in this module would be a second source of truth for when a
     * request ends, and the two would disagree in exactly the case that matters — a person answering as
     * the window closes. This resolves when the person answers or when the window goes away.
     * @param {Readonly<Record<string, unknown>>} request - the signer's request, which NAMES the operation.
     * @returns {Promise<{approve: boolean, unavailable?: boolean}>} the person's answer, or a refusal.
     */
    async ask(request) {
      // ADMITTED BEFORE ANYTHING IS OPENED. A request with no expiry, or one carrying its own summary
      // of the operation, is refused BY NAME HERE — and the refusal is upstream of
      // `openApprovalWindow()`, so there is no window to close and no question on a person's screen.
      const admitted = admitApprovalQuestion(request)
      if (admitted.ok !== true) {
        return Object.freeze({ approve: false, unavailable: true, reason: admitted.reason })
      }
      const { challenge } = admitted
      // ── ONE WINDOW, MANY QUESTIONS ────────────────────────────────────────────────────────────────────────────
      // A window already up is FOCUSED, not refused: the queue is what waits, and the person answers each entry on
      // the one surface. This is the second refusal the goal does not name — `openApprovalWindow()` returns
      // `WINDOW_OPEN` when one exists, and `ask` used to return that verbatim, so removing `ASK_BUSY` alone would
      // have left the queue permanently unable to grow past one. A window that genuinely cannot be opened is still
      // a refusal, reported by name.
      if (approval === null || approval.webContents.isDestroyed()) {
        const opened = openApprovalWindow()
        if (opened.ok !== true) {
          return Object.freeze({ approve: false, unavailable: true, reason: opened.reason })
        }
      } else {
        approval.webContents.focus()
      }
      return new Promise(resolve => {
        // NEWEST LAST IN THE ARRAY, NEWEST FIRST WHEREVER IT IS READ. The facts object is unchanged: the queue
        // carries the same fields the single case carried, so nothing downstream has to learn a new shape.
        pendingQueue.push(Object.freeze({
          challenge,
          facts: Object.freeze({
            challenge,
            subject: String(request.subject ?? ''),
            operationDigest: String(request.operationDigest ?? ''),
            issuedAt: request.issuedAt ?? null,
            expiresAt: admitted.expiresAt,
            // THE SIGNER'S OWN DERIVATION, AND NOTHING ELSE. `words`/`wordsDigest` come from the
            // operation's bytes (`aumlok-signer.mjs`), the page checks the digest before it shows the
            // line, and a caller-supplied description never reaches this object — `admitApprovalQuestion`
            // has already refused one.
            words: admitted.witness === null ? null : admitted.witness.words,
            wordsDigest: admitted.witness === null ? null : admitted.witness.wordsDigest,
            wordsTruncated: admitted.witness !== null && admitted.witness.wordsTruncated === true,
            wordsOmittedChars: admitted.witness === null ? 0 : admitted.witness.wordsOmittedChars,
            // THE CARD, COMPOSED HERE SO THE PAGE RENDERS A LIST AND DECIDES NOTHING.
            fields: approvalCardFields(
              admitted.witness === null ? {} : admitted.witness.fields,
              request.subject,
              admitted.expiresAt,
            ),
          }),
          settle: resolve,
        }))
        // THE WINDOW CAN GO AWAY WITHOUT ANSWERING. Closing it, or a crash, must release EVERY signer waiting on
        // it rather than leave them waiting for a person who is no longer there.
        if (approval !== null && !approval.webContents.isDestroyed()) {
          approval.webContents.once('destroyed', () => settleAllAsks({ approve: false }))
        }
      })
    },
    dispose() {
      settleAsk({ approve: false, unavailable: true })
      closeApproval()
      // THE PHRASE DIES WITH THE BRIDGE, and it is the first thing dropped: a disposed bridge that
      // still held a drawn phrase would be memory nobody owns and nothing can clear.
      draw.forget()
      for (const channel of Object.values(APPROVAL_CHANNELS)) {
        ipcMain.removeHandler(channel)
        ipcMain.removeAllListeners(channel)
      }
    },
    close: closeApproval,
  }
}

/** The disposable controller this build has been running on, beside the real one. */
export const TEST_CONTROLLER_DIRNAME = 'controller'

/**
 * Retire the disposable TEST controller once a real one exists.
 *
 * WHY A RENAME AND NOT A DELETE. The TEST controller is still the thing a standing receipt was minted
 * against, and a deletion would destroy the only copy of a key that something may still be asked to
 * verify against. So it is moved aside under a timestamped name, which is reversible in one command,
 * and the returned path is what the shell logs and the screen reports.
 *
 * IT REFUSES TO MOVE A BOUND DIRECTORY. If any composition overlay names this path as a plugin's
 * `config.directory`, it is not the disposable leftover — it is something the running app reads,
 * and moving it would break a mount to tidy a directory. The check is the same overlay read that
 * resolves the binding destination, so the two cannot disagree about what is bound.
 * @param {{directory: string, patchPaths: readonly string[], now?: () => Date}} input - the bindings.
 * @returns {{retired: boolean, from?: string, to?: string, reason?: string}} what happened.
 */
export function retireTestController({ directory, patchPaths, now } = /** @type {never} */ ({})) {
  const stateRoot = dirname(resolve(directory))
  const candidate = join(stateRoot, TEST_CONTROLLER_DIRNAME)
  if (resolve(candidate) === resolve(directory)) {
    return { retired: false, reason: 'aumlok:retire-would-move-the-controller-in-use' }
  }
  for (const path of patchPaths ?? []) {
    let text
    try {
      text = readFileSync(path, 'utf8')
    } catch {
      continue
    }
    for (const row of readPatchPluginDirectories(text)) {
      if (row.directory !== null && resolve(row.directory) === resolve(candidate)) {
        return { retired: false, reason: `aumlok:retire-directory-is-bound:${path}` }
      }
    }
  }
  if (!existsSync(join(candidate, 'local-control.json'))) {
    return { retired: false, reason: 'aumlok:retire-nothing-to-retire' }
  }
  const stamp = (now ?? (() => new Date()))().toISOString().replace(/[:.]/gu, '-')
  const target = `${candidate}.retired-${stamp}`
  try {
    renameSync(candidate, target)
  } catch (error) {
    return { retired: false, reason: `aumlok:retire-failed:${String(error?.message ?? error)}` }
  }
  return { retired: true, from: candidate, to: target }
}

/** The one file a ceremony leaves behind, and the only durable record of what it did. */
export const BINDING_RECEIPT_FILENAME = 'binding-receipt.json'

/** Domain of that record. Its own domain, so it cannot be mistaken for a controller. */
export const BINDING_RECEIPT_DOMAIN = 'aukora:local-aumlok-binding-receipt:v1'

/**
 * Write the binding receipt: what it did, in public facts, and nothing else.
 *
 * WHY THIS EXISTS. A binding wrote the controller record and then told the window what had happened —
 * and when the window closed, the answer was gone. Nothing durable recorded whether the disposable
 * controller had actually been retired, or why it had not, so the only way to know was to have been
 * watching at the time. A receipt makes the outcome readable afterwards, by a person or by a report,
 * without anyone having to re-run anything.
 *
 * WHAT IT MAY CONTAIN, WHICH IS THE WHOLE CONSTRAINT: the state, the public commitment, the
 * retirement outcome and its reason, and a timestamp. It carries NO PHRASE, NO SEED AND NO KEY — not
 * the Ed25519 private half, not the ML-DSA-65 secret half, not the seven words they were derived
 * from. The `subject` and `approvalKeyId` here are the same public identifiers the screen prints, and
 * a court asserts the file contains no private material after a real binding.
 *
 * A REFUSAL IS RECORDED TOO, with its reason and its detail. "It said no" is a fact worth keeping,
 * and a receipt that only existed on success would make a refusal indistinguishable from a binding
 * nobody ran.
 * @param {object} input - the outcome to record.
 * @returns {string} the path written.
 */
export function writeBindingReceipt({ directory, mode, at, outcome } = /** @type {never} */ ({})) {
  const record = {
    domain: BINDING_RECEIPT_DOMAIN,
    // THE MODE IS CARRIED AS ITSELF. It used to collapse to one of two names, so a receipt for one
    // ceremony could have been filed as another — a durable record that says the wrong thing ran,
    // which is worse than no record because it is believed. A mode this module does not know is
    // recorded as what it was rather than defaulted: a receipt's job is to say what happened, and
    // "bind" is not a safe guess about a ceremony nobody ran.
    mode: typeof mode === 'string' && mode.length > 0 ? mode : 'bind',
    at: (at ?? (() => new Date()))().toISOString(),
    directory: resolve(directory),
    ok: outcome?.ok === true,
  }
  if (outcome?.ok === true) {
    if (outcome.subject !== undefined) record.subject = outcome.subject
    if (outcome.approvalKeyId !== undefined) record.approvalKeyId = outcome.approvalKeyId
    if (outcome.custodyClass !== undefined) record.custodyClass = outcome.custodyClass
    if (outcome.epoch !== undefined) record.epoch = outcome.epoch
    record.retiredTestController = outcome.retiredTestController ?? null
    record.retirementReason = outcome.retiredTestController === null
      ? (outcome.retirementReason ?? null) : null
  } else {
    record.reason = outcome?.reason ?? null
    record.detail = outcome?.detail ?? null
  }
  const path = join(resolve(directory), BINDING_RECEIPT_FILENAME)
  mkdirSync(resolve(directory), { recursive: true, mode: 0o700 })
  writeFileSync(path, `${JSON.stringify(record, null, 2)}\n`, { mode: 0o600 })
  return path
}
