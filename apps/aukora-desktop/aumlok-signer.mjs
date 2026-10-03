// The shell's signer: it serves the approval socket the backend already talks to.
//
// WHY THE SHELL AND NOT A `--key-file`. In v3 a BOUND machine keeps the MACHINE KEY
// (`machine-seed-v3.json` in this state root, or the macOS Keychain for this user), and the ROOT is
// kept nowhere: it is re-derived from the handle and the seven words when a root-class act needs it.
// So a shell on a machine that has already been bound can sign APPROVALS without asking for the words
// again, and it still cannot re-key the identity, revoke anything or perform any other root-class act
// — which is the whole point of keeping a machine key rather than the root. A machine that has never
// been bound holds no machine key, which is a different fact from a refused approval and is reported
// as one rather than as a decline.
//
// WHAT CONSENT IS HERE. It is PER OPERATION, not per session: `ask` puts ONE operation in front of a
// person over its exact digest and returns ONE BIT. There is no session to open and no timer to run
// down, so a shell that cannot ask a person refuses the operation rather than signing it.
//
// WHAT THIS MODULE CANNOT DO YET, MEASURED RATHER THAN ASSUMED. MEASURED 2026-09-23 at this tip: the
// two organ functions this file used to call — the v2 session factory and the v2 socket server — are
// exported by NO module under `plugins/aukora-aumlok/lib/` any more; the nuke removed them. The v3
// replacements exist (`readKeptMachineSeed` in `record-v3.mjs`, `createOwnerSigner` in
// `owner-signer.mjs`) and they are a DIFFERENT SHAPE rather than a rename: the machine key is read
// rather than a phrase typed, the signer is built from an Ed25519 key rather than an opened wrap, and
// the local socket server the shell needs is written in `scripts/aumlok/signer.mjs` for the TERMINAL
// route rather than exported by the organ for this one.
//
// THE REQUIREMENT WAS THE ROOT'S READER AND IS NOW THE MACHINE'S, WHICH IS THE CUSTODY FIX SHOWING UP
// IN THE SHELL (Y1, 2026-09-23). This list named `readKeptRootSeed` — a function that already had no
// caller anywhere in the tree, reading a file the design forbids — so the shell was declaring a
// dependency on root material to serve APPROVALS, which are machine-class. It now names the machine
// seed's reader, which is the key a signed approval is actually made with. That makes this list
// honest AND testable: the organ exports what the list names, so `missingSignerOrgan` reports the one
// thing genuinely absent (the socket server), not a function nobody was calling.
//
// SO IT REFUSES BY NAME INSTEAD OF FINISHING A SENTENCE IT CANNOT HONESTLY FINISH. This module
// previously called the removed functions directly, which meant `startShellSigner` threw
// `library.<name> is not a function` at launch — a message that reads like a bug in the shell. It now
// checks for the v3 surface it needs and reports `aumlok:signer-organ-not-v3` with the reason, so the
// gap is visible in the log and in the state reply. REWIRING IT IS A SEPARATE PIECE that needs the
// organ's socket protocol, and it is REPORTED rather than guessed at: writing a second socket server
// here, untested against the wire, would be a new signing path rather than a repair of this one.
//
// THE SOCKET PATH IS RESOLVED HERE, ONCE, AND THE BACKEND CHILD IS TOLD IT. This used to be the
// operator's: nothing in this repository exported `AUKORA_SIGNER_SOCKET`, so with no export the shell
// served nothing and the backend dialled a path someone had typed on a command line. The two agreed
// only by OMISSION, and the failure it produces is the worst kind — `aumlok:channel-unavailable`,
// "nothing is listening", about a shell that is listening somewhere else. This shell now picks the
// path under its OWN state root, `main.mjs` hands that exact string to the backend child through the
// child's ENVIRONMENT, and an exported `AUKORA_SIGNER_SOCKET` still overrides both.
//
// AND A REFUSAL HERE DOES NOT TAKE THE WINDOW DOWN. The caller logs it and the app stays up: a shell
// that cannot sign is a shell with a closed signing channel, not a shell that cannot start.
import { readJsonStrictBytes } from '../../plugins/aukora-kira/lib/strict-read.mjs'
import { createHash, createPrivateKey, createPublicKey, randomBytes, sign as nodeSign } from 'node:crypto'
import { appendFileSync, chmodSync, existsSync, lstatSync, mkdirSync, readFileSync, unlinkSync } from 'node:fs'
import { connect, createServer } from 'node:net'
import { dirname, join, resolve } from 'node:path'
import { readOwnerDaemonConfig } from './aumlok-airlock-config.mjs'
import { assertOwnerDaemonProtocol, createAirlockSigner, requestOwnerSignature } from './aumlok-signer-airlock.mjs'
// THE REST OF THIS SIGNER LIVES IN TWO SIBLINGS, MOVED WHOLE (2026-09-27) so that no file of it passes the self-change
// loop's 64 KiB limit (MAX_PATCH_BYTES, vendor/aukora-seed-app). No moved line was rewritten, every name this file
// exported is still exported from here, and the code below that uses them is unchanged.
//   aumlok-signer-witness.mjs  what is signed and shown: the Nostr binding and SAS confirmation preimages, and the
//                              approval witness derived from an operation's own bytes (Z2)
//   aumlok-signer-review.mjs   the reviewer, the approval-event and decision logs, and the names, limits, machine key,
//                              window, organ check and paths the server below is built from
// WITNESS_DISPLAY_LIMIT stays in this file because scripts/aukora/become.mjs reads its value out of this file's text.
import {
  MAX_SIGNER_LINE_BYTES, SIGNER_CONNECTION_IDLE_MS, decide, ed25519KeyFromSeed, missingSignerOrgan, organValueAt,
  rawPublicKeyHexOf, readableChallenge, resolveSignerLogDir, reviewFromAsk, withinWindow, writeSignerDecision,
} from './aumlok-signer-review.mjs'
import {
  CANONICAL_INSTANT, CONFIRM_NOSTR_SAS_OPERATION, HEX64, NOSTR_BINDING_OPERATION, NOSTR_BINDING_WINDOW_SECONDS,
  NOSTR_SIGNER_REFUSE, OPERATION_CONTENT_ABSENT, SAS_CONFIRMATION_WINDOW_SECONDS, nostrBindingPreimage,
  nostrBindingStatement, readOperationContent, sasConfirmationPreimage, sha256Hex,
  NOSTR_SAFETY_VERSION, assertWitnessFields, decodeNpub,
} from './aumlok-signer-witness.mjs'
export {
  SIGNER_SOCKET_ENV, DEFAULT_SIGNER_SOCKET_NAME, SIGNER_DECISION_LOG_NAME, SIGNER_LOG_SOURCE, MAX_SIGNER_LINE_BYTES,
  SIGNER_CONNECTION_IDLE_MS, SIGNER_ORGAN_REQUIREMENTS, resolveSignerSocketPath, resolveSignerLogDir,
  appendApprovalEvent, writeSignerDecision, missingSignerOrgan, reviewFromAsk,
} from './aumlok-signer-review.mjs'
export {
  NOSTR_BINDING_OPERATION, CONFIRM_NOSTR_SAS_OPERATION, SAS_CONFIRMATION_DOMAIN, SAS_CONFIRMATION_KEYS,
  SAS_CONFIRMATION_WINDOW_SECONDS, sasConfirmationPreimage, NOSTR_BINDING_DOMAIN, NOSTR_BINDING_WINDOW_SECONDS,
  NOSTR_SIGNER_REFUSE, decodeNpub, nostrBindingStatement, nostrBindingPreimage, MAX_WITNESS_CONTENT_BYTES,
  OPERATION_CONTENT_ABSENT, APPROVAL_WORDS_DOMAIN, OPERATION_CONTENT_DOMAIN, operationDigestOfContent,
  approvalWordsDigest, KIRA_CONTENT_NOT_CANONICAL, APPROVAL_FIELD_ORDER, APPROVAL_FIELD_NOT_STATED, approvalFieldsOf,
  deriveApprovalWitness, approvalWitnessFor, readOperationContent,
} from './aumlok-signer-witness.mjs'

