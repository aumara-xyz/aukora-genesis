// One focused bridge check: actual source, synthetic Electron frames, no Electron/app/signer import.
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { EventEmitter } from 'node:events'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { Script } from 'node:vm'
import { APPROVAL_CHANNELS, APPROVAL_REFUSE } from '../apps/aukora-desktop/aumlok-bridge-state.mjs'
import { DRAW_REFUSE } from '../apps/aukora-desktop/aumlok-draw.mjs'
import { backendStatus } from '../apps/aukora-desktop/backend-status.mjs'

const root = fileURLToPath(new URL('..', import.meta.url))
const bridgePath = 'apps/aukora-desktop/aumlok-bridge.mjs'
const source = readFileSync(join(root, bridgePath), 'utf8')
const main = readFileSync(join(root, 'apps/aukora-desktop/main.mjs'), 'utf8')
const original = execFileSync('/usr/bin/git', ['-C', root, 'show', `499dcd8218304ad4df897c8e828342fd467b2805:${bridgePath}`], { encoding: 'utf8' })
const pinExpression = main.match(/applicationOrigin: ([^,\n]+),/u)?.[1]
assert.ok(pinExpression, 'caller did not supply an origin contract')
const ownedOrigin = 'http://127.0.0.1:3187'
const originFor = mode => new Script(pinExpression).runInNewContext({ status: backendStatus({ mode, url: `${ownedOrigin}/?token=synthetic` }) })
assert.equal(originFor('own'), ownedOrigin); assert.equal(originFor('attach'), null)

const frame = (url, processId = 7, routingId = 11) => ({ url, origin: url.startsWith('file:') ? 'file://' : new URL(url).origin,
  processId, routingId, parent: null, detached: false, isDestroyed: () => false })
const event = contents => ({ type: 'frame', sender: contents, senderFrame: contents.mainFrame,
  processId: contents.mainFrame.processId, frameId: contents.mainFrame.routingId })
