/** First-open Nostr identity, bound to the enrolled Aumlok subject through its existing signer. */
import { randomBytes } from 'node:crypto'
import { existsSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { basename, dirname, join, relative, resolve } from 'node:path'
import { assertContactFields, loadOrCreateNostrKey, NOSTR_BINDING_DOMAIN, NOSTR_SAFETY_VERSION, NOSTR_STATEMENT_KEYS, signerKeyOf, verifyBindingWithKey } from './identity.mjs'
import { identityFingerprint } from './contact.mjs'

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
    // Releases put Nostr at their root and Aumlok under plugins; checkouts keep them as siblings.
    const candidates = [`../../aukora-aumlok/lib/${name}.mjs`, `../../plugins/aukora-aumlok/lib/${name}.mjs`]
      .map(path => new URL(path, import.meta.url))
    const module = candidates.find(path => existsSync(path))
    if (!module) throw new Error(`Aumlok ${name} is absent from this layout`)
    return await import(module.href)
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
    const controller = { subject: publicRecord.subject, handle: publicRecord.handle || 'TEST', signerKeys }
    assertContactFields(controller)
    return controller
  } catch (cause) {
    throw refuse('nostr:identity-controller-unreadable', cause.message)
  }
}

function validBinding(binding, nostr, controller) {
  if (!controller || binding?.statement?.npub !== nostr.npub || binding?.statement?.handle !== controller.handle
    || binding?.statement?.safetyVersion !== NOSTR_SAFETY_VERSION) return false
  const signer = signerKeyOf(binding)
  return controller.signerKeys.includes(signer)
    && verifyBindingWithKey(binding, { controllerKeyHex: signer, expectSubject: controller.subject }).verdict === 'verified'
}

async function snapshot(options) {
  const paths = roots(options)
  // Key creation happens before the first await and preserves an existing npub on every retry.
  const nostr = loadOrCreateNostrKey(paths.stateDir, { create: options.createKey !== false })
  const controller = await controllerAt(paths.controllerDir)
  let binding = null, bindingText = null
  const file = join(paths.stateDir, 'nostr', 'binding.json')
  if (existsSync(file)) {
    bindingText = readFileSync(file, 'utf8')
    try { binding = JSON.parse(bindingText) } catch { /* explicit reissue refuses an unverifiable prior anchor */ }
  }
  const storedBinding = binding
  if (!validBinding(binding, nostr, controller)) binding = null
  return { paths, nostr, controller, binding, storedBinding, bindingText }
}

const publicIdentity = ({ nostr, controller, binding }) => Object.freeze({
  npub: nostr.npub,
  subject: controller?.subject ?? null,
  label: controller?.handle ?? '',
  peerControllerKey: binding ? signerKeyOf(binding) : null,
  identityFingerprint: binding ? identityFingerprint({ npub: nostr.npub, controllerKeyHex: signerKeyOf(binding), binding }) : null,
  // Stored documents may carry unrelated fields; only the public binding crosses the host boundary.
  binding: binding ? {
    domain: binding.domain,
    statement: Object.fromEntries(NOSTR_STATEMENT_KEYS
      .map(key => [key, binding.statement[key]])),
    signature: binding.signature,
    approvalKeyDid: binding.approvalKeyDid,
    label: controller.handle,
  } : null,
})

/** Create the separate Nostr key if absent, then return public facts without requesting approval. */
export async function readMessagesIdentity(options = {}) {
  return publicIdentity(await snapshot(options))
}

/**
 * Background callers read public identity only. Rendering never requests a signature.
 * Binding issuance and migration require the explicit Messages action below.
 */
export function ensureMessagesIdentity(options = {}) {
  return readMessagesIdentity(options)
}

/** Explicitly approve a current binding while preserving the existing Nostr and signer anchors. */
export async function reissueMessagesIdentity(options = {}) {
  const current = await snapshot({ ...options, createKey: false })
  const { paths, nostr, controller } = current
  if (!controller) throw refuse('nostr:identity-controller-unbound', 'Link an Aumlok ID before binding Messages')
  if (options.expectedNpub !== nostr.npub || options.expectedSubject !== controller.subject) {
    throw refuse('nostr:identity-changed', 'The displayed Messages identity changed; read it again before requesting approval')
  }
  if (current.binding) return publicIdentity(current)
  let previousSigner = null
  if (current.bindingText !== null) {
    const version = current.storedBinding?.statement?.safetyVersion
    if (version !== undefined && version !== NOSTR_SAFETY_VERSION) {
      throw refuse('nostr:identity-safety-version-mismatch', 'Reissue cannot downgrade an unknown binding protocol')
    }
    previousSigner = signerKeyOf(current.storedBinding)
    if (!controller.signerKeys.includes(previousSigner) || current.storedBinding?.statement?.npub !== nostr.npub
      || verifyBindingWithKey(current.storedBinding, { controllerKeyHex: previousSigner, expectSubject: controller.subject }).verdict !== 'verified') {
      throw refuse('nostr:identity-anchor-mismatch', 'Reissue requires the existing binding to verify under the same active machine and identity')
    }
  }
  const slot = `${paths.stateDir}\n${paths.controllerDir}`
  if (pending.has(slot)) return pending.get(slot)
  const operation = requestBinding(options, current, previousSigner).finally(() => pending.delete(slot))
  pending.set(slot, operation)
  return operation
}

async function requestBinding(options, { paths, nostr, controller, bindingText }, previousSigner) {
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
    handle: controller.handle, createdAt, safetyVersion: NOSTR_SAFETY_VERSION }
  const reply = await askSignerOperation({ operation: 'sign-nostr-binding', npub: nostr.npub,
    subject: controller.subject, handle: controller.handle, issuedAt: createdAt, safetyVersion: NOSTR_SAFETY_VERSION, challenge }, socketPath, {
    unreachable: 'nostr:identity-signer-unreachable', malformed: 'nostr:identity-signer-reply-malformed',
  })
  assertContactFields(reply)
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
  for (const key of previousSigner === null ? latest.signerKeys : [previousSigner]) {
    const candidate = { domain: NOSTR_BINDING_DOMAIN, statement, signature: reply.signature,
      approvalKeyDid: `did:key:${key}`, label: latest.handle }
    if (validBinding(candidate, nostr, latest)) { binding = candidate; break }
  }
  if (!binding) throw refuse('nostr:identity-binding-unverified', 'The returned binding does not verify under an active Aumlok machine')
  const file = join(paths.stateDir, 'nostr', 'binding.json')
  const latestNostr = loadOrCreateNostrKey(paths.stateDir, { create: false })
  if (latestNostr.npub !== nostr.npub || (existsSync(file) ? readFileSync(file, 'utf8') : null) !== bindingText) {
    throw refuse('nostr:identity-changed', 'The local key or binding changed during approval; nothing was replaced')
  }
  const temporary = `${file}.${process.pid}.${randomBytes(8).toString('hex')}.tmp`
  try {
    writeFileSync(temporary, `${JSON.stringify(binding, null, 2)}\n`, { mode: 0o600, flag: 'wx' })
    renameSync(temporary, file)
  } catch (cause) {
    throw refuse('nostr:identity-binding-unwritable', `The Messages binding could not be stored: ${cause.code || cause.message}`)
  }
  return publicIdentity({ nostr, controller: latest, binding })
}
