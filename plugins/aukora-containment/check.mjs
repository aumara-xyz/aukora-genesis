#!/usr/bin/env node
/**
 * Increment 1 stage self-check.
 *
 * Proves the placement stubs refuse a signer-socket forward, a home mount,
 * a universal shell, and best-effort graduation, and that B01/B02/O01–O08
 * stay labeled UNRUN. It does not start OpenShell or the desktop app.
 *
 * Absent from scripts/check.sh on purpose: an UNRUN metal court must not
 * increment that packet's pass count.
 *
 *   node plugins/aukora-containment/check.mjs
 */
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { WORKSPACE_PATCH, WORKSPACE_PATCH_DEFINITION } from '../aukora-box/aukora/broker/effect-definition.mjs'
import { launch, MAC_SPIKE_FIXES } from './backends/openshell-sketch.mjs'
import { INC1_CASES, qualificationCase } from './courts/inc1.mjs'
import { admitProfile, admitWorkloadRequest, CLOSED_EFFECT, isProtectedMountShape } from './lib/adapter.mjs'
import { GATE_A_BLOCKERS, PLACEMENT, REQUIRED_FILESYSTEM_COMPATIBILITY, SEAMS, STAGE } from './lib/placement.mjs'

const HERE = dirname(fileURLToPath(import.meta.url))

/**
 * @param {boolean} ok
 * @param {string} message
 */
function assert(ok, message) {
  if (!ok) {
    process.stderr.write(`FAIL ${message}\n`)
    process.exit(1)
  }
}

/**
 * @param {() => void} fn
 * @param {string} code
 */
function assertRefused(fn, code) {
  let caught = null
  try {
    fn()
  } catch (error) {
    caught = error
  }
  assert(caught !== null && caught.code === code, `expected ${code}, got ${caught?.code ?? 'no throw'}`)
}

const adapterSource = readFileSync(join(HERE, 'lib', 'adapter.mjs'), 'utf8')
const sketchSource = readFileSync(join(HERE, 'backends', 'openshell-sketch.mjs'), 'utf8')
const policy = readFileSync(join(HERE, 'policy', 'memory-metal-worker.inc1.sketch.yaml'), 'utf8')
const placementDoc = readFileSync(join(HERE, '..', '..', 'docs', 'research', 'containment', 'INC1-PLACEMENT.md'), 'utf8')

for (const [name, text] of [['adapter', adapterSource], ['sketch', sketchSource], ['policy', policy], ['placement-doc', placementDoc]]) {
  assert(!/[0-9a-fA-F]{64}/.test(text), `${name} contains a contiguous 64-hex string`)
}

