#!/usr/bin/env node
/**
 * KIRA AND OPENVIKING, THE CHAINED STORE AS THE TRUTH, on the plugin mounted as tests/kira-memory-live-path.test.mjs mounts it.
 * A stand-in OpenViking by default: a word table, so it proves the bridge, not meaning. Scratch state only; not the installed app.
 *   --live <openviking home>  the running server through a forwarder pinned to user hook-test; the root key is read at run
 *                             time and never printed, and everything written there is deleted at the end
 *   --red                     each protection reverted in memory: its arm must go red
 */
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { createServer } from 'node:http'
import { registerHooks } from 'node:module'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { Readable } from 'node:stream'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { zstdCompressSync } from 'node:zlib'

const argv = process.argv.slice(2)
const live = argv.includes('--live') ? argv[argv.indexOf('--live') + 1] : undefined
const HERE = fileURLToPath(import.meta.url)
const ROOT = resolve(dirname(HERE), '..')
const ARMS = Object.freeze({
  down: 'down: with OpenViking down the turn is remembered and lexical recall finds it, said once',
  backfill: 'backfill: once OpenViking answers, the next capture indexes every note, including one captured while it was down',
  found: 'found: the note is tagged with its Kira id, and a question by meaning returns it from the chained store with its bodyAtCapture',
  ledger: 'ledger: a hit the chained store does not hold is never shown, and is removed',
  forget: 'forget: forget removes the note from OpenViking at once',
  race: 'race: a note forgotten while a reconcile waits or writes it is not shown and not put back',
  privacy: 'privacy: a model endpoint off this machine is refused',
})
const MUTANTS = Object.freeze({
  'ledger-filter-off': ['recall-openviking.mjs', '      const note = id === null ? undefined : live.entries.get(id)\n', "      const note = id === null ? undefined : (live.entries.get(id) ?? { id, statement: 'unmapped' })\n", ARMS.ledger],
  'forget-not-passed': ['index.js', '      const reached = await bridge.forget(String(answer.id))\n', "      const reached = { reached: false, because: 'reverted' }\n", ARMS.forget],
  'capture-not-indexed': ['index.js', "from ${info.sessionId} turn ${String(info.turn)}`); semanticIndex() }", "from ${info.sessionId} turn ${String(info.turn)}`) }", ARMS.backfill],
  'ledger-read-early': ['index.js', 'found = await bridge.recall({ question: text, live: semanticLedger })', 'found = await bridge.recall({ question: text, live: semanticLedger() })', ARMS.race],
  'forget-out-of-turn': ['recall-openviking.mjs', '  const forget = id => inTurn(() => forgetNow(id))\n', '  const forget = forgetNow\n', ARMS.race],
  'remote-models-allowed': ['recall-openviking.mjs', '    if (off.length > 0 && raw.allowRemoteModels !== true) {\n', '    if (false) {\n', ARMS.privacy],
})
if (argv.includes('--red')) {
  const run = extra => { const child = spawnSync(process.execPath, [HERE, ...extra, ...argv.filter(one => one !== '--red')], { encoding: 'utf8', timeout: 600_000 }); return { status: child.status, out: `${child.stdout}${child.stderr}` } }
  const plain = run([])
  let caught = 0
  process.stdout.write(`plain: exit ${String(plain.status)}\n${plain.out}\n`)
  for (const [name, [file, , , armName]] of Object.entries(MUTANTS)) {
    const child = run(['--mutant', name])
    const red = child.status !== 0 && child.out.includes(`FAIL  ${armName}`)
    caught += red ? 1 : 0
    process.stdout.write(`revert ${name} (${file}): exit ${String(child.status)} — ${red ? 'CAUGHT' : 'NOT CAUGHT'}\n${child.out}\n`)
  }
  const ok = plain.status === 0 && caught === Object.keys(MUTANTS).length
  process.stdout.write(`KIRA OPENVIKING RED ARM: ${String(caught)}/${String(Object.keys(MUTANTS).length)} reverts caught — ${ok ? 'OK' : 'NOT OK'}\n`)
  process.exit(ok ? 0 : 1)
}
let mutation = null
if (argv.includes('--mutant')) {
  const [file, from, to] = MUTANTS[argv[argv.indexOf('--mutant') + 1]]
  mutation = { name: argv[argv.indexOf('--mutant') + 1], applied: 0 }
  const target = pathToFileURL(join(ROOT, 'plugins/aukora-kira/lib', file)).href
  registerHooks({ load(url, context, nextLoad) {
    const result = nextLoad(url, context)
    if (url !== target) return result
    const source = Buffer.from(result.source).toString('utf8')
    if (source.split(from).length !== 2) throw new Error(`mutant ${mutation.name}: the guarded text does not occur exactly once in ${file}`)
    mutation.applied += 1
    return { ...result, source: source.replace(from, to) }
  } })
}

