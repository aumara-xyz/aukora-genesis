/** Offline, single-use Web upgrade under the broker's existing writer lease. */
import { createHash, createPublicKey, randomBytes } from 'node:crypto'
import { closeSync, constants, fstatSync, fsyncSync, lstatSync, openSync, readFileSync, readSync, readdirSync, realpathSync, renameSync, unlinkSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { acquireStateLease, provisionBrokerIdentity, readSettlementHead, reconcileIntents } from './broker.mjs'
import { readSeal, measureStateDirectory } from './confinement.mjs'
import { compareObjectInventory, readVerifiedChain } from '../aura/record.mjs'
import { readIdentityControlState } from '../identity/broker-state.mjs'
import { identityControlDigest } from '../identity/control.mjs'
import { openNonceBook } from '../host-dsh/src/nonce-book.mjs'
import { activationDigest, parseActivationStatement } from '../activation/statement.mjs'
import { ACTIVATION_BINDING_DOMAIN, readActivationBinding } from '../activation/broker-state.mjs'
import { UPGRADED_BINDING_DOMAIN, WEB_UPGRADE_DOMAIN, parseSignedWebUpgrade, parseWebUpgrade, verifyWebUpgradeRecord } from '../activation/web-upgrade-record.mjs'
import { MAX_WEB_ROLLBACK_BUNDLE_BYTES, verifyWebRollbackBundle } from '../activation/web-rollback-record.mjs'
import { canonicalJSON } from '../kernel-seed/canonical-json.mjs'
import { observe } from './effect.mjs'
import { KEY_SHAPE } from './memory-put-args.mjs'
import { receiptKeyIdForPublicKey } from '../host-dsh/src/grant.mjs'
import { selectMemoryEntries } from './memory-entries.mjs'
import { WORKSPACE_PATCH } from './effect-definition.mjs'
import { preflightWorkspacePatch } from './workspace-patch.mjs'
import { MAX_WORKSPACE_PATCH_BYTES } from './workspace-patch-args.mjs'
import { readReceipt, RECEIPT_FIELDS, requestDigest, verifyReceipt, verifyReceiptSignature } from './receipt.mjs'

const digest = bytes => createHash('sha256').update(bytes).digest('hex')
const fail = name => { throw new Error(`upgrade:${name}`) }
const MAX_FILES = 8192
const MAX_BYTES = 128 * 1024 * 1024
const MAX_BINDING_BYTES = 256 * 1024

/** Read one bounded regular file through its observed descriptor without following links. */
function readBoundedFile(path, limit, state = lstatSync(path, { bigint: true })) {
  if (!state.isFile() || state.nlink !== 1n) fail('linked-or-special-entry')
  if (state.size > BigInt(limit)) fail('file-too-large')
  const fd = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK)
  try {
    const before = fstatSync(fd, { bigint: true })
    if (before.ino !== state.ino || before.dev !== state.dev || before.size !== state.size) fail('store-changed')
    const bytes = Buffer.alloc(Number(state.size))
    let offset = 0
    while (offset < bytes.length) {
      const count = readSync(fd, bytes, offset, bytes.length - offset)
      if (count === 0) fail('store-changed')
      offset += count
    }
    if (readSync(fd, Buffer.alloc(1), 0, 1) !== 0) fail('store-changed')
    const after = fstatSync(fd, { bigint: true })
    if (after.mtimeNs !== state.mtimeNs || after.ctimeNs !== state.ctimeNs) fail('store-changed')
    return bytes
  } finally { closeSync(fd) }
}

/** Hash the retained bytes and identities without following links or reading unbounded files. */
function inventory(stateDir) {
  let bytesRead = 0
  const rows = []
  const visit = (relative) => {
    const path = join(stateDir, relative)
    const state = lstatSync(path, { bigint: true })
    if (rows.length >= MAX_FILES) fail('store-too-large')
    const row = { path: relative, dev: String(state.dev), ino: String(state.ino), mode: Number(state.mode), uid: Number(state.uid) }
    if (state.uid !== BigInt(process.geteuid()) || (state.mode & 0o077n) !== 0n) fail('store-not-private')
    if (state.isDirectory() && !state.isSymbolicLink()) {
      rows.push({ ...row, kind: 'directory' })
      for (const name of readdirSync(path).sort()) {
        if (relative === '' && (name === '.broker-active.lock' || name === 'activation.json')) continue
        if (name.endsWith('.lock') || name.includes('.staging-') || name.startsWith('.nonce-candidate-')
          || name.startsWith('.activation-upgrade-')) fail('unresolved-residue')
        visit(relative === '' ? name : `${relative}/${name}`)
      }
      return
    }
    if (!state.isFile() || state.nlink !== 1n) fail('linked-or-special-entry')
    bytesRead += Number(state.size)
    if (bytesRead > MAX_BYTES) fail('store-too-large')
    const bytes = readBoundedFile(path, MAX_BYTES, state)
    rows.push({ ...row, kind: 'file', size: bytes.length, mtimeNs: String(state.mtimeNs), sha256: digest(bytes) })
  }
  visit('')
  return digest(canonicalJSON(rows))
}

