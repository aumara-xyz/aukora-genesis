#!/usr/bin/env node
/**
 * A DISPOSABLE PEER TO TALK TO — the second identity this lane needs to prove messaging.
 *
 *   node plugins/aukora-nostr/bin/test-peer.mjs create --state <dir> [--name <label>]
 *   node plugins/aukora-nostr/bin/test-peer.mjs show   --state <dir>
 *   node plugins/aukora-nostr/bin/test-peer.mjs read   --state <dir> [--relays <url,url>] [--lookback <s>]
 *
 * WHY THIS EXISTS. Until now the whole messaging path was provable only IN PROCESS, inside
 * `scripts/demo/steps/60-nostr.mjs`. That is a demo: it runs, it prints, it ends. It cannot be left
 * running while the owner sends a real message from the Messages screen, so there was nothing on the
 * other end to prove the message arrived. This is that other end — a peer that persists between runs.
 *
 * ─────────────────────────────────────────────────────────────────────────────────────────────────
 * IT IS A TEST IDENTITY AND IT SAYS SO EVERYWHERE: on disk, in `show`, and on every line `create`
 * prints. It vouches for nothing and it is disposable. A real identity and this one must never be
 * mistakable for each other, which is why the marker is checked on every read rather than assumed
 * from the directory's name: `show` and `read` REFUSE a directory that is not a test peer.
 * ─────────────────────────────────────────────────────────────────────────────────────────────────
 *
 * WHAT `create` PRINTS IS THE WHOLE POINT. Two strings, in a form that can be pasted into a chat:
 * the peer's `npub` (its address on the network) and its controller public key (the key that vouches
 * for that address). Those are exactly the two strings the other side needs, and exchanging them is
 * the step that has no UI yet.
 *
 * RE-RUNNING `create` PRESERVES THE Npub. `loadOrCreateNostrKey` returns the existing key when there
 * is one, so this cannot orphan an identity — the same property that makes `reissue-binding.mjs` safe
 * to run twice.
 *
 * IT READS BACK ONLY WHAT IT CAN PROVE. A message whose sender cannot be established is NOT reported
 * with a missing field; it is refused and named. A relay carrying a wrap we cannot open is not a
 * message from anyone.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

import { generateKeyPairSync } from 'node:crypto'

import { createBinding, loadOrCreateNostrKey, npubEncode, npubDecode } from '../lib/identity.mjs'
import { sasFingerprint } from '../lib/contact.mjs'
import { openGiftWrap, composeDirectMessage } from '../lib/giftwrap.mjs'
import { fetchGiftWraps, DEFAULT_RELAYS, DEFAULT_LOOKBACK_SECONDS, publishToRelays } from '../lib/relay.mjs'
import { writeMessageEvidence, wireDigest } from '../lib/evidence.mjs'
import { isMainModule } from '../lib/is-main.mjs'

/** The document this tool writes to mark a directory as a disposable test peer. */
export const TEST_PEER_DOMAIN = 'aukora:nostr-test-peer:v1'

/** The file that carries the marker, inside the state directory. */
export const TEST_PEER_FILE = 'TEST-PEER.json'

/** Why a peer command refused, by name rather than as a boolean. */
export const TEST_PEER_REFUSE = Object.freeze({
  NOT_A_PEER: 'nostr:test-peer-not-a-peer',
  UNREADABLE: 'nostr:test-peer-unreadable',
  USAGE: 'nostr:test-peer-usage',
})

const refuse = (code, detail) => Object.assign(new Error(detail), { code })

/** A minimal `--flag value` parser: an unknown flag is an error, never ignored. */
function parseArgs(argv, known) {
  const out = {}
  for (let i = 0; i < argv.length; i++) {
    const flag = argv[i]
    if (!flag.startsWith('--')) throw refuse(TEST_PEER_REFUSE.USAGE, `unexpected argument ${flag}`)
    if (!known.has(flag)) throw refuse(TEST_PEER_REFUSE.USAGE, `unknown argument ${flag}; known: ${[...known].join(' ')}`)
    const value = argv[++i]
    if (value === undefined || value.startsWith('--')) throw refuse(TEST_PEER_REFUSE.USAGE, `${flag} needs a value`)
    out[flag.slice(2)] = value
  }
  return out
}

