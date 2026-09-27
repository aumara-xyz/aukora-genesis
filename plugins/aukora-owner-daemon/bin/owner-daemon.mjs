#!/usr/bin/env node
/**
 * THE OWNER DAEMON — runs as `aukora-owner`, holds the key, and is the ONLY thing that settles.
 *
 * IT RUNS AS ANY UID, AND ITS ROLE COMES FROM ITS CONFIG. That is deliberate: the whole two-principal cut
 * is testable as one uid, so the daemon must not depend on BEING the owner — it must depend on where its
 * directories and sockets are, and on the modes it finds there. The LaunchDaemon's `UserName=aukora-owner`
 * is what makes it the owner in production; nothing in this process asks who it is.
 *
 * WHAT IT REFUSES TO START WITHOUT, AND WHY EACH ONE IS A REFUSAL RATHER THAN A WARNING:
 *   * its OWN directory (keys, journal, witness) at `0700`, owned by the running uid, not a symlink;
 *   * its key file at `0600` when present;
 *   * NO WORLD-WRITABLE ANCESTOR of the owner directory — a writable ancestor is a rename waiting to
 *     happen, and every mode below it becomes decoration;
 *   * the run directory and both sockets where the config says.
 * A daemon that started anyway and said so in a log line would be a daemon whose log nobody reads.
 *
 * WHAT IT DOES **NOT** DO YET — A NAMED CEILING, NOT AN OVERSIGHT (CODEX R5 ITEM E, DEFERRED):
 *   * **PENDING PROPOSALS DO NOT SURVIVE A RESTART.** The store is IN MEMORY AND PER DAEMON, so a restart
 *     empties it. A proposal frozen and not yet approved is GONE, and the agent must resubmit it.
 *   * **THE LOSS IS SAFE, AND THAT IS WHY IT IS ACCEPTABLE FOR NOW: NOTHING IS APPROVED OR CONSUMED BY IT.**
 *     No approval existed, no effect ran, no nonce was spent — **the worst outcome is that the owner is asked
 *     again about work nobody had decided yet.** What is NOT lost is anything that WAS decided: a settled
 *     nonce lives in the journal and is recovered through `result <nonce>` on the approve socket.
 *   * **THE MATERIAL TO RESTORE THEM IS NOW ON DISK.** The journal records the complete frozen proposal —
 *     bytes, scope, expiry and freeze instant — so rebuilding the store at startup is a bounded change rather
 *     than a redesign. **It is deferred because it is work, not because it is unknown.**
 *
 * THE KEY IS ITS OWN, GENERATED HERE, AND NEVER IMPORTED. `codex-uid-design.md:15` is explicit that Peter's
 * real Aumlok root is not imported into Genesis; this daemon makes a fresh Ed25519 key inside its own 0700
 * directory, disposable and scoped, which is what proves the isolation without risking an identity.
 *
 * TWO SOCKETS, AND THE ROLE IS WHICH ONE ACCEPTED. `submit.sock` lives in the run directory the submit
 * group can traverse; `approve.sock` lives in `run/owner/` at `0700`, so an agent-uid connect fails in the
 * KERNEL before this process sees anything (measured: `tests/aukora-owner-ingress.test.mjs`). Nothing here
 * reads a claimed uid, and nothing here could: there is no field to read.
 *
 * ONE JSON LINE IN, ONE JSON LINE OUT, on both sockets. `{op: …}` dispatches; refusals carry a name.
 */
import { assertNoDuplicateKeys } from '../../aukora-kira/lib/strict-read.mjs'

