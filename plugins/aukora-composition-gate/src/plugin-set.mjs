/**
 * THE PLUGIN SET: every shipped AUKORA plugin's bytes, recorded at materialization and admitted by ONE
 * owner approval.
 *
 * WHAT A RECORD BINDS. For each AUKORA plugin a release's composition mounts (`name: ./plugins/…`), the
 * record holds a sha256 for:
 *   - every regular file under that plugin's own directory (`plugins/<dir>/**`, `node_modules` excluded), and
 *   - the entry's relative import closure (`artifactClosure`), and every file of each other `plugins/<dir>`
 *     that closure reaches (a relative import can cross a plugin boundary).
 * Keys use `resolveModuleIdentity`, the same rule the load hook uses, so the recorded name and the
 * checked name are one string.
 *
 * WHAT AN APPROVAL IS. The owner approves the OPERATION CONTENT `setOperationContent` renders: the set
 * digest (over every artifact digest, `pluginSetDigest`), the counts and one line per plugin. The
 * approval is an Aumlok receipt (`aukora:approval-receipt:v1`) from `scripts/aumlok/approve-operation`,
 * signed by the approver key the deployment pins. The gate re-renders the content from the record,
 * recomputes its operation digest, and admits the set only when the receipt's signed operation digest is
 * that digest and the signature verifies under the pinned did:key. Nothing stored is trusted: every
 * artifact digest and the set digest are recomputed from the per-file digests.
 *
 * RECORDED BYTES ARE NOT LOADER ENFORCEMENT:
 *   - the gate bootstrap, action-gate policy/kernel and caged-worker files are recorded,
 *     but not import-gated in their own loaders;
 *   - bare dependencies (`node_modules`, `packages/`), apps/cli and the shell are outside the plugin set
 *     unless a release binding covers them;
 *   - a release binding covers the release tree and shell at cutover, excluding .dsh-build/plugin-set.json
 *     to avoid structural self-reference. External state/tools and symlink targets outside the tree are not covered;
 *   - the release binding is not rechecked at every boot or later read. Plugin bytes are checked at gate
 *     installation and imports through its hook; `fs` reads are not checked at each later read;
 *   - the same uid: the record, the approval and the pin all live in files this uid can write.
 */