/**
 * A disposable Aumlok controller for the peer: an ed25519 keypair written in the v2 shape.
 *
 * The peer needs a controller so it can issue a binding, which is what lets the other side resolve
 * it to a real contact state rather than UNBOUND. Disposable by construction — the private half is
 * generated here and never leaves this directory.
 *
 * @param {string} dir - where the controller record goes.
 * @returns {Readonly<{dir: string, publicKeyHex: string}>} the directory and the public signer key.
 */
export function disposablePeerController(dir) {
  mkdirSync(dir, { recursive: true, mode: 0o700 })
  const { publicKey, privateKey } = generateKeyPairSync('ed25519')
  const publicKeyHex = publicKey.export({ type: 'spki', format: 'der' }).subarray(-32).toString('hex')
  writeFileSync(join(dir, 'local-control.json'), JSON.stringify({
    domain: 'aukora:local-aumlok-control:v1',
    ed25519PrivateKeyPem: privateKey.export({ type: 'pkcs8', format: 'pem' }).toString(),
    activeControl: { subject: null, epoch: 0, revoked: false, publicKeys: { ed25519: publicKeyHex } },
  }, null, 2), { mode: 0o600 })
  return Object.freeze({ dir, publicKeyHex })
}

/**
 * Create (or re-open) the disposable peer in `stateDir`.
 * @param {Readonly<{stateDir: string, name?: string, createdAt?: string}>} input - where and what.
 * @returns {Readonly<Record<string, unknown>>} the peer's public facts.
 */
export function createPeer(input) {
  const stateDir = resolve(input.stateDir)
  mkdirSync(stateDir, { recursive: true, mode: 0o700 })
  const nostr = loadOrCreateNostrKey(stateDir)
  const controllerDir = join(stateDir, 'peer-controller')
  const existing = existsSync(join(controllerDir, 'local-control.json'))
    ? JSON.parse(readFileSync(join(controllerDir, 'local-control.json'), 'utf8'))
    : undefined
  const controller = existing === undefined
    ? disposablePeerController(controllerDir)
    : Object.freeze({ dir: controllerDir, publicKeyHex: existing.activeControl.publicKeys.ed25519 })
  const record = {
    domain: TEST_PEER_DOMAIN,
    label: input.name ?? 'TEST',
    disposable: true,
    npub: nostr.npub,
    nostrPubkeyHex: nostr.xonlyHex,
    controllerPublicKey: controller.publicKeyHex,
    controllerDir,
    createdAt: input.createdAt ?? new Date().toISOString().replace(/\.\d{3}Z$/, 'Z'),
  }
  writeFileSync(join(stateDir, TEST_PEER_FILE), `${JSON.stringify(record, null, 2)}\n`, { mode: 0o600 })
  return Object.freeze({ ...record, nostrReused: !nostr.created, controllerReused: existing !== undefined })
}

/**
 * Read a peer's own marker, refusing anything that is not one.
 *
 * The marker is the authority, not the directory's name: a directory that merely looks like a peer
 * is not one, and reporting it as a peer would put a disposable label on something that may be real.
 *
 * @param {string} stateDir - the peer's directory.
 * @returns {Readonly<Record<string, unknown>>} the marker.
 */
export function readPeerMarker(stateDir) {
  const file = join(resolve(stateDir), TEST_PEER_FILE)
  if (!existsSync(file)) {
    throw refuse(TEST_PEER_REFUSE.NOT_A_PEER, `no ${TEST_PEER_FILE} in ${resolve(stateDir)}: this is not a test peer`)
  }
  let parsed
  try { parsed = JSON.parse(readFileSync(file, 'utf8')) } catch (cause) {
    throw refuse(TEST_PEER_REFUSE.UNREADABLE, `the peer marker at ${file} is not JSON: ${cause?.message ?? cause}`)
  }
  if (parsed?.domain !== TEST_PEER_DOMAIN) {
    throw refuse(TEST_PEER_REFUSE.NOT_A_PEER, `the marker at ${file} is not a ${TEST_PEER_DOMAIN} document`)
  }
  return Object.freeze(parsed)
}

