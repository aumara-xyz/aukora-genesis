#!/usr/bin/env node
// node scripts/aura/echo-head.mjs [aura.jsonl]
// Exit 0 VERIFIED, 1 CONTRADICTED, 2 UNAVAILABLE. Node >= 22.18 (vendored .ts import).
// Read the source only; all identities, copies and retention are disposable.
// Same machine/UID, automatic scratch pairing: no independent or lasting witness.
import { createHash } from 'node:crypto'
import { chmodSync, copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

const DEFAULT_CHAIN = join(homedir(), 'Library', 'Application Support', 'AUKORA', 'state', 'home', 'aura-code', 'aura.jsonl')
const DOMAIN = 'aukora:aura-record:v1'
const EXIT = { VERIFIED: 0, CONTRADICTED: 1, UNAVAILABLE: 2 }
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex')

class Verdict extends Error {
  constructor(assurance, reason) { super(reason); this.assurance = assurance }
}

// Ported from verify-append-only.mjs's independent Aura check. First Echo's
// frontierOf reads stored hashes, so calling it alone would miss body edits.
function canonical(value) {
  if (value === null || typeof value !== 'object') return JSON.stringify(value)
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`
  return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonical(value[key])}`).join(',')}}`
}

function checkedHead(file) {
  const bytes = readFileSync(file)
  let text
  try { text = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes) }
  catch {
    throw new Verdict('CONTRADICTED', 'Aura copy is not UTF-8')
  }
  if (!text) throw new Verdict('UNAVAILABLE', 'Aura copy is empty; no head to witness')
  if (!text.endsWith('\n')) throw new Verdict('UNAVAILABLE', 'Aura copy has an incomplete final line; retry after the append finishes')
  const lines = text.slice(0, -1).split('\n')
  let prev = DOMAIN
  for (const [index, line] of lines.entries()) {
    const fail = reason => { throw new Verdict('CONTRADICTED', `${reason} at Aura entry ${index + 1}`) }
    let entry
    try { entry = JSON.parse(line) } catch { fail('CHAIN_UNPARSEABLE') }
    if (entry === null || typeof entry !== 'object' || Array.isArray(entry)) fail('CHAIN_UNPARSEABLE')
    if (JSON.stringify(entry) !== line) fail('CHAIN_NOT_CANONICAL')
    const { hash, prev: link, ...fields } = entry
    // v1's domain is preimage-only: a wire field would be silently overwritten below.
    if (Object.hasOwn(fields, 'domain')) fail('CHAIN_RESERVED_FIELD')
    if (typeof hash !== 'string' || !/^[0-9a-f]{64}$/.test(hash)) fail('CHAIN_NO_HASH')
    if (link !== prev) fail('CHAIN_BROKEN_LINK')
    if (sha256(canonical({ prev: link, ...fields, domain: DOMAIN })) !== hash) fail('CHAIN_TAMPERED')
    if (fields.sequence !== index + 1) fail('SEQUENCE_NOT_POSITION')
    prev = hash
  }
  return { sequence: lines.length, hash: prev }
}

async function echoHead(source) {
  const scratch = mkdtempSync(join(tmpdir(), 'aura-echo-head-'))
  const senderDir = join(scratch, 'sender')
  const witnessDir = join(scratch, 'witness')
  // Pin every vendor storage route to scratch, even if the caller has overrides.
  // Keep git discovery from borrowing a parent repository's identity as well.
  const overrides = {
    AUKORA_KEYS_DIR: join(senderDir, 'keys'),
    AUKORA_CHAIN_HOME: join(senderDir, 'chains'),
    GIT_CEILING_DIRECTORIES: scratch,
    GIT_DIR: undefined,
    GIT_WORK_TREE: undefined,
    GIT_COMMON_DIR: undefined,
  }
  const saved = Object.fromEntries(Object.keys(overrides).map(key => [key, process.env[key]]))
  const setEnv = values => {
    for (const [key, value] of Object.entries(values)) {
      if (value === undefined) delete process.env[key]
      else process.env[key] = value
    }
  }
  try {
    setEnv(overrides)
    mkdirSync(join(senderDir, '.aukora'), { recursive: true, mode: 0o700 })
    mkdirSync(process.env.AUKORA_CHAIN_HOME, { recursive: true, mode: 0o700 })
    mkdirSync(witnessDir, { mode: 0o700 })
    // This labels the input for this local rehearsal; it is not a durable identity.
    const repoId = sha256(`aukora:aura-echo-file:v1\0${source}`).slice(0, 32)
    writeFileSync(join(senderDir, '.aukora', 'identity.json'), JSON.stringify({ id: repoId, source: 'aura-file' }), { mode: 0o600 })
    const snapshot = join(process.env.AUKORA_CHAIN_HOME, `${repoId}.jsonl`)
    copyFileSync(source, snapshot)
    chmodSync(snapshot, 0o600)
    const head = checkedHead(snapshot)

    // Import only after isolation is in place. Reuse the vendored courier intact:
    // emit -> frontierOf/deltaOf -> buildCheckpointPush; accept -> witnessPush
    // -> verifyDelta/retention/signAck; verify -> verifyWitnessAck.
    const { pairPeer } = await import('../../vendor/aukora-first-echo/src/core/witness/peer.mjs')
    const { exportablePeer, importPeer, emit, accept, verify } = await import('../../vendor/aukora-first-echo/src/core/echo/courier.mjs')
    const on = (dir, fn) => {
      process.env.AUKORA_KEYS_DIR = join(dir, 'keys')
      process.env.AUKORA_CHAIN_HOME = join(dir, 'chains')
      return fn()
    }
    const requireOk = (result, step) => {
      if (!result.ok) throw new Verdict('UNAVAILABLE', `${step}: ${result.reason}`)
      return result
    }
    const sender = on(senderDir, () => pairPeer({ name: 'disposable Aura sender' }))
    const witness = on(witnessDir, () => pairPeer({ name: 'disposable Aura witness' }))
    // Public records only; private channel files stay in their own directories.
    // Automatic pairing is safe only for these disposable rehearsal identities.
    on(senderDir, () => requireOk(importPeer(exportablePeer(witness), { expect: witness.peerId }), 'import witness'))
    on(witnessDir, () => requireOk(importPeer(exportablePeer(sender), { expect: sender.peerId }), 'import sender'))
    const request = on(senderDir, () => requireOk(emit(senderDir, {
      asPeerId: sender.peerId, forWitness: witness.peerId,
      at: new Date().toISOString(), atMs: Date.now(),
    }), 'emit'))
    if (request.doc.push.frontier.receiptCount !== head.sequence) {
      throw new Verdict('CONTRADICTED', 'First Echo read a different entry count than the checked Aura copy')
    }
    const answer = on(witnessDir, () => accept(request.doc, { asWitness: witness.peerId }))
    if (!answer.ok) {
      throw new Verdict(answer.epochChange?.length ? 'UNAVAILABLE' : 'CONTRADICTED', `accept: ${answer.reason}`)
    }
    const result = on(senderDir, () => verify(senderDir, { asPeerId: sender.peerId, ackDoc: answer.doc }))
    if (result.assurance !== 'VERIFIED') throw new Verdict(result.assurance, result.reason)
    return `VERIFIED — Aura sequence ${head.sequence}, head ${head.hash}\n`
      + 'First Echo: full hash-prefix replay, retained checkpoint, signed acknowledgement verified.\n'
  } finally {
    setEnv(saved)
    rmSync(scratch, { recursive: true, force: true })
  }
}

try {
  const args = process.argv.slice(2)
  if (args.length > 1 || args[0]?.startsWith('-')) {
    throw new Verdict('UNAVAILABLE', 'usage: node scripts/aura/echo-head.mjs [aura.jsonl]')
  }
  const output = await echoHead(resolve(args[0] ?? DEFAULT_CHAIN))
  process.stdout.write(output)
  process.exitCode = EXIT.VERIFIED
} catch (error) {
  const assurance = error instanceof Verdict ? error.assurance : 'UNAVAILABLE'
  // Do not print parser fragments or input contents on failures.
  const reason = error instanceof Verdict ? error.message : `could not complete the echo (${error.code ?? 'runtime error'})`
  process.stdout.write(`${assurance} — ${reason}\n`)
  process.exitCode = EXIT[assurance] ?? EXIT.UNAVAILABLE
}
process.stdout.write('LIMIT: same machine/UID; disposable peers, no independent or lasting retention.\n')