function fixture(text = source, applicationOrigin = ownedOrigin, here = '/disposable/packaged shell/app.asar') {
  const handlers = new Map(), calls = [], views = []
  let interrupt = async () => {}, drawPending = false
  class Contents extends EventEmitter {
    constructor(page) { super(); this.mainFrame = page; this.destroyed = false }
    isDestroyed() { return this.destroyed }
    setWindowOpenHandler() {}
    loadFile(file, { query }) { this.mainFrame.url = `${pathToFileURL(file).href}?${new URLSearchParams(query)}`; return Promise.resolve() }
    close() { this.destroyed = true; this.emit('destroyed') }
    focus() {}
  }
  const contents = new Contents(frame(`${ownedOrigin}/messages?fixture=1#conversation`))
  const window = { webContents: contents }
  class View {
    constructor() { this.webContents = new Contents(frame(pathToFileURL(join(here, 'aumlok-approval.html')).href, 9, 13)); views.push(this) }
    setBackgroundColor() {}
  }
  const code = text.replace(/^import[^]*?from ['"][^'"]+['"];?\s*$/gmu, '')
    .replace(/^export \{[^]*?\} from ['"][^'"]+['"];?\s*$/gmu, '').replace(/\bexport (?=(?:const|function))/gu, '')
  const install = new Script(`${code}\ninstallApprovalBridge`).runInNewContext({
    URL, URLSearchParams, Number, join, pathToFileURL,
    APPROVAL_CHANNELS, APPROVAL_REFUSE, DRAW_REFUSE,
    loadOrganLibrary: async () => { calls.push('context'); await interrupt('context'); return {} },
    resolveAumlokDirectory: () => ({ directory: '/disposable/controller' }),
    signingReasonName: value => value, surfaceColour: () => '#000000',
    admitApprovalQuestion: request => ({ ok: true, challenge: request.challenge, expiresAt: request.expiresAt, witness: null }),
    approvalCardFields: () => [],
    lstatSync: () => { throw Object.assign(new Error('fixture absent'), { code: 'ENOENT' }) },
    submitProposal: () => { throw new Error('real proposal path forbidden in this check') },
    setTimeout: () => { throw new Error('no queued/timed approval effects allowed') },
    clearInterval() {},
  })
  const bridge = install({ applicationOrigin, here, getWindow: () => window, getReleaseDir: () => '/disposable/release', getPatchPaths: () => [],
    ipcMain: { handle: (channel, handler) => handlers.set(channel, handler), removeHandler() {}, removeAllListeners() {} },
    WebContentsView: View, headless: true,
    session: { fromPartition: () => ({ setPermissionRequestHandler() {} }) },
    ownerDaemonStatus: async () => { calls.push('daemon'); await interrupt('daemon'); return { installed: false } },
    readBindingState: () => { calls.push('state'); return { bound: false, handle: 'synthetic' } },
    draw: {
      async draw() { calls.push('draw'); await interrupt('draw'); drawPending = true; return { ok: true, marker: 'synthetic-draw' } },
      async submit() { calls.push('submit'); await interrupt('submit'); return { ok: false, reason: 'synthetic:no-ceremony' } },
      isPending: () => drawPending, forget() { calls.push('forget'); drawPending = false },
    },
  })
  return { bridge, handlers, contents, calls, views, interrupt: fn => { interrupt = fn }, here }
}
const appChannels = ['STATE', 'DRAW', 'SUBMIT']
const payload = { intent: 'bind', words: [], handle: 'synthetic' }
const appRefusal = name => name === 'STATE' ? APPROVAL_REFUSE.FORBIDDEN_SENDER : DRAW_REFUSE.FORBIDDEN_SENDER
async function refusesApp(f, supplied = event(f.contents)) {
  const before = f.calls.length
  for (const name of appChannels) assert.equal((await f.handlers.get(APPROVAL_CHANNELS[name])(supplied, payload)).reason, appRefusal(name), name)
  assert.equal(f.calls.length, before, 'untrusted IPC reached a context/draw/ceremony/daemon operation')
}
const variants = [
  ['foreign sender', f => { const e = event(f.contents); e.sender = {}; return e }],
  ['navigated hostile origin', f => { f.contents.mainFrame.url = 'https://hostile.invalid/'; f.contents.mainFrame.origin = 'https://hostile.invalid'; return event(f.contents) }],
  ['other loopback port', f => { f.contents.mainFrame.url = 'http://127.0.0.1:6666/'; f.contents.mainFrame.origin = 'http://127.0.0.1:6666'; return event(f.contents) }],
  ['opaque origin despite trusted URL', f => { f.contents.mainFrame.origin = 'null'; return event(f.contents) }],
  ['inherited about:blank', f => { f.contents.mainFrame.url = 'about:blank'; return event(f.contents) }],
  ['inherited blob document', f => { f.contents.mainFrame.url = `blob:${ownedOrigin}/synthetic`; return event(f.contents) }],
  ['credentialed URL', f => { f.contents.mainFrame.url = 'http://user@127.0.0.1:3187/'; return event(f.contents) }],
  ['subframe on the trusted origin', f => { const e = event(f.contents); e.senderFrame = { ...f.contents.mainFrame, routingId: 99, parent: f.contents.mainFrame }; e.frameId = 99; return e }],
  ['stale main-frame IDs', f => { const e = event(f.contents); e.frameId++; return e }],
  ['old process', f => { const e = event(f.contents); e.processId++; return e }],
  ['missing senderFrame', f => ({ ...event(f.contents), senderFrame: null })],
  ['destroyed sender', f => { const e = event(f.contents); f.contents.destroyed = true; return e }],
  ['detached frame', f => { f.contents.mainFrame.detached = true; return event(f.contents) }],
  ['destroyed frame', f => { f.contents.mainFrame.isDestroyed = () => true; return event(f.contents) }],
  ['throwing frame accessor', f => { const e = event(f.contents); Object.defineProperty(e, 'senderFrame', { get() { throw new Error('disposed') } }); return e }],
]
for (const [label, alter] of variants) {
  const f = fixture(); await refusesApp(f, alter(f)); f.bridge.dispose()
  console.log(`REFUSED STATE/DRAW/SUBMIT before effects: ${label}`)
}
for (const pin of [null, undefined, '', 'http://127.0.0.1:3187/', 'https://hostile.invalid', 'http://127.0.0.1@hostile.invalid']) {
  const f = fixture(source, pin === undefined ? '' : pin); await refusesApp(f); f.bridge.dispose()
}
console.log('PASS caller pin: owned canonical origin accepted; attach/missing/malformed context denied without a loopback fallback')
const legitimate = fixture()
assert.equal((await legitimate.handlers.get(APPROVAL_CHANNELS.STATE)(event(legitimate.contents))).ok, true)
assert.equal((await legitimate.handlers.get(APPROVAL_CHANNELS.DRAW)(event(legitimate.contents), payload)).marker, 'synthetic-draw')
assert.equal((await legitimate.handlers.get(APPROVAL_CHANNELS.SUBMIT)(event(legitimate.contents), payload)).reason, 'synthetic:no-ceremony')
legitimate.bridge.dispose()
console.log('PASS owned main-frame application paths/query/fragment retain STATE/DRAW/SUBMIT dispatch to fixture operations')

for (const stage of ['context', 'daemon', 'draw', 'submit']) {
  const f = fixture(), channel = stage === 'context' ? 'STATE' : stage === 'draw' ? 'DRAW' : 'SUBMIT'
  f.interrupt(async at => { if (at === stage) { f.contents.mainFrame.url = 'https://hostile.invalid/'; f.contents.mainFrame.origin = 'https://hostile.invalid' } })
  assert.equal((await f.handlers.get(APPROVAL_CHANNELS[channel])(event(f.contents), payload)).reason, appRefusal(channel))
  if (stage === 'daemon') assert.ok(!f.calls.includes('submit'))
  if (stage === 'draw') assert.equal(f.bridge.isDrawPending(), false)
  f.bridge.dispose()
}
console.log('PASS navigation during asynchronous context/daemon/draw/submit boundaries refuses; pending draw is discarded')

