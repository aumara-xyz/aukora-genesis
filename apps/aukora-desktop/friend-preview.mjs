// Friend preview: a normal macOS account can bind Aumlok locally.
//
// WHAT THIS IS. A profile marker and a set of named refusals. The local key is the organ's existing
// machine seed (node:crypto Ed25519, written by the bind ceremony). This module mints no key and
// implements no cipher.
//
// WHAT THIS IS NOT. It does not turn on AUKORA_REQUIRE_COMMIT_SSH or
// AUKORA_COMMIT_BIND_REQUIRE_SEPARATE_UID. It does not claim Alpha R1–R3 closed. An owner Airlock
// config that this account can trust keeps today's path. A config this account cannot trust closes
// local signing; a friend preview does not step in and pretend the daemon is up.
import { chmodSync, mkdirSync, readFileSync, realpathSync, writeFileSync } from 'node:fs'
import { isAbsolute, join } from 'node:path'
import { homedir } from 'node:os'
import { fileURLToPath, pathToFileURL } from 'node:url'

export const FRIEND_PROFILE = 'friend-preview'
export const MARKER_NAME = 'friend-preview.json'

export const UNTRUSTED_AIRLOCK = Object.freeze({
  code: 'friend-preview:airlock-config-untrusted',
  copy: 'A file is at the owner-daemon path and this account cannot trust it. Local Aumlok stays closed while that file is here. Repair it on the owner machine, or remove it when this Mac is a friend preview.',
})

/** Consequential owner actions. Friend preview returns a refusal and writes nothing. */
export const OWNER_ONLY = Object.freeze({
  'commit-ssh': Object.freeze({
    code: 'friend-preview:owner-only-commit-ssh',
    copy: 'Commit SSH signing stays on the owner Mac, with the owner key outside this account. Friend preview leaves AUKORA_REQUIRE_COMMIT_SSH off and signs nothing here.',
  }),
  'airlock-sign': Object.freeze({
    code: 'friend-preview:owner-only-airlock',
    copy: 'Airlock signing needs the owner daemon: a second macOS account and /etc/aukora/owner-daemon.json on the owner Mac. This account has no Airlock signer. The operation stops unsigned.',
  }),
  'proof-dir': Object.freeze({
    code: 'friend-preview:owner-only-proof-dir',
    copy: 'The commit-bind proof store stays on the owner Mac under the issuer account named by AUKORA_COMMIT_BIND_PROOF_UID. Friend preview leaves separate-UID mint off and writes no proof.',
  }),
  'self-change': Object.freeze({
    code: 'friend-preview:owner-only-self-change',
    copy: 'self-change pushes the owner repository main and restarts the owner app. Friend preview stops before any commit or push. The remote is unchanged.',
  }),
  become: Object.freeze({
    code: 'friend-preview:owner-only-become',
    copy: 'become replaces the installed owner app. Friend preview stops before any release cut or restart. The app you have stays as it is.',
  }),
  advance: Object.freeze({
    code: 'friend-preview:owner-only-advance',
    copy: 'advance moves the owner repository main. Friend preview stops before any push. The remote is unchanged.',
  }),
})

export const LAUNCH_LINE = 'FRIEND PREVIEW: Aumlok on this Mac is a software key in this macOS account (same uid). Airlock, commit SSH and a second-account proof store stay on the owner Mac. Those switches stay off.'

/** The support folder the desktop app actually uses. `$HOME/.aukora` is not that folder. */
export function macSupportRoot(home = homedir()) {
  return join(home, 'Library', 'Application Support', 'AUKORA')
}

export function friendPreviewLaunchLine(profile) {
  return profile === FRIEND_PROFILE ? LAUNCH_LINE : null
}

export function airlockConfigRefusedLine(error) {
  const detail = String(error?.message ?? error ?? 'unreadable')
  return `aukora-desktop: aumlok signer: not serving: airlock:config-refused: ${UNTRUSTED_AIRLOCK.copy} (${detail})`
}

/**
 * Local Aumlok directory for a friend account. Same layout the shell already binds:
 * `<support>/state/aumlok`. Custody is the same-uid software key the ceilings already name.
 */