import { generateKeyPairSync, randomBytes } from 'node:crypto'
import { spawnSync } from 'node:child_process'
import { chmodSync, existsSync, lstatSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { settleAuthorisedProposal } from '../lib/settle-adapter.mjs'
import { isMainModule } from '../lib/is-main.mjs'

const HERE = fileURLToPath(new URL('.', import.meta.url))
const binding = await import(pathToFileURL(join(HERE, '..', 'lib', 'binding.mjs')).href)
// THE DISPATCH TABLE, keyed by the CANONICAL OPERATIONS — imported, never re-spelled here.
const { effectFor, assertDispatchable, assertScopeInStore, EFFECTS, DISPATCH_REFUSE } = await import(
  pathToFileURL(join(HERE, '..', 'lib', 'dispatch.mjs')).href)
// **`OPERATIONS` IS TAKEN FROM HERE TOO, AND ITS ABSENCE WAS INVISIBLE.** MEASURED: a check added below
// used it without importing it, so the submit path threw `ReferenceError: OPERATIONS is not defined` —
// **and the catch turned that into `proposal-malformed`, a name four different checks throw.** Every
// submit was refused, the court that noticed reported a malformed request, and nothing in the reply said
// a NAME was missing from this line. **An undefined error code is somebody else's failure wearing this
// one's name**, and it is the second time this session that shape has hidden a one-word mistake.
const { OPERATIONS, SCOPE_KINDS } = await import(pathToFileURL(join(HERE, '..', 'lib', 'operations.mjs')).href)
// **THE REPOSITORY THE ADVANCE MOVES.** `HERE` is this file's directory — `plugins/aukora-owner-daemon/bin` — so the
// root is three levels up. *An effect that pushed from whatever the process's cwd happened to be would move a
// different repository depending on how the daemon was started.*
const REPO_ROOT = resolve(HERE, '..', '..', '..')
// THE BOUNDED LISTENER, WITH THE LIMITS IN ONE PLACE.
const { serveBounded, createProcessor, LIMITS } = await import(
  pathToFileURL(join(HERE, '..', 'lib', 'listener.mjs')).href)
// THE ONE BOUNDARY IMPLEMENTATION. Every startup check below delegates to it.
const boundary = await import(pathToFileURL(join(HERE, '..', 'lib', 'boundary.mjs')).href)
// THE WRITE-AHEAD JOURNAL. Its states are written BEFORE the step they guard, which is the whole of P1 #5.
const journalModule = await import(pathToFileURL(join(HERE, '..', 'lib', 'journal.mjs')).href)
const { JOURNAL_STATE, JOURNAL_REFUSE } = journalModule
const { OWNER_REFUSE, ownerRefusal, freezeProposal, freezeAdmissionEnvelope, envelopeOf,
  ADMISSION_ENVELOPE_VERSION, ADMISSION_KINDS, createProposalStore, authoriseSettlement,
  assertEnvelope, canonicalEnvelope, assertOperationNamesTheEnvelopeKind } = binding
// BETA'S VERIFIER IS THE CONTRACT for a relayed approval — BIP-340 Schnorr, the kind-30333 tags, the
// sentence check, the window and the pin are all his, and a second implementation of a signature check is a
// second place for it to be wrong.
const phone = await import(pathToFileURL(join(HERE, '..', '..', 'aukora-nostr', 'lib', 'phone-approval.mjs')).href)
// BETA'S ADMISSION GRANT IS HIS FORMAT AND HIS PREIMAGE, so the daemon SIGNS with his function rather than
// re-spelling the line order. A second spelling of one preimage is a signature that does not verify.
const grant = await import(pathToFileURL(join(HERE, '..', '..', 'aukora-composition-gate', 'src', 'admission-grant.mjs')).href)

/** The config keys this daemon requires, and there are no defaults for the paths: a default is a guess. */
export const REQUIRED_CONFIG = Object.freeze([
  'ownerDir', 'runDir', 'submitSocket', 'approveSocket', 'keyFile',
])

/** One named refusal for a startup that must not happen. */
const refuseStart = (code, message) => { throw ownerRefusal(code, message) }

// ── THE STARTUP BOUNDARY IS `lib/boundary.mjs`, AND THESE ARE DELEGATES RATHER THAN COPIES ─────────────
//
// **CODEX P1 #3 LANDED AS A MODULE AND WAS NEVER WIRED, so the daemon kept its own three checks and the module
// was a second implementation nobody ran.** Two implementations of a boundary is the shape this repository
// keeps paying for: they agree until one is edited, and the one that is edited is never the one under test.
//
// **THE DAEMON'S OWN BODIES ARE DELETED, NOT KEPT BESIDE THE CALLS** — what remains is the name each caller
// already used, delegating to the single implementation. And the deleted versions were WEAKER in ways worth
// naming: their ancestor walk looked only for world-write, so an ancestor owned by a THIRD PRINCIPAL, or one
// carrying a write ACE that `ls -ld` does not show, passed both of them. The submit group may TRAVERSE the run
// directory (`0750`) and may not write it; the owner directory is `0700`, and the approve directory with it.
export const assertPrivateDirectory = (path, label) =>
  boundary.assertPrivateDirectory(path, label, boundary.systemHost)

export const assertRunDirectory = (path, label) => {
  const absolute = resolve(path)
  if (!existsSync(absolute)) {
    refuseStart(OWNER_REFUSE.OWNER_DIR_ABSENT, `${label} does not exist: ${absolute}`)
  }
  const state = lstatSync(absolute)
  if (state.isSymbolicLink() || !state.isDirectory()) {
    refuseStart(OWNER_REFUSE.OWNER_DIR_INSECURE, `${label} is not a directory: ${absolute}`)
  }
  if (state.uid !== process.getuid()) {
    refuseStart(OWNER_REFUSE.OWNER_DIR_INSECURE, `${label} is owned by uid ${String(state.uid)}`)
  }
  boundary.assertRunBoundary(absolute, boundary.systemHost)
  boundary.assertTrustedAncestors(absolute, boundary.systemHost)
  return absolute
}

export const assertPrivateFile = (path, label) => boundary.assertPrivateFile(path, label, boundary.systemHost)

/**
 * Start the daemon. Returns the servers and a `close`, so a court can run it in-process on real sockets.
 * @param {Readonly<Record<string, string>>} config - the resolved config.
 * @param {{log?: (line: string) => void, ask?: Function}} [options]
 */
export async function startOwnerDaemon(config, options = {}) {
  const log = options.log ?? (line => { process.stdout.write(`${line}\n`) })
  for (const key of REQUIRED_CONFIG) {
    if (typeof config?.[key] !== 'string' || config[key].length === 0) {
      refuseStart(OWNER_REFUSE.PROPOSAL_MALFORMED, `the config must name its ${key}, and there are no defaults`)
    }
  }
  const ownerDir = assertPrivateDirectory(config.ownerDir, 'the owner directory')
  // ── THE KEY MUST BE INSIDE THE OWNER DIRECTORY, AND NOTHING BELOW IS WORTH ANYTHING IF IT IS NOT ────
  //
  // **MEASURED (R15/R7): `assertKeyBoundary` EXISTED AND THE DAEMON NEVER CALLED IT.** A `keyFile` outside
  // `ownerDir` was accepted, so the one file whose compromise is total sat somewhere the owner directory's
  // `0700` does not protect — and the boundary court had an arm for it that was one of the four never awaited.
  // It runs FIRST, before the key is read, written, or even looked for: **containment is a property of the
  // configuration, so it is checked before the configuration is used.**
  // **THE RETURN VALUE IS THE VALIDATED PATH, AND DISCARDING IT WAS THE WHOLE DEFECT (CODEX R7 ITEM 1, P1).**
  //
  // MEASURED: this call returned the RESOLVED, NORMALIZED, VALIDATED path — and the daemon threw it away and
  // then read and wrote `config.keyFile`, THE RAW CONFIG STRING. **A path can be validated as one thing and used
  // as another**, and the difference is exactly what a symlink or a `..` puts between them: the check follows
  // the string it was given, and every later operation re-follows it on its own.
  //
  // **SO THE VALIDATED VALUE IS CAPTURED AND IS THE ONLY KEY PATH THIS PROCESS USES FROM HERE ON.** Not a
  // second `resolve` of the same config string — that is a second answer to a question already answered — but
  // the exact value the boundary returned.
  const keyFile = boundary.assertKeyBoundary({
    keyFile: config.keyFile, ownerDir, uid: process.getuid(), aclsOf: boundary.aclEntries,
  })
  // THE RUN DIRECTORY IS SHARED AND THE APPROVE DIRECTORY IS NOT — see `assertRunDirectory`.
  // **BOUND, NOT JUST CHECKED.** The published key goes here (R5) and the path used for it must be the one
  // that was VALIDATED rather than a second resolution of the same config string that could differ.
  const runDir = assertRunDirectory(config.runDir, 'the run directory')
  // THE APPROVE DIRECTORY IS THE BOUNDARY, so it is checked before anything listens on it.
  const approveDir = dirname(resolve(config.approveSocket))
  assertPrivateDirectory(approveDir, 'the approve directory')

  // ── AND THE SOCKETS MUST LIVE IN THE DIRECTORIES THAT WERE JUST VALIDATED (CODEX R4 ITEM 6) ──────
  //
  // **MEASURED: `runDir` WAS CHECKED AND `submitSocket` WAS NOT BOUND TO IT.** The daemon validated one path
  // and then listened on another taken from its own config string, so a `submitSocket` pointing anywhere —
  // `/tmp/submit.sock`, or a directory nobody inspected — passed every rule in this file. **The validation was
  // of a directory the socket need not be in**, which is a check that reads as covering the socket and does not.
  //
  // Both sockets are bound, not just the submit one: **the approve directory is the owner boundary, and an
  // `approveSocket` elsewhere would put the owner's own door outside the `0700` that was verified.** A config
  // that fails this is refused at startup, before anything listens.
  // **AND THE VALIDATED PATH IS THE ONE BOUND, NOT THE CONFIG STRING (CODEX R7 ITEM 2).** The loop below
  // resolves each socket to compare its parent against the directory that was checked, and then the LISTENERS
  // were handed `config.submitSocket` and `config.approveSocket` — the raw strings. **Same defect as the key
  // path: a value is validated and a different spelling of it is used.** The difference is what a symlink or a
  // `..` puts between them, and the fix is the same — **capture what was validated and use that exact value.**
  const socketPaths = Object.freeze({
    submitSocket: resolve(config.submitSocket),
    approveSocket: resolve(config.approveSocket),
  })
  for (const [socketPath, expectedDir, what] of [
    [socketPaths.submitSocket, runDir, 'submitSocket'],
    [socketPaths.approveSocket, approveDir, 'approveSocket'],
  ]) {
    const parent = dirname(socketPath)
    if (parent !== expectedDir) {
      refuseStart(OWNER_REFUSE.OWNER_DIR_INSECURE,
        `${what} is ${resolve(socketPath)}, whose parent is ${parent} — and the directory this daemon `
        + `validated is ${expectedDir}. A socket outside the directory that was checked is not covered by `
        + 'anything this daemon verified about it')
    }
    // **AND THE PARENT IS RE-CHECKED ON THE HANDLE'S OWN PATH, NOT ONLY LEXICALLY.** `dirname(resolve(...))` is
    // a LEXICAL answer: it does not follow links, so a parent that IS a symlink to somewhere else compares equal
    // and binds elsewhere. **The directory this daemon certified must be the directory the socket is created
    // in**, and `lstat` on that parent is what says so — the same refusal the key boundary uses for the same
    // reason.
    let parentState = null
    try { parentState = lstatSync(parent) } catch (cause) {
      refuseStart(OWNER_REFUSE.OWNER_DIR_INSECURE,
        `${what}'s parent ${parent} could not be examined: ${String(cause?.code ?? cause)}`)
    }
    if (parentState.isSymbolicLink()) {
      refuseStart(OWNER_REFUSE.OWNER_DIR_INSECURE,
        `${what}'s parent ${parent} is a SYMLINK. Lexical validation compares equal and the socket is created `
        + 'wherever the link points, so the directory that was certified is not the directory that is used')
    }
  }

  // ── KEY CUSTODY ────────────────────────────────────────────────────────────────────────────────
  // A KIRA STORE WITHOUT A LEDGER ID CANNOT BE CHECKED AGAINST ANYTHING, so it is refused at STARTUP rather
  // than at the first settlement. **THE FAIL-OPEN WAS POSSIBLE BECAUSE NOTHING NAMED THE STORE'S OWN LEDGER**:
  // with no configured id, the only ledger in the room was the one inside the proposal, which is the thing
  // being checked. A daemon that will write to a Kira store must be told WHICH ledger that store is.
  if (typeof config.kiraStoreDir === 'string' && config.kiraStoreDir !== ''
    && (typeof config.kiraLedgerId !== 'string' || config.kiraLedgerId === '')) {
    refuseStart(OWNER_REFUSE.KIRA_LEDGER_NOT_CONFIGURED,
      'kiraStoreDir is set and kiraLedgerId is not, so a settlement could only be checked against the ledger '
      + 'the PROPOSAL names — which is the fail-open this daemon refuses to start with')
  }
  // ── THE JOURNAL, AND THE RECOVERY A RESTART OWES ─────────────────────────────────────────────────────
  //
  // **THE CRASH HOOK IS REFUSED UNLESS A COURT ASKED FOR IT.** `crashHook` throws when `AUKORA_OWNER_CRASH_AT`
  // is set without `AUKORA_OWNER_COURTS=1`, and that throw happens HERE — so a production configuration carrying
  // the hook refuses to start rather than running with it silently ignored. **A hook that is silently dropped
  // leaves the operator believing the daemon is normal and the court believing it is measuring.**
  let crashAt = () => {}
  try { crashAt = journalModule.crashHook(process.env) } catch (error) {
    refuseStart(error?.code ?? JOURNAL_REFUSE.CRASH_HOOK_REFUSED, String(error?.message ?? error))
  }
  const journal = journalModule.createJournal({ ownerDir, crashAt, log })
  {
    const swept = journal.sweepTemporaries()
    if (swept > 0) log(`journal: removed ${String(swept)} temporary file(s) a crashed run left behind`)
    const plan = journal.plan()
    for (const entry of plan.receiptsOwed) {
      // THE EFFECT LANDED AND ONLY THE RECORD WAS UNFINISHED. Finishing it is idempotent, so a restart may do
      // it — and must, or a settled memory reads as an unfinished one forever.
      finishRecord(entry.nonce)
      log(`journal: finished the record for ${String(entry.nonce).slice(0, 12)}… (the effect had landed)`)
    }
    // **A CRASH AT `receipt-written` LEFT THE RECORD ONE IDEMPOTENT STEP FROM DONE, AND NOTHING FINISHED IT.**
    // MEASURED by the kill court: the memory was written, the receipt existed, and the journal stayed at
    // `receipt-written` for ever — so `spent` stopped meaning "finished" and every later reader had to know
    // that two states both mean done. `plan()` says what is OWED; finishing the last step is this daemon's job.
    // ── **STARTUP STREAMS, BECAUSE `entries()` BUILT THE WHOLE HISTORY TO FIND THESE (CODEX R13b)** ──────
    //
    // MEASURED: this loop was `for (const entry of journal.entries())`, and **`entries()` reads every record
    // and sorts the lot** — so the daemon's own STARTUP held an array of every settlement the owner had ever
    // made, before it could finish the handful that were one step from done. **The journal's iterator was
    // streamed by then; THIS call site was not, and it is the one that runs on every boot.**
    //
    // **`eachRecord()` IS THE SAME SET IN THE SAME ORDER**, one record at a time, so the loop is unchanged in
    // meaning and bounded in memory. **`plan()` cannot replace it:** `plan()` counts a `receipt-written` record
    // as COMPLETE (its receipt exists, and two states both mean done), so those records are deliberately NOT in
    // `receiptsOwed` — and this loop exists to advance them the last idempotent step so `spent` keeps meaning
    // finished. **A set that is reported as complete and a set that still wants a write are different sets.**
    for (const entry of journal.eachRecord()) {
      if (entry.state === JOURNAL_STATE.RECEIPT_WRITTEN) {
        finishRecord(entry.nonce)
        log(`journal: advanced ${String(entry.nonce).slice(0, 12)}… to spent (its receipt already existed)`)
      }
    }
    for (const entry of plan.uncertain) {
      // **REPORTED, NEVER RETRIED.** The effect may or may not have landed, and only a person can decide.
      log(`journal: UNCERTAIN EFFECT ${JOURNAL_REFUSE.EFFECT_UNCERTAIN} for `
        + `${String(entry.nonce).slice(0, 12)}… began at ${String(entry.at)} — it is reported and NOT re-run`)
    }
  }
  const existing = assertPrivateFile(keyFile, 'the owner key')
  let keyPair
  if (existing === null) {
    keyPair = generateKeyPairSync('ed25519')
    const pkcs8 = keyPair.privateKey.export({ type: 'pkcs8', format: 'der' })
    // ── THE OWNER KEY IS CREATED THE WAY THE BOUNDARY MODULE SAYS, NOT WITH A PLAIN WRITE ────────────
    //
    // **MEASURED BY THE KILL COURT, AND IT LOCKS THE OWNER OUT PERMANENTLY.** `writeFileSync` neither fsyncs
    // nor refuses an existing path, so a crash (or a power loss) between the create and the flush leaves a
    // TRUNCATED key file — and the next start reads it and dies with
    // `asn1 encoding routines::not enough data`. **The daemon has no way back from that**: the key it needs to
    // read is the key it failed to finish writing, and there is no second copy.
    //
    // `boundary.createBoundaryFile` is the one implementation of "create this file safely": `O_EXCL|O_NOFOLLOW`
    // so it can neither overwrite nor follow a link, `fchmod` on the HANDLE rather than the path, and an
    // fsync before it returns. **It existed the whole time and the key — the one file where a torn write is
    // unrecoverable — was the file not using it.**
    boundary.createBoundaryFile(keyFile, pkcs8)
    log(`owner key GENERATED inside ${ownerDir} (0700), 0600, and this process never logs it`)
  } else {
    // A key that exists is READ, never replaced — a daemon that silently rotated its key on a bad mode
    // would turn a permissions problem into an identity change.
    // ── THE KEY IS READ FROM THE FILE, NOT FROM ITS NAME ─────────────────────────────────────────────
    //
    // **A REGRESSION MY OWN BOUNDARY WIRING INTRODUCED, AND ONLY A RESTART COULD SEE IT.** `assertPrivateFile`
    // returns the PATH; the daemon's old version returned the CONTENTS. So `createPrivateKey({ key: existing })`
    // was handed a filename where it expected DER — `asn1 encoding routines::not enough data`.
    //
    // **EVERY OTHER COURT GENERATES A FRESH KEY AND TAKES THE `existing === null` BRANCH**, so the else branch
    // — the one a real daemon takes on EVERY start after its first — was never executed by any of them. The
    // kill court reached it because a restart is exactly what it does.
    //
    // `readBoundaryFile` is the boundary module's reader: it refuses a symlink rather than following it, which
    // is the same rule the creation side enforces.
    const { createPrivateKey } = await import('node:crypto')
    keyPair = { privateKey: createPrivateKey({ key: boundary.readBoundaryFile(keyFile),
      format: 'der', type: 'pkcs8' }) }
    log('owner key READ from its 0600 file')
  }
  const publicKeyHex = (await import('node:crypto')).createPublicKey(keyPair.privateKey)
    .export({ type: 'spki', format: 'der' }).subarray(-32).toString('hex')

  // THE PUBLIC HALF IS RECORDED BESIDE THE PRIVATE ONE, so an installer can pin it and a caller can verify
  // the daemon's hello. It is public by definition and world-readable on purpose: `0644`, while the private
  // half stays `0600` in the same directory the caller cannot enter.
  // ── THE PRIVATE RECORD, INSIDE THE OWNER DIRECTORY ──────────────────────────────────────────────
  const pubFile = join(ownerDir, 'owner.pub')
  writeFileSync(pubFile, `${publicKeyHex}\n`, { mode: 0o644 })
  chmodSync(pubFile, 0o644)
  // ── AND THE PUBLISHED ONE, WHERE THE AGENT CAN READ IT AND CANNOT WRITE IT (R5) ─────────────────
  //
  // **THE AGENT COULD NEVER READ THE ONE ABOVE.** `ownerDir` is `0700`, so the app — running as the AGENT uid
  // — cannot traverse to `owner.pub` however the FILE is moded, `detect.mjs` answered `absent` on every real
  // install, and the app settled in-process: **the exact claim this daemon exists to retire.**
  //
  // **THE RUN DIRECTORY IS ALREADY THE BOUNDARY.** It is `0750` — the submit group traverses it and may not
  // write it, and this daemon refuses a group-writable one outright — and `submit.sock` lives there. So the
  // published key sits beside the socket the agent already reaches, at `0640`: **readable by the principal
  // that must verify this daemon, unwritable by the principal that must not be able to impersonate it.**
  const publishedPub = join(runDir, 'owner.pub')
  boundary.publishBoundaryFile(publishedPub, `${publicKeyHex}\n`)
  log(`public key published at ${publishedPub} (0640, read-only to the submit group)`)

  /** The console prints this; the field is here so `--print-config` reports what the detector will read. */
  const publishedPubFile = publishedPub

  const store = createProposalStore()
  // ── THE LISTING IS BOUNDED BY THE STORE, WHICH IS THE ONLY THING THAT CAN BOUND IT ──────────────
  //
  // **CODEX ITEM 4.** `asked` was an array that grew FOREVER — one entry per submit — and the console's
  // listing mapped EVERY entry. So a daemon that ran long enough leaked, and a submit flood grew the reply
  // until the owner's terminal was unusable and the daemon's heap with it. **The store beside it has real
  // limits (pending count and bytes); this list shadowed that state WITHOUT them.**
  //
  // **THE BOUND IS THE STORE'S OWN, RATHER THAN A SECOND NUMBER TO KEEP IN STEP.** An entry is kept exactly
  // while `store.byNonce` still holds its proposal — which is what the listing READS for the frozen bytes, so
  // an entry the store has dropped was already printing EMPTY BYTES. **A number chosen here would be a second
  // limit that could drift from the first; asking the store cannot.**
  const asked = []
  /**
   * DROP THE ENTRIES THE STORE HAS RELEASED, AND COUNT WHAT WAS DROPPED.
   *
   * **THE CALLER MUST HAVE SWEPT FIRST, AND THE ORDER IS THE WHOLE OF IT.** MEASURED: I first put this on the
   * SUBMIT path on its own, where it was **dead code that looks like a bound** — the store releases terminal
   * entries only when `sweep` runs, so a prune that asks its question before the release happens answers
   * "everything is still here" for ever while the code reads as though it cannot.
   */
  const keepTheListingsTheStoreCanStillExplain = () => {
    let dropped = 0
    for (let index = asked.length - 1; index >= 0; index -= 1) {
      if (store.byNonce(asked[index].nonce) === null) { asked.splice(index, 1); dropped += 1 }
    }
    return dropped
  }

  /**
   * RELEASE WHAT THE STORE HAS LET GO AND FORGET THE LISTINGS FOR IT — **WHEREVER THE LISTING GROWS OR IS
   * READ, NOT ONLY WHERE IT IS READ.**
   *
   * **MEASURED GAP IN MY FIRST VERSION (CODEX ITEM 4):** the sweep and the prune ran on `list` alone, so a
   * daemon that received SUBMITS AND NO `list` REQUESTS accumulated one entry per submit for ever — **each
   * holding a copy of the frozen bytes** — while the store beside it stayed inside its own limits. **The bound
   * was on the reader rather than on the writer, and the writer is the one that grows.**
   *
   * A SUBMIT IS ALSO A MOMENT THE TRUTH MATTERS. The store refuses past its pending count and byte bound, and
   * both are computed from what is still pending — so expiring the ones whose deadline passed BEFORE that
   * decision is asked is the same reasoning the list path already gives: **a question answered over stale state
   * is answered wrongly, whoever is asking.** And a timer is still not the answer, for the reason recorded on
   * the list path: it is one more thing a flooded event loop can starve.
   */
  const releaseAndForget = () => {
    const swept = store.sweep(Math.floor(Date.now() / 1000))
    const forgotten = keepTheListingsTheStoreCanStillExplain()
    if (swept.expired > 0 || swept.dropped > 0 || forgotten > 0) {
      log(`swept ${String(swept.expired)} expired, ${String(swept.dropped)} past-retention proposal(s), and `
        + `released ${String(forgotten)} listing entr(ies)`)
    }
    return swept
  }
  // THE PIN LIVES IN THE OWNER'S OWN DIRECTORY AT 0600, and is written ONLY by an owner-socket request.
  const pinFile = join(ownerDir, 'phone-pin.json')
  const readPin = () => {
    // **ONE LOOKUP (AUMLOK-92 ITEM 3).** MEASURED: this did `existsSync`, then `assertPrivateFile` — which
    // `lstat`s the path ITSELF — then `readFileSync`: **THREE lookups of one name**, so the privacy check and
    // the bytes could describe different files. `readBoundaryFile` opens once and hands the caller the
    // `fstat` of the descriptor it is about to read, so the ownership and mode check is about the same file
    // as the bytes.
    let bytes
    try {
      bytes = boundary.readBoundaryFile(pinFile, {
        checkHandle: (state) => boundary.assertPrivateHandle(state, pinFile, 'the phone pin'),
      })
    } catch (cause) {
      // A pin that is not there is not an error; the daemon simply has none. Everything else is real.
      if (cause?.code === 'ENOENT') return null
      throw cause
    }
    const pin = JSON.parse(bytes.toString('utf8'))
    return typeof pin?.pubkey === 'string' && /^[0-9a-f]{64}$/u.test(pin.pubkey) ? pin : null
  }
  if (existsSync(pinFile)) log(`phone pin read: ${String(readPin()?.pubkey).slice(0, 16)}…`)
  const say = reply => JSON.stringify(reply)

  /** One request, one reply. THE ROLE IS THE LISTENER, and it is passed in rather than inferred. */
  /**
   * THE JOIN, ONCE, FOR EVERY AUTHORITY. Kira's write happens AFTER `authoriseSettlement` consumed the
   * approval and never before it, and it reads the DAEMON'S frozen bytes rather than anything the submitter
   * said. Extracted from the console branch when the phone path was added: a second authority that settled
   * without writing would have broken "one approval, one memory write" while the console kept it.
   * @param {Readonly<Record<string, unknown>>} proposal - the frozen proposal, already consumed.
   * @returns {object|null} Kira's receipt, or null when no Kira store is configured.
   */
  const writeToKira = proposal => {
    // **A MEMORY SETTLEMENT MUST NEVER REPORT SUCCESS WITH NOWHERE TO WRITE (CODEX R4, NEW P1).**
    //
    // This returned `null` when no store was configured, and the caller went on to answer
    // `{ ok: true, settled: true, kira: null }` — **so the owner approved a memory write, the daemon said it
    // settled, and NOTHING WAS WRITTEN.** The approval was consumed. **A SUCCESS REPORT FOR AN ACT THAT DID
    // NOT HAPPEN IS THE WORST ANSWER THIS DAEMON CAN GIVE**, because every other check in the system is built
    // on `settled` meaning settled: the journal says so, the console says so, and the owner stops expecting to
    // do it again.
    //
    // THIS FUNCTION IS REACHED ONLY ON THE KIRA-SETTLE BRANCH — the admission branch returns before it — so
    // there is no operation for which `null` was the right answer here.
    if (typeof config.kiraStoreDir !== 'string' || config.kiraStoreDir === '') {
      refuseStart(OWNER_REFUSE.KIRA_STORE_NOT_CONFIGURED,
        'this daemon has no Kira store configured, so a memory settlement has nowhere to write. The approval '
        + 'is NOT consumed and nothing is recorded: reporting a settlement that did not happen would leave the '
        + 'owner believing a record exists')
    }
    const kira = settleAuthorisedProposal(proposal, {
      storeDir: config.kiraStoreDir,
      // ── THE STORE THIS DAEMON WAS CONFIGURED WITH, NAMED BY THE DAEMON RATHER THAN BY THE PROPOSAL ────
      // **KIRA FOUND A FAIL-OPEN, AND THIS IS MY HALF OF IT.** The adapter compared the proposal's scope
      // against **the proposal's own `ledgerId`** — so a proposal naming ANY ledger passed, against whatever
      // store happened to be configured. `kirastore:one` in the proposal, `kirastore:another` on disk, and the
      // check agreed with itself. She is making the adapter REQUIRE the configured ledger and fail closed when
      // it is absent; this line is the daemon handing it the configured one rather than letting the request
      // supply the answer it is checked against.
      ledgerId: config.kiraLedgerId,
      queueDir: String(config.kiraQueueDir ?? config.kiraStoreDir),
      subject: config.kiraSubject,
      approverDid: config.kiraApproverDid,
      activeControlDigest: config.kiraControlDigest,
    })
    log(`KIRA WROTE ${String(kira.receipt?.auraHash ?? kira.receipt?.hash ?? '').slice(0, 16)}… as ${kira.authority}`)
    return kira
  }

  /**
   * ONE APPROVAL, ONE CONSUMPTION, ONE EFFECT — AND A RECORD ON DISK BEFORE EACH STEP.
   *
   * **CODEX P1 #5, WHICH SURVIVED TWO ROUNDS BECAUSE THE JOURNAL WAS ONLY A LIBRARY.** MEASURED: both live
   * approval paths consumed the approval and THEN ran the effect, with nothing written down in between — so a
   * crash after the consume and before the effect burned the approval with no memory written, and a restart
   * could not tell that from a settlement that never started. The journal court was green throughout, because
   * it measured `journal.mjs` and the daemon did not call it. **A journal the daemon does not write is not a
   * transaction.**
   *
   * THE ORDER, AND WHY EACH STEP IS WHERE IT IS:
   *
   *     begin                pending           nothing has happened; a restart may re-present this
   *     advance(started)     effect-started    BEFORE the consume, because the consume is IRREVERSIBLE
   *     authoriseSettlement                    the approval is consumed — it cannot be un-consumed
   *     performApprovedEffect                  Kira writes, or a grant is signed
   *     advance(done)        effect-done       the effect is known to have LANDED
   *     advance(receipt)     receipt-written   the record of it exists
   *     advance(spent)       spent             terminal: this nonce is finished for good
   *
   * **`effect-started` IS WRITTEN BEFORE THE CONSUME, AND THAT IS DELIBERATE.** A crash between them leaves a
   * proposal that was NOT consumed but IS reported uncertain. That direction is the safe one: reporting
   * uncertain for an unconsumed approval costs a person one decision, while treating a possibly-consumed one as
   * fresh costs a second effect for one approval. **When the two errors are not symmetric, take the cheap one.**
   *
   * @param {Readonly<Record<string, unknown>>} proposal
   * @param {Readonly<Record<string, unknown>>} approval
   * @param {string} authority
   * @returns {Readonly<{result: object, performed: object}>}
   */
  const settleUnderJournal = (proposal, approval, authority) => {
    const nonce = proposal.nonce
    const recorded = journal.read(nonce)
    // ── WHAT A PREVIOUS LIFE ALREADY DID, DECIDED FROM DISK ──────────────────────────────────────────
    // AFTER A RESTART THE STORE IS EMPTY, so the in-memory checks cannot answer this: the journal is the only
    // thing that knows an approval was already consumed.
    if (recorded !== null) {
      if (recorded.state === JOURNAL_STATE.SPENT) {
        throw ownerRefusal(OWNER_REFUSE.APPROVAL_SPENT,
          `this approval was consumed and its effect completed at ${String(recorded.at)}. A settlement is `
          + 'idempotent by nonce, and this one is already done')
      }
      if (recorded.state === JOURNAL_STATE.EFFECT_STARTED) {
        // **THE EFFECT IS UNCERTAIN AND IS NOT RETRIED.** It may or may not have landed; re-running it is how
        // one approval writes two memories.
        throw ownerRefusal(JOURNAL_REFUSE.EFFECT_UNCERTAIN,
          `a settlement of this approval began at ${String(recorded.at)} and never recorded its effect. It may `
          + 'or may not have landed, so it is reported rather than retried — a person decides')
      }
      if (recorded.state === JOURNAL_STATE.EFFECT_DONE
        || recorded.state === JOURNAL_STATE.RECEIPT_WRITTEN) {
        // THE EFFECT LANDED AND ONLY THE RECORD WAS UNFINISHED, which is idempotent and is finished here.
        finishRecord(nonce, recorded)
        // **AND WHAT WAS RECORDED COMES BACK RATHER THAN A PLACEHOLDER.** MEASURED: this returned
        // `{ grant: null, kira: null }` — so a grant that had been signed and lost before delivery was reported
        // as nothing to recover, **which is indistinguishable from a settlement that produced no grant at all.**
        // The record now carries it, and this hands it back.
        return { result: { digest: proposal.digest, ledgerId: proposal.ledgerId, authority,
          ceiling: recorded.ceiling ?? null },
        performed: { kira: recorded.receipt === null || recorded.receipt === undefined
          ? null : { receipt: recorded.receipt }, grant: recorded.grant ?? null,
        effect: 'recovered' } }
      }
    }
    // ── THE WRITE-AHEAD, IN ORDER ────────────────────────────────────────────────────────────────────
    // ── THE JOURNAL KEEPS THE WHOLE PROPOSAL AND THE WHOLE RESULT (CODEX R4 ITEM 7) ────────────────
    //
    // **MEASURED: IT SAVED THREE FIELDS — digest, operation, ledgerId — AND NOTHING OF WHAT THE OWNER
    // APPROVED.** So after a restart a pending proposal **could not be restored**: the store is in memory and
    // starts empty, and the journal held a description of a proposal rather than the proposal. The owner had
    // approved specific bytes at a specific expiry and the only surviving copy was a digest.
    //
    // **AND THE RESULT WAS NEVER WRITTEN AT ALL.** `receipt-written` advanced a STATE and stored no receipt, so
    // **a grant signed and then lost before delivery was gone** — the effect had landed, the approval was spent,
    // and there was nothing to hand back. That is the one failure this journal exists to make survivable.
    //
    // WHATEVER `performApprovedEffect` PRODUCES IS NOW RECORDED BEFORE THE STATE THAT CLAIMS IT, and the
    // recovery path reads it back rather than reconstructing it. **`bytes` is the frozen text the owner was
    // shown**, which is what makes the record a restorable proposal rather than an index entry.
    // ── **ASK WHETHER THIS CAN RUN BEFORE SPENDING THE ANSWER (cohesion plan row 27)** ──────────────────────
    //
    // MEASURED AT HEAD: `journal.advance(EFFECT_STARTED)` consumed the owner's one-shot approval at :541, and
    // `effectFor` did not refuse an undispatched operation until :593 — **inside `performApprovedEffect`, after
    // the spend was already durable.** An operation this daemon cannot run therefore cost the person their
    // approval and did nothing. *A proposal that cannot run must be refused before it can cost anything.*
    //
    // Both questions are pure — whether an effect exists, and whether the scope names the store it writes to — so
    // they can be asked here, where `authority` is not yet known. `performApprovedEffect` asks the SAME function,
    // so the two sites cannot drift about what "dispatchable" means.
    assertDispatchable(proposal)
    journal.begin(nonce, {
      digest: proposal.digest, operation: proposal.operation, ledgerId: proposal.ledgerId,
      scope: proposal.scope, expiresAt: proposal.expiresAt, frozenAt: proposal.frozenAt,
      bytes: proposal.bytes.toString('utf8'),
    })
    journal.advance(nonce, JOURNAL_STATE.EFFECT_STARTED)
    const result = authoriseSettlement({ store, approval, authority })
    log(`SETTLED ${result.digest.slice(0, 16)}… ledger ${result.ledgerId} authority ${result.authority}`)
    const performed = performApprovedEffect(proposal, result.authority)
    // **THE GRANT AND THE RECEIPT, ON DISK, BEFORE THE STATE SAYS THE EFFECT LANDED.** A record that claims
    // `effect-done` while holding no result is the shape this item is about: the claim is durable and the thing
    // claimed is not.
    journal.advance(nonce, JOURNAL_STATE.EFFECT_DONE, {
      authority: result.authority, ceiling: result.ceiling ?? null,
      grant: performed.grant ?? null, receipt: performed.kira?.receipt ?? null,
    })
    finishRecord(nonce, null)
    return { result, performed }
  }

  /**
   * The last two steps, which are idempotent and are also what a restart owes.
   *
   * **A FUNCTION DECLARATION, NOT A `const` ARROW, AND THAT IS A BUG THIS COURT FOUND.** It was
   * `const finishRecord = nonce => …` declared BELOW the startup recovery that calls it — so the call at
   * startup threw `ReferenceError: Cannot access 'finishRecord' before initialization`, the daemon failed to
   * start, and it failed **EXACTLY WHEN THERE WAS RECOVERY WORK TO DO**. A crash at `effect-done` left a record
   * to finish, and the restart that was supposed to finish it could not open its sockets at all. **The recovery
   * path was broken in the one situation it exists for**, and only a kill-and-restart court could see it: every
   * other court starts a daemon with an empty journal, where `receiptsOwed` is empty and the line never runs.
   */
  function finishRecord(nonce) {
    const current = journal.read(nonce)
    if (current === null) return
    if (current.state === JOURNAL_STATE.EFFECT_DONE) journal.advance(nonce, JOURNAL_STATE.RECEIPT_WRITTEN)
    if (journal.read(nonce).state === JOURNAL_STATE.RECEIPT_WRITTEN) journal.advance(nonce, JOURNAL_STATE.SPENT)
  }

  /**
   * WHAT THIS APPROVAL DOES — DECIDED BY THE FROZEN OPERATION AND BY NOTHING ELSE.
   *
   * **CODEX P1 #2.** MEASURED: `writeToKira` ran on the phone and console paths whatever the operation was, so
   * with a Kira store configured an approval the owner granted for an ARTIFACT ADMISSION wrote a memory
   * record, and an approval for a memory write could be answered with a grant. The owner's answer authorised
   * whatever the daemon did next rather than the thing on the sheet.
   *
   * **BOTH AUTHORITIES COME THROUGH HERE.** A console answer and a phone answer are the same authority over
   * different channels, and a table consulted in one path and not the other is this defect one level down.
   *
   * @param {Readonly<Record<string, unknown>>} proposal - the frozen proposal, already consumed.
   * @param {string} authority - which authority answered.
   * @returns {{kira: object|null, grant: object|null, effect: string}}
   */
  const performApprovedEffect = (proposal, authority) => {
    // AN OPERATION THIS DAEMON DOES NOT KNOW IS REFUSED BY NAME. No default: a fallback would execute the most
    // consequential effect available for a question the owner never answered.
    // **THE SAME PRECONDITION, ASKED AGAIN.** It has already held once — this is the site that ACTS on it, and
    // *a precondition checked in two places in two ways is a precondition that holds in one.*
    const effect = assertDispatchable(proposal)
    if (effect === EFFECTS.GRANT_ONLY) {
      // AN ADMISSION SIGNS AND WRITES NOTHING — no Kira store is touched, whatever is configured.
      return { kira: null, grant: grantFor(proposal, authority), effect }
    }
    if (effect === EFFECTS.REPO_ADVANCE) {
      // ══ **THE FIRST EFFECT THAT LEAVES THIS MACHINE (aumlok-135)** ═════════════════════════════════════════
      //
      // **THE APPROVAL IS ALREADY CONSUMED WHEN THIS RUNS**, and the journal wrote `effect-started` BEFORE the
      // consume — so a crash between the two is reported uncertain rather than silently re-run. *This is the one
      // step in the whole daemon that another person can see happen, and it happens at most once per approval.*
      //
      // **THE RECORD IS READ OUT OF `proposal.bytes` AND NOWHERE ELSE.** That is the same rule `grantFor` follows
      // two functions down: *a value that reached an effect without being in the frozen bytes is a value the owner
      // never approved.* The range, the repo and the tree all come from the bytes the sheet displayed.
      let record = null
      try {
        record = JSON.parse(String(proposal.bytes ?? ''))
      } catch {
        throw Object.assign(new Error('repo.advance: the frozen bytes are not a JSON record, so there is no range '
          + 'to move and nothing that can be said to have been approved'), { code: 'aukora-owner:advance-bytes-unreadable' })
      }
      if (typeof record?.from !== 'string' || typeof record?.to !== 'string') {
        throw Object.assign(new Error('repo.advance: the frozen record carries no `from` and `to`, so no range was '
          + 'approved and nothing will be pushed'), { code: 'aukora-owner:advance-range-missing' })
      }
      // **THE COMPARE-AND-SWAP, AND NOT A PLAIN PUSH.** The lease is the whole safety of this effect: it says
      // *push only if main is still at `from`*. Between the approval and this line main can move — another lane,
      // another person — and the lease turns that from a lost commit into a refused push.
      const command = `git push --force-with-lease=refs/heads/main:${record.from} origin ${record.to}:refs/heads/main`
      const pushed = spawnSync('git', ['push', `--force-with-lease=refs/heads/main:${record.from}`, 'origin', `${record.to}:refs/heads/main`], { encoding: 'utf8', cwd: REPO_ROOT })
      if (pushed.status !== 0) {
        throw Object.assign(new Error(`repo.advance: ${command} exited ${String(pushed.status)}: `
          + `${String(pushed.stderr ?? '').trim().slice(0, 200)}`), { code: 'aukora-owner:advance-push-refused' })
      }
      // **"IT MOVED" IS A MEASUREMENT, NOT THE PUSH'S EXIT CODE.** *A push that returned zero and a main that is
      // where it was are different facts, and only one of them is what the owner approved.*
      const back = spawnSync('git', ['ls-remote', 'origin', 'refs/heads/main'], { encoding: 'utf8', cwd: REPO_ROOT })
      const main = String(back.stdout ?? '').trim().split(/\s+/u)[0] ?? ''
      if (main !== record.to) {
        throw Object.assign(new Error(`repo.advance: the push returned success and main is ${main.slice(0, 7)} `
          + `rather than ${record.to.slice(0, 7)}`), { code: 'aukora-owner:advance-did-not-move' })
      }
      return { kira: null, grant: null, effect, advance: { from: record.from, to: record.to, main, command } }
    }
    // A KIRA SETTLE WRITES, AND ONLY WHERE THE PERSON READ: `kira.store:<ledgerId>` must name this proposal's
    // own ledger. A right-kind scope pointing at another store is a different act from the one authorised.
    assertScopeInStore(proposal.scope, SCOPE_KINDS.KIRA_STORE, proposal.ledgerId)
    return { kira: writeToKira(proposal), grant: null, effect }
  }

  /**
   * THE ADMISSION GRANT, SIGNED BY THE DAEMON'S OWN KEY AFTER THE OWNER APPROVED — Beta's format, Beta's
   * preimage, and `authority` is the authority that ACTUALLY answered, so a phone approval produces a grant
   * saying `phone` and prints the phone ceiling rather than the console one.
   */
  /**
   * THE GRANT, DERIVED FROM THE FROZEN ENVELOPE AND FROM NOTHING ELSE.
   *
   * **CODEX'S SINGLE MOST IMPORTANT CHANGE.** `operation`, `release`, the artifact set, its count and its
   * digest are all read back OUT of `proposal.bytes` — the exact text whose digest the owner was shown and
   * approved. There is no `request.artifacts`, no `request.release` and no caller-supplied count: **a value
   * that reached a signature without being in the frozen bytes is a value the owner never approved.**
   *
   * `envelopeDigest` IS `proposal.digest`, AND THEY ARE THE SAME NUMBER BY CONSTRUCTION RATHER THAN BY
   * COINCIDENCE. Beta's `envelopeDigestOf(envelope)` is `digestOf(canonicalEnvelope(envelope))`, and
   * `freezeAdmissionEnvelope` sets `bytes = canonicalEnvelope(envelope)` — so the digest of the frozen bytes
   * IS the envelope digest. Taking it from `proposal.digest` keeps the claim attached to **the bytes the
   * owner reviewed** rather than to a re-serialisation that happens to agree today.
   */
  const grantFor = (proposal, authority) => {
    if (proposal.operation !== grant.ADMIT_OPERATION && proposal.operation !== grant.ADMIT_SET_OPERATION) {
      return null
    }
    const envelope = envelopeOf(proposal.bytes)
    const bound = { envelopeDigest: proposal.digest,
      release: envelope.release, nonce: proposal.nonce,
      approvedAt: Math.floor(Date.now() / 1000), authority, privateKey: keyPair.privateKey }
    return envelope.kind === ADMISSION_KINDS.SET
      ? grant.signSetGrant({ operation: grant.ADMIT_SET_OPERATION,
        setDigest: grant.pluginSetDigest(envelope.artifacts), count: envelope.artifacts.length, ...bound })
      : grant.signAdmissionGrant({ operation: grant.ADMIT_OPERATION,
        artifactDigest: envelope.artifacts[0], ...bound })
  }

  const handle = async (role, request) => {
    if (request === null || typeof request !== 'object') {
      return { ok: false, reason: OWNER_REFUSE.PROPOSAL_MALFORMED }
    }
    // A SHELL BOOLEAN IS REFUSED ON EVERY SOCKET, INCLUDING THIS ONE. It is the forbidden fallback, and a
    // route that never checked it would be the fallback wearing a different name.
    if (typeof request.approval === 'boolean' || typeof request.shellApproval === 'boolean') {
      return { ok: false, reason: OWNER_REFUSE.SHELL_BOOLEAN_REFUSED }
    }
    // ── THE HELLO: HOW A CALLER KNOWS A DAEMON IS THERE RATHER THAN A SOCKET FILE ───────────────────
    // "A socket exists" is not an answer: a stale socket, a foreign process, or an unlinked path all look
    // the same from outside. The hello is SIGNED BY THE DAEMON'S OWN KEY over a canonical line, so a caller
    // that holds the public key recorded at INSTALL can tell a real daemon from anything else that managed
    // to bind the path. It is answered on BOTH sockets and reveals nothing but the fact of the daemon.
    if (request.op === 'hello') {
      // ── THE CHALLENGE IS REQUIRED, AND AN OLD CLIENT IS REFUSED (CODEX R11, FINDING 3) ────────────────
      //
      // **MEASURED: THIS SIGNED KEY + TIME AND NOTHING ELSE, SO A RECORDED HELLO REPLAYED FOR TEN MINUTES.**
      // The request now carries a fresh random challenge and the signature binds it.
      //
      // **AND A REQUEST WITHOUT ONE IS REFUSED RATHER THAN ANSWERED.** Answering it would mean this daemon kept
      // PRODUCING replayable hellos for every old client, **so the hole would stay open on exactly the machines
      // that had not been updated, while the updated ones believed it closed.** The way to retire a replayable
      // hello is to stop signing one — and to say so by name, so an old client learns why rather than guessing.
      const challenge = request.challenge
      // **EXACTLY 64 HEX CHARACTERS, WHICH IS WHAT THE CLIENT SENDS (FABLE, 2026-09-26).**
      //
      // MEASURED: `detect.mjs:226` is `randomBytes(32).toString('hex')` — **64 characters** — and this check was
      // `/^[0-9a-f]{32,}$/`, **AT LEAST 32 WITH NO UPPER BOUND.** So it accepted the client's format AND every
      // longer string: a 63-character one, a 65-character one, **an 8 KB one, each of which the daemon then
      // SIGNED.** The signature covers a preimage containing the challenge, **so an unbounded challenge is an
      // unbounded preimage** — a caller chose how much work this daemon did and how much memory it allocated,
      // on a socket any process of the same uid can reach.
      //
      // **A LOWER BOUND IS NOT A FORMAT.** It admits every value above it, which is the opposite of "requires 64
      // hex characters". A fixed length is also the only version of this a reader can check against the client
      // by eye.
      if (typeof challenge !== 'string' || !/^[0-9a-f]{64}$/u.test(challenge)) {
        return { ok: false, reason: OWNER_REFUSE.HELLO_CHALLENGE_REQUIRED,
          detail: 'a hello must carry a fresh random challenge, and this one has none. The reply signature is '
            + 'bound to that challenge so a RECORDED hello cannot be replayed; answering an unchallenged hello '
            + 'would sign exactly the replayable preimage this change exists to retire' }
      }
      const signedAt = new Date().toISOString().replace(/\.\d{3}Z$/u, 'Z')
      const preimage = `aukora-owner-hello:v2\n${publicKeyHex}\n${challenge}\n${signedAt}`
      const signature = (await import('node:crypto')).sign(null, Buffer.from(preimage, 'utf8'), keyPair.privateKey)
      return { ok: true, daemon: 'aukora-owner-daemon', pubkeyHex: publicKeyHex, signedAt, challenge,
        signatureHex: signature.toString('hex'), preimage }
    }
    if (request.op === 'submit') {
      if (role !== 'submit') return { ok: false, reason: OWNER_REFUSE.PEER_UNKNOWN }
      try {
        // ── ONE BRANCH: AN ADMISSION IS FROZEN AS ITS ENVELOPE, FIRST ──────────────────────────────
        //
        // **CODEX P1 #1.** The artifact set came from `request.artifacts`, the release from a separate
        // `request.release` and the count from `request.artifacts.length` — three values that reached a
        // SIGNATURE without ever being checked against the bytes the owner was shown, while the owner saw a
        // 400-character preview that did not contain them.
        //
        // **AND THE ENVELOPE IS FROZEN FIRST, NOT AFTER A THROWAWAY PROPOSAL.** MEASURED, and the reason the
        // first attempt at this migration was reverted: an admission no longer SENDS raw bytes, so freezing
        // `request.bytes` first produced `''` — which `freezeProposal` refuses — and every admission came
        // back `proposal-malformed` before the envelope was reached. One branch, not two calls.
        const envelopeKind = request.envelope?.kind
        const isAdmission = typeof envelopeKind === 'string'
          && Object.values(ADMISSION_KINDS).includes(envelopeKind)
        let proposal
        if (isAdmission) {
          try {
            // ── AND THE OPERATION THE SUBMITTER NAMED MUST BE THE ONE ITS KIND IMPLIES (CODEX R5 ITEM D) ──
            //
            // **THE LINE BELOW DERIVES THE INNER OPERATION FROM THE KIND AND OVERWRITES WHATEVER ARRIVED**,
            // and `request.operation` was never passed to the agreement check that exists for exactly this.
            // MEASURED, as the shape of the defect: a caller could submit `operation: 'kira.memory.put'`
            // together with an `artifact` envelope, **and the daemon silently replaced the inner operation with
            // `admit-plugin-artifact` and froze it** — so the proposal the owner read carried an outer
            // operation naming one act and frozen bytes naming another. **A daemon that picks one of two
            // disagreeing statements for the caller is not resolving an ambiguity; it is hiding one.**
            //
            // **REFUSED RATHER THAN RESOLVED.** The derived value is still what gets frozen — that part was
            // right — but a submitter who NAMED an operation and a document that implies a different one is a
            // submitter whose two statements disagree, and that is the caller's error to fix.
            const derived = envelopeKind === ADMISSION_KINDS.SET
              ? grant.ADMIT_SET_OPERATION : grant.ADMIT_OPERATION
            const named = typeof request.operation === 'string' ? request.operation : ''
            // ── AND THE CALLER'S **OWN** ENVELOPE IS CHECKED BEFORE ANYTHING REPLACES IT (R6 ITEM 3) ──────
            //
            // **MEASURED: THE LINE BELOW REPLACES `envelope.operation` BEFORE ANYTHING VALIDATES IT.** Every
            // check downstream sees the DERIVED value, so a caller could put one operation in the envelope and
            // a different one in the request and **only the daemon's own replacement was ever examined** — the
            // caller's two statements were never compared with each other, only with the kind.
            //
            // **`assertEnvelope` ALREADY REQUIRES AN ENVELOPE'S `operation` TO BE THE ONE ITS `kind` IMPLIES**,
            // and the other check already requires the REQUEST's operation to be that same one. Both together
            // make the caller's two statements equal — **but only if the ORIGINAL envelope is the one put
            // through them, which is why this runs here and not after the replacement.**
            // ── AND A **NON-STRING** INNER OPERATION WAS SKIPPED ENTIRELY (CODEX R7 ITEM 3) ──────────
            //
            // **MEASURED: THIS GUARD WAS `typeof … === 'string'`, SO A MALFORMED NON-STRING OPERATION WENT
            // STRAIGHT PAST THE CHECK AND WAS THEN OVERWRITTEN BY THE DERIVED VALUE.** `assertEnvelope` ALREADY
            // refuses it by name — `binding.mjs:405`, *"does not name its operation"* — **but the guard meant
            // that refusal was never reached for exactly the input it exists to catch.** The rule was present
            // and unreachable, which is the same shape as a refusal nobody raises.
            //
            // **`undefined` IS THE ONE CASE THAT STILL PASSES THROUGH**, and deliberately: a producer that says
            // nothing about the inner operation has not disagreed with anything, and the derived value is the
            // daemon's own answer for it. **Anything a caller actually SUPPLIED — a number, an object, `null`,
            // an empty string — is a statement, and a statement is checked.**
            if (request.envelope.operation !== undefined) {
              try {
                // THE ORIGINAL, WITH THE CALLER'S OWN OPERATION, THROUGH THE EXISTING CHECKS.
                assertEnvelope(request.envelope, 'the submitted envelope')
                if (named !== '') {
                  assertOperationNamesTheEnvelopeKind(canonicalEnvelope(request.envelope), named)
                }
              } catch (error) {
                return { ok: false, reason: error?.code ?? OWNER_REFUSE.PROPOSAL_MALFORMED,
                  detail: String(error?.message ?? error).slice(0, 240) }
              }
            }
            if (named !== '' && named !== derived) {
              return { ok: false, reason: OWNER_REFUSE.OPERATION_DISAGREES_WITH_ENVELOPE,
                detail: `the request names the operation ${named} and its envelope declares kind `
                  + `${envelopeKind}, which is ${derived}. The two describe one act and must agree` }
            }
            proposal = store.put(freezeAdmissionEnvelope({
              // THE OPERATION FOLLOWS THE ENVELOPE'S KIND, so a request cannot freeze a `set` envelope under
              // an operation that says `artifact`, or the reverse.
              envelope: { ...request.envelope, operation: derived },
              scope: String(request.scope ?? ''), ledgerId: String(request.ledgerId ?? ''),
              expiresAt: Number(request.expiresAt),
            }))
          } catch (error) {
            return { ok: false, reason: error?.code ?? OWNER_REFUSE.PROPOSAL_MALFORMED,
              detail: String(error?.message ?? error).slice(0, 240) }
          }
        } else {
          // **AND THE FREEZE PATH REFUSES IT FIRST, SO THE OWNER IS NEVER SHOWN A PROPOSAL THAT CANNOT
          // SETTLE.** The settlement check below is the one that matters — it is the last door before the
          // approval is consumed — but a proposal that freezes and lists and can only fail on approval spends
          // the owner's attention on an act the daemon already knows it cannot perform. **BOTH ARE NEEDED:**
          // this one because the store is fixed at startup, and that one because `settleUnderJournal` is also
          // reached by the phone path, which does not come through here at all.
          if (String(request.operation ?? '') === OPERATIONS.KIRA_MEMORY_PUT
            && (typeof config.kiraStoreDir !== 'string' || config.kiraStoreDir === '')) {
            return { ok: false, reason: OWNER_REFUSE.KIRA_STORE_NOT_CONFIGURED,
              detail: 'this daemon has no Kira store configured, so a memory settlement has nowhere to write. '
                + 'The proposal is not frozen and the owner is not asked' }
          }
          // ── AN ENVELOPE MAY NOT COME THROUGH THE RAW DOOR (CODEX R4 ITEM 5) ────────────────────────
          //
          // **THE RAW PATH FREEZES BYTES VERBATIM.** It does not canonicalise them and it does not derive the
          // operation from the kind — **so an admission envelope submitted here would be frozen exactly as the
          // submitter typed it**, and the owner would read and approve a document that never passed the rules
          // the envelope path enforces. Two doors into one freezer, with the weaker one unguarded.
          //
          // **THE TEST IS THE SHAPE, NOT THE KEY.** A Kira settle command and an admission envelope are
          // different documents, and this refuses the second wherever it appears: `version` plus a recognised
          // `kind` is an envelope, and an envelope has exactly one door.
          {
            // **THE RAW DOOR SCANS THE BYTES BEFORE IT FREEZES THEM (AUMLOK-92 ITEM 2).** The freeze at the
            // `store.put(freezeProposal(...))` below takes these bytes verbatim, so an ambiguous document that
            // gets past this point becomes the FROZEN PROPOSAL — and every later check, the digest, the
            // display and the settle would each read whichever duplicate their own parse happened to keep.
            // **Refusing here is the only place the ambiguity can be removed rather than inherited.**
            const raw = String(request.bytes ?? '')
            try {
              assertNoDuplicateKeys(raw, 'the raw owner-door bytes')
            } catch (error) {
              return { ok: false, reason: OWNER_REFUSE.PROPOSAL_MALFORMED,
                detail: `these bytes repeat a key, so the document means more than one thing and freezing it `
                  + `would freeze an ambiguity: ${String(error?.message ?? error)}` }
            }
            let shape = null
            try { shape = JSON.parse(raw) } catch { shape = null }
            if (shape !== null && typeof shape === 'object'
              && shape.version === ADMISSION_ENVELOPE_VERSION
              && Object.values(ADMISSION_KINDS).includes(shape.kind)) {
              return { ok: false, reason: OWNER_REFUSE.PROPOSAL_MALFORMED,
                detail: 'these bytes are an admission envelope and must be submitted as one, through '
                  + '`envelope`: the raw path freezes what it is given, so an envelope here would reach the '
                  + 'owner without being canonicalised or having its operation derived from its kind' }
            }
          }
          proposal = store.put(freezeProposal({
            bytes: Buffer.from(String(request.bytes ?? ''), 'utf8'),
            operation: String(request.operation ?? ''),
            scope: String(request.scope ?? ''),
            ledgerId: String(request.ledgerId ?? ''),
            expiresAt: Number(request.expiresAt),
          }))
        }
        // **BEFORE THE PUSH, SO THE LIST CANNOT GROW PAST WHAT THE STORE WILL HOLD.** See `releaseAndForget`:
        // the first version pruned only on `list`, which bounded the READER and left the WRITER unbounded.
        releaseAndForget()
        asked.push({
          digest: proposal.digest, nonce: proposal.nonce, operation: proposal.operation, scope: proposal.scope,
          ledgerId: proposal.ledgerId, expiresAt: proposal.expiresAt, settledAt: proposal.settledAt,
          // **`count` WAS OMITTED FROM THIS CACHE ENTIRELY (CODEX R7 ITEM 4).** The frozen proposal CARRIES it
          // — `binding.mjs:178`, read from the bytes the owner sees — and the listing returned `entry.count`,
          // which was therefore `undefined`. **The owner reads this number to decide, and it is the number the
          // phone event is checked against.** A cache that drops a field is a reader that reports the drop.
          count: proposal.count,
          // **THE OWNER GETS THE WHOLE THING, NOT A PREVIEW.** MEASURED DEFECT (Codex P1): a
          // 400-character preview was the ONLY thing a person saw while the grant was built from fields the
          // preview did not contain. The console pages this; the daemon truncates nothing.
          bytes: proposal.bytes.toString('utf8'),
          bytesLength: proposal.bytes.length,
        })
        log(`frozen ${proposal.digest.slice(0, 16)}… ${proposal.operation}/${proposal.scope} as ${proposal.ledgerId}`)
        return { ok: true, digest: proposal.digest, nonce: proposal.nonce, expiresAt: proposal.expiresAt }
      } catch (error) {
        // **AN UNDEFINED CODE IS SOMEBODY ELSE'S FAILURE WEARING THIS ONE'S NAME.** When `error.code` is
        // absent the caller is told `proposal-malformed` — a name FOUR different checks throw — and the actual
        // message is discarded, so a `ReferenceError` or a typo in this file reads as a malformed request.
        // MEASURED: this court's first submit came back `proposal-malformed` with no detail while the same
        // inputs froze cleanly when called directly, and nothing in the reply said which of the two it was.
        return { ok: false, reason: error?.code ?? OWNER_REFUSE.PROPOSAL_MALFORMED,
          detail: String(error?.message ?? error).slice(0, 240) }
      }
    }
    // ── A RELAYED PHONE APPROVAL ARRIVES ON THE SUBMIT SOCKET, AND ANYONE MAY CARRY IT ──────────────
    // The carrier does not matter: the signature is the authority, so the AGENT relaying it is fine — that
    // is the whole point of U3 joining U1. What matters is that it verifies under the PINNED key, binds the
    // daemon-minted nonce of a frozen proposal, and is spent through the same one-use machinery.
    if (request.op === 'approve' && request.event !== undefined && role === 'submit') {
      const pin = readPin()
      if (pin === null) {
        return { ok: false, reason: OWNER_REFUSE.PHONE_NOT_ENROLLED,
          detail: 'no phone key is enrolled, so a relayed approval cannot be checked against anything' }
      }
      try {
        const nonce = (request.event.tags ?? []).find(tag => tag[0] === 'nonce')?.[1]
        const proposal = store.byNonce(String(nonce ?? ''))
        if (proposal === null) return { ok: false, reason: phone.PHONE_APPROVAL_REFUSE.PROPOSAL_ABSENT }
        // BETA'S VERIFIER IS THE CHECK: the pin, the kind, the BIP-340 signature, the sentence, the window,
        // the spent set and the scope binding are all his, and re-implementing a signature check would be a
        // second place for it to be wrong.
        // ── EVERY CROSS-CHECK BETA WROTE HAS TO BE GIVEN SOMETHING TO CHECK ────────────────────────────
        // THE DEFECT (Codex daemon r3, item 6): this call passed NO `expectedRecipient`, so the recipient
        // `p` check never ran; and it passed the frozen proposal AS IT IS, whose expiry is named `expiresAt`,
        // while the verifier reads `proposal.expires` — so THE EXPIRY CHECK NEVER RAN EITHER. Two of the
        // three cross-checks were INACTIVE CODE on the one path that matters, and nothing was red.
        // A CHECK THAT IS NEVER GIVEN ITS ARGUMENT IS NOT A WEAK CHECK, IT IS AN ABSENT ONE.
        //
        // THE MAPPING IS EXPLICIT AND IN ONE PLACE, because two names for one field is the defect and
        // renaming either side silently would move it rather than fix it. `expiresAt` is the DAEMON's name
        // for the instant the frozen window closes; `expires` is the verifier's name for the same instant.
        const bound = phone.verifyPhoneApproval({
          event: request.event, pinnedPubkey: pin.pubkey,
          proposal: {
            digest: proposal.digest, operation: proposal.operation, scope: proposal.scope,
            ledgerId: proposal.ledgerId, nonce: proposal.nonce,
            expires: proposal.expiresAt,
            // **THE COUNT, AND WITHOUT IT THE VERIFIER'S CHECK DID NOT RUN.** Its guard is
            // `proposal.count !== undefined && count !== proposal.count`, so a proposal carrying no count
            // SKIPPED the comparison entirely and an approval event could name any number of records. **A
            // check whose subject is absent does not fail; it does not run** — and it reports nothing, which
            // is why this was invisible from both sides. The number is DERIVED from the frozen bytes at freeze
            // time (`recordCountOf`), never supplied by the submitter.
            count: proposal.count,
          },
          // THE RECIPIENT THE OWNER ADDRESSED.  is the daemon's own public half, already the
          // hex form the `p` tag carries — so the check compares the event's recipient against the key this
          // daemon actually holds, and an approval addressed to ANOTHER deployment is refused even with a
          // perfect signature.
          expectedRecipient: publicKeyHex,
          now: Math.floor(Date.now() / 1000), isSpent: value => store.isSpent(value),
        })
        // THE EXPIRY IS THE PROPOSAL'S, NOT THE EVENT'S. MEASURED: Beta's bound record carries `expires`
        // (the tag's own name) and not `expiresAt`, so handing it straight to `authoriseSettlement` made
        // every relayed approval arrive with an undefined expiry and be refused as `approval-expired` — a
        // real interface mismatch, found by the court rather than by reading. AND THE PROPOSAL'S BOUND IS
        // THE RIGHT ONE ANYWAY: the window that matters is the one the DAEMON froze, and an event cannot
        // widen it by naming a later instant.
        const approval = {
          digest: bound.digest, operation: bound.operation, scope: bound.scope,
          ledgerId: bound.ledgerId, nonce: bound.nonce,
          expiresAt: proposal.expiresAt,
          attendance: 'phone',
        }
        const { result, performed } = settleUnderJournal(proposal, approval, 'phone')
        log(`SETTLED BY PHONE ${result.digest.slice(0, 16)}… ledger ${result.ledgerId}`)
        return { ok: true, settled: true, digest: result.digest, ledgerId: result.ledgerId,
          authority: result.authority, ceiling: result.ceiling, effect: performed.effect,
          kira: performed.kira, grant: performed.grant }
      } catch (error) {
        return { ok: false, reason: error?.code ?? phone.PHONE_APPROVAL_REFUSE.MALFORMED }
      }
    }
    // **THE ENROLMENT GUARD, AND IT IS THE ONE AN ATTACKER WANTS.** A pin written from the submit socket
    // would let the agent enrol its OWN phone key and then approve anything — the whole cut undone by one
    // request. It is refused by a name of its own rather than as a generic wrong-role so the attempt is
    // legible in a log.
    if (request.op === 'enrol-phone' && role !== 'owner') {
      log(`REFUSED an enrolment attempt on the ${role} socket`)
      return { ok: false, reason: OWNER_REFUSE.ENROL_ON_SUBMIT }
    }
    if (role !== 'owner') return { ok: false, reason: OWNER_REFUSE.PEER_NOT_OWNER }
    // ── ENROLMENT HAPPENS ON THE OWNER SOCKET AND NOWHERE ELSE ─────────────────────────────────────
    if (request.op === 'enrol-phone') {
      if (typeof request.pubkey !== 'string' || !/^[0-9a-f]{64}$/u.test(request.pubkey)) {
        return { ok: false, reason: OWNER_REFUSE.PROPOSAL_MALFORMED }
      }
      writeFileSync(pinFile, JSON.stringify({ pubkey: request.pubkey, enrolledAt: Math.floor(Date.now() / 1000) }), { mode: 0o600 })
      chmodSync(pinFile, 0o600)
      log(`phone key ENROLLED on the owner socket: ${request.pubkey.slice(0, 16)}…`)
      return { ok: true, enrolled: true, pubkey: request.pubkey }
    }
    if (request.op === 'list') {
      // EXPIRY AND RETENTION ARE SWEPT ON READ. A timer would be one more thing a flooded event loop can
      // starve, and the owner looking at the list is exactly when the list must be true. **THE SAME STEP RUNS
      // ON `put`, because a submit is where the listing GROWS** — see `releaseAndForget`.
      releaseAndForget()
      // THE OWNER SEES THE PROPOSALS AND NOTHING ELSE OF THE SUBMITTER'S — AND **THE BYTES COME FROM THE
      // STORE, NOT FROM A COPY.** MEASURED: this mapping read a cached `preview` field, so when the cache
      // stopped carrying one the owner was shown `undefined` while the arm that checks he sees the frozen
      // bytes read it as a daemon defect. Reading through `store.byNonce` makes the shown text the frozen
      // text by construction: there is one copy, it is the one the digest is over, and it cannot drift from
      // what `grantFor` will derive the grant from. **The whole of it, too — Codex P1 was that the owner saw
      // 400 characters while the signature covered the rest.**
      return { ok: true, proposals: asked.map(entry => {
        const frozen = store.byNonce(entry.nonce)
        const text = frozen === null ? '' : frozen.bytes.toString('utf8')
        // ── THE TWO VALUE FIELDS COME FROM THE CURRENT ENTRY, NOT THE FREEZE-TIME SNAPSHOT (R7 ITEM 4) ──
        //
        // **MEASURED: `asked` IS A SNAPSHOT TAKEN WHEN THE PROPOSAL WAS FROZEN.** `settledAt` was `null` then
        // and never updated, so **a listing after a settlement showed a settled proposal with
        // `settledAt: null`** — while the bytes printed beside it were already read live from the store.
        //
        // **AND THE STORE IS THE RIGHT SOURCE ONLY WHILE IT STILL HOLDS THE NONCE.** MEASURED, both ways: after
        // a settle `byNonce` returns the entry with `settledAt` set (1800000010 in a probe that settled at
        // +10), **but a SETTLED proposal is TERMINAL, `reclaim` drops terminal entries, and `byNonce` then
        // returns `null`.** So the fallback order is the current entry, then the cache, then — **because the
        // cache can only ever hold the freeze-time value — the JOURNAL, which is where the settled time is
        // durable and which item E already reads for exactly this fact.**
        const recorded = frozen === null ? journal.read(entry.nonce) : null
        const settledAt = frozen !== null ? frozen.settledAt
          : (recorded !== null && typeof recorded.at === 'number' ? recorded.at : entry.settledAt)
        const count = frozen !== null && frozen.count !== undefined ? frozen.count : entry.count
        return {
          digest: entry.digest, nonce: entry.nonce, operation: entry.operation, scope: entry.scope,
          ledgerId: entry.ledgerId, expiresAt: entry.expiresAt, settledAt,
          // THE OWNER SEES HOW MANY RECORDS HE IS AUTHORISING. It is the same number the phone event is
          // checked against and the same number the ceiling prints, and it comes from the frozen bytes.
          count,
          bytes: text, bytesLength: Buffer.byteLength(text, 'utf8'),
        }
      }) }
    }
    // ══ `result <nonce>`: THE OWNER RECOVERS A SETTLED RESULT (CODEX R5 ITEM E, FABLE'S DECISION) ══
    //
    // **A GRANT SIGNED AND LOST BEFORE DELIVERY WAS UNRECOVERABLE, AND THE REPLAY REFUSAL MUST NOT CHANGE.**
    // The two needs pull in opposite directions: a replay of a spent approval has to keep answering
    // `APPROVAL_SPENT` — **that refusal is what stops one approval writing two memories** — and yet the owner
    // who never received the grant needs to be handed it. **THIS OP IS THE SEPARATION: it reads, it never
    // settles, and it cannot be reached from the submit socket.**
    //
    // **OWNER-ONLY BY THE SOCKET, NOT BY A FLAG.** This handler answers on `approve.sock`, which is `0600`
    // inside the owner's `0700` directory and is not the socket an agent submits on. **There is no "am I the
    // owner" test here because the channel already is one** — a check that could be passed by a parameter would
    // be a check an agent could pass.
    //
    // **AND IT READS THE JOURNAL, NOT THE STORE.** After a restart the in-memory store is empty; the journal is
    // the only thing that remembers a settlement, **which is why item 7 put the grant and the receipt in it.**
    if (request.op === 'result') {
      const nonce = String(request.nonce ?? '')
      const recorded = journal.read(nonce)
      if (recorded === null) {
        return { ok: false, reason: OWNER_REFUSE.PROPOSAL_ABSENT,
          detail: `nothing is recorded for ${nonce.slice(0, 12)}…, so there is no result to recover` }
      }
      if (recorded.state !== JOURNAL_STATE.SPENT) {
        // **AN UNFINISHED SETTLEMENT IS NOT A LOST RESULT, AND SAYING SO IS THE POINT.** Handing back a
        // half-written record as though it were the outcome would make this op a way to read a state the
        // caller is supposed to be told about by name.
        return { ok: false, reason: OWNER_REFUSE.RESULT_NOT_SETTLED,
          detail: `${nonce.slice(0, 12)}… is at ${recorded.state}, not spent — a result is recoverable only `
            + 'once the effect has landed and its record is finished' }
      }
      return { ok: true, nonce, digest: recorded.digest ?? null, operation: recorded.operation ?? null,
        authority: recorded.authority ?? null, ceiling: recorded.ceiling ?? null,
        grant: recorded.grant ?? null, receipt: recorded.receipt ?? null, settledAt: recorded.at }
    }
    if (request.op === 'approve' || request.op === 'decline') {
      const proposal = store.byNonce(String(request.nonce ?? ''))
      if (proposal === null) {
        // ── THE JOURNAL ANSWERS FIRST WHEN THE STORE CANNOT ──────────────────────────────────────────
        // **MEASURED BY THE KILL COURT, AND IT IS THE WHOLE POINT OF A DURABLE RECORD.** After a restart the
        // in-memory store is EMPTY, so this line answered `proposal-absent` for a settlement that had ALREADY
        // BEEN CONSUMED AND WRITTEN — telling the owner their approval never existed when in fact it was spent.
        // The journal is the only thing that survives a restart, so it is consulted before the store's silence
        // is reported as absence.
        const recorded = journal.read(String(request.nonce ?? ''))
        if (recorded !== null && recorded.state === JOURNAL_STATE.SPENT) {
          return { ok: false, reason: OWNER_REFUSE.APPROVAL_SPENT,
            detail: `consumed and completed at ${String(recorded.at)}; the store is empty after a restart and `
              + 'the journal is what remembers it' }
        }
        if (recorded !== null && recorded.state === JOURNAL_STATE.EFFECT_STARTED) {
          return { ok: false, reason: JOURNAL_REFUSE.EFFECT_UNCERTAIN,
            detail: `a settlement began at ${String(recorded.at)} and never recorded its effect` }
        }
        return { ok: false, reason: OWNER_REFUSE.PROPOSAL_ABSENT }
      }
      if (request.op === 'decline') {
        // ── A DECLINE IS A STATE, NOT A LOG LINE ───────────────────────────────────────────────────────
        // **MEASURED DEFECT (Codex P1 #4): `decline` LOGGED AND RETURNED, AND NOTHING RECORDED IT.** The
        // proposal stayed PENDING in the store, so the owner's "no" was a message to whoever was listening and
        // the very next `approve` on the same nonce would settle it. **The owner said no; that has to be a fact
        // the next caller reads rather than a line in a log.**
        try {
          store.decline(proposal.nonce, Math.floor(Date.now() / 1000))
        } catch (error) {
          return { ok: false, reason: error?.code ?? OWNER_REFUSE.PROPOSAL_MALFORMED }
        }
        log(`DECLINED ${proposal.digest.slice(0, 16)}…`)
        return { ok: false, reason: OWNER_REFUSE.OWNER_DECLINED, declined: true }
      }
      // ── THE PROPOSAL'S DEADLINE IS ENFORCED HERE, INDEPENDENTLY OF THE APPROVAL'S ───────────────────
      // Codex P2: expiry lived only inside `authoriseSettlement`, so it was the APPROVAL's expiry that was
      // checked. **The proposal has its own deadline and it is the one the submitter was told**, so it is
      // enforced against the store on the way in — a proposal past its deadline is EXPIRED whatever approval is
      // presented, and that transition is recorded rather than inferred.
      try {
        store.assertLive(proposal.nonce, Math.floor(Date.now() / 1000))
      } catch (error) {
        return { ok: false, reason: error?.code ?? OWNER_REFUSE.PROPOSAL_MALFORMED }
      }
      try {
        // THE OWNER ANSWERED ON THE OWNER SOCKET, so the bound approval is built HERE from the frozen
        // proposal. Nothing the submitter sent is copied into it.
        const { result, performed } = settleUnderJournal(proposal, {
          digest: proposal.digest, operation: proposal.operation, scope: proposal.scope,
          ledgerId: proposal.ledgerId, nonce: proposal.nonce, expiresAt: proposal.expiresAt,
        }, 'console')
        return { ok: true, settled: true, digest: result.digest, ledgerId: result.ledgerId,
          kira: performed.kira, effect: performed.effect,
          authority: result.authority, ceiling: result.ceiling, grant: performed.grant }
      } catch (error) {
        // A CATCH MUST NOT RELABEL A PROGRAMMING ERROR AS A CALLER-FACING REFUSAL. MEASURED on the join
        // court's first mutant: a ReferenceError from a badly spliced join reached the caller as
        // `aukora-owner:proposal-malformed` — a complaint about THEIR bytes — and hid a real bug in this
        // file for a whole round. Only a code the daemon or Kira actually refuses BY NAME passes through;
        // anything else is an internal error, logged with its stack and named as what it is.
        const code = error?.code
        const known = OWNER_REFUSE !== null && typeof OWNER_REFUSE === 'object' ? new Set(Object.values(OWNER_REFUSE)) : new Set()
        // **THE ADAPTER'S OWN REFUSALS ARE NAMED TOO, AND THEY WERE BEING RELABELLED.** MEASURED: Kira's
        // adapter refuses with BARE codes — `SETTLE_ADAPTER_MALFORMED`, `SETTLE_ADAPTER_NOT_OWNER_DAEMON` —
        // and this set holds only `OWNER_REFUSE` values, so a refusal about the STORE or the COMMAND arrived as
        // `aukora-owner:internal-error`. **A named refusal turned into an internal error tells the operator to
        // look for a bug in this file when the answer is about their request**, which is the same relabelling
        // this catch was written to stop, one layer down. The prefix is the adapter's own and it names itself.
        if (typeof code === 'string'
          && (known.has(code) || code.startsWith('kira.') || code.startsWith('SETTLE_'))) {
          return { ok: false, reason: code }
        }
        // ── A KIRA REFUSAL IS A NAMED REFUSAL, NOT AN INTERNAL ERROR ────────────────────────────────
        // MEASURED: Kira's codes are BARE — `APPROVAL_REPLAY`, `GRANT_OPERATION_MISMATCH` — so a genuine
        // "this approval was already consumed" arrived as `INTERNAL ERROR in the settle path` with a stack,
        // reading as a bug in this daemon rather than as Kira refusing a second write. **Kira's module names
        // itself**, so the code is carried through under a `kira.` prefix and the operator is told which side
        // refused.
        if (error?.name === 'MemoryOwnerRefusal' || error?.name === 'KiraRefusal') {
          return { ok: false, reason: `kira.${String(code ?? 'refused')}` }
        }
        log(`INTERNAL ERROR in the settle path: ${String(error?.stack ?? error?.message ?? error)}`)
        return { ok: false, reason: 'aukora-owner:internal-error' }
      }
    }
    return { ok: false, reason: OWNER_REFUSE.PROPOSAL_MALFORMED }
  }

  // ── BOUNDED REQUEST PROCESSING, WITH CAPACITY THE OWNER KEEPS ─────────────────────────────────────
  //
  // **CODEX'S LISTENER P1s.** The loop this replaces had no byte cap before the newline, no deadline on a
  // partial line, no connection or processing limit, and it kept accumulating after dispatch — so a peer that
  // never sent a newline buffered until the daemon died, a split multibyte character was corrupted, a parse
  // failure became `null`, and `void answer()` left handler failures as UNHANDLED REJECTIONS that kill the
  // process. A submitter could take the owner's daemon down with bytes.
  //
  // **ONE PROCESSOR, SHARED BY BOTH SOCKETS, AND THAT SHARING IS THE WHOLE POINT.** The two sockets are
  // separate servers, so a flood cannot take the owner's CONNECTIONS — but every connection shares one event
  // loop and one `handle`, so a hundred queued submits delay an approval behind them. The processor lets a
  // submit hold at most `PROCESSING_SLOTS - RESERVED_FOR_OWNER` and the owner hold all of them.
  const processor = createProcessor({ total: LIMITS.PROCESSING_SLOTS, reserved: LIMITS.RESERVED_FOR_OWNER })
  const listen = (socketPath, role) => serveBounded({
    socketPath, role, processor, handle, log, say,
  })

  // THE VALIDATED PATHS, WHICH ARE ALSO THE ONES THE CHECKS ABOVE EXAMINED.
  const submitServer = await listen(socketPaths.submitSocket, 'submit')
  const approveServer = await listen(socketPaths.approveSocket, 'owner')
  // THE SOCKET FILE'S MODE IS SET WHEN THE FILE IS THERE, AND ITS ABSENCE IS NOT FATAL.
  //
  // MEASURED: chmodding a socket path can run before the file is visible — the protocol court never hit it
  // and a second harness did, which is exactly the kind of race a mode-setting call should not turn into a
  // startup failure. **AND IT DOES NOT NEED TO BE FATAL, BY THIS DESIGN'S OWN REASONING: the socket FILE's
  // mode is a SECOND lock and the DIRECTORY is the boundary** (measured in `aukora-owner-ingress.test.mjs`),
  // so a socket that appears a moment later is protected by the directory it sits in, and the mode only
  // narrows it further. A directory that is wrong still refuses the start, above, where it matters.
  // **THE LISTENERS WERE BOUND AT THE VALIDATED PATHS AND THIS LOOP STILL ADJUSTED THE RAW STRINGS (R8 P1).**
  //
  // MEASURED: `listen` was handed `socketPaths.*` while the chmod below was handed `config.*`. **So the mode
  // could land on a DIFFERENT OBJECT than the one being listened on — and a socket created through a symlink
  // would sit at whatever mode it was born with while an unrelated file, or nothing at all, was chmodded.**
  // `chmodSync` on a path that does not exist raises, and the `existsSync` guard above it would report the
  // absence as "the socket file was not visible yet" — **a sentence about a race, printed for a mis-resolution.**
  //
  // **THE VALIDATED PATH IS THE ONLY SOCKET PATH THIS FUNCTION TOUCHES OR NAMES.** The loop, the log line and
  // the report below all read `socketPaths`, for the same reason `keyFile` is captured once.
  for (const [path, mode, what] of [
    [socketPaths.submitSocket, 0o660, 'submit'],
    [socketPaths.approveSocket, 0o600, 'approve'],
  ]) {
    if (!existsSync(path)) {
      log(`note: the ${what} socket file was not visible yet, so its mode was left to the directory`)
      continue
    }
    chmodSync(path, mode)
  }
  log(`listening: submit ${socketPaths.submitSocket} | approve ${socketPaths.approveSocket}`)
  log(`public key ${publicKeyHex.slice(0, 16)}… (the private half stays in ${ownerDir})`)
  return Object.freeze({
    publicKeyHex,
    pubFile,
    // THE VALIDATED PATH, NOT THE CONFIG STRING: what the daemon reports it uses must be what it used.
    keyFile,
    proposals: asked,
    close: () => { submitServer.close(); approveServer.close() },
    /** The daemon's own handle answers, so a court can ask without a socket when it wants the binding only. */
    handle,
    store,
  })
}

// ── the entry point, when run rather than imported ────────────────────────────────────────────────
if (isMainModule(import.meta.url)) {
  const configPath = process.env.AUKORA_OWNER_CONFIG ?? process.argv[2]
  if (typeof configPath !== 'string' || configPath.length === 0) {
    process.stderr.write('usage: owner-daemon.mjs <config.json>   (or AUKORA_OWNER_CONFIG)\n')
    process.exit(64)
  }
  const config = JSON.parse(readFileSync(configPath, 'utf8'))
  mkdirSync(config.runDir, { recursive: true, mode: 0o750 })
  mkdirSync(dirname(config.approveSocket), { recursive: true, mode: 0o700 })
  startOwnerDaemon(config).catch(error => {
    // A STARTUP REFUSAL IS A NAME AND AN EXIT CODE, not a stack a log will swallow.
    process.stderr.write(`owner daemon REFUSED TO START: ${String(error?.code ?? error?.name)}: ${String(error?.message ?? error)}\n`)
    process.exit(error?.code === OWNER_REFUSE.OWNER_DIR_INSECURE ? 77 : 78)
  })
}