/**
 * The peer's binding, as the other side would hold it: issued by the peer and signed by its own
 * controller, labelled TEST because that is what this identity is.
 * @param {string} stateDir - the peer's directory.
 * @returns {Readonly<Record<string, unknown>>} the binding document.
 */
export function peerBinding(stateDir) {
  const peer = readPeerMarker(stateDir)
  const nostr = loadOrCreateNostrKey(resolve(stateDir))
  return createBinding({
    controllerDir: peer.controllerDir,
    subject: 'did:aukora:test-peer',
    nostr,
    label: 'TEST',
    createdAt: peer.createdAt,
  })
}

/**
 * Read back what has arrived for the peer, and prove who sent it.
 *
 * A WRAP THAT DOES NOT OPEN, OR WHOSE SENDER CANNOT BE ESTABLISHED, IS NOT A MESSAGE. It is counted
 * as a refusal and named, because reporting it with an empty sender would be reporting an anonymous
 * message as if the network had delivered one.
 *
 * @param {Readonly<{stateDir: string, relays?: readonly string[], lookback?: number, timeoutMs?: number, WebSocketImpl?: unknown, now?: number}>} input - where and how to look.
 * @returns {Promise<Readonly<Record<string, unknown>>>} the opened messages and the refusals.
 */
export async function readPeer(input) {
  const stateDir = resolve(input.stateDir)
  const peer = readPeerMarker(stateDir)
  const nostr = loadOrCreateNostrKey(stateDir)
  const since = input.now === undefined
    ? undefined
    : input.now - (input.lookback ?? DEFAULT_LOOKBACK_SECONDS)
  const fetched = await fetchGiftWraps({
    recipientPubkey: nostr.xonlyHex,
    since,
    relays: input.relays ?? DEFAULT_RELAYS,
    timeoutMs: input.timeoutMs ?? 8000,
    WebSocketImpl: input.WebSocketImpl,
    now: input.now,
  })

  const opened = []
  const refused = []
  for (const wrap of fetched.wraps ?? []) {
    // `openGiftWrap` THROWS on every refusal and returns `{rumor, seal, sender}` on success — it does
    // not return a verdict object. Reading it as one made every message look refused, which is the
    // failure this arm caught.
    let result
    try {
      result = openGiftWrap(wrap, { recipientSecretKey: nostr.secretKeyHex })
    } catch (cause) {
      refused.push({ eventId: wrap.id, code: cause?.code ?? 'nostr:wrap-not-opened', detail: cause?.message ?? String(cause) })
      continue
    }
    // ONE RECORD PER MESSAGE THAT OPENED, written before it is reported, so a message that is shown
    // is a message whose wire is retained and re-derivable.
    const evidence = writeMessageEvidence({ stateDir, wrap, observedAt: peer.createdAt })
    // `sender` is the RUMOR's pubkey, established by the seal's signature and not by anything the
    // wrap claims about itself. A message whose sender could not be established never reaches here.
    opened.push({
      from: result.sender,
      fromNpub: npubEncode(result.sender),
      text: result.rumor.content,
      createdAt: result.rumor.created_at,
      eventId: wrap.id,
      recordPath: evidence.path,
      contentDigest: evidence.record.contentDigest,
    })
  }
  return Object.freeze({
    peer: peer.npub,
    relays: fetched.outcomes ?? [],
    opened,
    refused,
  })
}


/**
 * SEND ONE MESSAGE AS THE TEST PEER — the half this tool was missing.
 *
 * WHY IT EXISTS. `create`, `show` and `read` made a peer that could be READ FROM and never SPEAK.
 * Proving RECEIVING on the owner's node needs a message to arrive from somewhere, and until this
 * existed the only sender was the owner's own face — which proves nothing about receiving. This is
 * the other direction, and it is the whole reason a second identity was built.
 *
 * IT IS STILL A TEST IDENTITY AND IT STILL SAYS SO: `readPeerMarker` is consulted FIRST, so a
 * directory that is not a marked test peer is refused before anything is composed or published. A
 * real identity must never be reachable through this path.
 *
 * IT PUBLISHES, so it is the one subcommand here with an effect outside this machine. It returns the
 * wrap and the per-relay outcomes rather than deciding what they mean: a caller that wants to know
 * whether the message was accepted reads `outcomes`, and a relay that refused is named.
 *
 * @param {{stateDir: string, to: string, text: string, relays?: readonly string[]}} input - the peer,
 *   the recipient npub, the message, and where to publish.
 * @returns {Promise<{peer: object, wrap: object, recipient: string, published: object}>} what was sent,
 *   with the publish result carrying `accepted`, `outcomes` and a NAMED `verdict` when nobody did.
 */