/** Require an absent or empty directory without discarding unexplained entries. */
function requireEmptyDirectory(stateDir, relative) {
  const path = join(stateDir, relative)
  let state
  try { state = lstatSync(path) }
  catch (error) { if (error?.code === 'ENOENT') return; throw error }
  if (!state.isDirectory() || state.isSymbolicLink() || readdirSync(path).length !== 0) fail('empty-store-evidence-present')
}

/** Read absent history only when the independent sequence and evidence readers established zero. */
function retainedEntries(stateDir, count, allowEmpty) {
  if (count === 0 && !allowEmpty) fail('populated-history-required')
  const path = join(stateDir, 'aura.jsonl')
  try { lstatSync(path) }
  catch (error) {
    if (error?.code === 'ENOENT' && count === 0) return []
    throw error
  }
  const chain = readVerifiedChain(path)
  if (!chain.ok || chain.count !== count) fail('populated-history-required')
  return chain.entries
}

/** Authenticate every workspace receipt; only each destination's latest settlement describes its current file. */
function verifyWorkspaceHistory(stateDir, entries, brokerPublicKeyPem) {
  const workspaceEntries = entries.filter(entry => entry.toolName === WORKSPACE_PATCH)
  if (workspaceEntries.length === 0) return
  const roots = JSON.parse(readBoundedFile(join(stateDir, 'workspace-roots.json'), MAX_BINDING_BYTES).toString('utf8'))
  if (roots === null || typeof roots !== 'object' || Array.isArray(roots)) fail('workspace-map-invalid')
  const latest = new Map()
  for (const entry of workspaceEntries) {
    const root = roots[entry.workspace]
    if (!Object.hasOwn(roots, entry.workspace) || typeof root !== 'string'
      || resolve(root) !== root || realpathSync(root) !== root
      || entry.path !== join(root, entry.relativePath)) fail('workspace-destination-mismatch')
    const receipt = readReceipt({ stateDir, receiptSha256: entry.receiptSha256 })
    const verified = verifyReceiptSignature({ receipt, brokerPublicKeyPem })
    if (!verified.ok) fail(`workspace-${verified.reason}`)
    if (RECEIPT_FIELDS.some(field => canonicalJSON(receipt[field]) !== canonicalJSON(entry[field]))) {
      fail('workspace-receipt-mismatch')
    }
    latest.set(entry.path, { entry, receipt })
  }
  for (const { entry, receipt } of latest.values()) {
    const target = preflightWorkspacePatch(roots, {
      workspace: entry.workspace, path: entry.relativePath, beforeSha256: entry.contentSha256, content: '',
    })
    if (target.path !== receipt.path) fail('workspace-destination-mismatch')
    const verified = verifyReceipt({ receipt, brokerPublicKeyPem, observe })
    if (!verified.ok) fail(`workspace-${verified.reason}`)
    const content = readBoundedFile(target.path, MAX_WORKSPACE_PATCH_BYTES).toString('utf8')
    const args = { workspace: entry.workspace, path: entry.relativePath, beforeSha256: entry.beforeSha256, content }
    if (requestDigest(WORKSPACE_PATCH, args) !== receipt.requestDigest) fail('workspace-request-mismatch')
  }
}

