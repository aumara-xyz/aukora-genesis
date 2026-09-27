/**
 * The guest: the untrusted proposer, run under its own uid by the court.
 *
 * It holds no keys and no state. It is told the socket path (its only route
 * to the broker), the broker's state path, and a shared scratch path — the
 * last two only so the court can measure that the kernel denies the guest any
 * reach into the state. It reports its uid, probes the state boundary, then
 * forwards newline-delimited requests from stdin to the broker and echoes each
 * reply, so one guest process can carry a whole refusal battery.
 *
 * argv: <socketPath> <stateDir> <sharedDir>
 *
 * @module @aukora/guest
 */
import { createConnection } from 'node:net'
import { readFileSync, readdirSync, symlinkSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import readline from 'node:readline'

const socketPath = process.argv[2]
const stateDir = process.argv[3]
const sharedDir = process.argv[4]

const out = (label, payload) => process.stdout.write(`${label} ${payload}\n`)

out('UID', JSON.stringify({ uid: process.getuid?.() ?? null, gid: process.getgid?.() ?? null }))
out('ENV', JSON.stringify({ NODE_OPTIONS: process.env.NODE_OPTIONS ?? null }))

// Kernel-enforced state denial. The state dir is owned by the broker's uid
// with mode 0700, so listing it (readdir) fails with the kernel's permission
// refusal, as does any read beneath it or through a symlink the guest plants.
// readdir is the probe that flips cleanly when confinement is removed: EACCES
// while confined, success when the dir is opened.
for (const [label, p] of [
  ['STATE_ACCESS', stateDir],
  ['TRAVERSAL', join(stateDir, 'memory', 'objects')],
]) {
  try {
    if (label === 'STATE_ACCESS') readdirSync(p)
    else readFileSync(p)
    out(label, JSON.stringify({ ok: true }))
  } catch (err) {
    out(label, JSON.stringify({ ok: false, code: err.code ?? String(err) }))
  }
}

// Symlink substitution: plant a link into the state, then walk through it.
{
  const link = join(sharedDir, `guest-link-${process.pid}`)
  try {
    symlinkSync(join(stateDir, 'seq'), link)
    try {
      readFileSync(link)
      out('SYMLINK', JSON.stringify({ ok: true }))
    } catch (err) {
      out('SYMLINK', JSON.stringify({ ok: false, code: err.code ?? String(err) }))
    }
  } catch (err) {
    out('SYMLINK', JSON.stringify({ ok: false, plantCode: err.code ?? String(err) }))
  } finally {
    try { rmSync(link, { force: true }) } catch { /* the link may not exist */ }
  }
}

// The narrow channel: forward requests, echo replies, exit when drained.
const conn = createConnection(socketPath)
let buffer = ''
let outstanding = 0
let stdinClosed = false

const maybeExit = () => { if (stdinClosed && outstanding <= 0) process.exit(0) }

conn.on('connect', () => out('CONNECTED', JSON.stringify({ ok: true })))
conn.on('error', (err) => { out('SOCKET_ERROR', JSON.stringify({ message: String(err?.message ?? err) })); process.exit(1) })
conn.on('data', (chunk) => {
  buffer += chunk
  let cut
  while ((cut = buffer.indexOf('\n')) !== -1) {
    const line = buffer.slice(0, cut)
    buffer = buffer.slice(cut + 1)
    if (line.trim() === '') continue
    out('REPLY', line)
    outstanding--
    maybeExit()
  }
})

const rl = readline.createInterface({ input: process.stdin, terminal: false })
rl.on('line', (l) => {
  if (l.trim() === '') return
  outstanding++
  conn.write(l + '\n')
})
rl.on('close', () => { stdinClosed = true; maybeExit() })
