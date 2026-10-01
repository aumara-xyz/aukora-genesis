#!/usr/bin/env node
/**
 * RE-ISSUE THE NOSTR BINDING BY ASKING THE AUMLOK SIGNER — the one line for enrol day.
 *
 *   node plugins/aukora-nostr/bin/reissue-binding.mjs \
 *     --state <stateDir> --subject <subject> [--controller <dir>] [--handle <nip05LocalPart>] [--label TEST]
 *
 * WHY THIS EXISTS AS A SCRIPT RATHER THAN A NOTE. Until the owner enrols, the only controller record on
 * this machine is a DISPOSABLE one, so every binding this node can produce is signed by a key that
 * means nothing and is therefore labelled `TEST`. Nothing about the binding machinery changes on enrol
 * day — the Nostr key is machine-generated and is never derived from the phrase, and the binding is
 * signed by the Aumlok key whatever that key happens to be. The ONLY thing that changes is which
 * controller record is on disk. So the re-issue is a re-run, and it should cost one line and zero
 * thought while the enrolment is still fresh.
 *
 * It does not move, overwrite or delete any key. `loadOrCreateNostrKey` returns the existing one if
 * there is one, so re-running this cannot orphan a node's npub — which is the property that makes it
 * safe to run twice.
 *
 * ─────────────────────────────────────────────────────────────────────────────────────────────
 * IT HOLDS NO KEY. IT ASKS THE SIGNER, AND THAT IS THE WHOLE DESIGN.
 *
 * B5 ruled that the MACHINE KEY signs the binding, and that the signer is the only thing in this
 * product that can do so without opening a seed file. This tool therefore:
 *
 *   · NEVER reads a seed file (`machine-seed-v3.json`, `root-seed-v3.json`) — it does not name them;
 *   · NEVER reads or uses `ed25519PrivateKeyPem` from the controller record, even when a v2 record
 *     carries one: that private half is left on disk untouched and unread by this path;
 *   · NEVER signs anything itself. It imports no signing primitive at all, so there is no local
 *     signature to fall back on when the signer is missing — which is the point rather than an
 *     omission, because a binding written without a signature is a document claiming a machine key
 *     vouched for this npub when nothing did.
 *
 * What crosses the socket is ONE compact JSON line naming the operation, and what comes back carries
 * the signature and nothing else. If there is no signer to answer — no socket, a refusal, a reply that
 * does not verify — the tool refuses BY NAME, says so in a readable line, exits non-zero, and writes NO
 * binding file.
 *
 * THE TWO SIDES AGREE BY PROTOCOL, NOT BY A SHARED IMPORT. The request is the four fields the operation
 * names (`{npub, subject, handle, issuedAt}`, plus the operation's own name and the caller's one-use
 * challenge) and the reply is the organ's own response record, exactly as
 * `apps/aukora-desktop/aumlok-signer.mjs` defines them. That module is not part of this plugin's build,
 * so it is read as a contract and imported by nothing here; what this tool writes is then verified with
 * the PLUGIN'S OWN VERIFIER before it reaches the disk.
 * ─────────────────────────────────────────────────────────────────────────────────────────────
 *
 * BACK THIS UP BEFORE YOU NEED IT: the controller record's ML-DSA half is a FRESH RANDOM SEED.
 *
 * The seven words recover the Ed25519 owner key and NOTHING ELSE. The ML-DSA-65 seed is generated
 * randomly at enrolment and is not derivable from the phrase, so if `local-control.json` is lost,
 * the phrase restores one half of the controller and the post-quantum half is gone permanently.
 * Back up the controller record itself, privately, outside this repository. A binding signed by a
 * lost controller cannot be re-issued, only replaced — and replacing it is a new identity, not a
 * recovery.
 */
import { randomBytes } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
/**
 * RESOLVED IN EITHER TREE, for the reason spelled out in `lib/confirmation.mjs`: this file sits at
 * `plugins/aukora-nostr/bin/` in this checkout but at `<release>/aukora-nostr/bin/` in a
 * materialized release, whose lanes are FLAT. `../../aukora-aumlok/...` therefore names a directory
 * OUTSIDE the release, and the materializer rewrites nothing, so the shipped bin could not load.
 * Both layouts are tried and an unresolvable module THROWS BY NAME rather than silently continuing
 * without the signer client.
 */