export async function sendPeer({ stateDir, to, text, relays = DEFAULT_RELAYS }) {
  const peer = readPeerMarker(stateDir)
  if (typeof to !== 'string' || to === '') throw new Error('send needs --to <npub>')
  if (typeof text !== 'string' || text === '') throw new Error('send needs --text <message>')
  const recipient = npubDecode(to)
  const nostr = loadOrCreateNostrKey(stateDir)
  const composed = composeDirectMessage({
    text,
    senderSecretKey: nostr.secretKeyHex,
    recipientPubkeys: [recipient],
  })
  const chosen = composed.wraps.find(w => w.recipient === recipient)
  if (chosen === undefined) throw new Error('the composition produced no wrap for that recipient')
  const published = await publishToRelays(chosen.wrap, { relays })
  return { peer, wrap: chosen.wrap, recipient, published }
}

// ── the command line ─────────────────────────────────────────────────────────────────────────────

const USAGE = [
  'usage: test-peer.mjs <create|show|binding|read|send> --state <dir> [options]',
  '  create  --state <dir> [--name <label>]                  make or re-open a disposable TEST peer',
  '  show    --state <dir>                                   print the peer and say that it is a test peer',
  '  read    --state <dir> [--relays a,b] [--lookback <sec>] read back what arrived and prove senders',
  '  binding --state <dir> [--out <path>]                    the peer\'s OWN binding, for add-contact',
  '  send    --state <dir> --to <npub> --text <msg> [--relays a,b]  publish ONE message AS the peer',
].join('\n')