/** Validate retained facts using their existing readers, without recreating any evidence. */
function retainedState(stateDir, allowEmpty = false) {
  const storeDigest = inventory(stateDir)
  const measured = measureStateDirectory({ stateDir, euid: process.geteuid() })
  const seal = readSeal(stateDir)
  if (!seal.present || seal.seal.stateDev !== measured.stateDev || seal.seal.stateIno !== measured.stateIno
    || measured.class === 'unconfined') fail('seal-mismatch')
  const pending = reconcileIntents(stateDir)
  if (pending.malformed.length || pending.orphaned.length) fail('unresolved-intents')
  // Presence is required before the provisioning reader: an upgrade cannot create a replacement key.
  lstatSync(join(stateDir, 'keys', 'broker.json'))
  const identity = provisionBrokerIdentity(stateDir)
  const count = readSettlementHead(stateDir)
  const entries = retainedEntries(stateDir, count, allowEmpty)
  const memory = selectMemoryEntries(entries)
  if (!memory.ok) fail('effect-definition-unverified')
  const objects = compareObjectInventory(stateDir, memory.entries)
  if (!objects.ok) fail('objects-unverified')
  if (count === 0) {
    for (const path of ['memory/objects', 'memory/keys', 'nonces', 'receipts']) requireEmptyDirectory(stateDir, path)
  }
  const last = new Map()
  for (const entry of memory.entries) {
    if (typeof entry.key !== 'string' || !KEY_SHAPE.test(entry.key)) fail('projection-mismatch')
    const path = join(stateDir, 'memory', 'objects', `${entry.contentSha256}.json`)
    const observed = observe(path)
    if (entry.verdict !== 'settled' || entry.path !== path || observed.status !== 'observed'
      || entry.inode !== observed.inode || entry.mtimeNs !== observed.mtimeNs
      || entry.bytes !== observed.bytes || entry.contentSha256 !== observed.contentSha256) fail('effect-evidence-mismatch')
    last.set(entry.key, entry.contentSha256)
  }
  if (count !== 0) {
    let keys
    try { keys = readdirSync(join(stateDir, 'memory', 'keys')).sort() }
    catch (error) {
      if (error?.code !== 'ENOENT' || memory.entries.length !== 0) throw error
      keys = []
    }
    if (canonicalJSON(keys) !== canonicalJSON([...last.keys()].map(key => `${key}.json`).sort())) fail('projection-mismatch')
  }
  for (const [key, contentSha256] of last) {
    if (readFileSync(join(stateDir, 'memory', 'keys', `${key}.json`), 'utf8') !== `${JSON.stringify({ key, contentSha256 })}\n`) fail('projection-mismatch')
  }
  const book = openNonceBook(stateDir)
  if (entries.some(entry => !book.set.has(entry.nonce))) fail('nonce-evidence-missing')
  verifyWorkspaceHistory(stateDir, entries, identity.brokerPublicKeyPem)
  const control = readIdentityControlState(stateDir)
  if (control === null || control.revoked) fail('controller-unavailable')
  if (inventory(stateDir) !== storeDigest) fail('store-changed')
  return { storeDigest, control, receiptKeyId: identity.receiptKeyId }
}

/**
 * Lock a retained v1 store and prepare one exact reconnectable-Web upgrade.
 * No runtime is stopped and no activation changes without commit of the signed operation.
 * Empty history requires an explicit matching prior activation pin and no effect or nonce evidence.
 * @param {string} stateDir - canonical existing broker state directory; identity must already exist.
 * @param {unknown} nextInput - measured target Web ActivationStatement.
 * @param {{expectedPreviousActivation?: string}} [options] - operator's retained activation pin; omission requires populated history.
 * @returns {{operation: Readonly<Record<string, unknown>>, previousBinding: string, commit: (record: unknown) => object, close: () => void}} one-use review lifetime and exact retained bytes for recovery authorization.
 */