async function loadSignerClient() {
  const here = new URL('.', import.meta.url)
  const candidates = [
    new URL('../../aukora-aumlok/lib/signer-client.mjs', here),         // a release: flat
    new URL('../../plugins/aukora-aumlok/lib/signer-client.mjs', here), // this checkout: nested
  ]
  const tried = []
  for (const candidate of candidates) {
    tried.push(candidate.pathname)
    try {
      return await import(candidate.href)
    } catch (error) {
      if (error?.code !== 'ERR_MODULE_NOT_FOUND') throw error
    }
  }
  throw new Error(
    `reissue-binding:aumlok-signer-client-absent: the signer client is in neither layout this lane `
    + `ships in, so an operation cannot be asked for: ${tried.join(' , ')}`,
  )
}

const { askSignerOperation } = await loadSignerClient()
import { join, resolve } from 'node:path'

import { assertContactFields, verifyBinding, loadOrCreateNostrKey, NOSTR_BINDING_DOMAIN, NOSTR_SAFETY_VERSION } from '../lib/identity.mjs'
import { isMainModule } from '../lib/is-main.mjs'

/** Every way this tool refuses, by name. A caller routes on these; none of them is prose to parse. */
export const REISSUE_REFUSE = Object.freeze({
  /** No signer answered on the socket: absent, refused the connection, or silent. */
  SIGNER_UNREACHABLE: 'nostr:reissue-signer-unreachable',
  /** The signer answered with something that is not the operation's response record. */
  SIGNER_REPLY_MALFORMED: 'nostr:reissue-signer-reply-malformed',
  /** A signature came back, and the binding it produces does not verify. */
  BINDING_UNVERIFIED: 'nostr:reissue-binding-unverified',
})

/** The operation's name on the wire, and the response domain the signer answers in. */
const OPERATION = 'sign-nostr-binding'
const RESPONSE_DOMAIN = 'aukora:owner-approval-response:v1'

/** The socket this shell binds when nobody has exported one, relative to the state root it was given. */
const SIGNER_SOCKET_ENV = 'AUKORA_SIGNER_SOCKET'
const DEFAULT_SIGNER_SOCKET_NAME = 'aumlok-signer.sock'

/** The longest single protocol line this tool will read: the signer's own ceiling, restated. */
const MAX_SIGNER_LINE_BYTES = 64 * 1024

/**
 * How long to wait for an answer before giving up, in milliseconds.
 *
 * GENEROUS ON PURPOSE: the signer puts the request in front of a PERSON, so the honest bound is the
 * signer's own approval window (300 s in `aumlok-signer.mjs`) plus room for the answer to travel. A
 * shorter timeout here would report an unreachable signer for a window a person was still reading,
 * which is the same defect the signer's own `DEFAULT_SIGNER_TIMEOUT_MS = 310000` exists to prevent.
 */
const SIGNER_REPLY_TIMEOUT_MS = 310_000

/** The shape of one canonical instant, matching the statement's own `createdAt` rule. */
const CANONICAL_INSTANT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/

/** The NPUB this tool is about to ask for, printed as the x-only key: 64 hex, never a secret. */
const HEX64 = /^[0-9a-f]{64}$/

/** A refusal with a name, so `main` can print one line and exit non-zero. */
const refuse = (code, message) => Object.assign(new Error(message), { code })

/** A minimal `--flag value` parser: no dependency, and an unknown flag is an error, not ignored. */
function parseArgs(argv) {
  const known = new Set(['--state', '--controller', '--subject', '--handle', '--label'])
  const out = {}
  for (let i = 0; i < argv.length; i++) {
    const flag = argv[i]
    if (!known.has(flag)) throw new Error(`unknown argument ${flag}; known: ${[...known].join(' ')}`)
    const value = argv[++i]
    if (value === undefined || value.startsWith('--')) throw new Error(`${flag} needs a value`)
    out[flag.slice(2)] = value
  }
  return out
}

/** The usage text, in one place so no two error paths can disagree about it. */
const usage = () => [
  'usage: reissue-binding.mjs --state <stateDir> [--controller <dir>] --subject <subject> [--handle <localPart>] [--label TEST]',
  '  --state       the app state directory (the Nostr key lives in <state>/nostr/)',
  '  --controller  the Aumlok controller record directory (default: <state>/aumlok)',
  '  --subject     the subject this npub belongs to',
  '  --handle      the NIP-05 local part the statement names (default: the record\'s own handle)',
  '  --label       the UNSIGNED label on the document; TEST until the owner enrols',
].join('\n')