for (const here of ['/disposable/unpacked shell', '/disposable/AUKORA.app/Contents/Resources/app.asar', '/disposable/Unicode 空格/app.asar']) {
  const f = fixture(source, ownedOrigin, here)
  const pending = f.bridge.ask({ challenge: 'synthetic-question', subject: 'synthetic', expiresAt: '2099-01-01T00:00:00Z' })
  const contents = f.views[0].webContents, correct = contents.mainFrame.url
  for (const [label, mutate] of [
    ['another file with file:// origin', () => { contents.mainFrame.url = pathToFileURL(join(here, 'another.html')).href }],
    ['remote URL', () => { contents.mainFrame.url = 'https://hostile.invalid/'; contents.mainFrame.origin = 'https://hostile.invalid' }],
    ['opaque/inherited document', () => { contents.mainFrame.url = 'about:blank'; contents.mainFrame.origin = 'file://' }],
    ['opaque origin on exact file path', () => { contents.mainFrame.origin = 'null' }],
    ['subframe', () => {}],
  ]) {
    contents.mainFrame.url = correct; contents.mainFrame.origin = 'file://'; mutate()
    const e = event(contents)
    if (label === 'subframe') { e.senderFrame = { ...contents.mainFrame, routingId: 97, parent: contents.mainFrame }; e.frameId = 97 }
    const before = f.calls.length
    for (const channel of ['ASK', 'ANSWER']) assert.equal((await f.handlers.get(APPROVAL_CHANNELS[channel])(e, { challenge: 'synthetic-question', approve: false })).reason, APPROVAL_REFUSE.FORBIDDEN_SENDER)
    assert.equal(f.calls.length, before)
  }
  contents.mainFrame.url = correct + '#fixture'; contents.mainFrame.origin = 'file://'
  assert.equal((await f.handlers.get(APPROVAL_CHANNELS.ASK)(event(contents))).ok, true)
  assert.equal((await f.handlers.get(APPROVAL_CHANNELS.ANSWER)(event(contents), { challenge: 'synthetic-question', approve: false })).ok, true)
  assert.equal((await pending).approve, false); f.bridge.dispose()
}
console.log('PASS ASK/ANSWER exact packaged file in unpacked/ASAR/spaces/Unicode layouts; wrong file/origin/document/subframe refuse without settling')

const delayed = fixture()
const awaiting = delayed.bridge.ask({ challenge: 'delayed-question', subject: 'synthetic', expiresAt: '2099-01-01T00:00:00Z' })
const sheet = delayed.views[0].webContents, sheetUrl = sheet.mainFrame.url
delayed.interrupt(async stage => { if (stage === 'daemon') { sheet.mainFrame.url = 'https://hostile.invalid/'; sheet.mainFrame.origin = 'https://hostile.invalid' } })
assert.equal((await delayed.handlers.get(APPROVAL_CHANNELS.ANSWER)(event(sheet), { challenge: 'delayed-question', approve: false })).reason, APPROVAL_REFUSE.FORBIDDEN_SENDER)
sheet.mainFrame.url = sheetUrl; sheet.mainFrame.origin = 'file://'; delayed.interrupt(async () => {})
assert.equal((await delayed.handlers.get(APPROVAL_CHANNELS.ASK)(event(sheet))).ok, true, 'navigated answer settled the pending fixture question')
await delayed.handlers.get(APPROVAL_CHANNELS.ANSWER)(event(sheet), { challenge: 'delayed-question', approve: false })
assert.equal((await awaiting).approve, false); delayed.bridge.dispose()
console.log('PASS ANSWER revalidates after daemon await; navigated frame cannot settle the pending fixture question')

// The production gates, removed one at a time, make the refusal assertions fail.
const gate = (text, name) => text.match(new RegExp(`  function ${name}\\([^]*?\\n  \\}`, 'u'))?.[0]
for (const name of ['fromApplication', 'fromApproval']) {
  const mutant = source.replace(gate(source, name), gate(original, name))
  assert.notEqual(mutant, source)
  const f = fixture(mutant)
  if (name === 'fromApplication') {
    const bad = variants.find(([label]) => label === 'navigated hostile origin')[1](f)
    await assert.rejects(refusesApp(f, bad), assert.AssertionError)
  } else {
    const pending = f.bridge.ask({ challenge: 'mutant-question', subject: 'synthetic', expiresAt: '2099-01-01T00:00:00Z' })
    const contents = f.views[0].webContents
    contents.mainFrame.url = pathToFileURL(join(f.here, 'another.html')).href
    const result = await f.handlers.get(APPROVAL_CHANNELS.ASK)(event(contents))
    assert.throws(() => assert.equal(result.ok, false), assert.AssertionError)
    await f.handlers.get(APPROVAL_CHANNELS.ANSWER)(event(contents), { challenge: 'mutant-question', approve: false }); await pending
  }
  f.bridge.dispose(); console.log(`EXPECTED FAILURE with published identity-only ${name}: origin refusal assertion fails`)
}
console.log('NOT VERIFIED: installed Electron/app, real signer/daemon/ceremony/approval. All effects are fixture stubs; no live state, keys, sockets or OS settings were accessed. Already-started ceremony effects are not rolled back on navigation.')
