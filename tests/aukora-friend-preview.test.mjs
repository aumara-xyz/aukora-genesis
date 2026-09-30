#!/usr/bin/env node
// Friend preview: scratch files only. No app launch, no phrase, no owner daemon.
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { chmodSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { resolveTarget } from '../apps/aukora-desktop/resolve.mjs'
import { friendConsequentialRefusal, ownerFact } from '../scripts/aukora/friend-guard.mjs'
import {
  FRIEND_PROFILE, LAUNCH_LINE, OWNER_ONLY, UNTRUSTED_AIRLOCK, airlockConfigRefusedLine,
  friendPreviewLaunchLine, localAumlokPlan, refusalFor, resolveProfile, writeFriendBootstrap,
} from '../apps/aukora-desktop/friend-preview.mjs'

const root = fileURLToPath(new URL('..', import.meta.url))
const scratch = mkdtempSync(join(tmpdir(), 'aukora-friend-preview-'))
const saved = {
  AUKORA_PROFILE: process.env.AUKORA_PROFILE,
  AUKORA_SUPPORT_ROOT: process.env.AUKORA_SUPPORT_ROOT,
  AUKORA_OWNER_DAEMON_CONFIG: process.env.AUKORA_OWNER_DAEMON_CONFIG,
  AUKORA_REQUIRE_COMMIT_SSH: process.env.AUKORA_REQUIRE_COMMIT_SSH,
}

function restoreEnv() {
  for (const [key, value] of Object.entries(saved)) {
    if (value === undefined) delete process.env[key]
    else process.env[key] = value
  }
}

try {
  assert.equal(friendPreviewLaunchLine(null), null)
  assert.equal(friendPreviewLaunchLine('owner-airlock'), null)
  assert.equal(friendPreviewLaunchLine(FRIEND_PROFILE), LAUNCH_LINE)
  assert.match(airlockConfigRefusedLine(new Error('airlock:config-untrusted')), /airlock:config-refused/)
  assert.match(airlockConfigRefusedLine(new Error('airlock:config-untrusted')), /Local Aumlok stays closed/)
  console.log('PASS launch line and airlock refusal copy')

  const plan = localAumlokPlan(join(scratch, 'support'))
  assert.equal(plan.ok, true)
  assert.equal(plan.airlock, false)
  assert.equal(plan.requireCommitSsh, false)
  assert.equal(plan.separateUidMint, false)
  assert.equal(plan.custody, 'SAME_UID_POSIX_MODE_ONLY')
  assert.equal(plan.custodyMilestone, 'open')
  assert.equal(refusalFor('aumlok-local-approve', { kind: 'friend-preview' }), null)
  console.log('PASS local Aumlok plan: same-uid software key, enforce flags off')

  const friend = { kind: 'friend-preview' }
  for (const action of Object.keys(OWNER_ONLY)) {
    const refusal = refusalFor(action, friend)
    assert.equal(refusal.ok, false)
    assert.equal(refusal.code, OWNER_ONLY[action].code)
    assert.ok(refusal.copy.length > 40)
  }
  assert.equal(refusalFor('self-change', { kind: 'unmarked' }), null)
  assert.equal(refusalFor('self-change', { kind: 'owner-airlock' }), null)
  assert.equal(refusalFor('commit-ssh', resolveProfile({
    ownerFact: 'trusted',
    env: { AUKORA_PROFILE: FRIEND_PROFILE },
  })), null)
  const untrusted = refusalFor('self-change', resolveProfile({ ownerFact: 'untrusted' }))
  assert.equal(untrusted.code, UNTRUSTED_AIRLOCK.code)
  console.log('PASS owner actions fail closed; trusted Airlock keeps today\'s path')

  const support = join(scratch, 'marked')
  const repo = join(scratch, 'repo')
  const written = writeFriendBootstrap({ supportRoot: support, repo, ownerFact: null })
  assert.equal(written.wrote, true)
  const marker = JSON.parse(readFileSync(join(support, 'friend-preview.json'), 'utf8'))
  assert.equal(marker.profile, FRIEND_PROFILE)
  assert.equal(marker.airlock, false)
  assert.equal(marker.requireCommitSsh, false)
  assert.equal(marker.separateUidMint, false)
  assert.equal(marker.custodyMilestone, 'open')
  const config = JSON.parse(readFileSync(join(support, 'config.json'), 'utf8'))
  assert.equal(config.repo, repo)
  assert.equal(config.profile, FRIEND_PROFILE)
  assert.equal(config.allowUnapproved, false)
  assert.equal(Object.hasOwn(config, 'requireCommitSsh'), false)
  assert.equal((lstatSync(support).mode & 0o777), 0o700)
  assert.equal((lstatSync(join(support, 'state', 'aumlok')).mode & 0o777), 0o700)
  assert.equal((lstatSync(join(support, 'config.json')).mode & 0o777), 0o600)
  const again = writeFriendBootstrap({ supportRoot: support, repo: join(scratch, 'other'), ownerFact: null })
  assert.equal(again.wrote, true)
  assert.equal(JSON.parse(readFileSync(join(support, 'config.json'), 'utf8')).repo, repo)
  assert.equal(writeFriendBootstrap({ supportRoot: support, repo, ownerFact: 'trusted' }).reason, 'owner-airlock')
  assert.equal(writeFriendBootstrap({ supportRoot: join(scratch, 'skip'), repo, ownerFact: 'untrusted' }).reason,
    'airlock-config-untrusted')
  const dry = writeFriendBootstrap({ supportRoot: join(scratch, 'dry'), repo, dryRun: true })
  assert.equal(dry.wrote, false)
  assert.equal(dry.reason, 'dry-run')
  assert.throws(() => lstatSync(join(scratch, 'dry')))
  console.log('PASS bootstrap writes friend profile, keeps flags off, skips owner Airlock')

  writeFileSync(join(support, 'friend-preview.json'), `${JSON.stringify({ ...marker, requireCommitSsh: true })}\n`)
  const inconsistent = resolveProfile({ supportRoot: support, ownerFact: null, env: {} })
  assert.equal(inconsistent.kind, 'friend-preview')
  assert.equal(refusalFor('advance', inconsistent).code, 'friend-preview:marker-inconsistent')
  writeFileSync(join(support, 'friend-preview.json'), `${JSON.stringify(marker)}\n`)
  console.log('PASS inconsistent marker fails closed')

  const userData = join(scratch, 'userdata')
  const release = join(userData, 'release')
  mkdirSync(join(release, '.dsh-build'), { recursive: true })
  writeFileSync(join(release, '.dsh-build/genesis-artifacts.json'),
    `${JSON.stringify({ producer: { genesisCommit: '1'.repeat(40) } })}\n`)
  writeFileSync(join(userData, 'config.json'), `${JSON.stringify({
    release, checkout: join(userData, 'checkout'), profile: FRIEND_PROFILE,
  }, null, 2)}\n`)
  mkdirSync(join(userData, 'checkout'), { recursive: true })
  const target = await resolveTarget({ env: {}, userData, checkoutsDir: join(userData, 'checkouts') })
  assert.ok(target.why.includes(LAUNCH_LINE))
  assert.equal(target.allowUnapproved, true)
  console.log('PASS resolver announces friend preview on first run')

  const sourcePath = join(root, 'apps/aukora-desktop/friend-preview.mjs')
  const source = readFileSync(sourcePath, 'utf8')
  const gate = "if (profile?.kind !== 'friend-preview' && profile?.kind !== 'airlock-untrusted') return null"
  assert.equal(source.split(gate).length, 2, 'red arm must remove exactly the friend-preview refusal gate')
  const mutantPath = join(scratch, 'friend-preview-mutant.mjs')
  writeFileSync(mutantPath, source.replace(gate, "if (profile?.kind !== 'friend-preview-DISABLED' && profile?.kind !== 'airlock-untrusted') return null"))
  const mutant = await import(pathToFileURL(mutantPath).href)
  const opened = mutant.refusalFor('self-change', { kind: 'friend-preview' })
  assert.throws(() => {
    assert.equal(opened?.code, OWNER_ONLY['self-change'].code)
  }, (error) => error.code === 'ERR_ASSERTION')
  console.log('RED caught: removing the friend-preview gate lets self-change through')

  process.env.AUKORA_OWNER_DAEMON_CONFIG = join(scratch, 'missing-owner.json')
  process.env.AUKORA_SUPPORT_ROOT = support
  delete process.env.AUKORA_PROFILE
  const wired = friendConsequentialRefusal('self-change', support)
  assert.equal(wired.code, OWNER_ONLY['self-change'].code)
  assert.match(wired.copy, /The remote is unchanged/)
  assert.equal(ownerFact(join(scratch, 'missing-owner.json')), null)
  const bare = join(scratch, 'bare-support')
  mkdirSync(bare, { recursive: true })
  assert.equal(friendConsequentialRefusal('self-change', bare), null)
  const broken = join(scratch, 'broken-owner.json')
  writeFileSync(broken, '{}\n', { mode: 0o666 })
  chmodSync(broken, 0o666)
  assert.equal(ownerFact(broken), 'untrusted')
  process.env.AUKORA_OWNER_DAEMON_CONFIG = broken
  assert.equal(friendConsequentialRefusal('advance', bare).code, UNTRUSTED_AIRLOCK.code)
  console.log('PASS friend guard: marker refuses self-change; absent config does not; untrusted config refuses advance')

  for (const [file, needle, later] of [
    ['scripts/aukora/self-change.mjs', "failClosedIfFriend('self-change', SUPPORT, fail)", 'usage: node scripts/aukora/self-change.mjs'],
    ['scripts/aukora/advance.mjs', "failClosedIfFriend('advance', SUPPORT, fail)", "git(['push'"],
    ['scripts/aukora/become.mjs', "failClosedIfFriend('become', SUPPORT,", 'main().catch'],
    ['scripts/aukora/commit-ssh-candidate.mjs', "friendConsequentialRefusal('commit-ssh')", "'commit-tree', tree"],
  ]) {
    const text = readFileSync(join(root, file), 'utf8')
    const at = text.indexOf(needle)
    assert.ok(at > 0, `${file} must call the friend guard`)
    assert.ok(at < text.indexOf(later), `${file} must refuse before ${later}`)
  }
  console.log('PASS self-change, advance, become and commit-ssh call the guard before they act')

  const explain = execFileSync('sh', [join(root, 'scripts/friend-mac-pack.sh'), '--explain'], { encoding: 'utf8' })
  assert.match(explain, /unsigned/)
  assert.match(explain, /xattr -dr com.apple.quarantine/)
  assert.match(explain, /AUKORA_REQUIRE_COMMIT_SSH and AUKORA_COMMIT_BIND_REQUIRE_SEPARATE_UID unset/)
  assert.match(explain, /notarization ticket/)
  let packed
  try {
    packed = execFileSync('sh', [join(root, 'scripts/friend-mac-pack.sh')], { encoding: 'utf8' })
  } catch (error) {
    packed = error
  }
  if (process.platform === 'darwin') {
    assert.fail(`this court runs the not-darwin arm; platform was ${process.platform}`)
  } else {
    assert.equal(packed.status, 1)
    assert.match(packed.stderr, /friend-pack:not-darwin/)
    console.log('PASS friend-mac-pack --explain; zip refused off macOS')
  }

  delete process.env.AUKORA_PROFILE
  delete process.env.AUKORA_SUPPORT_ROOT
  delete process.env.AUKORA_OWNER_DAEMON_CONFIG
  delete process.env.AUKORA_REQUIRE_COMMIT_SSH
  const { writeCandidateCommit } = await import('../scripts/aukora/commit-ssh-candidate.mjs')
  process.env.AUKORA_PROFILE = FRIEND_PROFILE
  process.env.AUKORA_REQUIRE_COMMIT_SSH = '1'
  process.env.AUKORA_OWNER_DAEMON_CONFIG = join(scratch, 'missing-owner.json')
  process.env.AUKORA_SUPPORT_ROOT = bare
  assert.throws(() => writeCandidateCommit(scratch, { tree: 'a', base: 'b', message: 'c' }),
    (error) => error?.message === 'friend-preview:owner-only-commit-ssh')
  console.log('PASS commit-ssh flag on a friend profile refuses before git')
} finally {
  restoreEnv()
  rmSync(scratch, { recursive: true, force: true })
}
