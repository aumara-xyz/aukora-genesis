#!/usr/bin/env node
/**
 * THE OWNER CONSOLE — Peter runs this as `aukora-owner` through `sudo -u`, and the agent cannot.
 *
 * IT IS THE ONLY APPROVAL PATH IN THIS CUT, AND IT IS DELIBERATELY THE WEAKEST ONE THAT IS HONEST. The
 * person reads the frozen bytes on a terminal in a session the agent's uid cannot open, and answers. It
 * retires nothing about ATTENDANCE — there is no proof a person read anything — and it retires the
 * shell-Boolean fallback completely, because there is no boolean to send: the answer is a line on
 * `approve.sock`, which the kernel refuses to an agent-uid connect (measured in
 * `tests/aukora-owner-ingress.test.mjs`, before this process sees anything).
 *
 * WHERE A BETTER ONE PLUGS IN (codex-uid-design.md:11,13): phone/NIP-46, Touch ID and FIDO2 all answer the
 * same question over the same socket with the same bound record. This CLI is the slot's first occupant, not
 * its shape.
 *
 *   owner-console.mjs --socket <approve.sock> list
 *   owner-console.mjs --socket <approve.sock> approve <nonce>
 *   owner-console.mjs --socket <approve.sock> decline <nonce>
 */
import { connect } from 'node:net'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
// ── NOTHING AUTHORED BY THE SUBMITTER REACHES THE TERMINAL UNESCAPED (R0) ────────────────────────
//
// EVERY field below is a string somebody else chose, and a terminal is a program: `ESC [ 2 J` clears the
// screen and `ESC [ H` moves the cursor, so a submitter can REDRAW the listing and have the owner approve a
// nonce the submitter picked. **These two functions are the whole of the defence and they are applied at the
// point of printing**, so a field added later cannot forget them without the arm noticing.
/**
 * AN INSTANT, RENDERED WITHOUT EVER THROWING.
 *
 * **INDEPENDENT REVIEW R3, AND THE DAEMON NOW REFUSES THESE AT FREEZE TIME — THIS IS THE SECOND LOCK.**
 * `new Date(1e15 * 1000).toISOString()` throws `RangeError: Invalid time value`, and it did so WHILE THE
 * CONSOLE WAS LISTING, so the owner lost the whole listing to one field. **The daemon refusing bad values is
 * not a reason for the reader to trust them**: this console also reads a socket, and a reply can come from an
 * older daemon, a different build, or a hand-written client.
 *
 * A value that cannot be rendered is shown AS ITSELF, escaped, with the reason beside it — **the owner must
 * still see that something is there and that it is wrong**, rather than a blank where the expiry should be.
 */
function renderInstant(value) {
  const seconds = Number(value)
  if (!Number.isFinite(seconds)) return `${visible(value)} (not a number of seconds)`
  try {
    return visible(new Date(seconds * 1000).toISOString())
  } catch {
    return `${visible(value)} (NOT A RENDERABLE INSTANT)`
  }
}

const { visible, visibleKeepingNewlines } = await import(
  join(dirname(fileURLToPath(import.meta.url)), '..', 'lib', 'visible.mjs'))

const argv = process.argv.slice(2)
const option = name => {
  const at = argv.indexOf(name)
  return at === -1 ? undefined : argv[at + 1]
}
// **`result` IS THE OWNER'S RECOVERY VERB (CODEX R6 ITEM 2).** A grant signed and lost before delivery is
// recoverable, and until now ONLY over the socket — **so the owner had no way to reach it from the console,
// which is the one place the owner actually is.**
const verb = argv.find(word => ['list', 'approve', 'decline', 'result'].includes(word))
const socketPath = option('--socket') ?? process.env.AUKORA_OWNER_SOCKET
  ?? '/private/var/run/aukora/owner/settle.sock'
const configPath = option('--config')

/** Resolve the approve socket from the config when one is given, so the path lives in exactly one place. */
function approveSocketFrom(configPath) {
  if (typeof configPath !== 'string') return socketPath
  const config = JSON.parse(readFileSync(configPath, 'utf8'))
  return config.approveSocket ?? socketPath
}
const target = approveSocketFrom(configPath)

if (verb === undefined) {
  process.stderr.write('usage: owner-console.mjs --socket <approve.sock> list|approve|decline [nonce]\n')
  process.exit(64)
}

/** One request, one reply line. The refusal comes back as a record carrying its NAME. */
function ask(request) {
  return new Promise((resolvePromise, rejectPromise) => {
    let received = ''
    let settled = false
    const socket = connect(target)
    const finish = (error, value) => {
      if (settled) return
      settled = true
      socket.destroy()
      if (error !== null) rejectPromise(error)
      else resolvePromise(value)
    }
    socket.on('connect', () => socket.write(`${JSON.stringify(request)}\n`))
    socket.on('data', chunk => {
      received += chunk.toString('utf8')
      const newline = received.indexOf('\n')
      if (newline === -1) return
      try { finish(null, JSON.parse(received.slice(0, newline))) } catch (cause) { finish(cause, null) }
    })
    // AN UNREACHABLE DAEMON IS A NAMED FAILURE, NOT A PROMPT. A console that fell back to asking locally
    // when the socket was missing would be approving into nothing.
    socket.on('error', cause => finish(new Error(
      `the owner socket at ${target} could not be reached (${String(cause?.code ?? cause)}). This console `
      + 'only speaks to the daemon; there is no local approval path and no fallback'), null))
  })
}

