// Fail closed when a friend-preview Mac asks for an owner action.
// Owner Airlock (a trusted /etc/aukora/owner-daemon.json) keeps today's path.
// Enforce flags stay off unless the process environment already set them.
//
// The desktop reader lives behind plugins/aukora-kira/lib/strict-read.mjs. This guard
// does the same first checks readOwnerDaemonConfig does (absent, not a file, not root-owned,
// group/world writable) without importing that module. A root-owned private file is handed
// to that reader in a child process. If the reader cannot load, the file counts as untrusted.
import { execFileSync } from 'node:child_process'
import { lstatSync } from 'node:fs'
import { macSupportRoot, refusalFor, resolveProfile } from '../../apps/aukora-desktop/friend-preview.mjs'

const DEFAULT_OWNER_CONFIG = '/etc/aukora/owner-daemon.json'

export function ownerFact(path = process.env.AUKORA_OWNER_DAEMON_CONFIG || DEFAULT_OWNER_CONFIG) {
  let info
  try {
    info = lstatSync(path)
  } catch (error) {
    if (error?.code === 'ENOENT') return null
    return 'untrusted'
  }
  // readOwnerDaemonConfig's trusted uid defaults to 0, and mode 022 is refused before parse.
  if (!info.isFile() || info.uid !== 0 || (info.mode & 0o022)) return 'untrusted'
  const reader = new URL('../../apps/aukora-desktop/aumlok-airlock-config.mjs', import.meta.url)
  try {
    const out = execFileSync(process.execPath, ['--input-type=module', '-e', `
      import { readOwnerDaemonConfig } from ${JSON.stringify(reader.href)}
      try {
        const config = readOwnerDaemonConfig(process.env.AUKORA_OWNER_DAEMON_CONFIG)
        process.stdout.write(config === null ? 'absent\\n' : 'trusted\\n')
      } catch {
        process.stdout.write('untrusted\\n')
      }
    `], {
      encoding: 'utf8',
      timeout: 20000,
      env: { ...process.env, AUKORA_OWNER_DAEMON_CONFIG: path },
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    if (out.trim() === 'trusted') return 'trusted'
    if (out.trim() === 'absent') return null
    return 'untrusted'
  } catch {
    return 'untrusted'
  }
}

export function friendConsequentialRefusal(action, supportRoot = process.env.AUKORA_SUPPORT_ROOT || macSupportRoot()) {
  return refusalFor(action, resolveProfile({
    supportRoot,
    ownerFact: ownerFact(),
    env: process.env,
  }))
}

export function failClosedIfFriend(action, supportRoot, fail) {
  const refusal = friendConsequentialRefusal(action, supportRoot)
  if (refusal) fail(`${refusal.code}: ${refusal.copy}`)
}
