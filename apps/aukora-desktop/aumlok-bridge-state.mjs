// Moved whole from aumlok-bridge.mjs (2026-09-27) with no line of it rewritten, so that no file of the approval
// bridge passes the self-change loop's 64 KiB limit. aumlok-bridge.mjs re-exports every name exported here; where
// a comment below says "this file" or "this module", it means the bridge the code was written in.
import { dirname, join, resolve } from 'node:path'
import { readFileSync, existsSync, mkdirSync, renameSync, writeFileSync } from 'node:fs'
import { pathToFileURL } from 'node:url'
import { APPROVAL_FIELD_ORDER, APPROVAL_FIELD_NOT_STATED } from './aumlok-signer.mjs'
import { readOwnerDaemonConfig } from './aumlok-airlock-config.mjs'

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
    const inner = value.slice(1, -1)
    return first === "'" ? inner.replaceAll("''", "'") : inner
  }
  return value
}

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
 * @param {object} [options] - optional config location and ownership for an isolated check.
 * @returns {Readonly<{bound: boolean, reason?: string, subject?: string, handle?: string}>} the state.
 */
export function readBindingState(library, directory, options = {}) {
  if (directory === null) return Object.freeze({ bound: false, reason: 'aumlok:adapter-unbound' })
  if (!existsSync(join(directory, 'local-control.json'))) {
    return Object.freeze({ bound: false, reason: 'aumlok:controller-absent' })
  }
  try {
    // Configured custody selects the protected public pin without reading the old local seed.
    // A refresh retires that old key, so consulting it here would make the bound airlock read unbound.
    const owner = readOwnerDaemonConfig(options.ownerDaemonConfigPath, options.ownerDaemonConfigUid)
    const machinePublicKeyHex = owner === null
      ? keptMachinePublicKeyOf(library, directory) : owner.ownerPublicKeyHex
    const projection = library
      .loadLocalAumlokPublicControl(directory, undefined, machinePublicKeyHex)
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