let failures = 0
let passed = 0
const arm = async (name, body) => {
  try { await body(); passed += 1; process.stdout.write(`  ok    ${name}\n`) } catch (error) {
    failures += 1
    process.stdout.write(`  FAIL  ${name}\n        ${String(error?.message ?? error).split('\n')[0].slice(0, 400)}\n`)
  }
}
const show = (label, value) => process.stdout.write(`        ${label}: ${JSON.stringify(value)}\n`)
const until = async (fn, ms) => { for (const end = Date.now() + ms; ;) { const value = await fn(); if (value || Date.now() > end) return value; await new Promise(done => setTimeout(done, 200)) } }
const listen = server => new Promise(done => server.listen(0, '127.0.0.1', () => done(server.address().port)))
const bodyOf = async req => { const chunks = []; for await (const chunk of req) chunks.push(chunk); return Buffer.concat(chunks) }
const reply = (res, status, body) => { res.statusCode = status; res.setHeader('content-type', 'application/json'); res.end(typeof body === 'string' ? body : JSON.stringify(body)) }
const load = path => import(pathToFileURL(join(ROOT, 'plugins/aukora-kira/lib', path)).href)
const { apply } = await load('index.js')
const { KIRA_ROUTES } = await load('memory-routes.mjs')
if (mutation !== null) { assert.equal(mutation.applied, 1, `mutant ${mutation.name} did not load its subject`); process.stdout.write(`MUTANT ${mutation.name}: reverted in memory only\n`) }

// ── THE SERVER THE BRIDGE TALKS TO: a stand-in, or a forwarder to the live one pinned to user hook-test ─────────────────
const USER = 'hook-test'
const KEY = randomBytes(32).toString('hex')
const serve = live === undefined ? standIn() : forwarder(live)
const wait = live === undefined ? 1 : 12
// THE LIVE BRIDGE'S TUNING (thresholds, query instruction), never its key: the scratch home holds a scratch key.
const tuned = live === undefined ? {} : JSON.parse(readFileSync(join(live, 'aukora-bridge.json'), 'utf8'))
show('OpenViking', live === undefined ? 'stand-in' : `live, through a forwarder pinned to user ${USER}`)
function forwarder(home) {
  const target = JSON.parse(readFileSync(join(home, 'aukora-bridge.json'), 'utf8')).url
  return async (req, res) => {
    const body = await bodyOf(req)
    if (req.url !== '/health' && (req.headers['x-api-key'] !== KEY || req.headers['x-openviking-user'] !== USER)) return reply(res, 403, { status: 'error', error: { message: 'forwarder: user hook-test only' } })
    const answer = await fetch(`${target}${req.url}`, { method: req.method, ...(body.length > 0 ? { body } : {}),
      headers: { 'content-type': 'application/json', 'x-api-key': readFileSync(join(home, 'root.key'), 'utf8').trim(), 'x-openviking-account': 'aukora', 'x-openviking-user': USER } })
    reply(res, answer.status, await answer.text())
  }
}
function standIn() {
  const files = new Map()
  const concept = text => new Set([['drink', 'soda'], ['ana', 'lands']].flatMap((words, i) => (words.some(word => String(text).toLowerCase().includes(word)) ? [i] : [])))
  return async (req, res) => {
    const url = new URL(req.url, 'http://x')
    const body = JSON.parse((await bodyOf(req)).toString('utf8') || '{}')
    const uri = String(url.searchParams.get('uri'))
    if (url.pathname === '/health') return reply(res, 200, { status: 'ok', healthy: true })
    if (url.pathname === '/api/v1/content/write') { files.set(body.uri, body); return reply(res, 200, { status: 'ok', result: {} }) }
    if (req.method === 'DELETE') { for (const one of files.keys()) if (one === uri || one.startsWith(`${uri}/`)) files.delete(one); return reply(res, 200, { status: 'ok', result: {} }) }
    if (url.pathname === '/api/v1/fs/ls') {
      const rows = [...files.keys()].filter(one => one.startsWith(`${uri}/`))
      return rows.length === 0 && uri.endsWith('/remembered') ? reply(res, 404, { status: 'error', error: { code: 'NOT_FOUND' } }) : reply(res, 200, { status: 'ok', result: rows })
    }
    const asked = concept(body.query)
    const memories = [...files.values()].map(one => ({ uri: one.uri, tags: one.tags, score: [...concept(one.content)].some(c => asked.has(c)) ? 0.8 : 0.2 }))
    return reply(res, 200, { status: 'ok', result: { memories, resources: [] } })
  }
}
/** Index writes and removals wait this long first, so a forget can land while a reconcile waits or writes (the race arm). */
const slow = { write: 0, remove: 0 }
const pause = ms => new Promise(done => setTimeout(done, ms))
const server = createServer((req, res) => {
  pause(String(req.url).startsWith('/api/v1/content/write') ? slow.write : req.method === 'DELETE' ? slow.remove : 0).then(() => serve(req, res))
    .catch(error => reply(res, 502, { status: 'error', error: { message: String(error?.message) } }))
})
const port = await listen(server)
const ov = async (method, path, body) => (await fetch(`http://127.0.0.1:${String(port)}${path}`, { method, ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  headers: { 'content-type': 'application/json', 'x-api-key': KEY, 'x-openviking-account': 'aukora', 'x-openviking-user': USER } })).json()
const ROOT_URI = `viking://user/${USER}/memories/kira`
const indexed = async () => { const answer = await ov('GET', `/api/v1/fs/ls?uri=${encodeURIComponent(`${ROOT_URI}/remembered`)}&simple=true&limit=1000`); return Array.isArray(answer?.result) ? answer.result.map(String) : [] }