export function localAumlokPlan(supportRoot) {
  return Object.freeze({
    ok: true,
    action: 'aumlok-local-approve',
    directory: join(supportRoot, 'state', 'aumlok'),
    custody: 'SAME_UID_POSIX_MODE_ONLY',
    airlock: false,
    requireCommitSsh: false,
    separateUidMint: false,
    custodyMilestone: 'open',
    copy: 'Aumlok on this Mac keeps a software machine key in this account, mode 0600. Any process you run can read it. Approve in the app signs with that key. Commit signing, Airlock, and a second-account proof store stay on the owner Mac.',
  })
}

export function readFriendMarker(supportRoot) {
  const path = join(supportRoot, MARKER_NAME)
  let text
  try {
    text = readFileSync(path, 'utf8')
  } catch (error) {
    if (error?.code === 'ENOENT') return null
    return { refused: true, code: 'friend-preview:marker-unreadable' }
  }
  let value
  try {
    value = JSON.parse(text)
  } catch {
    return { refused: true, code: 'friend-preview:marker-unreadable' }
  }
  if (value?.profile !== FRIEND_PROFILE) return null
  if (value.airlock !== false || value.requireCommitSsh !== false || value.separateUidMint !== false) {
    return { refused: true, code: 'friend-preview:marker-inconsistent' }
  }
  return { profile: FRIEND_PROFILE }
}

/**
 * @param {{ supportRoot?: string, ownerFact?: null|'trusted'|'untrusted', env?: NodeJS.ProcessEnv }} facts
 * ownerFact `trusted` means readOwnerDaemonConfig returned a config. `untrusted` means it threw.
 * `null` means the file is absent. A trusted owner config wins over a friend marker.
 */
export function resolveProfile({ supportRoot, ownerFact = null, env = process.env } = {}) {
  if (ownerFact === 'trusted') return Object.freeze({ kind: 'owner-airlock', consequential: 'existing-flags' })
  if (ownerFact === 'untrusted') return Object.freeze({ kind: 'airlock-untrusted', consequential: 'fail-closed' })
  const marker = typeof supportRoot === 'string' && supportRoot.length > 0 ? readFriendMarker(supportRoot) : null
  if (marker?.refused) {
    return Object.freeze({ kind: 'friend-preview', consequential: 'fail-closed', code: marker.code })
  }
  if (env?.AUKORA_PROFILE === FRIEND_PROFILE || marker?.profile === FRIEND_PROFILE) {
    return Object.freeze({ kind: 'friend-preview', consequential: 'fail-closed' })
  }
  return Object.freeze({ kind: 'unmarked', consequential: 'unchanged' })
}

/**
 * Refusal for a consequential owner action, or null when today's path may continue.
 * Local Aumlok approve is absent from OWNER_ONLY, so a friend profile returns null for it.
 */
export function refusalFor(action, profile) {
  if (profile?.kind === 'owner-airlock' || profile?.kind === 'unmarked') return null
  if (profile?.kind !== 'friend-preview' && profile?.kind !== 'airlock-untrusted') return null
  if (profile.kind === 'airlock-untrusted') {
    return Object.freeze({ ok: false, code: UNTRUSTED_AIRLOCK.code, copy: UNTRUSTED_AIRLOCK.copy, action })
  }
  if (profile.code) {
    const spec = OWNER_ONLY[action]
    return Object.freeze({
      ok: false,
      code: profile.code,
      copy: spec?.copy ?? 'Friend preview marker is inconsistent. The owner action stops.',
      action,
    })
  }
  const spec = OWNER_ONLY[action]
  if (!spec) return null
  return Object.freeze({ ok: false, code: spec.code, copy: spec.copy, action })
}

function markerBody(supportRoot) {
  const plan = localAumlokPlan(supportRoot)
  return {
    profile: FRIEND_PROFILE,
    custody: plan.custody,
    airlock: false,
    requireCommitSsh: false,
    separateUidMint: false,
    custodyMilestone: 'open',
    localAumlokDirectory: plan.directory,
  }
}

/**
 * Write the friend marker and a config overlay the shell merges under its template.
 * Does not set allowUnapproved. Does not set the enforce flags.
 * @returns {{ wrote: boolean, reason: string, supportRoot: string, configPath?: string, markerPath?: string }}
 */