/** How much of a rendered description is shown. Past this the line is SHORTENED AND SAYS SO. The card scrolls, so a real
 * change fits (12,000 since 2026-09-27; it was 1,800, which refused almost every self-change). */
export const WITNESS_DISPLAY_LIMIT = 9007199254740991

/**
 * Start the shell's signer and hand back a disposer.
 *
 * THE LIBRARY IS PASSED IN, so this module can be exercised without Electron and so the shell always
 * signs with the bytes of the release it is serving rather than with a copy of its own.
 *
 * THE SERVER (layer 2, 2026-09-23). Refusing by name was right and serving nothing was the whole
 * defect: the backend is handed `AUKORA_SIGNER_SOCKET` and dials it, so a shell that does not bind
 * that path can never raise an approval. What this now does, in order, is the same order the terminal
 * signer (`scripts/aumlok/sign.mjs`'s route) uses, because it is the same wire:
 *
 *   1. refuse early, by name, when there is no bound controller, no socket path, or no organ;
 *   2. read the machine key this laptop kept (`readKeptMachineSeed`) and BUILD the private key from
 *      it. The root is never read, never needed and never held — an approval is machine-class;
 *   3. refuse `aumlok:machine-signer-not-listed-by-the-record` when the record's own
 *      `publicRoot.machines` does not list this key. A signature made by a machine the identity does
 *      not recognise would be refused by the broker anyway, and refusing here names which of the two
 *      facts is wrong;
 *   4. build the signer with the ORGAN'S OWN `createOwnerSigner`, whose review step is
 *      {@link reviewFromAsk} over the approval window. There is no second decision procedure here and
 *      no default approver;
 *   5. bind the unix socket owner-only, record its device and inode, and answer each connection with
 *      one newline-terminated response record;
 *   6. hand back a `stop` that removes the leaf ONLY when the path still resolves to the exact socket
 *      this process created.
 *
 * WHAT IT DOES NOT DO. It does not verify its own signature (that is the broker's job, and doing it
 * here would be the signer checking itself), it does not decide anything (the window answers, and
 * `ask` is that window), and it does not serve a second protocol: the request it parses and the
 * response it writes are `owner-approval.mjs`'s, the same module the broker reads.
 * @param {object} input - the organ library, the controller directory, the socket, the asker and a logger.
 * @returns {Promise<Readonly<Record<string, unknown>>>} `{serving, socketPath, reason, socket, stop}`.
 */
