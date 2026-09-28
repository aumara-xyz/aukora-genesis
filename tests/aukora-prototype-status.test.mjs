// One check: the friend-facing prototype status stays honest and owner ops fail closed.
// No signer, no key, no live app. Strings are compared to the copy the first-run screen ships.
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  GATEKEEPER_STEPS, LAB_LINE, NOT_ENFORCED, OWNER_ONLY_CODE, OWNER_ONLY_MESSAGE, POSTURE, PREVIEW,
  RAISE_PATHS, SECURITY_FLAGS, airlockFailureIsOwnerOnly, consequentialOwnerDecision, ownerOnlyDetail,
  prototypeStatus,
} from '../plugins/aukora-aumlok/lib/prototype-status.mjs'

const root = new URL('..', import.meta.url).pathname
const read = path => readFileSync(join(root, path), 'utf8')
const locales = read('plugins/aukora-face/layout/src/client/locales.ts')
const shipped = read('plugins/aukora-face/layout/lib/client.js')
const airlock = read('apps/aukora-desktop/aumlok-signer-airlock.mjs')
const statusSource = read('plugins/aukora-aumlok/lib/prototype-status.mjs')

assert.equal(POSTURE, 'PROTOTYPE')
assert.equal(PREVIEW, 'analyst preview')
assert.match(LAB_LINE, /PROTOTYPE/u)
assert.match(LAB_LINE, /analyst preview/u)
assert.equal(prototypeStatus().posture, 'PROTOTYPE')
assert.equal(prototypeStatus().preview, 'analyst preview')
assert.equal(prototypeStatus().platform, 'macOS')
assert.equal(prototypeStatus().ownerOps, 'fail-closed')
assert.equal(prototypeStatus().lab, LAB_LINE)

for (const value of Object.values(SECURITY_FLAGS)) assert.equal(value, false)
assert.equal(Object.isFrozen(SECURITY_FLAGS), true)
assert.equal(statusSource.includes('airlockBoundaryEnforced: true'), false)
assert.equal(statusSource.includes('secondUidEnforced: true'), false)
assert.equal(statusSource.includes('serverSideMainCheck: true'), false)
assert.equal(statusSource.includes('personBoundClick: true'), false)
const lied = prototypeStatus({
  airlock: 'present',
  secondUid: 'present',
  securityFlags: { airlockBoundaryEnforced: true, personBoundClick: true },
})
assert.equal(lied.securityFlags, SECURITY_FLAGS)
assert.equal(lied.securityFlags.airlockBoundaryEnforced, false)
assert.equal(lied.securityFlags.personBoundClick, false)
assert.equal(lied.ownerOnly, false)

for (const observed of [undefined, {}, { airlock: 'missing' }, { airlock: 'present' },
  { airlock: 'unknown', secondUid: 'present' }, { airlock: 'yes', secondUid: 'yes' },
  { airlock: 'present', secondUid: 'missing' }]) {
  const decision = consequentialOwnerDecision(observed)
  assert.equal(decision.action, 'refuse')
  assert.equal(decision.signed, false)
  assert.equal(decision.reason, OWNER_ONLY_CODE)
  assert.equal(decision.message, OWNER_ONLY_MESSAGE)
}
const present = consequentialOwnerDecision({ airlock: 'present', secondUid: 'present' })
assert.equal(present.action, 'refuse')
assert.equal(present.signed, false)
assert.equal(present.reason, 'aumlok:not-authorized-here')
assert.equal(present.message.includes('does not sign'), true)

assert.equal(ownerOnlyDetail(OWNER_ONLY_CODE), OWNER_ONLY_MESSAGE)
assert.equal(ownerOnlyDetail('airlock:refused'), null)
assert.equal(ownerOnlyDetail('aumlok:no-seed'), null)
assert.equal(airlockFailureIsOwnerOnly(Object.assign(new Error('connect'), { code: 'ECONNREFUSED' })), true)
assert.equal(airlockFailureIsOwnerOnly(new Error('airlock:peer-uid')), true)
assert.equal(airlockFailureIsOwnerOnly(new Error('airlock:timeout')), true)
assert.equal(airlockFailureIsOwnerOnly(new Error('airlock:closed')), true)
assert.equal(airlockFailureIsOwnerOnly(new Error('airlock:signature')), false)
assert.equal(airlockFailureIsOwnerOnly(new Error('airlock:challenge')), false)
assert.equal(airlockFailureIsOwnerOnly(new Error('airlock:response-too-large')), false)

assert.equal(GATEKEEPER_STEPS.length, 4)
assert.match(GATEKEEPER_STEPS[3], /Do not turn Gatekeeper off/u)
assert.equal(NOT_ENFORCED.length, 4)
for (const text of [LAB_LINE, OWNER_ONLY_MESSAGE, ...GATEKEEPER_STEPS, NOT_ENFORCED.join(' ')]) {
  assert.equal(locales.includes(text), true, text)
  assert.equal(shipped.includes(text), true, text)
}
for (const path of RAISE_PATHS) {
  assert.equal(locales.includes(path.file), true, path.file)
  assert.equal(locales.includes(path.raises), true, path.raises)
  assert.equal(shipped.includes(path.file), true, path.file)
  assert.equal(shipped.includes(path.raises), true, path.raises)
}
for (const path of RAISE_PATHS) {
  const body = read(path.file)
  assert.equal(body.length > 0, true, path.file)
}
const probeAt = airlock.indexOf('if (!await airlockOwnerReachable(config)) return no(OWNER_ONLY_CODE)')
const reviewAt = airlock.indexOf('withinWindow(review(')
assert.equal(probeAt > 0 && reviewAt > probeAt, true, 'owner-only probe runs before the approval window')
assert.match(airlock, /if \(airlockFailureIsOwnerOnly\(error\)\) return no\(OWNER_ONLY_CODE\)/u)

const { airlockOwnerReachable } = await import('../apps/aukora-desktop/aumlok-airlock-reach.mjs')
const missingAirlock = await airlockOwnerReachable({
  socketPath: '/tmp/aukora-no-such-airlock.sock',
  ownerUid: 602,
  peerHelperPath: '/no/such/peer-uid',
}, 400)
assert.equal(missingAirlock, false, 'a missing Airlock socket is not reachable')

console.log('PASS prototype status: PROTOTYPE / analyst preview; owner ops fail closed; flags stay off')