/**
 * The signer socket this run will dial, and which rule named it.
 *
 * THE SAME RULE THE SHELL USES, for the same reason: an exported `AUKORA_SIGNER_SOCKET` wins, and
 * otherwise the socket sits at the root of the state directory this tool was pointed at. Deriving it
 * from `--state` rather than guessing at the user's Library is what keeps the tool usable against a
 * test peer's state directory without an environment variable — and it is why a court can run this
 * whole path inside a temporary directory and never dial the live signer.
 * @param {Readonly<Record<string, string|undefined>>} env - the process environment.
 * @param {string} stateDir - the resolved `--state` directory.
 * @returns {Readonly<{socketPath: string, source: string}>} the path and which rule named it.
 */
export function resolveSignerSocketPath(env, stateDir) {
  const configured = env?.[SIGNER_SOCKET_ENV]
  if (typeof configured === 'string' && configured.trim().length > 0) {
    return { socketPath: resolve(configured.trim()), source: SIGNER_SOCKET_ENV }
  }
  return { socketPath: join(stateDir, DEFAULT_SIGNER_SOCKET_NAME), source: 'the state directory' }
}

/**
 * Ask the signer one question over its socket and read ONE line of answer.
 *
 * NO SIGNING HAPPENS HERE AND NO KEY IS READ: the caller's request is serialised, written, and the
 * reply is parsed. Every transport failure — a missing socket, a refused connection, a connection that
 * closes without a newline, a reply over the ceiling, the timeout — is the SAME named refusal, because
 * from the operator's side they are one fact: nothing answered, so nothing may be written.
 * @param {Readonly<Record<string, unknown>>} request - the wire request.
 * @param {string} socketPath - where to dial.
 * @returns {Promise<Readonly<Record<string, unknown>>>} the parsed reply record.
 * @throws {Error} `nostr:reissue-signer-unreachable` or `nostr:reissue-signer-reply-malformed`.
 */
function askTheSigner(request, socketPath) {
  assertContactFields(request)
  // THE TRANSPORT IS SHARED NOW (`plugins/aukora-aumlok/lib/signer-client.mjs`), and this tool supplies its
  // OWN refusal names and limits, so nothing an operator or a court sees from here has changed. It was
  // extracted rather than copied because the Confirm path must speak the same wire: two copies of one
  // protocol — the timeout, the line ceiling, "every transport failure is ONE named refusal", the
  // one-compact-JSON-line rule — drift, and a drifted wire is a signature that does not verify.
  return askSignerOperation(request, socketPath, {
    unreachable: REISSUE_REFUSE.SIGNER_UNREACHABLE,
    malformed: REISSUE_REFUSE.SIGNER_REPLY_MALFORMED,
    timeoutMs: SIGNER_REPLY_TIMEOUT_MS,
    maxBytes: MAX_SIGNER_LINE_BYTES,
  }).then(reply => { assertContactFields(reply); return reply })
}

/**
 * The binding document one signer reply produces for a request — the statement rebuilt BY THE CALLER,
 * never taken from anything the signer says about it.
 *
 * THE STATEMENT IS DERIVED, NOT ECHOED. `nostrPubkeyHex` is this node's own x-only key and `createdAt`
 * is the request's own `issuedAt`, so the bytes verified here are the bytes that were asked for. A
 * signer that signed something else produces a signature that does not verify against this statement,
 * which is exactly the refusal the caller needs.
 * @param {Readonly<{statement: Readonly<Record<string, unknown>>, signature: string}>} input - the statement and the signer's signature.
 * @param {string} signerKeyHex - the controller key the record nominates, as 64 hex.
 * @param {string} label - the UNSIGNED document label.
 * @returns {Readonly<Record<string, unknown>>} the binding document.
 */
function bindingFromReply({ statement, signature }, signerKeyHex, label) {
  assertContactFields({ statement, signature, signerKeyHex, label })
  return Object.freeze({
    domain: NOSTR_BINDING_DOMAIN,
    statement: Object.freeze(statement),
    signature,
    // THE DOCUMENT-LEVEL SIGNER, ENUMERABLE SO IT CROSSES THE WIRE. The signed statement is the ruled
    // five keys and carries no signer; a reader that needs to ask "who does this document say signed
    // it?" reads it here, and `verifyBindingUnderItsSigner` proves the claim by verifying under this
    // very key. See `SIGNER_KEY_DID_FIELD` in identity.mjs for why it is not inside the statement.
    approvalKeyDid: `did:key:${signerKeyHex}`,
    label,
  })
}