export function writeFriendBootstrap({ supportRoot, repo, ownerFact = null, dryRun = false }) {
  if (ownerFact === 'trusted') return { wrote: false, reason: 'owner-airlock', supportRoot }
  if (ownerFact === 'untrusted') return { wrote: false, reason: 'airlock-config-untrusted', supportRoot }
  if (typeof supportRoot !== 'string' || !isAbsolute(supportRoot)) {
    const error = new Error('friend-preview:support-not-absolute')
    error.code = 'friend-preview:support-not-absolute'
    throw error
  }
  if (typeof repo !== 'string' || !isAbsolute(repo)) {
    const error = new Error('friend-preview:repo-not-absolute')
    error.code = 'friend-preview:repo-not-absolute'
    throw error
  }
  const configPath = join(supportRoot, 'config.json')
  const markerPath = join(supportRoot, MARKER_NAME)
  let existing = null
  try {
    existing = JSON.parse(readFileSync(configPath, 'utf8'))
  } catch (error) {
    if (error?.code !== 'ENOENT') {
      const wrapped = new Error('friend-preview:config-unreadable')
      wrapped.code = 'friend-preview:config-unreadable'
      throw wrapped
    }
  }
  if (existing && typeof existing.profile === 'string' && existing.profile.length > 0
    && existing.profile !== FRIEND_PROFILE) {
    return { wrote: false, reason: 'profile-already-set', supportRoot, configPath }
  }
  const repoValue = typeof existing?.repo === 'string' && existing.repo.length > 0 ? existing.repo : repo
  const config = { ...(existing ?? {}), repo: repoValue, profile: FRIEND_PROFILE }
  delete config.requireCommitSsh
  delete config.separateUidMint
  if (config.allowUnapproved !== true) config.allowUnapproved = false
  const marker = markerBody(supportRoot)
  if (dryRun) {
    return { wrote: false, reason: 'dry-run', supportRoot, configPath, markerPath, config, marker }
  }
  mkdirSync(supportRoot, { recursive: true, mode: 0o700 })
  chmodSync(supportRoot, 0o700)
  const stateDir = join(supportRoot, 'state')
  const aumlokDir = marker.localAumlokDirectory
  mkdirSync(stateDir, { recursive: true, mode: 0o700 })
  chmodSync(stateDir, 0o700)
  mkdirSync(aumlokDir, { recursive: true, mode: 0o700 })
  chmodSync(aumlokDir, 0o700)
  writeFileSync(configPath, `${JSON.stringify(config, null, 2)}\n`, { mode: 0o600 })
  chmodSync(configPath, 0o600)
  writeFileSync(markerPath, `${JSON.stringify(marker, null, 2)}\n`, { mode: 0o600 })
  chmodSync(markerPath, 0o600)
  return { wrote: true, reason: 'friend-preview', supportRoot, configPath, markerPath }
}

function main(argv) {
  const dryRun = argv.includes('--dry-run')
  const supportFlag = argv.indexOf('--support')
  const repoFlag = argv.indexOf('--repo')
  if (argv.includes('--print-support')) {
    process.stdout.write(`${macSupportRoot()}\n`)
    return
  }
  if (!argv.includes('--write-bootstrap')) {
    process.stderr.write('usage: node apps/aukora-desktop/friend-preview.mjs --write-bootstrap --repo ABS --support ABS [--dry-run]\n')
    process.exit(2)
  }
  const supportRoot = supportFlag >= 0 ? argv[supportFlag + 1] : ''
  const repo = repoFlag >= 0 ? argv[repoFlag + 1] : ''
  import('../../scripts/aukora/friend-guard.mjs').then(({ ownerFact }) => {
    try {
      const result = writeFriendBootstrap({ supportRoot, repo, ownerFact: ownerFact(), dryRun })
      process.stdout.write(`${JSON.stringify(result)}\n`)
    } catch (error) {
      process.stderr.write(`${error?.code ?? error?.message ?? 'friend-preview:failed'}\n`)
      process.exit(1)
    }
  }).catch((error) => {
    process.stderr.write(`${error?.message ?? error}\n`)
    process.exit(1)
  })
}

function invokedDirectly() {
  const argv1 = process.argv[1]
  if (typeof argv1 !== 'string' || argv1.length === 0) return false
  try {
    return realpathSync(fileURLToPath(import.meta.url)) === realpathSync(argv1)
  } catch {
    return import.meta.url === pathToFileURL(argv1).href
  }
}

if (invokedDirectly()) main(process.argv.slice(2))