export function beginWebActivationUpgrade(stateDir, nextInput, options = {}) {
  if (resolve(stateDir) !== stateDir || realpathSync(stateDir) !== stateDir) fail('canonical-state-required')
  const root = lstatSync(stateDir)
  if (!root.isDirectory() || root.uid !== process.geteuid() || (root.mode & 0o777) !== 0o700) fail('private-state-required')
  const release = acquireStateLease(stateDir)
  let closed = false
  let uncertain = false
  let committed = false
  const close = () => { if (!closed && !uncertain) { closed = true; release() } }
  try {
    const path = join(stateDir, 'activation.json')
    const binding = lstatSync(path)
    if (!binding.isFile() || binding.nlink !== 1 || (binding.mode & 0o777) !== 0o600 || binding.uid !== process.geteuid()) fail('binding-not-private')
    const prior = readBoundedFile(path, MAX_BINDING_BYTES).toString('utf8')
    // Both persisted binding formats are upgradable: the one-time legacy v1 record and
    // an upgraded record this mechanism itself wrote. Refusing the second made the
    // transition one-way, so a later measured target could not be bound to a populated
    // store at all. `readActivationBinding` below resolves either form, and for an
    // upgraded record it re-verifies the controller signatures and canonical encoding
    // before returning the activation it names — so accepting it here widens which
    // prior states may transition, never what authorizes the transition.
    if (![ACTIVATION_BINDING_DOMAIN, UPGRADED_BINDING_DOMAIN].includes(JSON.parse(prior)?.domain)) {
      fail('supported-binding-required')
    }
    const previousActivation = readActivationBinding(stateDir)
    if (options.expectedPreviousActivation !== undefined && options.expectedPreviousActivation !== previousActivation) {
      fail('previous-activation-mismatch')
    }
    const nextStatement = parseActivationStatement(nextInput)
    const allowEmpty = options.expectedPreviousActivation !== undefined
    const state = retainedState(stateDir, allowEmpty)
    if (nextStatement.brokerId !== state.receiptKeyId) fail('broker-identity-changed')
    const rootPublicKey = createPublicKey({ format: 'jwk', key: { kty: 'OKP', crv: 'Ed25519',
      x: Buffer.from(state.control.publicKeys.ed25519, 'hex').toString('base64url') } })
    if (nextStatement.issuerId !== receiptKeyIdForPublicKey(rootPublicKey.export({ type: 'spki', format: 'pem' }).toString())) {
      fail('issuer-identity-changed')
    }
    const issuedAt = Math.floor(Date.now() / 1000)
    const operation = parseWebUpgrade({ domain: WEB_UPGRADE_DOMAIN, previousActivation,
      previousBindingSha256: digest(prior), nextStatement,
      subject: state.control.subject, controlDigest: identityControlDigest(state.control), receiptKeyId: state.receiptKeyId,
      storeDigest: state.storeDigest, nonce: randomBytes(32).toString('hex'),
      issuedAt, expiresAt: issuedAt + 120 })
    const assertUnexpired = () => {
      const now = Math.floor(Date.now() / 1000)
      if (now < operation.issuedAt || now >= operation.expiresAt) fail('approval-expired')
    }
    return {
      operation,
      previousBinding: prior,
      close,
      commit(record) {
        if (closed || committed || uncertain) fail('review-closed')
        const detached = parseSignedWebUpgrade(record)
        const verified = verifyWebUpgradeRecord(detached, readIdentityControlState(stateDir))
        if (canonicalJSON(verified) !== canonicalJSON(operation)) fail('operation-substituted')
        assertUnexpired()
        if (readBoundedFile(path, MAX_BINDING_BYTES).toString('utf8') !== prior
          || retainedState(stateDir, allowEmpty).storeDigest !== operation.storeDigest) fail('stale-store')
        const temporary = join(stateDir, `.activation-upgrade-${operation.nonce}`)
        const fd = openSync(temporary, 'wx', 0o600)
        try { writeFileSync(fd, canonicalJSON(detached)); fsyncSync(fd); assertUnexpired() }
        catch (error) { closeSync(fd); unlinkSync(temporary); throw error }
        closeSync(fd)
        // From publication onward, uncertainty retains the writer lease for explicit recovery.
        uncertain = true
        renameSync(temporary, path)
        const directory = openSync(stateDir, constants.O_RDONLY | constants.O_DIRECTORY)
        try { fsyncSync(directory) } finally { closeSync(directory) }
        if (readActivationBinding(stateDir) !== activationDigest(nextStatement)) fail('published-binding-unverified')
        committed = true
        uncertain = false
        close()
        return Object.freeze({ status: 'ACTIVATION_UPGRADED', previousActivation,
          activationDigest: activationDigest(nextStatement), storeDigest: operation.storeDigest })
      },
    }
  } catch (error) { close(); throw error }
}

/**
 * Restore only the exact legacy binding authorized alongside a signed Web upgrade.
 * Broker-owned bytes must still match the forward transition's inventory; no effect is undone.
 * Authorization expires after fifteen minutes. An exclusive audit survives restoration, and
 * publication uncertainty retains the writer lease for operator recovery. This starts no process.
 * @param {string} stateDir - canonical existing private broker directory with no active writer.
 * @param {unknown} bundleInput - owner-signed forward and rollback operations plus exact prior binding.
 * @returns {{operation: Readonly<Record<string, unknown>>, commit: () => object, close: () => void}} one-use rollback lifetime.
 */
