/**
 * R1 custody asserts for commit-bind proof store + commit SSH key.
 *
 * Alpha R1: PROOF_DIR (and commit key) must be owned by the expected issuer UID,
 * not by the app/agent caller. 0700 is useless when the writer is the owner.
 *
 * Default OFF: only enforces when requireSeparateUid === true OR
 * AUKORA_COMMIT_BIND_REQUIRE_SEPARATE_UID=1. Landed courts stay green without
 * a live second-account directory. See ~/aukora-live/jobs/M2-R1-CUSTODY.md.
 *
 * Test seams (callerEuid/statSync) are accepted only in MODE=test. Production
 * paths always resolve the process euid and Node's real filesystem stat.
 */
import { statSync as defaultStatSync, existsSync } from 'node:fs'
import { isAbsolute } from 'node:path'
import { pathToFileURL } from 'node:url'

const fail = (code) => {
  const err = new Error(code)
  err.code = code
  throw err
}

const testMode = () => process.env.AUKORA_COMMIT_SIGN_MODE === 'test'

export function separateUidRequired(explicit) {
  if (explicit === true) return true
  if (explicit === false) return false
  return process.env.AUKORA_COMMIT_BIND_REQUIRE_SEPARATE_UID === '1'
}

function resolveCallerEuid(callerEuid, code) {
  if (callerEuid !== undefined) {
    if (!testMode() || !Number.isSafeInteger(callerEuid)) fail(code)
    return callerEuid
  }
  const euid = typeof process.geteuid === 'function' ? process.geteuid() : process.getuid()
  if (!Number.isSafeInteger(euid)) fail(code)
  // Root can write an issuer-owned store/key regardless of its mode.
  if (euid === 0 && !testMode()) fail(code.replace('injection-refused', 'root-refused'))
  return euid
}

function resolveStatSync(injected, code) {
  if (injected === undefined) return defaultStatSync
  if (!testMode() || typeof injected !== 'function') fail(code)
  return injected
}

function expectedOwnerUid(code) {
  const raw = process.env.AUKORA_COMMIT_BIND_PROOF_UID
  if (typeof raw !== 'string' || !/^[1-9][0-9]*$/u.test(raw)) fail(code)
  const uid = Number(raw)
  if (!Number.isSafeInteger(uid) || uid <= 0) fail(code)
  return uid
}

/**
 * Refuse when PROOF_DIR is missing, world-accessible, root-owned, or not owned
 * by the pinned issuer UID.
 * @param {{ storeDir: string, callerEuid?: number, requireSeparateUid?: boolean, statSync?: Function }} args
 */
export function assertProofDirCustody({
  storeDir, callerEuid, requireSeparateUid, statSync,
} = {}) {
  if (!separateUidRequired(requireSeparateUid)) return { enforced: false }
  if (typeof storeDir !== 'string' || storeDir.length === 0 || !isAbsolute(storeDir)) {
    fail('proof-store:dir-missing')
  }
  const stat = resolveStatSync(statSync, 'proof-store:stat-injection-refused')
  let st
  try {
    st = stat(storeDir)
  } catch {
    fail('proof-store:dir-missing')
  }
  if (!st || typeof st.isDirectory !== 'function' || !st.isDirectory()) fail('proof-store:dir-missing')
  const euid = resolveCallerEuid(callerEuid, 'proof-store:caller-euid-injection-refused')
  if (!Number.isSafeInteger(st.uid)) fail('proof-store:dir-owner-unknown')
  if (st.uid === euid) fail('proof-store:same-uid')
  const expected = expectedOwnerUid('proof-store:expected-uid-missing')
  if (st.uid !== expected) fail('proof-store:owner-uid')
  // Require owner-only bits: no group/other (0700-class).
  const mode = st.mode & 0o777
  if ((mode & 0o077) !== 0) fail('proof-store:mode-world')
  return { enforced: true, uid: st.uid, mode }
}

/**
 * Refuse when commit SSH private key is missing, world-readable, root-owned, or
 * not owned by the pinned issuer UID.
 * @param {{ keyPath: string, callerEuid?: number, requireSeparateUid?: boolean, statSync?: Function }} args
 */
export function assertCommitKeyCustody({
  keyPath, callerEuid, requireSeparateUid, statSync,
} = {}) {
  if (!separateUidRequired(requireSeparateUid)) return { enforced: false }
  if (typeof keyPath !== 'string' || keyPath.length === 0) fail('commit-sign:key-missing')
  if (!existsSync(keyPath)) fail('commit-sign:key-missing')
  const stat = resolveStatSync(statSync, 'commit-sign:stat-injection-refused')
  let st
  try {
    st = stat(keyPath)
  } catch {
    fail('commit-sign:key-missing')
  }
  if (!st || typeof st.isFile !== 'function' || !st.isFile()) fail('commit-sign:key-missing')
  const euid = resolveCallerEuid(callerEuid, 'commit-sign:caller-euid-injection-refused')
  if (!Number.isSafeInteger(st.uid)) fail('commit-sign:key-owner-unknown')
  if (st.uid === euid) fail('commit-sign:key-same-uid')
  const expected = expectedOwnerUid('commit-sign:expected-uid-missing')
  if (st.uid !== expected) fail('commit-sign:key-owner-uid')
  const mode = st.mode & 0o777
  if ((mode & 0o077) !== 0) fail('commit-sign:key-mode')
  return { enforced: true, uid: st.uid, mode }
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.stderr.write('commit-bind-custody.mjs: library; import assertProofDirCustody / assertCommitKeyCustody\n')
  process.exit(2)
}