assert(!/import\s*\(|from\s+['"][^'"]*workspace-patch\.mjs['"]/.test(adapterSource), 'adapter imports the workspace.patch executor')
assert(!adapterSource.includes('node:child_process'), 'adapter imports child_process')
assert(!adapterSource.includes('electron'), 'adapter names Electron')
assert(!/\bspawn\(/.test(sketchSource), 'sketch names a process spawn')

assert(STAGE.status === 'STAGE' && STAGE.wired === false && STAGE.mounted === false, 'stage banner drifted')
assert(STAGE.become === false && STAGE.liveElectron === false, 'stage claims a live wire or Become')
assert(STAGE.openshellIsApprove === false, 'OpenShell was marked as Approve')
assert(STAGE.gateA === 'UNMET' && GATE_A_BLOCKERS.length >= 8, 'Gate A blockers missing')
assert(STAGE.baseCommit === '28956e78a', 'base commit pin drifted')
assert(STAGE.sameUidCeiling.includes('share one UID'), 'same-UID ceiling dropped')

assert(PLACEMENT.insideWorkload.includes('cordis-agent'), 'Cordis worker left the workload')
assert(PLACEMENT.outsideWorkload.includes('broker'), 'broker entered the workload')
assert(PLACEMENT.outsideWorkload.includes('issuer'), 'issuer entered the workload')
assert(PLACEMENT.outsideWorkload.includes('workspace.patch'), 'workspace.patch executor entered the workload')
assert(SEAMS.seatbeltProfile.endsWith('plugins/aukora-seatbelt/lib/profile.mjs'), 'seatbelt seam path drifted')

assert(CLOSED_EFFECT === WORKSPACE_PATCH, 'closed effect diverged from the carried definition')
assert(
  JSON.stringify(WORKSPACE_PATCH_DEFINITION.parameters) === JSON.stringify(['workspace', 'path', 'beforeSha256', 'content']),
  'carried workspace.patch parameters drifted',
)

assertRefused(() => admitWorkloadRequest({ effect: CLOSED_EFFECT, forwardSignerSocket: true }), 'containment:signer-socket-forward-refused')
assertRefused(() => admitWorkloadRequest({ effect: CLOSED_EFFECT, mounts: ['/tmp/aumlok-signer.sock'] }), 'containment:signer-socket-forward-refused')
assertRefused(() => admitWorkloadRequest({ effect: CLOSED_EFFECT, mountHome: true }), 'containment:home-mount-refused')
assertRefused(() => admitWorkloadRequest({ effect: CLOSED_EFFECT, mounts: ['/Users/owner'] }), 'containment:home-mount-refused')
assertRefused(() => admitWorkloadRequest({ effect: CLOSED_EFFECT, mounts: ['/var/run/docker.sock'] }), 'containment:home-mount-refused')
assertRefused(() => admitWorkloadRequest({ effect: 'bash' }), 'containment:universal-shell-refused')
assertRefused(() => admitWorkloadRequest({ effect: CLOSED_EFFECT, universalShell: true }), 'containment:universal-shell-refused')
assertRefused(() => admitWorkloadRequest({ effect: CLOSED_EFFECT, workerPolicyChange: true }), 'containment:worker-policy-change-refused')
assertRefused(() => admitProfile({ compatibility: 'best_effort' }), 'containment:best-effort-refused')
assert(isProtectedMountShape('~/Library/Application Support/AUKORA/state/aumlok-signer.sock'), 'signer path under home was not protected')

const held = admitWorkloadRequest({
  effect: CLOSED_EFFECT,
  mounts: ['workload-scratch'],
})
assert(held.status === 'NOT_WIRED' && held.executed === false && held.placement === 'outside', 'workspace.patch was treated as executed')
assert(held.owner.endsWith('workspace-patch.mjs'), 'outside owner path drifted')

const profile = admitProfile({ compatibility: REQUIRED_FILESYSTEM_COMPATIBILITY })
assert(profile.status === 'NOT_WIRED' && profile.accepted === false, 'a compatibility keyword graduated the profile')

assertRefused(() => launch(), 'containment:not-wired')
assert(MAC_SPIKE_FIXES.B.refuseRoot === true && MAC_SPIKE_FIXES.B.assumeSandboxUser === false, 'workload user fix drifted')
assert(MAC_SPIKE_FIXES.D.maxChars === 19, 'sandbox name limit drifted')
assert(MAC_SPIKE_FIXES.A.avoids.includes('127.0.0.1'), 'docker callback fix dropped the failing endpoint')

assert(policy.includes('compatibility: hard_requirement'), 'sketch policy lost hard_requirement')
assert(policy.includes('status: STAGE') && policy.includes('gateA: UNMET'), 'sketch policy lost its stage marks')
assert(policy.includes('signer-socket') && policy.includes('owner-home'), 'sketch policy dropped a refused mount')
assert(!policy.includes('best_effort'), 'sketch policy allows best_effort')
assert(!/\/Users\/|\/home\/|aumlok-signer\.sock:/.test(policy), 'sketch policy names a concrete home or socket mount')

const expectedIds = ['B01', 'B02', 'O01', 'O02', 'O03', 'O04', 'O05', 'O06', 'O07', 'O08']
assert(INC1_CASES.length === expectedIds.length, 'Increment 1 case list changed size')
for (const id of expectedIds) {
  const row = qualificationCase(id)
  assert(row.status === 'UNRUN' && row.executableInCi === false, `${id} is executable or not UNRUN`)
  process.stdout.write(`UNRUN ${id}\n`)
}

process.stdout.write('INC1 STAGE SELF-CHECK: placement stubs hold; metal courts UNRUN; OpenShell is not Approve\n')
