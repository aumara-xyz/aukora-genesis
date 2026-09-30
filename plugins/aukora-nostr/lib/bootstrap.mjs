/** First-open Nostr identity, bound to the enrolled Aumlok subject through its existing signer. */
import { randomBytes } from 'node:crypto'
import { existsSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { basename, dirname, join, relative, resolve } from 'node:path'
import { loadOrCreateNostrKey, NOSTR_BINDING_DOMAIN, signerKeyOf, verifyBindingWithKey } from './identity.mjs'

const pending = new Map()
const refuse = (code, detail) => Object.assign(new Error(detail), { code })

function roots(options = {}) {
  const supportRoot = process.env.AUKORA_SUPPORT_ROOT?.trim()
  if (!options.stateDir && !supportRoot) {
    throw refuse('nostr:identity-state-unconfigured', 'Messages needs a stateDir or AUKORA_SUPPORT_ROOT')
  }
  const stateDir = resolve(options.stateDir || join(supportRoot, 'state', 'home'))
  const shellState = basename(stateDir) === 'home' ? dirname(stateDir) : stateDir
  // An explicit undefined is the host service saying no controller is mounted. Only callers
  // that omit the option altogether may use the standalone scratch-layout default.
  const controllerDir = Object.hasOwn(options, 'controllerDir')
    ? (typeof options.controllerDir === 'string' && options.controllerDir.trim() ? resolve(options.controllerDir) : undefined)
    : join(shellState, 'aumlok')
  return { stateDir, shellState, controllerDir, supportRoot }
}

async function aumlokModule(name) {
  try {
    // Both the checkout and the materialized release keep these two plugins as siblings.
    return await import(new URL(`../../aukora-aumlok/lib/${name}.mjs`, import.meta.url).href)
  } catch (cause) {
    throw refuse('nostr:identity-aumlok-unavailable', `Aumlok ${name} could not load: ${cause.code || cause.message}`)
  }
}

async function controllerAt(controllerDir) {
  if (controllerDir === undefined) return null
  const file = join(controllerDir, 'local-control.json')
  if (!existsSync(file)) return null
  let record
  try { record = JSON.parse(readFileSync(file, 'utf8')) } catch {
    throw refuse('nostr:identity-controller-unreadable', 'The Aumlok public record is unreadable')
  }
  if (record?.version !== 3) {
    throw refuse('nostr:identity-controller-unbound', 'Messages needs the enrolled Aumlok public record')
  }
  const { recordProjection, projectRecordV3Control } = await aumlokModule('record-v3')
  try {
    const publicRecord = recordProjection(record)
    const machines = record.publicRoot?.machines
    if (!Array.isArray(machines) || !machines.length || machines.some(m => !/^[0-9a-f]{64}$/u.test(m?.ed25519 || ''))) {
      throw new Error('The Aumlok record names no usable machine signer')
    }
    const signerKeys = []
    for (const machine of machines) {
      try {
        // This is a public projection: no seed or private signer is opened here. It also checks
        // revokedMachines, so an old binding cannot silently outlive its machine's retirement.
        projectRecordV3Control({ record, machinePublicKeyHex: machine.ed25519 })
        signerKeys.push(machine.ed25519)
      } catch (cause) {
        if (!String(cause.message).startsWith('aumlok:machine-revoked:')) throw cause
      }
    }
    if (!signerKeys.length) throw new Error('The Aumlok record has no active machine signer')
    return { subject: publicRecord.subject, handle: publicRecord.handle || 'TEST', signerKeys }
  } catch (cause) {
    throw refuse('nostr:identity-controller-unreadable', cause.message)
  }
}

function validBinding(binding, nostr, controller) {
  if (!controller || binding?.statement?.npub !== nostr.npub || binding?.statement?.handle !== controller.handle) return false
  const signer = signerKeyOf(binding)
  return controller.signerKeys.includes(signer)
    && verifyBindingWithKey(binding, { controllerKeyHex: signer, expectSubject: controller.subject }).verdict === 'verified'
}

async function snapshot(options) {
  const paths = roots(options)
  // Key creation happens before the first await and preserves an existing npub on every retry.
  const nostr = loadOrCreateNostrKey(paths.stateDir)
  const controller = await controllerAt(paths.controllerDir)
  let binding = null
  const file = join(paths.stateDir, 'nostr', 'binding.json')
  if (existsSync(file)) {
    try { binding = JSON.parse(readFileSync(file, 'utf8')) } catch { /* a newly approved binding can replace an unreadable one */ }
  }
  if (!validBinding(binding, nostr, controller)) binding = null
  return { paths, nostr, controller, binding }
}

const publicIdentity = ({ nostr, controller, binding }) => Object.freeze({
  npub: nostr.npub,
  subject: controller?.subject ?? null,
  binding,
})

/** Create the separate Nostr key if absent, then return public facts without requesting approval. */
export async function readMessagesIdentity(options = {}) {
  return publicIdentity(await snapshot(options))
}

/**
 * Return a verified binding or request one through sign-nostr-binding. The existing signer owns
 * the approval window; this module never signs, reads a seed, or supplies an approval decision.
 * Concurrent callers share one request. A refusal is retryable only when a caller asks again.
 */
export function ensureMessagesIdentity(options = {}) {
  const paths = roots(options)
  const slot = `${paths.stateDir}\n${paths.controllerDir}`
  if (pending.has(slot)) return pending.get(slot)
  const operation = bindIdentity(options).finally(() => pending.delete(slot))
  pending.set(slot, operation)
  return operation
}

async function bindIdentity(options) {
  const current = await snapshot(options)
  if (current.binding) return publicIdentity(current)
  const { paths, nostr, controller } = current
  if (!controller) throw refuse('nostr:identity-controller-unbound', 'Link an Aumlok ID before binding Messages')
  const socketPath = resolve(options.socketPath || process.env.AUKORA_SIGNER_SOCKET || join(paths.shellState, 'aumlok-signer.sock'))
  if (paths.supportRoot) {
    const within = relative(resolve(paths.supportRoot), socketPath)
    if (within === '..' || within.startsWith('../') || within.startsWith('/')) {
      throw refuse('nostr:identity-signer-outside-support-root', 'The signer socket is outside AUKORA_SUPPORT_ROOT')
    }
  }
  const { askSignerOperation } = await aumlokModule('signer-client')
  const createdAt = new Date().toISOString().replace(/\.\d{3}Z$/u, 'Z')
  const challenge = randomBytes(32).toString('hex')
  const statement = { subject: controller.subject, npub: nostr.npub, nostrPubkeyHex: nostr.xonlyHex,
    handle: controller.handle, createdAt }
  const reply = await askSignerOperation({ operation: 'sign-nostr-binding', npub: nostr.npub,
    subject: controller.subject, handle: controller.handle, issuedAt: createdAt, challenge }, socketPath, {
    unreachable: 'nostr:identity-signer-unreachable', malformed: 'nostr:identity-signer-reply-malformed',
  })
  if (typeof reply.refusal === 'string' && reply.refusal) throw refuse(reply.refusal, 'The Aumlok signer refused the Messages binding')
  if (reply.domain !== 'aukora:owner-approval-response:v1' || reply.challenge !== challenge || !/^[0-9a-f]{128}$/u.test(reply.signature || '')) {
    throw refuse('nostr:identity-signer-reply-malformed', 'The signer did not return the requested binding signature')
  }
  // The controller may have changed while its approval window was open. Re-read it before writing.
  const latest = await controllerAt(paths.controllerDir)
  if (!latest || latest.subject !== controller.subject || latest.handle !== controller.handle) {
    throw refuse('nostr:identity-controller-changed', 'The Aumlok identity changed during Messages binding')
  }
  let binding = null
  for (const key of latest.signerKeys) {
    const candidate = { domain: NOSTR_BINDING_DOMAIN, statement, signature: reply.signature,
      approvalKeyDid: `did:key:${key}`, label: latest.handle }
    if (validBinding(candidate, nostr, latest)) { binding = candidate; break }
  }
  if (!binding) throw refuse('nostr:identity-binding-unverified', 'The returned binding does not verify under an active Aumlok machine')
  const file = join(paths.stateDir, 'nostr', 'binding.json')
  const temporary = `${file}.${process.pid}.${randomBytes(8).toString('hex')}.tmp`
  try {
    writeFileSync(temporary, `${JSON.stringify(binding, null, 2)}\n`, { mode: 0o600, flag: 'wx' })
    renameSync(temporary, file)
  } catch (cause) {
    throw refuse('nostr:identity-binding-unwritable', `The Messages binding could not be stored: ${cause.code || cause.message}`)
  }
  return publicIdentity({ nostr, controller: latest, binding })
}
