// One disposable migration/comparison flow. Transport is replaced before any route or bootstrap runs.
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { generateKeyPairSync, randomBytes, sign } from 'node:crypto'
import * as fs from 'node:fs'
import { tmpdir } from 'node:os'
import * as path from 'node:path'
import { fileURLToPath } from 'node:url'
import { stripTypeScriptTypes } from 'node:module'
import { Script } from 'node:vm'
import * as identity from '../plugins/aukora-nostr/lib/identity.mjs'
import * as contacts from '../plugins/aukora-nostr/lib/contact.mjs'
import * as receipts from '../plugins/aukora-nostr/lib/confirmation.mjs'
import * as writer from '../plugins/aukora-nostr/bin/add-contact.mjs'
import * as record from '../plugins/aukora-aumlok/lib/record-v3.mjs'
import * as witness from '../plugins/aukora-owner-daemon/lib/airlock-witness.mjs'
import { publicKeyOf } from '../plugins/aukora-nostr/lib/event.mjs'
import * as wire from '../plugins/aukora-face/messages/src/messages-route.ts'
import * as store from '../plugins/aukora-face/messages/src/contacts-store.ts'

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)))
const scratch = fs.mkdtempSync(path.join(tmpdir(), 'contact-migration-'))
const source = name => fs.readFileSync(path.join(root, name), 'utf8')
const prior = name => execFileSync('/usr/bin/git', ['-C', root, 'show', `2e9b855d29f4ecf9148d482497a28ed38757d83b:${name}`], { encoding: 'utf8' })
const compiled = process.argv.includes('--compiled')
const region = (text, name) => {
  const start = text.indexOf(`//#region ${name}`), end = text.indexOf('//#endregion', start)
  assert.ok(start >= 0 && end > start, `compiled region absent: ${name}`)
  return text.slice(start, end)
}
const plain = text => stripTypeScriptTypes(text).replace(/\bexport (?=(?:async )?function|const)/gu, '')
const fn = (text, name) => {
  const found = plain(text).match(new RegExp(`(?:async )?function ${name}\\([^]*?\\n\\}`, 'u'))?.[0]
  assert.ok(found, `function absent: ${name}`)
  return found
}
const instant = offset => new Date(Math.floor(Date.now() / 1000) * 1000 + offset).toISOString().replace('.000Z', 'Z')
let calls = 0, mode = 'approved'
const parties = []
function party(name, scalar, rootDigit) {
  const stateDir = path.join(scratch, name), controllerDir = path.join(stateDir, 'controller')
  fs.mkdirSync(path.join(stateDir, 'nostr'), { recursive: true }); fs.mkdirSync(controllerDir)
  const pair = generateKeyPairSync('ed25519'), other = generateKeyPairSync('ed25519')
  const hex = pair.publicKey.export({ type: 'spki', format: 'der' }).subarray(-32).toString('hex')
  const otherHex = other.publicKey.export({ type: 'spki', format: 'der' }).subarray(-32).toString('hex')
  const secretKeyHex = scalar.toString(16).padStart(64, '0'), nostrPubkeyHex = publicKeyOf(secretKeyHex)
  const npub = identity.npubEncode(nostrPubkeyHex), subject = `aukora:1:${rootDigit.repeat(64)}`
  const controller = { version: 3, publicRoot: { rootId: rootDigit.repeat(64), handle: name, epoch: 1,
    machines: [{ ed25519: hex }, { ed25519: otherHex }] }, revokedMachines: [] }
  // Two active keys exercise preservation of the binding's actual signer, not a guessed first key.
  const controllerFile = path.join(controllerDir, 'local-control.json')
  fs.writeFileSync(controllerFile, JSON.stringify(controller), { mode: 0o600 })
  const keyFile = path.join(stateDir, 'nostr/identity.json')
  fs.writeFileSync(keyFile, JSON.stringify({ secretKeyHex }), { mode: 0o600 })
  const statement = { subject, npub, nostrPubkeyHex, handle: name, createdAt: instant(-1000) }
  const legacy = { domain: identity.NOSTR_BINDING_DOMAIN, statement,
    signature: sign(null, identity.bindingPreimage(statement), pair.privateKey).toString('hex'), approvalKeyDid: `did:key:${hex}`, label: name }
  const bindingFile = path.join(stateDir, 'nostr/binding.json')
  fs.writeFileSync(bindingFile, JSON.stringify(legacy), { mode: 0o600 })
  const item = { stateDir, controllerDir, controllerFile, controller, pair, other, hex, otherHex, npub, subject,
    bindingFile, keyFile, legacy, keyBytes: fs.readFileSync(keyFile), bindingBytes: fs.readFileSync(bindingFile) }
  parties.push(item); return item
}
async function syntheticAsk(request, socket) {
  assert.ok(socket.startsWith(scratch), 'nonfixture signer path')
  const owner = parties.find(item => item.subject === request.subject)
  assert.ok(owner); calls++
  if (mode === 'declined') return { domain: 'aukora:owner-approval-response:v1', challenge: request.challenge, refusal: 'signer:declined' }
  if (mode === 'expired') return { domain: 'aukora:owner-approval-response:v1', challenge: request.challenge, refusal: 'signer:request-expired' }
  const binding = request.operation === 'sign-nostr-binding'
  const statement = binding ? { subject: request.subject, npub: request.npub,
    nostrPubkeyHex: identity.npubDecode(request.npub), handle: request.handle, createdAt: request.issuedAt, safetyVersion: request.safetyVersion }
    : { subject: request.subject, npub: request.npub, controllerKeyHex: request.controllerKeyHex,
      sasDigits: request.sasDigits, confirmedAt: request.confirmedAt, safetyVersion: request.safetyVersion }
  const bytes = binding ? witness.nostrBindingPreimage(statement) : witness.sasConfirmationPreimage(statement)
  // Confirmation subject belongs to the peer; its approver is selected by the fixture socket's owner.
  const approver = binding ? owner : parties.find(item => socket.startsWith(item.stateDir))
  assert.ok(approver)
  if (mode === 'key-change' && binding) fs.writeFileSync(owner.keyFile, JSON.stringify({ secretKeyHex: '9'.padStart(64, '0') }))
  return { domain: 'aukora:owner-approval-response:v1', challenge: mode === 'challenge' ? '0'.repeat(64) : request.challenge,
    signature: sign(null, Buffer.from(mode === 'old-domain' && !binding ? bytes.replace(witness.SAS_CONFIRMATION_DOMAIN, 'aukora:nostr-sas-confirmation:v1') : bytes),
      mode === 'other-machine' ? approver.other.privateKey : approver.pair.privateKey).toString('hex') }
}
function bootstrap(text = source('plugins/aukora-nostr/lib/bootstrap.mjs')) {
  const code = text.replace(/^import[^\n]+\n/gmu, '').replaceAll('import.meta.url', "'file:///disposable/bootstrap.mjs'").replace(/\bexport (?=(?:async )?function)/gu, '')
  return new Script(`${code}\naumlokModule = fixtureModule; ({readMessagesIdentity, ensureMessagesIdentity, reissueMessagesIdentity: typeof reissueMessagesIdentity === 'function' ? reissueMessagesIdentity : null})`)
    .runInNewContext({ ...fs, ...path, ...identity, identityFingerprint: contacts.identityFingerprint,
      randomBytes, process: { pid: process.pid, env: {} }, Buffer,
      fixtureModule: async name => name === 'record-v3' ? record : { askSignerOperation: syntheticAsk } })
}
const index = source('plugins/aukora-face/messages/src/index.ts')
const host = compiled ? source('plugins/aukora-face/messages/lib/index.js') : null
function migrationRoute(owner, runtime, allowed = true, text = host ?? index) {
  return new Script(`(${fn(text, 'reissueIdentityRoute')})`).runInNewContext({
    MESSAGES_REISSUE_IDENTITY_ENDPOINT: wire.MESSAGES_REISSUE_IDENTITY_ENDPOINT,
    admitted: (_gate, method) => { assert.equal(method, 'POST'); return allowed },
    hostOwnedRefusal: () => undefined, isRecord: value => value !== null && typeof value === 'object' && !Array.isArray(value),
    contactFieldsAreSafe: wire.contactFieldsAreSafe, messagesRefusalBody: wire.messagesRefusalBody, URL,
    readRequestBody: async req => ({ kind: 'body', text: req.body }), identityBootstrap: async () => runtime,
    answer: (res, body) => { res.statusCode = 400; res.body = body },
    json: (res, status, body) => { res.statusCode = status; res.body = body },
  })(() => ({}), () => ({ stateDir: owner.stateDir, controllerDir: owner.controllerDir }))
}
async function runRoute(route, body) {
  const res = { statusCode: 0, setHeader() {}, end(text) { this.body = JSON.parse(text) } }
  await route.handler({ url: route.path, body: JSON.stringify(body), async *[Symbol.asyncIterator]() { yield Buffer.from(JSON.stringify(body)) } }, res)
  return res
}
const opts = owner => ({ stateDir: owner.stateDir, controllerDir: owner.controllerDir, expectedNpub: owner.npub, expectedSubject: owner.subject })
const bindOf = owner => JSON.parse(fs.readFileSync(owner.bindingFile, 'utf8'))
const spec = (owner, peer) => ({ npub: peer.npub, peerControllerKey: peer.hex, binding: bindOf(peer), ownerStateDir: owner.stateDir, ownerControllerDir: owner.controllerDir })
function confirmationRoute(owner, text = host === null ? source('plugins/aukora-face/messages/src/confirm-contact-route.ts') : region(host, 'lib/types/confirm-contact-route.js')) {
  const code = plain(text).replace(/^import[^]*?from ['"][^'"]+['"];?\s*$/gmu, '')
  const parts = { ...writer, ...contacts, ...receipts, resolveSignerSocketPath: () => ({ socketPath: path.join(owner.stateDir, 'synthetic.sock') }), askSignerOperation: syntheticAsk }
  return new Script(`${code}\nloadContactParts = async () => ({kind: 'loaded', parts: fixtureParts}); confirmContactRoute`)
    .runInNewContext({ ...fs, ...path, wire, ...wire, parseStoredContact: store.parseStoredContact,
      randomBytes, Buffer, process: { env: {} }, fixtureParts: parts })(() => true, () => ({ stateDir: owner.stateDir, controllerDir: owner.controllerDir }))
}
try {
  const alice = party('alice', 1, 'a'), bob = party('bob', 2, 'b'), runtime = bootstrap()
  const baseline = bootstrap(prior('plugins/aukora-nostr/lib/bootstrap.mjs'))
  mode = 'declined'
  await assert.rejects(baseline.ensureMessagesIdentity(opts(alice)), error => error.code === 'signer:declined')
  assert.equal(calls, 1)
  console.log('REPRODUCED baseline background ensure reaches synthetic signer for a legacy binding')
  calls = 0; mode = 'approved'
  assert.equal((await runtime.readMessagesIdentity(opts(alice))).binding, null)
  await runtime.ensureMessagesIdentity(opts(alice)); assert.equal(calls, 0)
  console.log('PASS read/background ensure stays read-only; legacy binding requires an explicit action')
  const route = migrationRoute(alice, runtime), body = { npub: alice.npub, subject: alice.subject }
  await runRoute(migrationRoute(alice, runtime, false), body); assert.equal(calls, 0)
  assert.equal((await runRoute(route, { ...body, stateDir: '/never-used' })).statusCode, 400)
  assert.equal((await runRoute(route, { ...body, npub: bob.npub })).body.reason, 'messages:identity-changed')
  for (const corrupt of ['not JSON', JSON.stringify({ ...alice.legacy, approvalKeyDid: `did:key:${bob.hex}` }),
    JSON.stringify({ ...alice.legacy, statement: { ...alice.legacy.statement, safetyVersion: 3 } })]) {
    fs.writeFileSync(alice.bindingFile, corrupt)
    const before = calls, refusal = await runRoute(route, body)
    assert.ok(refusal.statusCode >= 400); assert.equal(calls, before)
    assert.equal(fs.readFileSync(alice.bindingFile, 'utf8'), corrupt)
  }
  fs.writeFileSync(alice.bindingFile, alice.bindingBytes)
  for (const refusal of ['declined', 'expired', 'challenge', 'other-machine', 'key-change']) {
    mode = refusal
    const result = await runRoute(route, body)
    assert.ok(result.statusCode >= 400, `${refusal} accepted`)
    assert.deepEqual(fs.readFileSync(alice.bindingFile), alice.bindingBytes)
    fs.writeFileSync(alice.keyFile, alice.keyBytes)
  }
  mode = 'approved'
  const upgraded = await runRoute(route, body)
  assert.equal(upgraded.statusCode, 200); assert.equal(upgraded.body.binding.statement.safetyVersion, 2)
  assert.equal(upgraded.body.peerControllerKey, alice.hex); assert.deepEqual(fs.readFileSync(alice.keyFile), alice.keyBytes)
  const count = calls; await runRoute(route, body); assert.equal(calls, count, 'current binding requested another signature')
  assert.equal(contacts.resolveContact(spec(alice, bob)).sas, null)
  const bobResult = await runRoute(migrationRoute(bob, runtime), { npub: bob.npub, subject: bob.subject })
  assert.equal(bobResult.statusCode, 200); assert.deepEqual(fs.readFileSync(bob.keyFile), bob.keyBytes)
  console.log('PASS explicit migration: denied gate, hostile body, stale pins, decline, expiry, challenge, alternate active signer and key change refuse; valid pair preserves both keys and signer anchors')
  const missing = path.join(scratch, 'missing'); fs.mkdirSync(missing)
  await assert.rejects(runtime.reissueMessagesIdentity({ ...opts(alice), stateDir: missing }), error => error.code === identity.NOSTR_REFUSE.KEY_UNREADABLE)
  assert.equal(fs.existsSync(path.join(missing, 'nostr/identity.json')), false)
  console.log('PASS migration does not create a missing Nostr key')

  // Existing confirmation selects a single owner machine. Migration above separately exercised
  // a multi-machine public record and rejected a signature from its other active key.
  for (const owner of [alice, bob]) {
    owner.controller.publicRoot.machines = [{ ed25519: owner.hex }]
    fs.writeFileSync(owner.controllerFile, JSON.stringify(owner.controller))
  }

  const views = []
  for (const [owner, peer] of [[alice, bob], [bob, alice]]) {
    const full = contacts.resolveContact(spec(owner, peer)).sas
    assert.ok(full); views.push(full.comparisonGroupIndex)
    const own = store.contactSas(full), peerHalf = full.digits.slice(full.comparisonGroupIndex === 0 ? 35 : 0, full.comparisonGroupIndex === 0 ? 70 : 35)
    assert.equal(own.digits, full.digits.slice(full.comparisonGroupIndex * 5, full.comparisonGroupIndex * 5 + 35))
    assert.equal(own.digits.length, 35); assert.ok(!JSON.stringify(own).includes(peerHalf))
    assert.equal(wire.parseSafetyNumber(full), undefined, 'old full wire payload accepted')
    if (owner === alice) {
      const oldParser = new Script(`(${fn(prior('plugins/aukora-face/messages/src/messages-route.ts'), 'parseSafetyNumber')})`).runInNewContext({
        isRecord: value => value !== null && typeof value === 'object' && !Array.isArray(value),
        hasExactKeys: (value, keys) => Object.keys(value).sort().join(',') === keys.sort().join(','), contactFieldsAreSafe: wire.contactFieldsAreSafe,
      })
      const oldProjector = new Script(`(${fn(prior('plugins/aukora-face/messages/src/contacts-store.ts'), 'contactSas')})`).runInNewContext({ parseSafetyNumber: oldParser })
      assert.throws(() => assert.equal(oldProjector(full).digits.length, 35), assert.AssertionError)
      console.log('EXPECTED FAILURE: published full70 projection fails own35-only assertion; current projection removes peer convenience payload')
    }
    if (host !== null) {
      const projected = new Script(`(${fn(host, 'contactSas')})`).runInNewContext({
        isRecord$2: value => value !== null && typeof value === 'object' && !Array.isArray(value), parseSafetyNumber: wire.parseSafetyNumber,
      })(full)
      assert.equal(projected.digits, own.digits); assert.ok(!JSON.stringify(projected).includes(peerHalf))
    }
    writer.addContact({ stateDir: owner.stateDir, npub: peer.npub, controller: peer.hex, name: peer.subject, binding: bindOf(peer) })
    const endpoint = confirmationRoute(owner)
    const groups = value => full.comparisonGroupIndex === 0 ? [own.digits, value] : [value, own.digits]
    const comparison = value => ({ npub: peer.npub, safetyVersion: 2, sasDigits: groups(value).join(''), comparisonGroups: groups(value) })
    const priorCalls = calls
    assert.equal((await runRoute(endpoint, comparison(own.digits))).body.reason, 'messages:confirm-comparison-required')
    for (let n = 0; n < 35; n++) {
      const wrong = peerHalf.slice(0, n) + (peerHalf[n] === '9' ? '0' : '9') + peerHalf.slice(n + 1)
      assert.equal((await runRoute(endpoint, comparison(wrong))).body.reason, 'messages:confirm-comparison-required')
    }
    assert.equal(calls, priorCalls, 'wrong peer half reached signer')
    for (const refusal of ['challenge', 'old-domain', 'declined']) {
      mode = refusal; assert.ok((await runRoute(endpoint, comparison(peerHalf))).statusCode >= 400)
    }
    mode = 'approved'
    assert.equal((await runRoute(endpoint, comparison(peerHalf))).body.state, 'VERIFIED')
    const saved = writer.readExistingContacts(writer.contactsPath(owner.stateDir))[0]
    assert.equal(saved.confirmation.domain, 'aukora:nostr-sas-confirmation:v2')
    assert.equal(saved.confirmation.statement.sasDigits, full.digits)
    assert.equal(contacts.resolveContact({ ...spec(owner, peer), confirmation: saved.confirmation }).state, 'VERIFIED')
    const oldBytes = receipts.confirmationPreimage(saved.confirmation.statement).replace(receipts.SAS_CONFIRMATION_DOMAIN, 'aukora:nostr-sas-confirmation:v1')
    const old = { ...saved.confirmation, domain: 'aukora:nostr-sas-confirmation:v1', signature: sign(null, Buffer.from(oldBytes), owner.pair.privateKey).toString('hex') }
    assert.equal(contacts.resolveContact({ ...spec(owner, peer), confirmation: old }).state, 'BOUND')
  }
  assert.deepEqual(views.sort(), [0, 7])
  console.log('PASS both half orders: wire exposes own35 only; copied own half and every wrong peer digit refuse before signer; exact full pair signs/verifies v2; old-domain receipt stays BOUND')
  assert.ok(index.includes('register(reissueIdentityRoute(gate, rootsOf))'))
  assert.ok(!index.includes('bootstrap.ensureMessagesIdentity'))
  const ui = source('plugins/aukora-face/messages/src/client/MessagesSurface.tsx')
  assert.ok(ui.includes('data-reissue-identity') && ui.includes('await reissueIdentity(publicNpub, identitySubject)'))
  assert.equal((ui.match(/data-verify-comparison-half=/gu) ?? []).length, 1)
  assert.ok(!ui.includes("comparisonGroups.join('') === sas.digits"))
  console.log('PASS source mounting: explicit POST registered, migration control wired, one peer input; no automatic ensure/signing from Messages')
  if (compiled) {
    // Same tiny element/hooks seam as the existing Worker3 check. Effects are disabled; all fetch
    // is dispatched to the fixture routes above. No browser, camera, DOM or real transport exists.
    let hooks = [], cursor = 0, browser, endpoint, fetched = [], success = 0
    const react = {
      useState(initial) { const at = cursor++; if (!(at in hooks)) hooks[at] = typeof initial === 'function' ? initial() : initial
        return [hooks[at], next => { hooks[at] = typeof next === 'function' ? next(hooks[at]) : next }] },
      useRef(initial) { const at = cursor++; return hooks[at] ??= { current: initial } }, useCallback: callback => callback, useEffect() {},
    }
    const jsx = (type, props) => ({ type, props })
    const bytes = source('plugins/aukora-face/messages/lib/client.js')
    const exposed = bytes.replace('return module.exports;', 'return { VerifySheet, SasSeat, MessagesSurface, readIdentity, reissueIdentity, en, zh };')
    assert.notEqual(exposed, bytes)
    const flush = async () => { for (let n = 0; n < 20; n++) await new Promise(resolve => setImmediate(resolve)) }
    new Script(exposed).runInNewContext({ Object, JSON, URL, Uint8Array, TextEncoder, AbortSignal,
      window: { __ModuleLoader__: { load({ factory }) { browser = factory(name => {
        if (name === 'react') return react
        if (name === 'react/jsx-runtime') return { jsx, jsxs: jsx }
        if (name === '@aukora/face-layout/client') return { ActionButton: 'ActionButton', Card: 'Card', Panel: 'Panel', SectionHeader: 'SectionHeader' }
        throw new Error(`unexpected browser module ${name}`)
      }) } } },
      fetch: async (url, init) => {
        fetched.push({ url, init })
        const result = url === '/aukora-messages/identity'
          ? { statusCode: 200, body: { status: 'ok', ...await runtime.readMessagesIdentity(opts(alice)) } }
          : url === wire.MESSAGES_CONTACTS_ENDPOINT ? { statusCode: 503, body: wire.messagesRefusalBody('messages:no-controller-record', null) }
          : await runRoute(endpoint, JSON.parse(init.body))
        return { status: result.statusCode, headers: { get: () => 'application/json' }, json: async () => result.body }
      },
    })
    const nodes = value => Array.isArray(value) ? value.flatMap(nodes)
      : value && typeof value === 'object' ? [value, ...nodes(value.props?.children)] : []
    const find = (tree, key) => nodes(tree).find(node => Object.hasOwn(node.props ?? {}, key))
    const render = (component, props) => { cursor = 0; return component(props) }
    for (const [owner, peer] of [[alice, bob], [bob, alice]]) {
      writer.setContactConfirmation({ stateDir: owner.stateDir, npub: peer.npub, confirmation: null })
      const full = contacts.resolveContact(spec(owner, peer)).sas, own = store.contactSas(full)
      const peerHalf = full.digits.slice(full.comparisonGroupIndex === 0 ? 35 : 0, full.comparisonGroupIndex === 0 ? 70 : 35)
      endpoint = confirmationRoute(owner); hooks = []
      const props = { state: 'BOUND', sas: own, contact: 'Synthetic peer', npub: peer.npub,
        t: key => browser.en[key] ?? key, onClose() {}, onConfirmed() { success++ } }
      let tree = render(browser.VerifySheet, props)
      assert.equal(nodes(tree).filter(node => Object.hasOwn(node.props ?? {}, 'data-verify-comparison-half')).length, 1)
      assert.equal(find(tree, 'data-verify-confirm').props.disabled, true)
      const displayed = render(browser.SasSeat, { state: 'BOUND', sas: own, t: props.t })
      const displayText = nodes(displayed).map(node => node.props?.children).filter(value => typeof value === 'string').join(' ')
      assert.ok(displayText.includes(own.spoken)); assert.ok(!displayText.includes(peerHalf.match(/.{5}/gu).join(' ')))
      find(tree, 'data-verify-comparison-half').props.onChange({ target: { value: own.digits } })
      const before = calls
      find(render(browser.VerifySheet, props), 'data-verify-confirm').props.onClick(); await flush()
      assert.equal(calls, before); assert.equal(find(render(browser.VerifySheet, props), 'data-verify-confirm-note').props.children, 'messages:confirm-comparison-required')
      find(render(browser.VerifySheet, props), 'data-verify-comparison-half').props.onChange({ target: { value: peerHalf.match(/.{5}/gu).join(' ') } })
      find(render(browser.VerifySheet, props), 'data-verify-confirm').props.onClick(); await flush()
      assert.equal(JSON.parse(fetched.at(-1).init.body).sasDigits, full.digits)
      assert.equal(contacts.resolveContact({ ...spec(owner, peer), confirmation: writer.readExistingContacts(writer.contactsPath(owner.stateDir))[0].confirmation }).state, 'VERIFIED')
    }
    assert.equal(success, 2)
    // Reach the actual header action after a public read, without running any effect automatically.
    fs.writeFileSync(alice.bindingFile, alice.bindingBytes)
    endpoint = migrationRoute(alice, runtime); hooks = []; fetched = []
    const publicRead = await browser.readIdentity(); assert.equal(publicRead.value.bindingReady, false)
    const stateFields = [...ui.slice(ui.indexOf('export function MessagesSurface')).matchAll(/const \[([\w]+),[^\n]*= useState/gu)].map(match => match[1])
    let stateCursor = 0
    const useState = react.useState
    react.useState = initial => useState(({ publicNpub: publicRead.value.npub, identitySubject: publicRead.value.subject })[stateFields[stateCursor++]] ?? initial)
    const props = { activeSurface: 'messages', closeSurface() {}, t: key => browser.en[key] ?? key }
    const before = calls, surface = render(browser.MessagesSurface, props)
    assert.equal(calls, before); assert.equal(fetched.length, 1, 'render performed unexpected fetch/signing')
    const action = find(surface, 'data-reissue-identity'); assert.ok(action); assert.equal(action.props.disabled, false)
    action.props.onClick(); await flush()
    assert.equal(calls, before + 1); assert.equal(bindOf(alice).statement.safetyVersion, 2)
    assert.deepEqual(fs.readFileSync(alice.keyFile), alice.keyBytes)
    assert.equal(JSON.parse(fetched.find(item => item.url === wire.MESSAGES_REISSUE_IDENTITY_ENDPOINT).init.body).npub, alice.npub)
    assert.ok(browser.en['state.VERIFIED.title'].includes('human presence is unproven'))
    console.log('PASS compiled host/client end-to-end: own35 display, one peer input, copied-own refusal, entered synthetic peer35 -> full70 signed v2 in both orders; reachable explicit migration asks only on gesture and preserves keys')
  }
  console.log('NOT VERIFIED: installed app, real signer/approval, custody or human attendance. Values are public-derived; a malicious client can compute them. Only synthetic keys/stores and replaced transport were used.')
} finally { fs.rmSync(scratch, { recursive: true, force: true }) }
