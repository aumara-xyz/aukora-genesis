#!/usr/bin/env node
/**
 * KIRA AND OPENVIKING, THE CHAINED STORE AS THE TRUTH, on the plugin mounted as tests/kira-memory-live-path.test.mjs mounts it.
 * A stand-in OpenViking by default: a word table, so it proves the bridge, not meaning. Scratch state only; not the installed app.
 */
import assert from 'node:assert/strict'
import { randomBytes } from 'node:crypto'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { createServer } from 'node:http'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { Readable } from 'node:stream'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { zstdCompressSync } from 'node:zlib'

const HERE = fileURLToPath(import.meta.url)
const ROOT = resolve(dirname(HERE), '..')
const ARMS = Object.freeze({
  down: 'down: with OpenViking down the turn is remembered and lexical recall finds it, said once',
  backfill: 'backfill: once OpenViking answers, the next capture indexes every note, including one captured while it was down',
})
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

// ── THE SERVER THE BRIDGE TALKS TO ───────────────────────────────────────────────────────────────────────────────────
const USER = 'hook-test'
const KEY = randomBytes(32).toString('hex')
const serve = standIn()
const wait = 1
const tuned = {}
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
const server = createServer((req, res) => { serve(req, res).catch(error => reply(res, 502, { status: 'error', error: { message: String(error?.message) } })) })
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
} finally {
  server.close()
  rmSync(work, { recursive: true, force: true })
}
const green = failures === 0 && passed === Object.keys(ARMS).length
process.stdout.write(`KIRA OPENVIKING RECALL: ${green ? 'GREEN' : 'RED'} — ${String(passed)}/${String(Object.keys(ARMS).length)} arms\n`)
process.exit(green ? 0 : 1)