const work = mkdtempSync(join(tmpdir(), 'kira-openviking-recall-'))
const home = join(work, 'home')
const stateDir = join(home, 'kira-memory')
mkdirSync(stateDir, { recursive: true, mode: 0o700 })
const bridgeTo = (dir, url, conf = { embedding: { dense: { provider: 'openai', api_base: 'http://127.0.0.1:1934/v1' } } }) => {
  mkdirSync(dir, { recursive: true, mode: 0o700 })
  writeFileSync(join(dir, 'aukora-bridge.json'), JSON.stringify({ scoreThreshold: tuned.scoreThreshold, window: tuned.window, queryInstruction: tuned.queryInstruction, url, account: 'aukora', user: USER }))
  writeFileSync(join(dir, 'ov.conf'), JSON.stringify(conf))
  writeFileSync(join(dir, 'root.key'), KEY, { mode: 0o600 })
}
try {
  delete process.env.AUKORA_OPENVIKING_HOME
  const dead = createServer()
  bridgeTo(join(home, 'openviking'), `http://127.0.0.1:${String(await listen(dead))}`)
  dead.close()
  const SESSION = 'session-openviking'
  const sessionFile = join(home, 'sessions', 'project', SESSION, 'session.jsonl.zstd')
  mkdirSync(dirname(sessionFile), { recursive: true })
  const events = []
  const handlers = new Map()
  const routes = new Map()
  const tools = new Map()
  const on = name => handlers.get(name) ?? []
  const say = async content => {
    events.push({ type: 'user/message', seq: events.length * 2 + 3, time: Date.now(), data: { id: `msg-${String(events.length)}`, content, source: { kind: 'user' } } })
    writeFileSync(sessionFile, Buffer.concat([{ type: 'session', id: SESSION }, ...events].map(one => zstdCompressSync(Buffer.from(`${JSON.stringify(one)}\n`)))))
    for (const handler of on('agent/turn-stopping')) await handler({ agent: { session: { id: SESSION } }, turn: events.length })
  }
  const route = async (method, path, body) => {
    let text = ''
    await routes.get(path.split('?')[0])(Object.assign(Readable.from(body === undefined ? [] : [JSON.stringify(body)]), { method, url: path, headers: {} }), { setHeader: () => {}, end: chunk => { text = String(chunk) } })
    return JSON.parse(text)
  }
  const web = { get: name => (name === 'webServer' ? { register: ({ path, handler }) => { routes.set(path, handler); return () => {} } } : name === 'connection' ? { requestRejection: () => undefined } : undefined), effect: fn => fn() }
  await apply({
    tools: { register: definition => { tools.set(definition.name, definition); return () => {} } },
    on: (name, handler) => { handlers.set(name, [...on(name), handler]); return () => {} },
    emit: () => {}, effect: fn => fn(), inject: (_names, callback) => callback(web), get: () => undefined, provide: () => {},
    reflect: { get: () => undefined }, logger: { warn: () => {}, info: () => {}, debug: () => {} },
  }, { memoryOwner: { stateDir, subject: `aukora:1:${'3c'.repeat(32)}`, permittedPrivacy: ['local'], approvalFile: join(home, 'a.json'), grantFile: join(home, 'g.json') } })
  const recall = async text => (await tools.get('kira_recall').execute({ text }, { agent: {} })).remembered
  const noteWith = async words => (await route('GET', `${KIRA_ROUTES.list}?tier=remembered&limit=200`)).items.find(one => one.text === words)
  const DRINK = 'my favorite drink right now is santai hard sodas'
  const ANA = 'My sister Ana lands in Denpasar on Friday at noon.'
  let drink = null

  await arm(ARMS.down, async () => {
    await say(DRINK)
    drink = await noteWith(DRINK)
    assert.match(String(drink?.id), /^rem:[0-9a-f]{64}$/u, 'the turn was not remembered while OpenViking was down')
    const first = await recall('what do I like to drink?')
    show('recall while down', { method: first.method ?? 'lexical', ids: first.notes.map(one => one.id), semantic: first.semantic })
    assert.equal(first.notes[0]?.id, drink.id, 'lexical recall did not find the note')
    assert.equal(first.semantic?.available, false, 'the reply did not say semantic recall is unavailable')
    assert.equal((await recall('what do I like to drink?')).semantic, undefined, 'the notice was repeated')
  })
  bridgeTo(join(home, 'openviking'), `http://127.0.0.1:${String(port)}`)
  await arm(ARMS.backfill, async () => {
    await say(ANA)
    const ana = await noteWith(ANA)
    const both = await until(async () => { const now = await indexed(); return [drink, ana].every(one => now.some(uri => uri.endsWith(`rem-${one.id.slice(4)}.md`))) && now }, wait * 5_000)
    show('OpenViking holds after the next capture', both)
    assert.ok(both, 'the note captured while OpenViking was down was not indexed after it came back')
  })
  await arm(ARMS.found, async () => {
    // POLLED: on the live server a listed file can be a moment ahead of its search record.
    const tagsOf = async () => (await ov('POST', '/api/v1/search/find', { query: DRINK, target_uri: ROOT_URI, limit: 5 })).result.memories.find(one => one.uri.endsWith(`rem-${drink.id.slice(4)}.md`))?.tags ?? []
    const tags = await until(async () => { const now = await tagsOf(); return now.includes(`kira_id=${drink.id}`) && now }, wait * 2_500) || await tagsOf()
    assert.ok(tags.includes(`kira_id=${drink.id}`), `the note is not tagged with its Kira id (${JSON.stringify(tags)})`)
    const found = await recall('what do I like to drink?')
    show('kira_recall "what do I like to drink?"', { method: found.method, notes: found.notes.map(one => ({ id: one.id, score: one.score, text: one.text, body: one.bodyAtCapture?.observationClass })) })
    assert.equal(found.method, 'openviking-semantic')
    const hit = found.notes.find(one => one.id === drink.id)
    assert.equal(hit?.text, DRINK, 'the note is not among the hits with the ledger\'s words')
    assert.deepEqual(hit.bodyAtCapture, drink.bodyAtCapture, 'the hit does not carry the note\'s bodyAtCapture')
    assert.equal(hit.bodyAtCapture?.observationClass, 'HOST_REPORTED_CAPTURE_CONTEXT_NOT_EXECUTION_ATTESTATION')
    assert.equal(found.grantsAuthority, false)
  })
  await arm(ARMS.ledger, async () => {
    // A NOTE FILE THE CHAIN NEVER SAW, and its words in OpenViking: on disk and indexed, and still not the ledger's.
    const foreign = `rem:${'e'.repeat(64)}`
    const words = 'my favorite drink is a planted cold soda'
    writeFileSync(join(stateDir, 'remembered', `${'e'.repeat(64)}.json`), JSON.stringify({ id: foreign, statement: words, aura: { entryHash: 'f'.repeat(64) } }))
    const planted = await ov('POST', '/api/v1/content/write', { uri: `${ROOT_URI}/remembered/rem-${'e'.repeat(64)}.md`, content: words, mode: 'replace', wait: true, tags: [`kira_id=${foreign}`] })
    assert.equal(planted.status, 'ok', 'vacuity: the foreign entry was not planted')
    const answer = await recall('what do I like to drink?')
    show('with an unchained entry in OpenViking', { ids: answer.notes.map(one => one.id), droppedUnmapped: answer.droppedUnmapped })
    assert.ok(!answer.notes.some(one => one.id === foreign || one.text === words || one.text === 'unmapped'), 'a hit the chained store does not hold was shown')
    assert.ok(answer.droppedUnmapped >= 1, 'vacuity: OpenViking did not return the planted entry')
    assert.ok(await until(async () => !(await indexed()).some(uri => uri.includes('e'.repeat(64))), 10_000), 'the unchained entry was not removed from OpenViking')
  })
  await arm(ARMS.forget, async () => {
    const forgot = await route('POST', KIRA_ROUTES.forget, { id: drink.id })
    show('forget', { forgotten: forgot.forgotten, openviking: forgot.openviking })
    assert.equal(forgot.forgotten, true, 'vacuity: the forget did not complete')
    assert.ok(!(await indexed()).some(uri => uri.includes(drink.id.slice(4))), 'the forgotten note is still in OpenViking after the forget')
    assert.ok(!(await recall('what do I like to drink?')).notes.some(one => one.id === drink.id), 'recall still returns the forgotten note')
  })
  await arm(ARMS.race, async () => {
    const ana = await noteWith(ANA)
    const LANTERN = 'the paper lantern on the porch came from Ubud'
    slow.write = 1500
    slow.remove = 500
    try {
      // A RECALL WAITING ON A RECONCILE, AND A FORGET THAT LANDS WHILE IT WAITS: the recall reads the ledger in its turn.
      await say('I keep a red kite in the garden shed')
      await pause(100)
      const waiting = recall('when does Ana land?')
      await pause(100)
      assert.equal((await route('POST', KIRA_ROUTES.forget, { id: ana.id })).forgotten, true, 'vacuity: Ana was not forgotten')
      const answer = await waiting
      show('the recall that waited, after Ana was forgotten', { method: answer.method, ids: answer.notes.map(one => one.id) })
      assert.ok(!answer.notes.some(one => one.id === ana.id), 'a recall that waited returned a note forgotten meanwhile')
      // A FORGET WHILE THE NOTE'S OWN INDEX WRITE IS IN FLIGHT: it is removed after that write, not before it.
      slow.remove = 0
      await say(LANTERN)
      const lantern = await noteWith(LANTERN)
      await pause(300)
      assert.equal((await route('POST', KIRA_ROUTES.forget, { id: lantern.id })).forgotten, true, 'vacuity: the lantern was not forgotten')
      await pause(slow.write + 1000)
      const left = (await indexed()).filter(uri => [ana, lantern].some(one => uri.includes(one.id.slice(4))))
      show('forgotten notes OpenViking still holds', left)
      assert.deepEqual(left, [], 'a forgotten note was written back into OpenViking')
    } finally { slow.write = 0; slow.remove = 0 }
  })
  await arm(ARMS.privacy, async () => {
    const { readBridgeConfig } = await load('recall-openviking.mjs')
    const other = join(work, 'remote')
    bridgeTo(other, 'http://127.0.0.1:1933', { embedding: { dense: { provider: 'openai', api_base: 'https://api.openai.com/v1' } } })
    const refused = readBridgeConfig(other)
    show('ov.conf with a remote embedding endpoint', refused)
    assert.equal(refused.configured, false, 'a remote model endpoint was accepted')
    assert.match(String(refused.reason), /models-off-machine/u)
    bridgeTo(other, 'http://10.0.0.1:1933')
    assert.equal(readBridgeConfig(other).reason, 'openviking-url-not-on-this-machine')
  })
} finally {
  // EVERYTHING THIS RUN WROTE IS DELETED: the whole hook-test namespace, then what is left is said.
  const cleared = await ov('DELETE', `/api/v1/fs?uri=${encodeURIComponent(`viking://user/${USER}/memories`)}&recursive=true`).catch(error => ({ status: String(error?.message) }))
  const left = await ov('GET', `/api/v1/fs/ls?uri=${encodeURIComponent(`viking://user/${USER}`)}&simple=true`).catch(() => null)
  process.stdout.write(`        cleanup: ${String(cleared?.status)}; ${USER} holds ${JSON.stringify(left?.result ?? left)}\n`)
  server.close()
  rmSync(work, { recursive: true, force: true })
}
const green = failures === 0 && passed === Object.keys(ARMS).length
process.stdout.write(`KIRA OPENVIKING RECALL: ${green ? 'GREEN' : 'RED'} — ${String(passed)}/${String(Object.keys(ARMS).length)} arms\n`)
process.exit(green ? 0 : 1)
