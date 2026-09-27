#!/usr/bin/env node
/**
 * OPERATOR COMMAND — stage the CONTROL PIN into the kira deployment overlay, as a `.next`.
 *
 * THE GAP THIS CLOSES, MEASURED. The first live settlement returned `approverPinned: true` and
 * `controlPinned: false` — the approver was checked and the control head was not, because the overlay
 * names `subject` and `approverDid` and no head at all. The check itself was already implemented and
 * already courted: a stale pin refuses `APPROVAL_CONTROL_NOT_CURRENT` by name, a matching pin reports
 * `controlPinned: true`, and an absent pin settles and says it was unpinned. So this was never a missing
 * check; it was a missing value, and a pin nobody writes is a pin that never fires.
 *
 * IT WRITES `<overlay>.next` AND STOPS. The overlay in force is never written by this command, which is
 * what lets the staged file be inspected, re-run, and discarded; applying it is a promotion and a
 * relaunch that belong to somebody else. It also refuses to pin an overlay bound to a DIFFERENT subject
 * than the controller serves, because a head pinned onto a mis-bound file would make a wrong binding
 * look checked.
 *
 * WHY NOT `bind-overlay.mjs`. That command stages exactly two value lines and its own court asserts
 * that, so widening it to carry a Kira field would put this lane's change inside another lane's claim.
 * The two commands compose: bind the subject and the DID there, pin the head here.
 *
 *   node plugins/aukora-kira/bin/kira-pin-control.mjs --controller <controller-dir> [--overlay <patch.yml>]
 *   node plugins/aukora-kira/bin/kira-pin-control.mjs --controller <dir> [--overlay <patch.yml>] --check
 *
 * `--check` VERIFIES THE PENDING PROMOTION FIRST: when `<overlay>.next` exists it is the file checked,
 * otherwise the overlay itself is, and the path checked is always printed. It settles nothing, spends
 * nothing, and needs no key.
 *
 * Exit codes: 0 staged, or `--check` found the controller's head; 2 refused with a name; 3 `--check`
 * found the pin absent or stale; 1 could not run.
 */