/**
 * The controller ed25519 signer key the record nominates, as 64 hex — the same key `verifyBinding`
 * will resolve, so the name written on the document is the key the verifier uses.
 * @param {string} controllerDir - the directory holding `local-control.json`.
 * @returns {string|null} 64 hex, or null when the record names no usable signer.
 */
function signerKeyOfRecord(controllerDir) {
  const record = JSON.parse(readFileSync(join(controllerDir, 'local-control.json'), 'utf8'))
  const machines = record?.publicRoot?.machines
  if (Array.isArray(machines) && machines.length > 0 && HEX64.test(machines[0]?.ed25519 ?? '')) {
    return machines[0].ed25519
  }
  const v2 = record?.activeControl?.publicKeys?.ed25519
  return HEX64.test(v2 ?? '') ? v2 : null
}

/**
 * The NIP-05 local part on the statement: the flag if given, then the record's own handle, then `TEST`
 * — the same order `identity.mjs`'s `resolveHandle` uses, so a record that names no handle produces the
 * same statement here as it would there.
 * @param {Readonly<Record<string, string>>} args - the parsed flags.
 * @param {string} controllerDir - the controller record directory.
 * @returns {string} the local part to ask the signer to sign.
 */
function handleFor(args, controllerDir) {
  if (typeof args.handle === 'string' && args.handle.length > 0) return args.handle
  try {
    const record = JSON.parse(readFileSync(join(controllerDir, 'local-control.json'), 'utf8'))
    const enrolled = record?.publicRoot?.handle
    if (typeof enrolled === 'string' && enrolled.length > 0) return enrolled
  } catch { /* an unreadable record is refused by the run below, not swallowed into a default */ }
  return 'TEST'
}

