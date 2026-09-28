/**
 * Independent one-use commit-bind proof store (Airlock-adjacent).
 *
 * Closes Alpha 2 anti-oracle gap: digest compared at consume time is taken FROM
 * this store, never from the caller's argument. Mint is owner/Airlock-side only;
 * commit-ssh-sign helper only consumes.
 *
 * Persistence: AUKORA_COMMIT_BIND_PROOF_DIR/{pending,spent}/<challenge>.json
 * Atomic create on mint; atomic rename pending→spent on consume.
 *
 * See ~/aukora-live/jobs/M2b-PROOF-STORE.md.
 */
import { mkdirSync, openSync, closeSync, writeSync, readFileSync, renameSync,
  existsSync, readdirSync, unlinkSync } from 'node:fs'
import { join, isAbsolute } from 'node:path'
import { createHash } from 'node:crypto'
import { pathToFileURL } from 'node:url'
import { assertProofDirCustody } from './commit-bind-custody.mjs'

const HEX64 = /^[0-9a-f]{64}$/u
const MAX_PENDING = 4096

const fail = (code) => {
  const err = new Error(code)
  err.code = code
  throw err
}

export function sha256Hex(bytes) {
  return createHash('sha256').update(bytes).digest('hex')
}

function storeRoot(explicit) {
  const dir = explicit ?? process.env.AUKORA_COMMIT_BIND_PROOF_DIR
  if (typeof dir !== 'string' || dir.length === 0 || !isAbsolute(dir)) fail('proof-store:dir-missing')
  // R1: optional separate-UID refuse; when enabled, the issuer UID pin is required. Default off.
  assertProofDirCustody({ storeDir: dir })
  return dir
}

function ensureLayout(root) {
  mkdirSync(join(root, 'pending'), { recursive: true, mode: 0o700 })
  mkdirSync(join(root, 'spent'), { recursive: true, mode: 0o700 })
}

function pendingPath(root, challenge) { return join(root, 'pending', `${challenge}.json`) }
function spentPath(root, challenge) { return join(root, 'spent', `${challenge}.json`) }

function countPending(root) {
  try { return readdirSync(join(root, 'pending')).filter((n) => n.endsWith('.json')).length }
  catch { return 0 }
}

function parseEntry(raw) {
  let entry
  try { entry = JSON.parse(raw) } catch { fail('proof-store:malformed') }
  if (!entry || typeof entry !== 'object') fail('proof-store:malformed')
  const { challenge, bindDigest, decisionSignature, issuedAt, expiresAt } = entry
  if (typeof challenge !== 'string' || !HEX64.test(challenge)) fail('proof-store:malformed')
  if (typeof bindDigest !== 'string' || !HEX64.test(bindDigest)) fail('proof-store:malformed')
  if (typeof decisionSignature !== 'string' || decisionSignature.length < 32) fail('proof-store:malformed')
  if (!Number.isSafeInteger(issuedAt) || !Number.isSafeInteger(expiresAt)) fail('proof-store:malformed')
  if (expiresAt - issuedAt > 600 || expiresAt <= issuedAt) fail('proof-store:malformed')
  return { challenge, bindDigest, decisionSignature, issuedAt, expiresAt }
}

/**
 * Mint a one-use proof. Owner/Airlock only — caller must already hold a decision
 * signature binding bindDigest. Does not verify the signature here (Airlock did);
 * it records the bindDigest that consume will treat as source of truth.
 */
export function mintCommitBindProof({
  challenge, bindDigest, decisionSignature, issuedAt, expiresAt, storeDir,
}) {
  if (typeof challenge !== 'string' || !HEX64.test(challenge)) fail('proof-store:malformed')
  if (typeof bindDigest !== 'string' || !HEX64.test(bindDigest)) fail('proof-store:malformed')
  if (typeof decisionSignature !== 'string' || decisionSignature.length < 32) fail('proof-store:malformed')
  const now = Math.floor(Date.now() / 1000)
  const issued = Number.isSafeInteger(issuedAt) ? issuedAt : now
  const expires = Number.isSafeInteger(expiresAt) ? expiresAt : issued + 300
  if (expires - issued > 600 || expires <= issued) fail('proof-store:malformed')
  if (now >= expires) fail('proof-store:expired')

  const root = storeRoot(storeDir)
  ensureLayout(root)
  if (countPending(root) >= MAX_PENDING) fail('proof-store:busy')
  if (existsSync(spentPath(root, challenge))) fail('proof-store:challenge-exists')

  const body = `${JSON.stringify({
    challenge, bindDigest, decisionSignature, issuedAt: issued, expiresAt: expires,
  })}\n`
  const dest = pendingPath(root, challenge)
  // O_CREAT|O_EXCL — refuse if challenge already pending
  let fd
  try {
    fd = openSync(dest, 'wx', 0o600)
  } catch (error) {
    if (error && error.code === 'EEXIST') fail('proof-store:challenge-exists')
    throw error
  }
  try {
    writeSync(fd, body)
  } finally {
    closeSync(fd)
  }
  return { challenge, bindDigest, expiresAt: expires }
}

/**
 * Consume a one-use proof. Helper reads bindDigest FROM THE STORE (not caller).
 * unsignedBytes are hashed here; mismatch with store digest → digest-not-bound.
 */
export function consumeCommitBindProof({ challenge, unsignedBytes, storeDir, now }) {
  if (typeof challenge !== 'string' || !HEX64.test(challenge)) fail('proof-store:malformed')
  if (!Buffer.isBuffer(unsignedBytes) && typeof unsignedBytes !== 'string') {
    fail('proof-store:unsigned-missing')
  }
  const root = storeRoot(storeDir)
  const pending = pendingPath(root, challenge)
  if (!existsSync(pending)) {
    if (existsSync(spentPath(root, challenge))) fail('proof-store:replay')
    fail('proof-store:missing')
  }

  const entry = parseEntry(readFileSync(pending, 'utf8'))
  if (entry.challenge !== challenge) fail('proof-store:malformed')
  const current = Number.isSafeInteger(now) ? now : Math.floor(Date.now() / 1000)
  if (current >= entry.expiresAt) fail('proof-store:expired')

  const hashed = sha256Hex(Buffer.from(unsignedBytes))
  if (hashed !== entry.bindDigest) fail('proof-store:digest-not-bound')

  ensureLayout(root)
  const spent = spentPath(root, challenge)
  try {
    renameSync(pending, spent)
  } catch (error) {
    if (error && error.code === 'EEXIST') fail('proof-store:replay')
    // race: another consume won
    if (!existsSync(pending) && existsSync(spent)) fail('proof-store:replay')
    throw error
  }
  return { bindDigest: entry.bindDigest, challenge, decisionSignature: entry.decisionSignature }
}

/** Test helper: wipe pending+spent under a disposable storeDir. */
export function _resetProofStoreForTests(storeDir) {
  const root = storeRoot(storeDir)
  for (const sub of ['pending', 'spent']) {
    const dir = join(root, sub)
    if (!existsSync(dir)) continue
    for (const name of readdirSync(dir)) {
      if (name.endsWith('.json')) unlinkSync(join(dir, name))
    }
  }
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.stderr.write('commit-bind-proof-store.mjs: library; import mint/consume\n')
  process.exit(2)
}