import { chmodSync, closeSync, existsSync, mkdirSync, openSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { fileURLToPath } from 'node:url'

const ROOT = fileURLToPath(new URL('../../../', import.meta.url))
// THE CEILINGS COME FROM THE MODULE THAT OWNS THEM, so a refusal cannot print a summary that drifts from
// the list every settle result carries.
const { MEMORY_OWNER_CEILINGS } = await import(pathToFileURL(resolve(ROOT, 'plugins/aukora-kira/lib/memory-owner.mjs')).href)
const argv = process.argv.slice(2)
const option = (name, fallback) => {
  const index = argv.indexOf(name)
  return index === -1 ? fallback : argv[index + 1]
}

const APP = join(process.env.HOME ?? '', 'Library/Application Support/AUKORA')
const controller = option('--controller')
const overlayPath = resolve(option('--overlay') ?? join(APP, 'kira-deployment-overlay.patch.yml'))
const check = argv.includes('--check')

const refuse = (name, message) => {
  process.stderr.write(`REFUSED: kira.pin:${name}: ${message}\n`)
  // THE CEILINGS, ON THE REFUSED PATH TOO (AUKORA-37 classes 4 and 5). A command that names its limits
  // only when it succeeds leaves the person operating it — who is reading a refusal precisely because
  // something needs deciding — without the statement of what this mechanism does not prove.
  process.stderr.write(`  ceilings      : ${MEMORY_OWNER_CEILINGS.join(' | ')}\n`)
  process.exit(2)
}

if (controller === undefined || controller.startsWith('--')) {
  process.stderr.write('usage: kira-pin-control.mjs --controller <controller-directory> '
    + '[--overlay <patch.yml>] [--check]\n')
  process.exit(1)
}

const { loadLocalAumlokPublicControl } = await import(
  pathToFileURL(join(ROOT, 'plugins', 'aukora-aumlok', 'lib', 'index.mjs')).href
)
let projection
try {
  ({ projection } = loadLocalAumlokPublicControl(controller))
} catch (error) {
  refuse('controller-unreadable',
    `the controller could not be read (${error?.code ?? String(error?.message ?? error)}); nothing was staged`)
}
const head = String(projection.activeControlDigest ?? '')
const subject = String(projection.subject ?? '')
if (!/^[0-9a-f]{64}$/u.test(head)) {
  refuse('controller-names-no-head', `the controller reports no usable control head (${head || 'empty'}); nothing was staged`)
}
if (!existsSync(overlayPath)) {
  refuse('overlay-absent', `${overlayPath} does not exist, so there is nothing to pin`)
}

const valueOf = (text, key) => {
  const line = text.split('\n').find(row => new RegExp(`^\\s+${key}:\\s*\\S`, 'u').test(row))
  return line === undefined ? undefined : line.trim().slice(key.length + 1).trim()
}

// ── `--check`: does the file that is about to be (or has been) promoted carry this head? ──────────
if (check) {
  const pending = `${overlayPath}.next`
  const checked = existsSync(pending) ? pending : overlayPath
  const found = valueOf(readFileSync(checked, 'utf8'), 'activeControlDigest')
  process.stdout.write(`CHECKED: ${checked}\n`)
  process.stdout.write(`  controller : ${resolve(controller)}\n`)
  process.stdout.write(`  serves     : ${subject}\n`)
  process.stdout.write(`  head       : ${head}\n`)
  process.stdout.write(`  pin in file: ${found ?? '(none)'}\n`)
  if (found === undefined) {
    process.stdout.write('\nCHECK: UNPINNED — this file names no control head, so a settlement through it '
      + 'checks the approver and not the control state.\n')
    process.exit(3)
  }
  if (found !== head) {
    process.stdout.write('\nCHECK: STALE — this file pins a head the controller no longer serves; a settle '
      + 'through it would refuse APPROVAL_CONTROL_NOT_CURRENT.\n')
    process.exit(3)
  }
  process.stdout.write('\nCHECK: PINNED — a settle through this file pins the approver and this head.\n')
  process.exit(0)
}

const inForce = readFileSync(overlayPath, 'utf8')
const lines = inForce.split('\n')

// THE ANCHOR COMES FIRST: an indentation to match and a line to sit beside, so the pin joins the
// `memoryOwner` map rather than landing at the document root. No anchor means no pin, by name.
const approverIndex = lines.findIndex(line => /^\s+approverDid:\s*\S/u.test(line))
if (approverIndex === -1) {
  refuse('overlay-names-no-approver',
    `${overlayPath} has no 'approverDid:' value line, so there is no line for a pin to sit beside. `
    + 'The approver and the head are one binding: pinning a head onto a file that names no approver '
    + 'would say less than it looks like it says.')
}
const indent = /^(\s+)approverDid:/u.exec(lines[approverIndex])?.[1] ?? '      '

// A HEAD PINNED ONTO A MIS-BOUND FILE IS WORSE THAN NO PIN, because the file would then read as
// checked while naming another identity. The subject is the one fact a controller can settle this
// question with, and it is read rather than typed.
const foundSubject = valueOf(inForce, 'subject')
if (foundSubject !== subject) {
  refuse('overlay-subject-differs',
    `${overlayPath} names subject ${String(foundSubject)} and the controller serves ${subject}; a pin on `
    + 'that file would make a mis-bound overlay read as a checked one. Nothing was staged.')
}

const pinLine = `${indent}activeControlDigest: ${head}`
const existing = lines.findIndex(line => /^\s+activeControlDigest:\s*\S/u.test(line))
if (existing === -1) lines.splice(approverIndex + 1, 0, pinLine)
else lines[existing] = pinLine

const nextPath = `${overlayPath}.next`
mkdirSync(dirname(nextPath), { recursive: true, mode: 0o700 })
const descriptor = openSync(nextPath, 'w', 0o600)
try {
  writeFileSync(descriptor, lines.join('\n'), 'utf8')
} finally {
  closeSync(descriptor)
}
chmodSync(nextPath, 0o600)

process.stdout.write(
  `CONTROLLER: ${resolve(controller)}\n`
  + `SUBJECT: ${subject}\n`
  + `CONTROL_HEAD: ${head}\n`
  + `PIN: ${existing === -1 ? 'added' : 'replaced in place'}\n`
  + `STAGED: ${nextPath}\n`
  + 'NOT APPLIED: the overlay in force is unchanged. This file is applied by a promotion and a\n'
  + 'quit-and-reopen, and `--check` answers whether it carries the right head before and after.\n',
)