async function main(argv) {
  // A bad flag is a usage error, not a crash. This script is meant to be run once, by hand, on the day
  // of an enrolment, so its failure has to be readable rather than a Node stack trace.
  let args
  try {
    args = parseArgs(argv)
    assertContactFields(args)
  } catch (cause) {
    console.error(cause.message)
    console.error(usage())
    return 2
  }
  if (args.state === undefined) {
    console.error(usage())
    return 2
  }
  const stateDir = resolve(args.state)
  // Defaulting to <state>/aumlok is a guess about layout, so it is stated in the output rather than
  // assumed silently: the script prints the exact controller directory it used either way.
  const controllerDir = resolve(args.controller ?? join(stateDir, 'aumlok'))
  const label = args.label ?? 'TEST'
  const subject = args.subject
  if (subject === undefined) {
    console.error('--subject is required: a binding says WHICH subject owns the npub')
    return 2
  }
  if (!existsSync(join(controllerDir, 'local-control.json'))) {
    console.error(`no controller record at ${controllerDir}/local-control.json`)
    console.error('If the owner has not enrolled yet, there is nothing real to sign with. Do not invent one.')
    return 1
  }

  const { socketPath, source } = resolveSignerSocketPath(process.env, stateDir)
  // THE NOSTR KEY IS THE ONLY KEY THIS TOOL TOUCHES, and it is a public identity it may create.
  const nostr = loadOrCreateNostrKey(stateDir)
  console.log(`nostr key   : ${nostr.created ? 'CREATED just now' : 'loaded (existing npub preserved)'}`)
  console.log(`npub        : ${nostr.npub}`)
  console.log(`x-only hex  : ${nostr.xonlyHex}`)
  console.log(`controller  : ${controllerDir}`)
  console.log(`signer sock : ${socketPath} (from ${source})`)

  const issuedAt = new Date().toISOString().replace(/\.\d{3}Z$/, 'Z')
  if (!CANONICAL_INSTANT.test(issuedAt)) {
    console.error(`refused: ${REISSUE_REFUSE.SIGNER_REPLY_MALFORMED} — this machine's clock did not produce a canonical instant`)
    return 1
  }
  const handle = handleFor(args, controllerDir)
  // THE STATEMENT IS BUILT HERE FROM WHAT THIS NODE KNOWS, and the hex is the npub's own key rather
  // than a second claim; the signer rebuilds the same statement from the request.
  const statement = {
    subject,
    npub: nostr.npub,
    nostrPubkeyHex: nostr.xonlyHex,
    handle,
    createdAt: issuedAt,
    safetyVersion: NOSTR_SAFETY_VERSION,
  }
  const request = {
    operation: OPERATION,
    npub: nostr.npub,
    subject,
    handle,
    issuedAt,
    safetyVersion: NOSTR_SAFETY_VERSION,
    // THE CHALLENGE IS THIS CALLER'S OWN ONE-USE VALUE, and the answer must carry it back: a reply that
    // does not is an answer to some other question, which is not an answer to this one.
    challenge: randomBytes(32).toString('hex'),
  }

  let reply
  try {
    reply = await askTheSigner(request, socketPath)
  } catch (cause) {
    console.error(`refused: ${cause.code ?? REISSUE_REFUSE.SIGNER_UNREACHABLE} — ${cause.message}`)
    return 1
  }
  // A SIGNER'S OWN REFUSAL NAME TRAVELS THROUGH VERBATIM. The tool must not invent a synonym for it and
  // must not report a decline as a transport failure: an operator needs to know whether nobody answered
  // or somebody said no.
  if (typeof reply.refusal === 'string' && reply.refusal.length > 0) {
    console.error(`refused: ${reply.refusal} — the signer answered ${OPERATION} with its own refusal name`)
    return 1
  }
  if (reply.domain !== RESPONSE_DOMAIN || typeof reply.signature !== 'string') {
    console.error(`refused: ${REISSUE_REFUSE.SIGNER_REPLY_MALFORMED} — the reply is neither a refusal nor a signature record`)
    return 1
  }
  if (reply.challenge !== request.challenge) {
    console.error(`refused: ${REISSUE_REFUSE.SIGNER_REPLY_MALFORMED} — the reply carries a different challenge, so it answers a different request`)
    return 1
  }
  if (!/^([0-9a-f]{2}){64}$/i.test(reply.signature)) {
    console.error(`refused: ${REISSUE_REFUSE.SIGNER_REPLY_MALFORMED} — the signature is not 128 hex characters`)
    return 1
  }

  const signerKeyHex = signerKeyOfRecord(controllerDir)
  if (signerKeyHex === null) {
    console.error(`refused: ${REISSUE_REFUSE.BINDING_UNVERIFIED} — the controller record at ${controllerDir} names no machine signer key to verify against`)
    return 1
  }
  const binding = bindingFromReply({ statement, signature: reply.signature }, signerKeyHex, label)

  // VERIFY BEFORE WRITING. The signer's answer is checked against the record this machine holds, over
  // the statement THIS TOOL built, so a signer that signed something else is caught here and nothing
  // reaches the disk.
  const verdict = verifyBinding(binding, { controllerDir, expectSubject: subject })
  if (verdict.verdict !== 'verified') {
    console.error(`refused: ${REISSUE_REFUSE.BINDING_UNVERIFIED} — the document this signature produces does not verify: ${verdict.code} ${verdict.detail}`)
    return 1
  }

  const outDir = join(stateDir, 'nostr')
  mkdirSync(outDir, { recursive: true, mode: 0o700 })
  const outFile = join(outDir, 'binding.json')
  writeFileSync(outFile, `${JSON.stringify(binding, null, 2)}\n`, { mode: 0o600 })

  // Verify what was just written, by reading it back off disk rather than trusting the object in hand.
  // A binding that cannot be re-read and re-verified is not a binding that was issued.
  const reread = JSON.parse(readFileSync(outFile, 'utf8'))
  const rereadVerdict = verifyBinding(reread, { controllerDir, expectSubject: subject })
  console.log(`binding     : ${outFile}`)
  console.log(`label       : ${label} (UNSIGNED: the signer signs the statement, not the label)`)
  console.log(`subject     : ${subject}`)
  console.log(`handle      : ${handle}`)
  console.log(`signer did  : ${binding.approvalKeyDid}`)
  console.log(`verdict     : ${rereadVerdict.verdict}${rereadVerdict.code ? ` ${rereadVerdict.code}` : ''}`)

  if (rereadVerdict.verdict !== 'verified') {
    console.error(`the binding did not verify after writing: ${rereadVerdict.code} — ${rereadVerdict.detail}`)
    return 1
  }
  if (label !== 'TEST') {
    console.log()
    console.log('Back up the controller record now, privately and outside this repository:')
    console.log(`  ${join(controllerDir, 'local-control.json')}`)
    console.log('The seven words recover the Ed25519 key only. The ML-DSA seed is a fresh random seed,')
    console.log('so an unbacked-up controller record cannot be recovered from the phrase.')
  }
  return 0
}

// Run only when invoked as a program, so a court can import the socket rule and the refusal names
// without the import performing an issue against somebody's state directory.
if (isMainModule(import.meta.url)) {
  process.exitCode = await main(process.argv.slice(2))
}

export { main, askTheSigner, bindingFromReply }