export async function startShellSigner(input) {
  const { library, directory, socketPath, log, ask, logDir: requestedLogDir } = input
  const say = typeof log === 'function' ? log : () => {}
  const logDir = resolveSignerLogDir({ logDir: requestedLogDir, socketPath })
  let ownerConfig
  try {
    ownerConfig = readOwnerDaemonConfig(input.ownerDaemonConfigPath, input.ownerDaemonConfigUid)
  } catch {
    return decide({ logDir, say, verdict: { serving: false, reason: 'airlock:config-refused', socketPath: null } })
  }

  if (directory === null || directory === undefined) {
    // A shell with no bound controller is a shell with nothing to sign for. It says so and stays up.
    return decide({
      logDir,
      say,
      verdict: { serving: false, reason: 'aumlok:adapter-unbound', socketPath: null },
    })
  }
  if (socketPath === null || socketPath === undefined) {
    return decide({
      logDir,
      say,
      verdict: { serving: false, reason: 'aumlok:signer-socket-unconfigured', socketPath: null },
    })
  }
  const absent = missingSignerOrgan(library)
  if (absent !== null) {
    // NAMED, AND NOT DRESSED UP AS A DECLINE. Nothing was asked of a person here; the shell is missing
    // the organ it would sign with, and the string below is the measurement rather than a guess.
    const reason = 'aumlok:signer-organ-not-v3'
    say(`aukora-desktop: aumlok signer: not serving: ${reason}: the release's organ exports no ${absent}(), so this `
      + 'shell has no v3 signing path to serve. Approvals refuse by name; nothing is signed.')
    return decide({ logDir, say, verdict: { serving: false, reason, socketPath: null, missing: absent } })
  }

  // THE DIRECTORY HAS TO EXIST BEFORE A SOCKET CAN BE BOUND INTO IT. Under the default this path
  // lives in this shell's own state root, and on a fresh userData nobody has made that directory yet.
  // MEASURED, 2026-09-22: without this the very first bind failed `EACCES` and the shell reported
  // "not serving" — the same silence the default path exists to end, arrived at from the other side.
  try {
    mkdirSync(dirname(socketPath), { recursive: true, mode: 0o700 })
  } catch (error) {
    const detail = String(error?.code ?? error?.message ?? error)
    say(`aukora-desktop: aumlok signer: not serving: the socket's directory could not be made: ${detail}`)
    return decide({
      logDir,
      say,
      verdict: { serving: false, reason: 'aumlok:signer-socket-unusable', socketPath: null, detail },
    })
  }

  // ── the machine key, read rather than asked for ────────────────────────────────────────────────
  // A BOUND MACHINE KEEPS THIS KEY, AND THAT IS WHY A SHELL CAN SIGN AT ALL. A machine that has never
  // been bound holds none — a different fact from a refused approval, and reported as one.
  if (ownerConfig !== null) {
    try { await assertOwnerDaemonProtocol(ownerConfig, library.library) }
    catch (error) {
      return decide({ logDir, say, verdict: { serving: false,
        reason: error.code ?? 'airlock:protocol-unverified', detail: error.message, socketPath: null } })
    }
  }
  let privateKey
  let machinePublicKeyHex = ownerConfig?.ownerPublicKeyHex
  // AIRLOCK: configured custody must never enter the local seed reader, even on daemon failure.
  if (ownerConfig === null) {
    let kept
    try {
      kept = library.readKeptMachineSeed({ directory, custodian: 'file' })
    } catch {
      const reason = 'aumlok:no-seed'
      say(`aukora-desktop: aumlok signer: not serving: ${reason}: no machine key is kept in ${directory}, so `
        + 'this laptop has nothing to sign an approval with. Binding this machine writes one; until then '
        + 'nothing is signed.')
      return decide({ logDir, say, verdict: { serving: false, reason, socketPath: null } })
    }

    // THE MACHINE'S OWN KEY, DERIVED FROM THE SEED RATHER THAN TRUSTED FROM THE FILE. The file names both
    // the seed and a public key; deriving the second from the first is what makes the pair a fact instead
    // of two claims that happen to sit in one JSON document.
    try {
      const loaded = ed25519KeyFromSeed(kept.ed25519SeedHex)
      privateKey = loaded
    } catch (error) {
      const reason = 'aumlok:no-seed'
      say(`aukora-desktop: aumlok signer: not serving: ${reason}: the kept machine seed is not a usable `
        + `Ed25519 seed: ${String(error?.message ?? error)}`)
      return decide({ logDir, say, verdict: { serving: false, reason, socketPath: null } })
    }
    machinePublicKeyHex = library.rawEd25519PublicKeyHex?.(privateKey)
      ?? rawPublicKeyHexOf(privateKey)
    if (typeof kept.ed25519PublicKeyHex === 'string' && kept.ed25519PublicKeyHex !== machinePublicKeyHex) {
      // THE FILE CONTRADICTS ITSELF. Signing would produce bytes the record's own machine list cannot
      // explain, so it is refused before a socket exists rather than after a person has been asked.
      const reason = 'aumlok:machine-signer-not-listed-by-the-record'
      say(`aukora-desktop: aumlok signer: not serving: ${reason}: ${directory} keeps a seed that derives `
        + `${machinePublicKeyHex}, and the same file names ${kept.ed25519PublicKeyHex}. Nothing is signed.`)
      return decide({ logDir, say, verdict: { serving: false, reason, socketPath: null } })
    }

  }

  // THE RECORD HAS TO LIST THIS MACHINE. `publicRoot.machines[].ed25519` is the record's own statement
  // about which machines it recognizes, and a signer whose key is absent from it is a signer whose
  // signature the identity never agreed to.
  let listed = null
  try {
    // **THE RECORD IS SCANNED BEFORE IT IS PARSED (AUMLOK-92 ITEM 4).** `JSON.parse` keeps the LAST duplicate
    // key silently, and this document's whole job is to say which keys this identity recognises — **so a
    // repeated `ed25519` means two readers disagree while both report success, and the one that decides is
    // whichever parsed last.** A duplicate key is not a document with two values; it is a document that means
    // two things, and this signer must not decide to sign on one of them.
    const { value: record } = readJsonStrictBytes(join(directory, 'local-control.json'),
      { label: 'local-control.json' })
    const machines = record?.publicRoot?.machines
    listed = Array.isArray(machines) ? machines.map(entry => entry?.ed25519).filter(k => typeof k === 'string') : []
  } catch {
    listed = null
  }
  if (listed === null || !listed.includes(machinePublicKeyHex)) {
    const reason = 'aumlok:machine-signer-not-listed-by-the-record'
    say(`aukora-desktop: aumlok signer: not serving: ${reason}: the record in ${directory} does not list the `
      + `key this machine holds (${machinePublicKeyHex}), so an approval signed with it is one the identity `
      + 'does not recognize. Nothing is signed.')
    return decide({ logDir, say, verdict: { serving: false, reason, socketPath: null } })
  }

  // ── the signer, built by the organ, driven by the approval window ──────────────────────────────
  const review = reviewFromAsk(library, ask, { logDir, presence: input.presence })
  const encodeResponse = organValueAt(library, 'library.serializeApprovalResponse')
  let signer
  try {
    signer = ownerConfig !== null
      ? createAirlockSigner({ config: ownerConfig, library: library.library, review,
        stillListed: () => stillListedByTheRecord() })
      : library.createOwnerSigner({
      privateKey,
      registeredPublicKeyHex: machinePublicKeyHex,
      review,
    })
  } catch (error) {
    const reason = 'aumlok:signer-organ-not-v3'
    say(`aukora-desktop: aumlok signer: not serving: ${reason}: the organ's signer would not build: `
      + `${String(error?.message ?? error)}`)
    return decide({ logDir, say, verdict: { serving: false, reason, socketPath: null } })
  }
  if (typeof encodeResponse !== 'function') {
    // THE SERIALIZER IS THE WIRE. Without it there is no honest way to answer, and guessing at the
    // record's own encoding is how a second protocol gets invented beside the first.
    const reason = 'aumlok:signer-organ-not-v3'
    say(`aukora-desktop: aumlok signer: not serving: ${reason}: the wire library carries no `
      + 'serializeApprovalResponse(), so this shell cannot write a response record. Nothing is signed.')
    return decide({
      logDir,
      say,
      verdict: { serving: false, reason, socketPath: null, missing: 'library.serializeApprovalResponse' },
    })
  }

  // ── THE SECOND OPERATION, ON THE SAME WINDOW AND THE SAME KEY (Y7) ──────────────────────────────
  const refuseNames = organValueAt(library, 'library.SIGNER_REFUSE') ?? {}
  const MALFORMED = refuseNames.REQUEST_MALFORMED ?? 'signer:request-malformed'
  const EXPIRED = refuseNames.REQUEST_EXPIRED ?? 'signer:request-expired'
  const DECLINED = refuseNames.DECLINED ?? 'signer:declined'
  const ASK_UNAVAILABLE = refuseNames.ASK_UNAVAILABLE ?? 'signer:ask-unavailable'
  // THE REPLAY GUARD THIS OPERATION WAS MISSING, NAMED BY THE ORGAN RATHER THAN BY A NEW WORD HERE.
  // `createOwnerSigner` refuses a repeat with `SIGNER_REFUSE.CHALLENGE_ALREADY_SEEN`; taking the same
  // constant means a caller sees ONE vocabulary for one fact, whichever path refused it.
  const ALREADY_SEEN = refuseNames.CHALLENGE_ALREADY_SEEN ?? 'signer:challenge-already-seen'
  /**
   * The challenges THIS SIGNER has already signed a binding for, and nothing else.
   *
   * IN MEMORY, PER SIGNER, EXACTLY AS `createOwnerSigner` KEEPS ITS `seen` SET — a signer that
   * persisted it would be a signer that could be made to refuse forever by anyone who could write to
   * the file, and the fact being remembered is about this process's own answers.
   */
  const seenBindingChallenges = new Set()
  /** The challenges this signer has already signed a SAS CONFIRMATION for, and nothing else. In memory,
   *  per signer, exactly as `seenBindingChallenges` is, and for the same reason. */
  const seenSasChallenges = new Set()
  const encodeRefusal = organValueAt(library, 'library.createRefusedApprovalResponse')
  // THE WIRE LIBRARY IS A NAMED SUB-LIBRARY, NOT A FLATTENED ONE, so the signature constructor is
  // reached through `library.library` — the same path `SIGNER_ORGAN_REQUIREMENTS` names. MEASURED:
  // calling the flattened `library.createSignedApprovalResponse` threw `is not a function` at the
  // moment a person had already said yes, and the socket handler turned that into a malformed-request
  // refusal — a signature lost behind a message about the caller's own record.
  const encodeSigned = organValueAt(library, 'library.createSignedApprovalResponse')

  /**
   * Re-read the record's own machine list and answer whether THIS machine is still on it.
   *
   * THE ANCHOR IS RE-READ AT THE MOMENT OF SIGNING, NOT REMEMBERED FROM STARTUP. The record can be
   * replaced while this signer runs — a re-bind, a rotation, a restore — and a signer that kept the
   * answer it read at launch would keep signing for an identity that has stopped recognising it.
   * @returns {boolean} true when `publicRoot.machines[]` still lists the key this signer holds.
   */
  const stillListedByTheRecord = () => {
    try {
      // **AND THE SAME SCAN ON EVERY SIGNATURE (AUMLOK-92 ITEM 4).** This is the second reader of one
      // document, and **one strict read without the other is one of two implementations of the protection**:
      // the launch check decides whether to start, and this one decides whether to keep signing.
      const { value: record } = readJsonStrictBytes(join(directory, 'local-control.json'),
        { label: 'local-control.json' })
      const machines = record?.publicRoot?.machines
      if (!Array.isArray(machines)) return false
      return machines.some(entry => entry?.ed25519 === machinePublicKeyHex)
    } catch {
      // AN UNREADABLE RECORD IS NOT A LISTING. Signing on a record this function could not read would
      // be signing on the memory of a record rather than on the record.
      return false
    }
  }

  /**
   * Answer one `sign-nostr-binding` request: refuse by name, or sign the binding with the machine key.
   *
   * THE ONE BIT IS THE SAME ONE BIT. The request put in front of the person is built here and handed to
   * the SAME `review` every approval goes through, so the window, the question and the answer are the
   * product's single approval path rather than a second one built for bindings. What the person is
   * shown is the digest of the exact bytes that will be signed, so "approve" is about the binding.
   *
   * WHAT COMES BACK IS A SIGNATURE AND NOTHING ELSE. The reply is the organ's own response record, so
   * it carries the challenge that binds the answer and the 128-hex signature — never the key, never the
   * seed, never the record, and never the statement, which the caller can rebuild from its own request.
   * @param {Readonly<Record<string, unknown>>} request - the parsed wire request.
   * @returns {Promise<Readonly<Record<string, unknown>>>} a signed or refused response record.
   */
  const answerNostrBinding = async request => {
    /** Refuse with a name, echoing the request's own challenge when there is one to echo. */
    const refuse = (refusal, challenge = null) => {
      if (typeof encodeRefusal !== 'function') {
        // WITHOUT THE ORGAN'S SERIALIZER THERE IS NO HONEST ANSWER, and there is no route here that
        // would not be a second codec. `startShellSigner` refuses to serve without it, so this is a
        // belt-and-braces branch rather than a reachable state.
        return { domain: 'aukora:owner-approval-response:v1', challenge: null, refusal: MALFORMED }
      }
      return encodeRefusal({ challenge, refusal })
    }

    const { npub, subject, handle, issuedAt, safetyVersion, challenge: callerChallenge } = request
    if (typeof subject !== 'string' || subject.length === 0 || subject.length > 256) return refuse(MALFORMED)
    if (typeof handle !== 'string' || handle.length === 0 || handle.length > 128) return refuse(MALFORMED)
    if (typeof issuedAt !== 'string' || !CANONICAL_INSTANT.test(issuedAt)) return refuse(MALFORMED)
    if (typeof npub !== 'string' || safetyVersion !== NOSTR_SAFETY_VERSION) return refuse(MALFORMED)

    // THE CALLER'S CHALLENGE, ADOPTED. `reissue-binding` mints a 64-hex one-use value, sends it as
    // `request.challenge` (plugins/aukora-nostr/bin/reissue-binding.mjs:334) and REFUSES a reply that
    // does not carry it back (:355): a reply carrying a different challenge answers a different
    // question. The refusal path above already echoed it; the SUCCESS path minted its own instead,
    // which is the asymmetry this fixes. Validated exactly as `npub` and `issuedAt` are, and refused
    // with the same name, so an ill-formed challenge is MALFORMED rather than silently replaced.
    if (callerChallenge !== undefined && (typeof callerChallenge !== 'string' || !HEX64.test(callerChallenge))) {
      return refuse(MALFORMED)
    }
    let statement
    try {
      statement = nostrBindingStatement({ npub, subject, handle, issuedAt, safetyVersion })
    } catch {
      return refuse(MALFORMED)
    }
    const issuedAtMs = Date.parse(issuedAt)
    if (!Number.isFinite(issuedAtMs) || new Date(issuedAtMs).toISOString().replace('.000Z', 'Z') !== issuedAt) return refuse(MALFORMED)
    const issuedAtSeconds = Math.floor(issuedAtMs / 1000)
    const expiresAt = issuedAtSeconds + NOSTR_BINDING_WINDOW_SECONDS
    const now = Math.floor(Date.now() / 1000)
    if (issuedAtSeconds > now + 30) return refuse(MALFORMED)
    if (now >= expiresAt) return refuse(EXPIRED)

    // THE RECORD HAS TO LIST THIS MACHINE, asked again here rather than assumed from startup.
    if (!stillListedByTheRecord()) return refuse(NOSTR_SIGNER_REFUSE.MACHINE_NOT_LISTED)

    const preimage = nostrBindingPreimage(statement)
    // THE CHALLENGE IS THE CALLER'S WHEN THE CALLER SENT ONE, AND THIS SIGNER'S OWN ONLY WHEN IT DID NOT.
    // This comment used to say the opposite — "THE CHALLENGE IS THIS SIGNER'S OWN, because the only thing
    // that comes back is a signature" — and that sentence was the bug written down: the success path
    // minted a fresh value while the refusal path above echoed the caller's, so a caller that sent one
    // got its own back on a refusal and a stranger's on a signature. `reissue-binding` sends one and
    // refuses anything else (:355), which is how the two halves came apart. Adopted when present, minted
    // only when absent, so the page path that sends no challenge keeps working.
    const challenge = typeof callerChallenge === 'string' ? callerChallenge : randomBytes(32).toString('hex')

    // A CHALLENGE THIS SIGNER HAS ALREADY SIGNED IS REFUSED, AND THIS IS THE CHECK `precheck` MAKES FOR
    // EVERY OTHER OPERATION. `answerNostrBinding` calls `review()` directly rather than going through
    // `createOwnerSigner`, so `precheck` — parse, expiry, REPLAY, reviewer — never ran for it, and the
    // only things between a captured line and a second signature were the 300-second window and a
    // person clicking again. It is checked HERE, before the window opens, so a replay never reaches a
    // human at all: asking somebody to approve a question this signer has already answered is asking
    // them to authorise a duplicate.
    //
    // MEASURED, before this line existed (tests/aukora-sign-nostr-binding.test.mjs, section G): the
    // identical line sent twice came back signed twice with a BYTE-IDENTICAL signature —
    // `474a0cd1e3a2c473…` both times, because Ed25519 over one preimage is deterministic — so nothing
    // downstream could tell the replay from the original.
    if (typeof callerChallenge === 'string' && seenBindingChallenges.has(callerChallenge)) {
      return refuse(ALREADY_SEEN, challenge)
    }
    const asking = Object.freeze({
      challenge,
      subject,
      // WHAT THE PERSON SEES IS WHAT IS SIGNED: the digest of the binding preimage itself, not a
      // digest of a summary of it.
      operationDigest: sha256Hex(preimage),
      issuedAt: issuedAtSeconds,
      expiresAt,
    })
    let decision
    try {
      // THE PERSON IS SHOWN THE BINDING'S OWN BYTES. The preimage is what is signed, so it is what the
      // description is derived from — the statement text, escaped exactly as bound. Nothing here is
      // described by a caller: this signer wrote the statement itself, one step above.
      decision = await withinWindow(review({ request: asking, operationContent: preimage }), expiresAt)
    } catch {
      // A REVIEWER THAT THREW COULD NOT ASK, which is not the owner declining.
      return refuse(ASK_UNAVAILABLE, challenge)
    }
    if (decision?.expired === true) return refuse(EXPIRED, challenge)
    if (decision?.approve !== true) {
      const named = decision?.refusal === ASK_UNAVAILABLE ? ASK_UNAVAILABLE : DECLINED
      return refuse(named, challenge)
    }
    // THE CLOCK IS READ AGAIN: an awaited answer took time, and a window that closed while the person
    // was deciding must not produce a signature for a request that has already ended.
    if (Math.floor(Date.now() / 1000) >= expiresAt) return refuse(EXPIRED, challenge)
    // AND SO IS THE RECORD, FOR THE SAME REASON AND AT THE SAME MOMENT (class 1).
    //
    // THE CHECK ABOVE THE WINDOW IS NOT THE CHECK THAT MATTERS. `stillListedByTheRecord()` ran before
    // `review()` was awaited, and what it awaited is a PERSON: `NOSTR_BINDING_WINDOW_SECONDS` is 300
    // seconds of somebody reading a question. A re-bind, a rotation or a restore can take this machine
    // out of `publicRoot.machines` anywhere in that wait, and the read that decided "this identity
    // recognises this key" is then 300 seconds stale by the time the key is used. MEASURED by the arm
    // in `tests/aukora-sign-nostr-binding.test.mjs` before this line existed: the record was swapped
    // while the window was open, the person clicked Approve, and a signature came back anyway.
    //
    // NOTHING DOWNSTREAM CATCHES IT. The binding's statement is `{subject, npub, nostrPubkeyHex,
    // handle, createdAt}` — no control digest, no machine key — so this listing is the ONLY thing that
    // ties the signature to an identity that still recognises this machine. Which is also why the
    // re-read belongs HERE, at the moment of signing, and not only where the request arrives: that is
    // what `stillListedByTheRecord`'s own comment promises, and a promise kept on one side of an await
    // is not kept.
    if (!stillListedByTheRecord()) return refuse(NOSTR_SIGNER_REFUSE.MACHINE_NOT_LISTED, challenge)
    const signature = ownerConfig === null
      ? nodeSign(null, preimage, privateKey).toString('hex')
      : (await requestOwnerSignature(ownerConfig, { kind: 'nostr-binding', request: statement,
        challenge, operationDigest: sha256Hex(preimage) }, preimage, challenge, library.library)).signature
    if (ownerConfig !== null) {
      if (Math.floor(Date.now() / 1000) >= expiresAt) return refuse(EXPIRED, challenge)
      if (!stillListedByTheRecord()) return refuse(NOSTR_SIGNER_REFUSE.MACHINE_NOT_LISTED, challenge)
    }
    if (typeof encodeSigned !== 'function') return refuse(MALFORMED, challenge)
    // MARKED SEEN ONLY WHEN A SIGNATURE ACTUALLY GOES OUT, which is the rule `owner-signer.mjs` follows:
    // `seen.add` sits at :137, inside `sign`, after the decision — not in `precheck`. A request that was
    // DECLINED, that expired, or that named a machine the record no longer lists produced nothing to
    // replay, so it must not burn the caller's one-use value. This line sits after every refusal above
    // it for exactly that reason, and it is the last thing before the signature is encoded.
    if (typeof callerChallenge === 'string') seenBindingChallenges.add(callerChallenge)
    return encodeSigned({ challenge, signature })
  }

  /**
   * Answer one `confirm-nostr-sas` request: refuse by name, or sign the confirmation with the MACHINE key.
   *
   * THE SAME ONE BIT, THE SAME WINDOW, THE SAME KEY AS EVERY OTHER OWNER APPROVAL. The request put in front
   * of the person is built here and handed to the SAME `review` the approvals and the binding go through.
   * What the person is shown is derived by the signer from the preimage's own bytes, so the digits on the
   * sheet are the digits that get signed.
   *
   * WHY THE MACHINE KEY AND NOT THE ROOT: `record-v3.mjs:349-360` settles it — "the approval key of a v3
   * identity is one of its MACHINES, and never `publicRoot.ed25519`". Y1 deleted the root seed, so there is
   * no root-class key on a laptop to sign a day-to-day approval with, and `root-class-v3.mjs` keeps
   * root-class acts separate. A SAS confirmation is a day-to-day owner approval.
   * @param {Readonly<Record<string, unknown>>} request - the parsed wire request.
   * @returns {Promise<Readonly<Record<string, unknown>>>} a signed or refused response record.
   */
  const answerConfirmNostrSas = async request => {
    /** Refuse with a name, echoing the request's own challenge when there is one to echo. */
    const refuse = (refusal, challenge = null) => {
      if (typeof encodeRefusal !== 'function') {
        return { domain: 'aukora:owner-approval-response:v1', challenge: null, refusal: MALFORMED }
      }
      return encodeRefusal({ challenge, refusal })
    }

    const { subject, npub, controllerKeyHex, sasDigits, confirmedAt, safetyVersion, challenge: callerChallenge } = request
    if (typeof subject !== 'string' || subject.length === 0 || subject.length > 256) return refuse(MALFORMED)
    // Validate the bech32 checksum and the 32-byte key before signing a comparison about this contact.
    if (decodeNpub(npub) === null) return refuse(MALFORMED)
    if (typeof controllerKeyHex !== 'string' || !HEX64.test(controllerKeyHex)) return refuse(MALFORMED)
    // Two independently derived identity fingerprints, with the protocol version inside the signed bytes.
    if (safetyVersion !== NOSTR_SAFETY_VERSION || typeof sasDigits !== 'string' || !/^[0-9]{70}$/u.test(sasDigits)) return refuse(MALFORMED)
    if (typeof confirmedAt !== 'string' || !CANONICAL_INSTANT.test(confirmedAt)) return refuse(MALFORMED)
    if (callerChallenge !== undefined && (typeof callerChallenge !== 'string' || !HEX64.test(callerChallenge))) {
      return refuse(MALFORMED)
    }
    const confirmedAtMs = Date.parse(confirmedAt)
    if (!Number.isFinite(confirmedAtMs) || new Date(confirmedAtMs).toISOString().replace('.000Z', 'Z') !== confirmedAt) return refuse(MALFORMED)
    const confirmedAtSeconds = Math.floor(confirmedAtMs / 1000)
    if (confirmedAtSeconds > Math.floor(Date.now() / 1000) + 30) return refuse(MALFORMED)
    const expiresAt = confirmedAtSeconds + SAS_CONFIRMATION_WINDOW_SECONDS
    if (Math.floor(Date.now() / 1000) >= expiresAt) return refuse(EXPIRED)

    // THE RECORD HAS TO LIST THIS MACHINE, asked again here rather than assumed from startup — and asked
    // again after the window, below, for the reason the binding's own comment gives at length.
    if (!stillListedByTheRecord()) return refuse(NOSTR_SIGNER_REFUSE.MACHINE_NOT_LISTED)

    const statement = { subject, npub, controllerKeyHex, sasDigits, confirmedAt, safetyVersion }
    const preimage = Buffer.from(sasConfirmationPreimage(statement), 'utf8')
    const challenge = typeof callerChallenge === 'string' ? callerChallenge : randomBytes(32).toString('hex')

    // A CHALLENGE THIS SIGNER HAS ALREADY SIGNED IS REFUSED BEFORE THE WINDOW OPENS, so a replay never
    // reaches a person at all: asking somebody to approve a question this signer has already answered is
    // asking them to authorise a duplicate.
    if (typeof callerChallenge === 'string' && seenSasChallenges.has(callerChallenge)) {
      return refuse(ALREADY_SEEN, challenge)
    }
    const asking = Object.freeze({
      challenge,
      subject,
      // WHAT THE PERSON SEES IS WHAT IS SIGNED: the digest of the confirmation preimage itself.
      operationDigest: sha256Hex(preimage),
      issuedAt: confirmedAtSeconds,
      expiresAt,
    })
    let decision
    try {
      // THE PERSON IS SHOWN THE CONFIRMATION'S OWN BYTES, which carry the npub and the six digits. Nothing
      // here is described by a caller: this signer wrote the statement itself, one step above. THE
      // CONTACT'S NAME IS NOT ON THIS SHEET AND CANNOT BE — it is not in Beta's preimage, and a name the
      // caller supplied would be a caller-controlled string on an approval sheet, which is the one thing
      // this window never shows. The name belongs beside the sheet, in the screen that knows the contact.
      decision = await withinWindow(review({ request: asking, operationContent: preimage }), expiresAt)
    } catch {
      return refuse(ASK_UNAVAILABLE, challenge)
    }
    if (decision?.expired === true) return refuse(EXPIRED, challenge)
    if (decision?.approve !== true) {
      const named = decision?.refusal === ASK_UNAVAILABLE ? ASK_UNAVAILABLE : DECLINED
      return refuse(named, challenge)
    }
    // THE CLOCK AND THE RECORD ARE READ AGAIN: an awaited answer took time, and a person is 300 seconds of
    // somebody deciding.
    if (Math.floor(Date.now() / 1000) >= expiresAt) return refuse(EXPIRED, challenge)
    if (!stillListedByTheRecord()) return refuse(NOSTR_SIGNER_REFUSE.MACHINE_NOT_LISTED, challenge)
    const signature = ownerConfig === null
      ? nodeSign(null, preimage, privateKey).toString('hex')
      : (await requestOwnerSignature(ownerConfig, { kind: 'nostr-sas', request: statement,
        challenge, operationDigest: sha256Hex(preimage) }, preimage, challenge, library.library)).signature
    if (ownerConfig !== null) {
      if (Math.floor(Date.now() / 1000) >= expiresAt) return refuse(EXPIRED, challenge)
      if (!stillListedByTheRecord()) return refuse(NOSTR_SIGNER_REFUSE.MACHINE_NOT_LISTED, challenge)
    }
    if (typeof encodeSigned !== 'function') return refuse(MALFORMED, challenge)
    // MARKED SEEN ONLY WHEN A SIGNATURE ACTUALLY GOES OUT: a request that was declined, that expired, or
    // that named a machine the record no longer lists produced nothing to replay.
    if (typeof callerChallenge === 'string') seenSasChallenges.add(callerChallenge)
    return encodeSigned({ challenge, signature })
  }

  // ── the socket ─────────────────────────────────────────────────────────────────────────────────
  // A PATH IS SHARED STATE. Two consequences, both measured by the arms in
  // `tests/aukora-shell-signer.test.mjs`: `EADDRINUSE` on a unix socket arrives as an ASYNC `error`
  // event rather than as a throw, and Node's `server.close()` unlinks the leaf UNCONDITIONALLY. So
  // ownership is recorded from the bind itself — device and inode — and both `stop()` and the error
  // path remove the leaf only while the path still resolves to that exact object.
  let bound = false
  let socketIdentity = null
  /** True when the path still resolves to the exact socket object this process created. */
  const ownsLeafNow = () => {
    if (!bound || socketIdentity === null) return false
    try {
      const state = lstatSync(socketPath, { bigint: true })
      return state.isSocket() && state.dev === socketIdentity.dev && state.ino === socketIdentity.ino
    } catch {
      return false
    }
  }
  /** Remove the socket leaf only if this process created it and it is still that same object. */
  const removeOwnSocket = () => {
    if (!ownsLeafNow()) return
    try {
      unlinkSync(socketPath)
    } catch {
      /* already gone, or unreadable: either way it is not ours to remove */
    }
  }

  // THE ONE LINE WRITTEN TO THE WIRE IS THE ORGAN'S OWN SERIALIZER, taken from the wire library the
  // loader built. A hand-rolled `JSON.stringify` here would be a second encoding of the same record,
  // which is how two ends of one protocol start disagreeing about what a response is.
  const reply = (socket, response) => {
    try {
      socket.end(encodeResponse(response))
    } catch {
      socket.destroy()
    }
  }

  const server = createServer(socket => {
    let received = ''
    let answered = false
    const answer = response => {
      if (answered) return
      answered = true
      reply(socket, response)
    }
    // NOT A SHORT TIMER: the wait here is a PERSON answering a window, and the bound that matters is
    // already in the request — `createOwnerSigner` refuses an expired one by name. This is only a
    // backstop against a peer that connects and says nothing.
    socket.setTimeout(SIGNER_CONNECTION_IDLE_MS)
    socket.on('data', chunk => {
      received += chunk.toString('utf8')
      if (Buffer.byteLength(received, 'utf8') > MAX_SIGNER_LINE_BYTES) {
        // Over-long input is ANSWERED with a refusal rather than dropped: a caller that sent something
        // wrong should get a reason, not a hang.
        answer(signer.approve(null))
        return
      }
      const newline = received.indexOf('\n')
      if (newline === -1) return
      let request
      try {
        request = JSON.parse(received.slice(0, newline))
      } catch {
        request = null
      }
      // THE SIGNER PRESENTS THE OPERATION BEFORE IT DECIDES, exactly as the terminal signer does, so
      // the request about to be signed is on the record whether the answer is a signature or a
      // refusal. It carries no secret: the subject, the control digest, the operation digest, the
      // challenge and the window.
      // WHICH OPERATION, DECIDED BY ITS OWN NAME AND BY NOTHING ELSE. A request that names an operation
      // is not an approval request and is never parsed as one; a request that names none is the
      // approval wire this server has always spoken, so the existing protocol is untouched.
      const operationName = request !== null && typeof request === 'object'
        && typeof request.operation === 'string' ? request.operation : null
      if (operationName === NOSTR_BINDING_OPERATION || operationName === CONFIRM_NOSTR_SAS_OPERATION) {
        // Reject unsafe fields before logging them or deriving anything displayed by the approval window.
        try { assertWitnessFields(request) } catch {
          answer(encodeRefusal({ challenge: readableChallenge(request?.challenge), refusal: MALFORMED }))
          return
        }
      }
      if (operationName === NOSTR_BINDING_OPERATION) {
        say(`aukora-desktop: aumlok signer: asked to sign a Nostr binding for ${String(request.subject)} `
          + `(handle ${String(request.handle)})`)
      } else if (operationName === CONFIRM_NOSTR_SAS_OPERATION) {
        // THE LOG NEVER CARRIES THE DIGITS. A SAS is only worth anything while it is not written down, and
        // a signer that logged the digits would be publishing the comparison it exists to protect.
        say(`aukora-desktop: aumlok signer: asked to confirm a Nostr SAS for ${String(request.subject)} `
          + `(npub ${String(request.npub)})`)
      } else if (operationName !== null) {
        say(`aukora-desktop: aumlok signer: asked for the unknown operation ${operationName}; refusing by name`)
      } else if (request !== null && typeof request === 'object') {
        say(`aukora-desktop: aumlok signer: asked to sign operation ${String(request.operationDigest)} `
          + `for ${String(request.subject)} (challenge ${String(request.challenge)})`)
      }
      // Z2 — THE CONTENT IS TAKEN OFF THE WIRE AND PROVED AGAINST THE DIGEST BEFORE ANYBODY IS ASKED.
      // `readOperationContent` recomputes `sha256` over the bytes the caller sent and compares it to the
      // `operationDigest` the SIGNED request carries; content that does not hash to it is refused by
      // name and no description of it is derived at all. What reaches the window is then a function of
      // the BOUND bytes and of nothing else — a caller's own summary is refused by the bridge before a
      // window exists (`aumlok-bridge.mjs`, `admitApprovalQuestion`).
      const content = operationName === null && request !== null && typeof request === 'object'
        ? readOperationContent(request)
        : { ok: false, reason: OPERATION_CONTENT_ABSENT }
      // THE SEVEN SIGNED FIELDS AND NOTHING ELSE ARE HANDED TO THE ORGAN. `operationContent` is a field
      // ON THE LINE, not a field of the record: `parseApprovalRequest` is a closed-record reader and
      // refuses an eighth field by name, and `approvalSigningBytes` re-derives the preimage from the
      // seven — so the content is lifted off here and the record the organ sees is byte-identical to
      // one that never carried it. The digest stays the only thing signed.
      const signedRecord = operationName === null && request !== null && typeof request === 'object'
        ? Object.fromEntries(Object.entries(request).filter(([field]) => field !== 'operationContent'))
        : request
      // A CALLER THAT SENT CONTENT AND GOT IT WRONG IS REFUSED BY NAME, NOT SHOWN A WINDOW.
      //
      // Z2's court is exactly this: "a caller-supplied summary that differs from the bound bytes is
      // refused, never displayed." Content that does not hash to the signed digest IS such a summary —
      // the bytes a caller offers as the operation — and the refusal happens here, before the reviewer
      // is called and therefore before any window exists. It is NOT answered by asking a person about
      // an operation nobody can describe.
      //
      // ABSENT IS A CEILING; PRESENT-AND-UNUSABLE IS A FAULT (`aukora-fail-open-pin`). A line carrying
      // no `operationContent` at all is the older wire this server has always spoken, and it still
      // reaches the window on its digest. A line that CARRIES the field and carries something this side
      // cannot read is a caller that tried to be described and failed — and the guard here used to ask
      // `typeof request?.operationContent === 'string'`, so a number, an object or an array FELL THROUGH
      // IT: `readOperationContent` had already computed `signer:operation-content-malformed`, the type
      // guard discarded that answer, and the request went on to the approval path with no description
      // and a live Approve button. It is the same shape as the expiry renderer that demanded a string
      // from an integer wire: a condition that can never be satisfied by the value it is guarding.
      // The one check decides, by its OWN sentinel for absence, and the refusal carries the challenge
      // when there is one to carry so the answer is still attributable to its question.
      const contentRefusal = content.ok === true || content.reason === OPERATION_CONTENT_ABSENT
        ? null
        : Promise.resolve(encodeRefusal({
          challenge: readableChallenge(request?.challenge),
          refusal: content.reason,
        }))
      if (contentRefusal !== null) {
        say(`aukora-desktop: aumlok signer: refusing ${content.reason}: the content offered for operation `
          + `digest ${String(request.operationDigest)} is not the bytes this side can read and describe`)
      }
      // ASYNC, BECAUSE THE ANSWER COMES FROM A WINDOW. `approve` is the synchronous path and refuses
      // a reviewer that has to ask a person (`signer:ask-requires-await`) — which is the right refusal
      // for a caller that cannot wait, and the wrong one for this server.
      const answering = contentRefusal !== null
        ? contentRefusal
        : operationName === NOSTR_BINDING_OPERATION
        ? answerNostrBinding(request)
        : operationName === CONFIRM_NOSTR_SAS_OPERATION
        ? answerConfirmNostrSas(request)
        : operationName !== null
          // AN OPERATION THIS SIGNER DOES NOT HAVE IS REFUSED BY NAME. It is NOT handed to the approval
          // path, which would answer `signer:request-malformed` and tell the caller its record was
          // broken when the truth is that this signer has no such operation.
          ? Promise.resolve(encodeRefusal({ challenge: null, refusal: NOSTR_SIGNER_REFUSE.OPERATION_UNKNOWN }))
          : Promise.resolve(signer.approveAsync(
            signedRecord,
            content.ok === true ? { operationContent: content.content } : {},
          ))
      Promise.resolve(answering).then(answer, error => {
        // AN ANSWER THAT THREW IS NOT A REQUEST THAT WAS MALFORMED, and reporting it as one would send
        // a caller to look at its own record while the fault is here. The cause is named on the log
        // line, and the caller still gets a refusal rather than a hang.
        say(`aukora-desktop: aumlok signer: answering the request threw: ${String(error?.stack ?? error)}`)
        answer(signer.approve(null))
      })
    })
    socket.on('timeout', () => socket.destroy())
    socket.on('error', () => socket.destroy())
  })
  // ── **A SOCKET FILE IS NOT A SIGNER: PROBE IT BEFORE BELIEVING IT (AUMLOK-115, LIVE-TEST PREP)** ──────
  //
  // MEASURED (Fable, 2026-09-26): **THE SIGNER HAD NOT SERVED SINCE 2026-09-24T10:24Z.** Every app start logged
  // `serving=false reason=aumlok:signer-socket-held`, because `listen` fails `EADDRINUSE` on a socket FILE that
  // still exists — and the old check treated ANY pre-existing path as a running signer. `lsof` showed no holder:
  // a stale file, and the approval window path was dead for two days while the log said a signer held it.
  //
  // **THE FILE'S EXISTENCE WAS NEVER THE QUESTION; WHETHER ANYONE IS LISTENING IS.** A connect answers it:
  // `ECONNREFUSED` on a unix socket means the file is there and nothing is bound to it.
  //
  // **THE PROBE RUNS FIRST, BEFORE THE BIND**, so there is exactly one listen path and one success path — no
  // second copy of the ownership and chmod sequence, which is the code that must not be duplicated.
  //
  // **AND IT FAILS CLOSED ON ANYTHING ELSE.** A timeout, an `EACCES`, an unexpected code: none of them are
  // evidence that the socket is dead, so none of them license an unlink. *A probe that reads "I could not tell"
  // as "it is stale" is a probe that deletes a live signer's socket* — the very failure the old comment was
  // written to prevent, and the reason the answer is three-valued rather than a boolean.
  const socketIsLive = path => new Promise(resolve => {
    const probe = connect(path)
    let settled = false
    const finish = verdict => {
      if (settled) return
      settled = true
      probe.destroy()
      resolve(verdict)
    }
    probe.on('connect', () => finish('live'))
    // **THE TWO CODES THAT MEAN STALE, BY NAME.** `ECONNREFUSED` is a socket file with no listener; `ENOENT` is
    // no file at all (it went away between the check and the probe). Everything else is UNKNOWN.
    probe.on('error', error => {
      const errorCode = String(error?.code ?? '')
      finish(errorCode === 'ECONNREFUSED' || errorCode === 'ENOENT' ? 'stale' : 'unknown')
    })
    probe.setTimeout(2_000, () => finish('unknown'))
  })

  let staleRemoved = false
  if (existsSync(socketPath)) {
    const state = await socketIsLive(socketPath)
    if (state === 'stale') {
      // **THE FILE IS THERE AND NOBODY IS LISTENING: IT IS OURS TO REMOVE.** This is the case the old check
      // could not see, and it is the one that matters — a leftover from a killed signer is not a signer.
      say(`aukora-desktop: aumlok signer: STALE SOCKET at ${socketPath} — a connect probe got ECONNREFUSED, so `
        + 'nothing is listening. Removing it and serving.')
      try {
        unlinkSync(socketPath)
        staleRemoved = true
      } catch (error) {
        const reason = 'aumlok:signer-socket-unusable'
        say(`aukora-desktop: aumlok signer: not serving: ${reason}: the stale socket could not be removed: `
          + `${String(error?.message ?? error)}`)
        try {
          server.close()
        } catch {
          /* nothing was listening */
        }
        return decide({ logDir, say, verdict: { serving: false, reason, socketPath: null, detail: 'stale-unremovable' } })
      }
    } else if (state === 'live') {
      // A REAL SIGNER IS HOLDING IT. Refused by name, exactly as before, and now on evidence rather than on the
      // file's mere existence.
      const reason = 'aumlok:signer-socket-held'
      say(`aukora-desktop: aumlok signer: not serving: ${reason}: a connect probe REACHED a listener on `
        + `${socketPath}, so a real signer holds it and it is left alone.`)
      return decide({ logDir, say, verdict: { serving: false, reason, socketPath: null, detail: 'live-holder' } })
    } else {
      // COULD NOT TELL. **UNKNOWN IS NOT STALE.** The socket is left exactly as found and the refusal says which
      // fact was missing, rather than deleting a path on a guess.
      const reason = 'aumlok:signer-socket-unusable'
      say(`aukora-desktop: aumlok signer: not serving: ${reason}: ${socketPath} exists and the connect probe `
        + 'could not determine whether anything is listening, so the socket is left alone rather than deleted '
        + 'on a guess.')
      return decide({ logDir, say, verdict: { serving: false, reason, socketPath: null, detail: 'probe-unknown' } })
    }
  }

  // Bind failure arrives HERE, not as a throw: an unix-socket `EADDRINUSE` is an async `error` event.
  const boundFailure = new Promise(resolve => server.once('error', resolve))
  const listening = new Promise(resolve => server.listen(socketPath, resolve))
  const outcome = await Promise.race([
    listening.then(() => ({ ok: true })),
    boundFailure.then(error => ({ ok: false, error })),
  ])
  if (!outcome.ok) {
    const code = String(outcome.error?.code ?? 'error')
    // A PATH THIS PROCESS DID NOT CREATE IS LEFT EXACTLY AS FOUND. An unconditional unlink here is how
    // a second launch deletes a running signer's socket — leaving that process holding its listening
    // fd with no name for any broker to reach, which presents as `channel-unavailable` forever.
    // **AND THE PROBE ABOVE IS WHY THIS BRANCH IS NOW RARE:** it is reached only when the path appeared
    // between the probe and the bind, or when the probe said `live`/`unknown` and the bind then disagreed.
    const reason = existsSync(socketPath) ? 'aumlok:signer-socket-held' : 'aumlok:signer-socket-unusable'
    say(`aukora-desktop: aumlok signer: not serving: ${reason}: ${socketPath} could not be bound `
      + `(${code}: ${String(outcome.error?.message ?? '')}).`
      + (existsSync(socketPath) ? ' A socket is already there and this process did not create it, so it is left alone.' : ''))
    try {
      server.close()
    } catch {
      /* nothing was listening */
    }
    return decide({ logDir, say, verdict: { serving: false, reason, socketPath: null, detail: code } })
  }
  if (staleRemoved) say(`aukora-desktop: aumlok signer: serving on ${socketPath} (a stale socket was replaced).`)

  // OWNERSHIP FROM THE BIND, THEN THE MODE MADE EXPLICIT, THEN BOTH ASSERTED — all before the verdict,
  // because a signer that announces itself must not be announcing a channel wider than the key it
  // guards. A unix socket is `0777 & ~umask`, so under a group-shared umask the request channel would
  // be reachable by every process in that group: anyone who can connect can ask this key to sign an
  // arbitrary operation digest, which is the part an attacker actually needs.
  const previousUmask = process.umask(0o177)
  try {
    const created = lstatSync(socketPath, { bigint: true })
    if (!created.isSocket()) throw new Error(`${socketPath} is not a socket after bind`)
    socketIdentity = { dev: created.dev, ino: created.ino }
    bound = true
    chmodSync(socketPath, 0o600)
    const settled = lstatSync(socketPath, { bigint: true })
    const mode = settled.mode & 0o777n
    if (mode !== 0o600n) throw new Error(`${socketPath} is mode 0${mode.toString(8)} after chmod`)
  } catch (error) {
    process.umask(previousUmask)
    const detail = String(error?.message ?? error)
    say(`aukora-desktop: aumlok signer: not serving: the socket could not be secured: ${detail}`)
    removeOwnSocket()
    try {
      server.close()
    } catch {
      /* nothing was listening */
    }
    return decide({
      logDir,
      say,
      verdict: { serving: false, reason: 'aumlok:signer-socket-unusable', socketPath: null, detail },
    })
  }
  process.umask(previousUmask)

  say(`aukora-desktop: aumlok signer: serving: ${socketPath}`)
  // THE DISPOSER IS THE ONLY WAY THE SOCKET GOES AWAY, and `main.mjs` calls it from `will-quit`. It
  // does not close over a reference it does not check: `ownsLeafNow()` is read per call, because a
  // path can be replaced while this process runs and a cached answer would delete somebody else's leaf.
  let stopped = false
  const stop = async () => {
    if (stopped) return
    stopped = true
    await new Promise(resolve => {
      try {
        server.close(() => resolve())
      } catch {
        resolve()
      }
    })
    // ORDER MATTERS: `server.close()` unlinks the leaf itself, so the guarded unlink runs after it and
    // is a no-op on the leaf this process created — and on a leaf that is NOT ours, `close()` is never
    // the thing that removes it because `ownsLeafNow()` was false and we would have unlinked nothing.
    removeOwnSocket()
    // THE SOCKET DID NOT EXIST BEFORE THIS CALL, SO THE DECISION THAT IT NO LONGER DOES IS NOT A NEW
    // DECISION — but a reader looking for "why is nothing listening" needs the last line to say so.
    writeSignerDecision(logDir, Object.freeze({ serving: false, reason: 'aumlok:signer-stopped', socketPath }))
  }
  return decide({
    logDir,
    say,
    verdict: { serving: true, reason: null, socketPath, socket: 'aumlok:signer-serving', stop },
  })
}
