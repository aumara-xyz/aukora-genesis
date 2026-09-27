#!/usr/bin/env node
/**
 * aukora-relay — two-way file bus between Genesis (Grok Bot whip) and the
 * AUKORA Genesis harness (LEAD / Auma / Deepseek).
 *
 * See .agents/live/relay/PROTOCOL.md
 */

import { randomBytes } from 'node:crypto'
import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const RELAY = join(ROOT, '.agents', 'live', 'relay')

function die(code, msg) {
  console.error(msg)
  process.exit(code)
}

function ensureDirs() {
  for (const side of ['to-harness', 'to-genesis']) {
    mkdirSync(join(RELAY, side, 'pending'), { recursive: true })
  }
  mkdirSync(join(RELAY, 'acked'), { recursive: true })
}

function pendingDir(side) {
  const folder = side === 'harness' ? 'to-harness' : side === 'genesis' ? 'to-genesis' : null
  if (!folder) die(1, `unknown side: ${side} (want harness|genesis)`)
  return join(RELAY, folder, 'pending')
}

function newId() {
  const stamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z')
  return `${stamp}-${randomBytes(2).toString('hex')}`
}

function readStdin() {
  return new Promise((resolvePromise) => {
    if (process.stdin.isTTY) {
      resolvePromise('')
      return
    }
    const chunks = []
    process.stdin.setEncoding('utf8')
    process.stdin.on('data', (c) => chunks.push(c))
    process.stdin.on('end', () => resolvePromise(chunks.join('')))
  })
}

function parseArgs(argv) {
  const out = { _: [] }
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a === '--json') out.json = true
    else if (a.startsWith('--')) {
      const key = a.slice(2)
      const val = argv[i + 1]
      if (val === undefined || val.startsWith('--')) out[key] = true
      else {
        out[key] = val
        i++
      }
    } else out._.push(a)
  }
  return out
}

function listPending(side) {
  const dir = pendingDir(side)
  if (!existsSync(dir)) return []
  return readdirSync(dir)
    .filter((n) => n.endsWith('.json'))
    .map((n) => {
      const path = join(dir, n)
      const msg = JSON.parse(readFileSync(path, 'utf8'))
      return { path, msg }
    })
    .sort((a, b) => String(a.msg.created_at).localeCompare(String(b.msg.created_at)))
}

function findById(id) {
  for (const side of ['harness', 'genesis']) {
    for (const row of listPending(side)) {
      if (row.msg.id === id || row.path.endsWith(`${id}.json`)) return { side, ...row }
    }
  }
  const acked = join(RELAY, 'acked')
  if (existsSync(acked)) {
    for (const n of readdirSync(acked)) {
      if (!n.endsWith('.json')) continue
      const path = join(acked, n)
      const msg = JSON.parse(readFileSync(path, 'utf8'))
      if (msg.id === id || n.startsWith(id)) return { side: 'acked', path, msg }
    }
  }
  return null
}

async function cmdSend(args) {
  ensureDirs()
  const to = args.to
  if (to !== 'harness' && to !== 'genesis') die(1, 'send requires --to harness|genesis')
  const from = args.from || (to === 'harness' ? 'genesis' : 'harness')
  const title = args.title
  if (!title) die(1, 'send requires --title')

  let body = args.body
  if (args['body-file']) body = readFileSync(resolve(args['body-file']), 'utf8')
  else if (body === '-' || body === true) body = await readStdin()
  if (body === undefined || body === true) die(1, 'send requires --body, --body-file, or --body -')

  const id = newId()
  const msg = {
    id,
    from,
    to,
    title: String(title),
    body: String(body),
    thread: args.thread || null,
    expects_reply: args['expects-reply'] === 'false' ? false : true,
    ack_on_deliver: args['ack-on-deliver'] === true || args['ack-on-deliver'] === 'true',
    artifacts: [],
    created_at: new Date().toISOString(),
    status: 'pending',
  }
  const path = join(pendingDir(to), `${id}.json`)
  writeFileSync(path, JSON.stringify(msg, null, 2) + '\n')
  console.log(`SENT ${id} → ${to}`)
  console.log(path)
}

function cmdInbox(args) {
  ensureDirs()
  const side = args.for
  if (side !== 'harness' && side !== 'genesis') die(1, 'inbox requires --for harness|genesis')
  const rows = listPending(side)
  if (args.json) {
    console.log(JSON.stringify(rows.map((r) => r.msg), null, 2))
    return
  }
  if (rows.length === 0) {
    console.log(`inbox ${side}: empty`)
    return
  }
  console.log(`inbox ${side}: ${rows.length} pending\n`)
  for (const { msg } of rows) {
    console.log(`── ${msg.id} ──`)
    console.log(`from: ${msg.from}  expects_reply: ${msg.expects_reply}`)
    console.log(`title: ${msg.title}`)
    console.log(msg.body)
    console.log('')
  }
}

function cmdShow(args) {
  const id = args._[0]
  if (!id) die(1, 'show requires <id>')
  const hit = findById(id)
  if (!hit) die(2, `not found: ${id}`)
  console.log(JSON.stringify(hit.msg, null, 2))
}

function cmdAck(args) {
  ensureDirs()
  const id = args._[0]
  if (!id) die(1, 'ack requires <id>')
  const hit = findById(id)
  if (!hit) die(2, `not found: ${id}`)
  if (hit.side === 'acked') {
    console.log(`already acked: ${hit.msg.id}`)
    return
  }
  hit.msg.status = 'acked'
  hit.msg.acked_at = new Date().toISOString()
  const dest = join(RELAY, 'acked', `${hit.msg.id}.json`)
  writeFileSync(dest, JSON.stringify(hit.msg, null, 2) + '\n')
  unlinkSync(hit.path)
  console.log(`ACKED ${hit.msg.id}`)
}

function cmdPendingCount(args) {
  ensureDirs()
  const side = args.for
  if (side !== 'harness' && side !== 'genesis') die(1, 'pending-count requires --for harness|genesis')
  console.log(String(listPending(side).length))
}

const args = parseArgs(process.argv.slice(2))
const cmd = args._.shift()

if (cmd === 'send') await cmdSend(args)
else if (cmd === 'inbox') cmdInbox(args)
else if (cmd === 'show') cmdShow(args)
else if (cmd === 'ack') cmdAck(args)
else if (cmd === 'pending-count') cmdPendingCount(args)
else {
  die(
    1,
    `usage:\n  node scripts/aukora-relay.mjs send --to harness|genesis [--from name] --title T --body B|--body-file F|--body -\n  node scripts/aukora-relay.mjs inbox --for harness|genesis [--json]\n  node scripts/aukora-relay.mjs show <id>\n  node scripts/aukora-relay.mjs ack <id>\n  node scripts/aukora-relay.mjs pending-count --for harness|genesis`,
  )
}