import { setOperationContent as renderSetOperationContent } from '../../aukora-aumlok/lib/plugin-set-content.mjs'
import { createHash, createPublicKey, verify as cryptoVerify } from 'node:crypto'
import { lstatSync, readdirSync, readFileSync, realpathSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { artifactClosure, artifactDigest, digestOf, resolveModuleIdentity } from './artifact.mjs'
import { pluginSetDigest } from './admission-grant.mjs'
// AUMLOK'S OWN SIGNING PREIMAGE AND did:key DECODER, IMPORTED RATHER THAN RE-IMPLEMENTED: the receipt is
// verified over the bytes `approvalSigningBytes` derives, which is what the signer signed.
import { APPROVAL_REQUEST_DOMAIN, approvalSigningBytes } from '../../aukora-aumlok/lib/owner-approval.mjs'
import { ed25519PublicKeyFromDidKey } from '../../aukora-aumlok/lib/did-key.mjs'

export const PLUGIN_SET_KIND = 'aukora-plugin-set/v1'
export const PLUGIN_SET_FILE = '.dsh-build/plugin-set.json'

/** The domain `operationDigestOf` uses (plugins/aukora-aumlok/lib/operation-approval.mjs). */
const OPERATION_CONTENT_DOMAIN = 'aukora:operation-content:v1'
const APPROVAL_RECEIPT_DOMAIN = 'aukora:approval-receipt:v1'

/** Every way the set can refuse, by name. */
export const SET_REFUSE = Object.freeze({
  RECORD_MALFORMED: 'plugin-set-record-malformed',
  APPROVAL_ABSENT: 'plugin-set-approval-absent',
  APPROVAL_MALFORMED: 'plugin-set-approval-malformed',
  PIN_ABSENT: 'plugin-set-approver-not-pinned',
  NOT_PINNED_KEY: 'plugin-set-approval-by-unpinned-key',
  OTHER_IDENTITY: 'plugin-set-approval-for-other-identity',
  OTHER_SET: 'plugin-set-approval-for-other-set',
  SIGNATURE_INVALID: 'plugin-set-approval-signature-invalid',
  BYTES_CHANGED: 'plugin-bytes-changed',
  UNLISTED: 'plugin-file-unrecorded',
})

const refuse = (code, detail) => Object.assign(new Error(`${code}: ${detail}`), { code, reason: detail })

/** `sha256(domain ‖ 0x00 ‖ content)`, the digest `approve-operation` asks the signer to approve. */
export function operationDigestOf(content) {
  return createHash('sha256').update(OPERATION_CONTENT_DOMAIN, 'utf8').update('\0', 'utf8')
    .update(Buffer.from(content, 'utf8')).digest('hex')
}

/** `plugins/<dir>` for a key under plugins/, or null. */
export function pluginDirOf(key) {
  const parts = key.split('/')
  return parts.length > 2 && parts[0] === 'plugins' ? `${parts[0]}/${parts[1]}` : null
}

const SKIP_DIRS = new Set(['node_modules', '__pycache__', '.git'])
const SKIP_FILES = new Set(['.DS_Store'])

/** Every regular file under one plugin directory, key -> sha256. Symlinks are not followed. */
function walkPluginDir(realRoot, dir) {
  const files = {}
  const stack = [join(realRoot, dir)]
  while (stack.length > 0) {
    const current = stack.pop()
    for (const name of readdirSync(current)) {
      const path = join(current, name)
      const info = lstatSync(path)
      if (info.isSymbolicLink()) continue
      if (info.isDirectory()) { if (!SKIP_DIRS.has(name)) stack.push(path); continue }
      if (!info.isFile() || SKIP_FILES.has(name) || name.endsWith('.pyc')) continue
      files[resolveModuleIdentity(path, realRoot).key] = digestOf(readFileSync(path))
    }
  }
  return files
}

const sortedObject = (record) => Object.fromEntries(Object.keys(record).sort().map((key) => [key, record[key]]))

/**
 * Record the set: one artifact per mounted AUKORA plugin row.
 * @param {{root: string, rows: {id: string, entry: string}[]}} input
 */
export function recordPluginSet({ root, rows }) {
  const realRoot = realpathSync(resolve(root))
  const artifacts = {}
  for (const { id, entry } of rows) {
    if (Object.hasOwn(artifacts, id)) continue
    const entryPath = resolve(realRoot, entry)
    const entryKey = resolveModuleIdentity(entryPath, realRoot).key
    const closure = artifactClosure(entryPath, realRoot)
    const dirs = new Set([pluginDirOf(entryKey), ...Object.keys(closure).map(pluginDirOf)].filter(Boolean))
    const files = { ...closure }
    for (const dir of [...dirs].sort()) Object.assign(files, walkPluginDir(realRoot, dir))
    const sorted = sortedObject(files)
    artifacts[id] = { id, entry: entryKey, files: sorted, digest: artifactDigest(sorted) }
  }
  const all = new Set(Object.values(artifacts).flatMap((artifact) => Object.keys(artifact.files)))
  return {
    formatVersion: 1,
    kind: PLUGIN_SET_KIND,
    count: Object.keys(artifacts).length,
    fileCount: all.size,
    setDigest: pluginSetDigest(artifacts),
    artifacts: sortedObject(artifacts),
  }
}

/**
 * Every artifact digest and the set digest RECOMPUTED from the per-file digests, and compared with what
 * the record states. A record whose stored summary disagrees with its own files is refused, so an edit
 * to a summary alone can never be what an approval is checked against.
 */
export function checkPluginSetRecord(record) {
  if (record === null || typeof record !== 'object' || record.kind !== PLUGIN_SET_KIND
    || record.artifacts === null || typeof record.artifacts !== 'object') {
    throw refuse(SET_REFUSE.RECORD_MALFORMED, `the plugin set record is not a ${PLUGIN_SET_KIND} record`)
  }
  const artifacts = {}
  for (const [id, artifact] of Object.entries(record.artifacts)) {
    const files = artifact?.files
    if (artifact?.id !== id || typeof artifact.entry !== 'string' || files === null || typeof files !== 'object'
      || Object.keys(files).length === 0 || !Object.values(files).every((d) => /^[0-9a-f]{64}$/u.test(d))
      || !Object.hasOwn(files, artifact.entry)) {
      throw refuse(SET_REFUSE.RECORD_MALFORMED, `the record for ${id} does not carry its entry and per-file digests`)
    }
    const digest = artifactDigest(files)
    if (digest !== artifact.digest) {
      throw refuse(SET_REFUSE.RECORD_MALFORMED, `${id}: the stored digest ${String(artifact.digest).slice(0, 16)}… is not `
        + `the digest of its own files (${digest.slice(0, 16)}…)`)
    }
    artifacts[id] = { id, entry: artifact.entry, files, digest }
  }
  const setDigest = pluginSetDigest(artifacts)
  if (setDigest !== record.setDigest || Object.keys(artifacts).length !== record.count) {
    throw refuse(SET_REFUSE.RECORD_MALFORMED, 'the stored set digest or count is not the one its artifacts derive')
  }
  return { artifacts, setDigest, count: Object.keys(artifacts).length }
}

/**
 * The exact text the owner approves. Rendered from the record, never stored: the gate renders it again
 * at every boot, so the approval can only ever cover what the record says now.
 */
export function setOperationContent(record) {
  checkPluginSetRecord(record)
  return renderSetOperationContent(record)
}

const RECEIPT_FIELDS = ['domain', 'verdict', 'approvalKeyDid', 'subject', 'activeControlDigest', 'operationDigest',
  'challenge', 'issuedAt', 'expiresAt', 'signature', 'signedBytesDigest', 'approvalClass', 'keyClass']

/**
 * Verify an Aumlok approval receipt over this set's operation content, against the pinned approver.
 *
 * The expiry window is NOT checked here: it bounds when an approval could be minted and installed
 * (`scripts/aukora/plugin-set.mjs install` refuses an expired one), and an installed approval is a
 * standing admission of exactly these bytes until a new set replaces it.
 *
 * @param {{record: object, receipt: object|null, pin: object|null}} input
 * @returns {{setDigest: string, operationDigest: string, approverDid: string, approvalClass: string, issuedAt: number, count: number}}
 */
export function verifySetApproval({ record, receipt, pin }) {
  const content = setOperationContent(record)
  const operationDigest = operationDigestOf(content)
  const { setDigest, count } = checkPluginSetRecord(record)
  if (pin === null || pin === undefined || typeof pin.approverDid !== 'string' || typeof pin.subject !== 'string'
    || typeof pin.activeControlDigest !== 'string') {
    throw refuse(SET_REFUSE.PIN_ABSENT, 'no approver is pinned (approverDid, subject, activeControlDigest), so no '
      + 'receipt can be said to come from the owner key')
  }
  if (receipt === null || receipt === undefined) {
    throw refuse(SET_REFUSE.APPROVAL_ABSENT, `no approval receipt is installed for set ${setDigest.slice(0, 16)}…`)
  }
  if (typeof receipt !== 'object' || RECEIPT_FIELDS.some((field) => !Object.hasOwn(receipt, field))
    || receipt.domain !== APPROVAL_RECEIPT_DOMAIN || receipt.verdict !== 'OWNER_KEY_SIGNED'
    || !/^[0-9a-f]{128}$/u.test(String(receipt.signature))) {
    throw refuse(SET_REFUSE.APPROVAL_MALFORMED, `the approval is not a complete ${APPROVAL_RECEIPT_DOMAIN} record`)
  }
  if (receipt.approvalKeyDid !== pin.approverDid) {
    throw refuse(SET_REFUSE.NOT_PINNED_KEY, `the receipt names ${String(receipt.approvalKeyDid)} and the pinned approver `
      + `is ${pin.approverDid}`)
  }
  if (receipt.subject !== pin.subject || receipt.activeControlDigest !== pin.activeControlDigest) {
    throw refuse(SET_REFUSE.OTHER_IDENTITY, 'the receipt is for another subject or control head than the pinned one')
  }
  if (receipt.operationDigest !== operationDigest) {
    throw refuse(SET_REFUSE.OTHER_SET, `the receipt approves operation ${String(receipt.operationDigest).slice(0, 16)}… and `
      + `this set's content hashes to ${operationDigest.slice(0, 16)}… (set ${setDigest.slice(0, 16)}…)`)
  }
  let bytes
  try {
    bytes = approvalSigningBytes({
      domain: APPROVAL_REQUEST_DOMAIN,
      subject: receipt.subject,
      activeControlDigest: receipt.activeControlDigest,
      operationDigest: receipt.operationDigest,
      challenge: receipt.challenge,
      issuedAt: receipt.issuedAt,
      expiresAt: receipt.expiresAt,
    })
  } catch (error) {
    throw refuse(SET_REFUSE.APPROVAL_MALFORMED, `the receipt's request fields do not form an approval request: ${error.message}`)
  }
  if (digestOf(bytes) !== receipt.signedBytesDigest) {
    throw refuse(SET_REFUSE.APPROVAL_MALFORMED, 'the receipt claims to have signed bytes its own fields do not derive')
  }
  let ok = false
  try {
    const raw = ed25519PublicKeyFromDidKey(pin.approverDid)
    const key = createPublicKey({ key: { kty: 'OKP', crv: 'Ed25519', x: Buffer.from(raw, 'hex').toString('base64url') }, format: 'jwk' })
    ok = cryptoVerify(null, bytes, key, Buffer.from(receipt.signature, 'hex'))
  } catch { ok = false }
  if (!ok) {
    throw refuse(SET_REFUSE.SIGNATURE_INVALID, `the receipt's signature does not verify under ${pin.approverDid}`)
  }
  return { setDigest, operationDigest, approverDid: pin.approverDid, approvalClass: String(receipt.approvalClass),
    keyClass: String(receipt.keyClass), issuedAt: receipt.issuedAt, count }
}

/**
 * The mounted AUKORA plugin rows in a composition patch: `- id: X` followed by `name: ./plugins/…`.
 * The release's own patches are generated by the materializer in exactly this shape.
 */
export function mountedPluginRows(patchText) {
  const rows = []
  let id = null
  for (const line of patchText.split('\n')) {
    if (/^\s*#/u.test(line)) continue
    const idMatch = /^\s*-\s+id:\s*([A-Za-z0-9@/._-]+)\s*$/u.exec(line)
    if (idMatch) { id = idMatch[1]; continue }
    const nameMatch = /^\s+name:\s*['"]?(\.\/plugins\/[^'"\s#]+)['"]?\s*$/u.exec(line)
    if (nameMatch && id !== null) { rows.push({ id, entry: nameMatch[1].slice(2) }); id = null }
  }
  return rows
}