async function main(argv) {
  const [command, ...rest] = argv
  try {
    if (command === 'create') {
      const args = parseArgs(rest, new Set(['--state', '--name']))
      if (args.state === undefined) throw refuse(TEST_PEER_REFUSE.USAGE, '--state is required')
      const peer = createPeer({ stateDir: args.state, name: args.name })
      console.log('TEST PEER — disposable, vouches for nothing, safe to delete.')
      console.log(`nostr key   : ${peer.nostrReused ? 'loaded (existing npub preserved)' : 'CREATED just now'}`)
      console.log(`controller  : ${peer.controllerReused ? 'loaded (existing key preserved)' : 'CREATED just now'}`)
      console.log(`state dir   : ${resolve(args.state)}`)
      console.log('')
      console.log('Send these two lines to the other side:')
      console.log(`  npub                : ${peer.npub}`)
      console.log(`  controller public   : ${peer.controllerPublicKey}`)
      return 0
    }
    if (command === 'show') {
      const args = parseArgs(rest, new Set(['--state']))
      if (args.state === undefined) throw refuse(TEST_PEER_REFUSE.USAGE, '--state is required')
      const peer = readPeerMarker(args.state)
      console.log('TEST PEER — disposable, vouches for nothing, safe to delete.')
      console.log(`label       : ${peer.label}`)
      console.log(`npub        : ${peer.npub}`)
      console.log(`controller  : ${peer.controllerPublicKey}`)
      console.log(`state dir   : ${resolve(args.state)}`)
      // THE PEER'S HALF OF THE READ-ALOUD. A SAS is a COMPARISON, so both people need the string:
      // the owner's face shows it for the contact, and until this line the peer had no way to show
      // theirs at all — which made the one step that actually establishes trust impossible to perform.
      // It is derived from the peer's OWN record, not from anything the other side sent.
      const sas = sasFingerprint({ controllerKeyHex: peer.controllerPublicKey, npub: peer.npub })
      console.log(`sas         : ${sas.digits}   (say: ${sas.spoken})`)
      console.log('              read this aloud and compare it with what the other person sees')
      return 0
    }
    if (command === 'binding') {
      const args = parseArgs(rest, new Set(['--state', '--out']))
      if (args.state === undefined) throw refuse(TEST_PEER_REFUSE.USAGE, '--state is required')
      // THE LABEL IS NOT A FLAG. `peerBinding` labels this TEST and that is the honest label for a
      // disposable controller, so there is no way to ask this tool for a binding that claims more
      // than the identity behind it can support. A `--label` here would be a one-word way to make a
      // contact row read stronger than the key that signed it.
      const document = peerBinding(args.state)
      const text = `${JSON.stringify(document, null, 2)}\n`
      if (args.out === undefined) {
        process.stdout.write(text)
      } else {
        writeFileSync(resolve(args.out), text)
        console.log(`binding written: ${resolve(args.out)}`)
        console.log(`subject        : ${document.statement.subject}`)
        console.log(`label          : ${document.label}  (UNSIGNED — a note about which key signed, not a claim about a person)`)
        console.log(`npub           : ${document.statement.npub}`)
        const sas = sasFingerprint({ controllerKeyHex: document.statement.controllerKeyHex ?? readPeerMarker(args.state).controllerPublicKey, npub: document.statement.npub })
        console.log(`sas            : ${sas.digits}   (say: ${sas.spoken})`)
        console.log(`next           : add-contact.mjs --binding ${resolve(args.out)}`)
      }
      return 0
    }
    if (command === 'send') {
      const args = parseArgs(rest, new Set(['--state', '--to', '--text', '--relays']))
      if (args.state === undefined) throw refuse(TEST_PEER_REFUSE.USAGE, '--state is required')
      if (args.to === undefined) throw refuse(TEST_PEER_REFUSE.USAGE, '--to is required')
      if (args.text === undefined) throw refuse(TEST_PEER_REFUSE.USAGE, '--text is required')
      const relays = args.relays === undefined ? undefined : args.relays.split(',').map(r => r.trim()).filter(Boolean)
      const result = await sendPeer({ stateDir: args.state, to: args.to, text: args.text, relays })
      const accepted = result.published.accepted
      const digest = wireDigest(result.wrap)
      console.log(`sent as     : ${result.peer.npub}   (a DISPOSABLE TEST identity — it vouches for nothing)`)
      console.log(`to          : ${args.to}`)
      console.log(`wrap id     : ${result.wrap.id}`)
      console.log(`wire digest : ${digest}`)
      console.log(`recipient   : ${result.recipient}`)
      console.log(`accepted    : ${accepted.length} of ${result.published.outcomes.length} relays`)
      if (result.published.verdict !== null) console.log(`verdict     : ${result.published.verdict}`)
      for (const outcome of result.published.outcomes) {
        console.log(`  ${outcome.state.padEnd(14)} ${outcome.relay}${outcome.message === '' ? '' : `  ${outcome.message}`}`)
      }
      return accepted.length === 0 ? 1 : 0
    }
    if (command === 'read') {
      const args = parseArgs(rest, new Set(['--state', '--relays', '--lookback']))
      if (args.state === undefined) throw refuse(TEST_PEER_REFUSE.USAGE, '--state is required')
      const relays = args.relays === undefined ? undefined : args.relays.split(',').map(r => r.trim()).filter(Boolean)
      const lookback = args.lookback === undefined ? undefined : Number(args.lookback)
      const result = await readPeer({ stateDir: args.state, relays, lookback })
      console.log(`peer        : ${result.peer}`)
      console.log(`opened      : ${result.opened.length}`)
      for (const message of result.opened) {
        console.log(`  from      : ${message.fromNpub}  (${message.from.slice(0, 16)}…)`)
        console.log(`  at        : ${message.createdAt}`)
        console.log(`  record    : ${message.recordPath}`)
        console.log(`  digest    : ${message.contentDigest}`)
      }
      console.log(`refused     : ${result.refused.length}`)
      for (const refusal of result.refused) console.log(`  ${refusal.code} ${refusal.eventId}`)
      return 0
    }
    console.error(USAGE)
    return 2
  } catch (cause) {
    // A hand-run command fails readably, never as a stack trace.
    console.error(`${cause?.code ?? 'error'}: ${cause?.message ?? cause}`)
    if (cause?.code === TEST_PEER_REFUSE.USAGE) console.error(USAGE)
    return cause?.code === TEST_PEER_REFUSE.USAGE ? 2 : 1
  }
}

if (isMainModule(import.meta.url)) {
  process.exitCode = await main(process.argv.slice(2))
}