const request = verb === 'list' ? { op: 'list' } : { op: verb, nonce: argv[argv.indexOf(verb) + 1] }
if (verb !== 'list' && (request.nonce === undefined || request.nonce.length === 0)) {
  // **THE BACKTICKS AROUND `list` WERE UNESCAPED AND KILLED THE WHOLE FILE.** MEASURED: this module was a
  // SyntaxError from the day it was written — `node --check` had never been run on it, and no court imports a
  // `bin` script, so the owner console Peter approves with **never parsed at all**. A tool that cannot start
  // is not a tool with a bug; it is absent, and every claim that it listed or approved anything was about a
  // file nobody had run.
  process.stderr.write(`${verb} needs the proposal's nonce, which \`list\` prints\n`)
  process.exit(64)
}

try {
  const reply = await ask(request)
  if (verb === 'list') {
    if (reply?.ok !== true) {
      process.stderr.write(`the daemon refused: ${visible(reply?.reason)}\n`)
      process.exit(1)
    }
    const proposals = Array.isArray(reply.proposals) ? reply.proposals : []
    process.stdout.write(`${String(proposals.length)} frozen proposal(s)\n\n`)
    for (const entry of proposals) {
      // **EVERY ONE OF THESE IS THE SUBMITTER'S TEXT.** `nonce` and `digest` come back from the daemon's own
      // minting, but they are printed here as strings the reply carried, and a reply is not a trusted source
      // just because the daemon usually writes it. The escaping is unconditional: a field that is normally
      // safe costs nothing to escape and a field that is normally dangerous costs everything to trust.
      process.stdout.write(`  nonce     ${visible(entry.nonce)}\n`)
      process.stdout.write(`  digest    ${visible(entry.digest)}\n`)
      process.stdout.write(`  operation ${visible(entry.operation)} / ${visible(entry.scope)}\n`)
      // **HOW MANY RECORDS THIS AUTHORISES**, derived from the frozen bytes and the same number the phone
      // event is checked against. A ceiling that cannot say how many things it covers is not a ceiling.
      process.stdout.write(`  count     ${visible(entry.count)}\n`)
      process.stdout.write(`  ledger    ${visible(entry.ledgerId)}\n`)
      process.stdout.write(`  expires   ${renderInstant(entry.expiresAt)}\n`)
      process.stdout.write(`  settled   ${entry.settledAt === null ? 'no' : visible(entry.settledAt)}\n`)
      // ── THE EXACT BYTES, IN FULL, AND PAGED RATHER THAN TRUNCATED ──────────────────────────────
      //
      // **CODEX P1: THE OWNER SAW A 400-CHARACTER PREVIEW AND NOTHING ELSE.** The grant was built from the
      // artifact set, the count and the release, and the preview did not contain them — so a person was
      // asked to authorise a summary while the signature covered the detail. **THE DAEMON NO LONGER
      // TRUNCATES ANYTHING**, and this side must not either: it pages, and it says so when there is more.
      // THE BYTES KEEP THEIR NEWLINES — they are a document, and paging depends on splitting them — but every
      // OTHER control character in them is made visible, CARRIAGE RETURN INCLUDED: a `\r` returns the cursor
      // to the start of the line so the rest of the document overwrites what the owner just read.
      const text = visibleKeepingNewlines(entry.bytes ?? entry.preview ?? '')
      const lines = text.split('\n')
      const pageSize = 40
      for (let at = 0; at < lines.length; at += pageSize) {
        const page = lines.slice(at, at + pageSize)
        const more = at + pageSize < lines.length
        process.stdout.write(`  --- frozen bytes ${String(at + 1)}-${String(at + page.length)}`
          + ` of ${String(lines.length)}${more ? ' (more follows)' : ''} ---\n`)
        process.stdout.write(`${page.join('\n')}\n`)
      }
      process.stdout.write('  --- end ---\n\n')
      // A TRUNCATION WOULD BE INVISIBLE IN A TERMINAL, so the length is stated beside the digest: a person
      // comparing what they read with what was signed needs to know they read all of it.
      process.stdout.write(`  ${visible(entry.bytesLength ?? text.length)} bytes, digest `
        + `${visible(entry.digest)}\n\n`)
    }
  } else if (verb === 'result' && reply?.ok === true) {
    // **A SUCCESSFUL RESULT WAS DISCARDED, AND PRINTED AS `REFUSED: undefined`.** MEASURED: there was no branch
    // for it, so a recovered grant fell through to the refusal line — **the owner asked for the thing they had
    // lost and the console told them they had been refused, with no name for what refused them.** The grant and
    // the receipt are the payload; a console that recovers them and does not print them is a console that did
    // the work and threw it away.
    process.stdout.write(`RESULT for ${visible(reply.digest)} — settled ${visible(reply.settledAt)}\n`)
    process.stdout.write(`  operation ${visible(reply.operation)}  authority ${visible(reply.authority)}\n`)
    // THE GRANT IS WHAT WAS LOST, so it is printed as its own block rather than summarised.
    process.stdout.write(`  grant:\n${JSON.stringify(reply.grant, null, 2).split('\n')
      .map(line => `    ${line}`).join('\n')}\n`)
    if (reply.receipt !== null && reply.receipt !== undefined) {
      process.stdout.write(`  receipt: ${visible(reply.receipt.hash ?? JSON.stringify(reply.receipt))}\n`)
    }
  } else if (reply?.ok === true && reply.settled === true) {
    process.stdout.write(`SETTLED ${visible(reply.digest)} as ledger ${visible(reply.ledgerId)}\n`)
  } else {
    // A REFUSAL IS PRINTED BY ITS NAME. `declined` is the owner's own answer and is not an error.
    process.stdout.write(`${reply?.declined === true ? 'DECLINED' : 'REFUSED'}: ${String(reply?.reason)}\n`)
    process.exit(reply?.declined === true ? 0 : 1)
  }
} catch (error) {
  process.stderr.write(`${String(error?.message ?? error)}\n`)
  process.exit(2)
}