export function beginWebActivationRollback(stateDir, bundleInput) {
  if (resolve(stateDir) !== stateDir || realpathSync(stateDir) !== stateDir) fail('canonical-state-required')
  const root = lstatSync(stateDir)
  if (!root.isDirectory() || root.uid !== process.geteuid() || (root.mode & 0o777) !== 0o700) fail('private-state-required')
  const release = acquireStateLease(stateDir)
  let closed = false
  let uncertain = false
  let temporary
  const close = () => { if (!closed && !uncertain) { closed = true; release() } }
  const abandonCandidate = (error, fd, closeFailed = false) => {
    const cleanupFailures = []
    if (fd !== undefined) {
      try { closeSync(fd) } catch (failure) { cleanupFailures.push(failure) }
    }
    try { unlinkSync(temporary); temporary = undefined }
    catch (failure) { cleanupFailures.push(failure) }
    if (closeFailed || cleanupFailures.length > 0) {
      uncertain = true
      throw new AggregateError([error, ...cleanupFailures], `${String(error?.message ?? error)}; rollback:cleanup-uncertain`)
    }
    throw error
  }
  try {
    const bundle = verifyWebRollbackBundle(bundleInput, readIdentityControlState(stateDir))
    const operation = bundle.rollback.operation
    const path = join(stateDir, 'activation.json')
    const expected = canonicalJSON(bundle.upgrade)
    const auditPath = join(stateDir, `.activation-rollback-${bundle.upgrade.operation.nonce}.json`)
    const assertUnexpired = () => {
      const now = Math.floor(Date.now() / 1000)
      if (now < operation.issuedAt || now >= operation.expiresAt) throw new Error('rollback:approval-expired')
    }
    const assertRetained = () => {
      assertUnexpired()
      verifyWebRollbackBundle(bundle, readIdentityControlState(stateDir))
      const binding = lstatSync(path)
      if (!binding.isFile() || binding.nlink !== 1 || (binding.mode & 0o777) !== 0o600
        || binding.uid !== process.geteuid()) fail('binding-not-private')
      if (readBoundedFile(path, MAX_BINDING_BYTES).toString('utf8') !== expected) {
        throw new Error('rollback:current-binding-mismatch')
      }
      const state = retainedState(stateDir, true)
      if (state.storeDigest !== operation.storeDigest || state.receiptKeyId !== operation.receiptKeyId) {
        throw new Error('rollback:store-changed')
      }
    }
    assertRetained()
    return {
      operation,
      close,
      commit() {
        if (closed || uncertain) throw new Error('rollback:review-closed')
        assertRetained()
        temporary = join(stateDir, `.activation-upgrade-rollback-${operation.nonce}`)
        const fd = openSync(temporary, 'wx', 0o600)
        try { writeFileSync(fd, bundle.previousBinding); fsyncSync(fd) }
        catch (error) { abandonCandidate(error, fd) }
        try { closeSync(fd) } catch (error) { abandonCandidate(error, undefined, true) }
        try { assertUnexpired() }
        catch (error) { abandonCandidate(error, undefined) }
        // The authorization audit is permanent evidence, even if binding publication fails.
        uncertain = true
        const audit = openSync(auditPath, 'wx', 0o600)
        try { writeFileSync(audit, canonicalJSON(bundle)); fsyncSync(audit) } finally { closeSync(audit) }
        const directory = openSync(stateDir, constants.O_RDONLY | constants.O_DIRECTORY)
        try {
          fsyncSync(directory)
          assertUnexpired()
          renameSync(temporary, path)
          temporary = undefined
          fsyncSync(directory)
        } finally { closeSync(directory) }
        if (readBoundedFile(auditPath, MAX_WEB_ROLLBACK_BUNDLE_BYTES).toString('utf8') !== canonicalJSON(bundle)
          || readBoundedFile(path, MAX_BINDING_BYTES).toString('utf8') !== bundle.previousBinding
          || readActivationBinding(stateDir) !== operation.previousActivation) {
          throw new Error('rollback:publication-unverified')
        }
        uncertain = false
        close()
        return Object.freeze({ status: 'ACTIVATION_ROLLED_BACK', activationDigest: operation.previousActivation,
          storeDigest: operation.storeDigest, auditPath })
      },
    }
  } catch (error) { close(); throw error }
}
