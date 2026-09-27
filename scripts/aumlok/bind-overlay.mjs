#!/usr/bin/env node
/**
 * Bind the Kira deployment overlay to the OWNER's bound record — as a staged `.next`, never applied.
 *
 * WHY THIS EXISTS, MEASURED. The deployment overlay carries the two per-deployment values the release
 * cannot know: `subject` and `approverDid`. On this machine the overlay in force has
 * `subject: aukora:1:b84d840c…` and `approverDid: did:key:z6MkewTyte…`, and BOTH of those are the
 * DISPOSABLE TEST controller's public facts (`state/controller`, a v1 record that keeps its private
 * half in the clear). So the Kira queue is bound to a test identity, and after Peter binds the binding
 * has to be repointed to the record the ceremony actually wrote. The sequence is short and every step
 * of it is one a person can get wrong by hand: read the wrong directory, copy the wrong hex, rewrite a
 * comment that only LOOKED like a value, or retire the old controller before the new binding exists.
 * So it is one command, and this file is the command.
 *
 * IT NEVER APPLIES ANYTHING. It writes `<overlay>.next` and stops. The file in force is left
 * byte-identical, which is what lets it be run twice, inspected, and discarded. Applying the `.next` is
 * Alpha's promotion plus Peter's quit-and-reopen, and that ordering is the whole safety property: the
 * queue is never bound to a value nobody looked at.
 *
 * WHAT IT CHANGES, EXACTLY TWO LINES. The `subject:` and `approverDid:` VALUE lines inside the config
 * block. The comments at the top of the live overlay quote the old subject and the old DID inline as
 * instructions to whoever edits it by hand — a blanket string replacement would rewrite those too, and
 * then the diff would be claiming a change it did not make. Line-scoped replacement cannot touch a line
 * that starts with `#`, and the court asserts that every other byte survives.
 *
 * IT REFUSES BY NAME WHEN THE RECORD IS TEST, OR ABSENT. Both are ordinary mistakes and neither should
 * be discovered by reading the resulting YAML:
 *   `aumlok:bind-controller-absent`                  nothing bound in that directory yet;
 *   `aumlok:bind-controller-is-the-test-directory`   it IS the disposable controller this build ran on;
 *   `aumlok:bind-record-is-a-test-record`            the record is the v1 disposable shape, not a bound one.
 *
 * RETIRING THE DISPOSABLE CONTROLLER HAPPENS HERE, AND ONLY AFTER THE WRITE. It reuses the shell's own
 * `retireTestController`, so the guard that refuses to move a directory a composition still binds is the
 * same code the app runs, and the move is a timestamped rename rather than a delete. If the write did
 * not happen, the retirement is never reached — the court proves that with a refusal case rather than
 * with the order of two statements.
 *
 * Usage:
 *   node scripts/aumlok/bind-overlay.mjs --directory <controller-directory>
 *                                       [--overlay <patch.yml>] [--config <config.json>]
 *
 * Exit 0: the `.next` was written. Exit 1: a named refusal. Exit 2: usage.
 *
 * @module scripts/aumlok/bind-overlay
 */
import { chmodSync, closeSync, existsSync, mkdirSync, openSync, readFileSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { basename, dirname, join, resolve } from 'node:path'
import {
  LOCAL_AUMLOK_CONTROL_FILENAME,
  didKeyFromEd25519PublicKey,
  isRecordV3,
  loadLocalAumlokPublicControl,
  readKeptMachineSeed,
  recordProjection,
} from '../../plugins/aukora-aumlok/lib/index.mjs'
import {
  TEST_CONTROLLER_DIRNAME,
  readPatchPluginDirectories,
  retireTestController,
} from '../../apps/aukora-desktop/aumlok-bridge.mjs'

/** Refusals this script produces by name. Stable strings; a caller renders them, never parses prose. */
export const BIND_REFUSE = Object.freeze({
  CONTROLLER_ABSENT: 'aumlok:bind-controller-absent',
  CONTROLLER_IS_THE_TEST_DIRECTORY: 'aumlok:bind-controller-is-the-test-directory',
  RECORD_IS_A_TEST_RECORD: 'aumlok:bind-record-is-a-test-record',
  RECORD_NAMES_NO_MACHINE: 'aumlok:bind-record-names-no-machine',
  MACHINE_KEY_NOT_LISTED: 'aumlok:bind-machine-key-not-listed',
  OVERLAY_ABSENT: 'aumlok:bind-overlay-absent',
  OVERLAY_NAMES_NO_SUBJECT: 'aumlok:bind-overlay-names-no-subject',
  OVERLAY_NAMES_NO_APPROVER: 'aumlok:bind-overlay-names-no-approver',
})

/** The live paths, so the morning command needs no flags at all. */
export const DEFAULT_APP_SUPPORT = join(homedir(), 'Library', 'Application Support', 'AUKORA')
export const DEFAULT_OVERLAY_NAME = 'kira-deployment-overlay.patch.yml'
export const DEFAULT_CONFIG_NAME = 'config.json'

/** The script's own tag for anything it writes to stdout, so a refusal is greppable. */
function refuse(name, detail) {
  process.stdout.write(`REFUSED: ${name}\n`)
  if (typeof detail === 'string' && detail.length > 0) process.stdout.write(`DETAIL: ${detail}\n`)
  process.exit(1)
}

/** Read one `--flag value` argument, or undefined. */
function option(flag) {
  const index = process.argv.indexOf(flag)
  return index === -1 ? undefined : process.argv[index + 1]
}

const KNOWN_FLAGS = ['--directory', '--overlay', '--config']
for (const argument of process.argv.slice(2)) {
  if (argument.startsWith('--') && !KNOWN_FLAGS.includes(argument)) {
    process.stderr.write(`bind-overlay: unknown flag ${argument}\n`)
    process.exit(2)
  }
}

const directory = option('--directory')
if (directory === undefined || directory.startsWith('--')) {
  process.stderr.write('usage: node scripts/aumlok/bind-overlay.mjs --directory <controller-directory> '
    + `[--overlay <patch.yml>] [--config <config.json>]\n`
    + `  --overlay defaults to ${join(DEFAULT_APP_SUPPORT, DEFAULT_OVERLAY_NAME)}\n`
    + `  --config  defaults to ${join(DEFAULT_APP_SUPPORT, DEFAULT_CONFIG_NAME)} (read for the patch list, never written)\n`)
  process.exit(2)
}
const overlayPath = resolve(option('--overlay') ?? join(DEFAULT_APP_SUPPORT, DEFAULT_OVERLAY_NAME))
const configPath = resolve(option('--config') ?? join(DEFAULT_APP_SUPPORT, DEFAULT_CONFIG_NAME))
const absolute = resolve(directory)

// THE COMPOSITION IS READ BEFORE ANYTHING ELSE, for two reasons and both are about naming things
// honestly: a refusal that says "point it at the owner's directory" should be able to say WHICH
// directory that is, and the retirement below must not move a directory a composition still binds — a
// guard that cannot read the composition must not guess. Nothing here is ever written.
let patchPaths = null
try {
  const config = JSON.parse(readFileSync(configPath, 'utf8'))
  if (Array.isArray(config?.patch)) patchPaths = config.patch.filter(entry => typeof entry === 'string')
} catch { /* null: reported where it matters, never guessed at */ }

/** The directory the composition binds for the owner, or null when no row declares one. */
function boundAumlokDirectory(paths) {
  for (const path of paths ?? []) {
    let text
    try {
      text = readFileSync(path, 'utf8')
    } catch {
      continue
    }
    for (const row of readPatchPluginDirectories(text)) {
      if (row.id === 'aukora-aumlok' && row.directory !== null) return resolve(row.directory)
    }
  }
  return null
}
const boundDirectory = boundAumlokDirectory(patchPaths)

// ── 1. THE RECORD MUST EXIST, AND IT MUST NOT BE THE DISPOSABLE ONE ──────────────────────────
const recordPath = join(absolute, LOCAL_AUMLOK_CONTROL_FILENAME)
if (!existsSync(recordPath)) {
  refuse(BIND_REFUSE.CONTROLLER_ABSENT,
    `${recordPath} does not exist, so there is no record to bind the overlay to. Bind first — the `
    + 'ceremony writes this file — and run this again with the directory the composition binds.')
}
// THE DISPOSABLE DIRECTORY, BY THE SAME NAME THE SHELL RETIRES IT BY. The constant is imported from the
// bridge rather than spelled again here, so this refusal and that retirement cannot disagree about which
// directory is the test one.
if (basename(absolute) === TEST_CONTROLLER_DIRNAME) {
  refuse(BIND_REFUSE.CONTROLLER_IS_THE_TEST_DIRECTORY,
    `${absolute} is the DISPOSABLE test controller this build has been running on (basename `
    + `'${TEST_CONTROLLER_DIRNAME}', the name the shell retires). Binding the Kira overlay to it would `
    + 'name a test identity as the owner. Point this command at the directory the composition binds for '
    + `the owner${boundDirectory === null ? ' (the `aukora-aumlok` row\'s config.directory)' : ` — ${boundDirectory}`} `
    + 'once the ceremony has BOUND there: this refuses until a v3 record exists, because a binding '
    + 'written against a test key is worse than no binding at all.')
}

/** The raw record, read once, so the shape check and the projection cannot read two different files. */
let raw
try {
  raw = JSON.parse(readFileSync(recordPath, 'utf8'))
} catch (cause) {
  refuse(BIND_REFUSE.CONTROLLER_ABSENT,
    `${recordPath} is not readable JSON: ${cause instanceof Error ? cause.message : String(cause)}`)
}
// A V1 RECORD IS THE DISPOSABLE SHAPE, AND THIS IS THE CONTENT HALF OF THE TEST CHECK. v1 keeps its
// private half in the clear and is what every disposable identity in this lane writes
// (`scripts/aumlok/make-disposable-identity.mjs`). A BOUND record is a v3 record: the public root and
// nothing else, because the seven words derived it and the seed this machine kept sits beside it. The
// check is on the record's OWN domain — `isRecordV3` asks the record which format it is rather than
// guessing from which fields happen to be present — so a v1 record under any name is refused too.
if (!isRecordV3(raw)) {
  refuse(BIND_REFUSE.RECORD_IS_A_TEST_RECORD,
    `${recordPath} is not a bound v3 record (version ${String(raw?.version)}, publicRoot `
    + `${raw?.publicRoot === undefined ? 'absent' : 'present'}). A v1 record keeps its private half in `
    + 'the clear and is the shape this lane\'s disposable identities are written in, so binding the '
    + 'overlay to it would name a test key as the owner. Bind with the ceremony and point this command '
    + 'at the record it writes.')
}

// THE RECORD VIEW IS READ SEPARATELY, AND THIS IS A FIX RATHER THAN A PREFERENCE. The loader answers
// with the CONTROL projection — the seven fields the admission machinery reads, which is what a broker
// pins — and `ROOT_ID` and `EPOCH` below are RECORD facts. Reading `projection.rootId` off the control
// projection printed `ROOT_ID: undefined` on a real binding: an overlay bound with nothing recording
// which root it was staged against, which is the fact a later refresh is checked against. The record's
// own reader answers it, from the record this command has already parsed and refused if it is not v3.
const recordView = recordProjection(raw)
// THE APPROVER IS THE **MACHINE** KEY, AND IT IS THE KEY THIS MACHINE ACTUALLY HOLDS.
//
// THIS USED TO BE DERIVED FROM THE ROOT, AND THAT MADE EVERY SETTLEMENT IMPOSSIBLE. `recordProjection`
// answers with the public ROOT — `ed25519` is the root key in hex — and the root is COLD: a root-signed
// approval is refused by name (`aumlok:approval-is-not-root-class`). What signs an approval on this
// machine is the MACHINE key the ceremony derived and kept beside the record, and the Kira owner refuses
// any artifact not signed by the key this overlay pins (`kira.settle:approver-not-registered`). Pinning
// the root therefore satisfied neither rule: MEASURED on a disposable binding, the staged value was the
// root's did:key while the kept key was a different one entirely.
//
// SO THE DID COMES FROM THE KEY, IN THREE CHECKED STEPS, and each failure is a NAMED refusal rather
// than a value nobody looked at:
//   1. the machine key THIS machine kept, read from `machine-seed-v3.json` (the same file the shell's
//      signer loads, so the overlay names the key that will actually sign);
//   2. the record must list that key in `machines[]` — a key the identity does not recognise cannot be
//      its approver, and after a refresh elsewhere this machine's key is exactly that;
//   3. only then is the did:key derived, with the organ's OWN function, so it is the same spelling the
//      approval path re-derives from the same key when it verifies a signature.
const machines = Array.isArray(raw.publicRoot.machines) ? raw.publicRoot.machines : []
if (machines.length === 0) {
  refuse(BIND_REFUSE.RECORD_NAMES_NO_MACHINE,
    `${recordPath} names no machine, so there is no key this overlay could name as the approver. A v3 `
    + 'binding records the machine key it derived and kept; a record without one cannot say which key '
    + 'signs its approvals, and pinning nothing would be worse than refusing: the queue would admit an '
    + 'artifact from any key at all.')
}
let keptMachine
try {
  keptMachine = readKeptMachineSeed({ directory: absolute, custodian: 'file' })
} catch (cause) {
  refuse(BIND_REFUSE.MACHINE_KEY_NOT_LISTED,
    `this machine holds no machine key in ${absolute} (${cause instanceof Error ? cause.message : String(cause)}). `
    + 'The overlay must name the key that signs here, and a machine that kept none cannot name one: bind '
    + 'on this machine, or copy the binding this machine made.')
}
const listed = machines.find(entry => entry?.ed25519 === keptMachine.ed25519PublicKeyHex)
if (listed === undefined) {
  refuse(BIND_REFUSE.MACHINE_KEY_NOT_LISTED,
    `the machine key this machine holds (${keptMachine.ed25519PublicKeyHex.slice(0, 16)}…) is not one of `
    + `the ${String(machines.length)} machine(s) ${recordPath} lists, so approving with it would be `
    + 'refused as an approver the identity never registered. This is what a machine sees after a refresh '
    + 'performed elsewhere: bind again here, and the key this overlay names will be the one that signs.')
}
const approverDid = didKeyFromEd25519PublicKey(listed.ed25519)
// THE LOADER RUNS **AFTER** THE THREE GUARDS, AND THAT ORDER IS A FIX RATHER THAN A STYLE CHOICE.
// MEASURED 2026-09-23 (ITEM 3): `loadLocalAumlokPublicControl` fails closed by THROWING when the machine
// key this machine holds is not one the record lists — `LocalAumlokControlError:
// aumlok-local:entry-malformed`, cause `RootCustodyError: aumlok:machine-signer-not-listed-by-the-record`
// — and it stood ABOVE the two guards written for exactly that condition. Both refusals were therefore
// UNREACHABLE: the script died with an uncaught stack trace on stderr and printed NOTHING on stdout, so
// the operator got no name, while this court's two section-4 arms read an empty string where they expect
// `REFUSED: aumlok:bind-record-names-no-machine` and `REFUSED: aumlok:bind-machine-key-not-listed`. The
// record's own reader above needs nothing from this loader, and the projection is used for `subject`
// alone, so moving the call below the guards costs nothing and restores both named refusals.
const { projection } = loadLocalAumlokPublicControl(absolute)
process.stdout.write(`CONTROLLER: ${absolute}\n`)
process.stdout.write(`BOUND_BY_COMPOSITION: ${boundDirectory ?? 'no aukora-aumlok row declares one'}\n`)
process.stdout.write(`SUBJECT: ${projection.subject}\n`)
process.stdout.write(`APPROVER_DID: ${approverDid}\n`)
process.stdout.write(`APPROVER_MACHINE_INDEX: ${String(listed.index)}\n`)
process.stdout.write(`ROOT_ID: ${recordView.rootId}\n`)
process.stdout.write(`EPOCH: ${String(recordView.epoch)}\n`)

// ── 2. THE OVERLAY: two value lines, replaced in place and nothing else ──────────────────────
if (!existsSync(overlayPath)) {
  refuse(BIND_REFUSE.OVERLAY_ABSENT,
    `${overlayPath} does not exist, so there is nothing to repoint. Name the deployment overlay with `
    + '--overlay if this deployment keeps it somewhere else.')
}
const inForce = readFileSync(overlayPath, 'utf8')
const lines = inForce.split('\n')

/**
 * Replace the VALUE of one key, on the line that carries it.
 *
 * LINE-SCOPED ON PURPOSE. The comments at the top of this overlay quote the old subject and the old DID
 * as instructions, so a text-wide replacement would rewrite prose and the diff would then overstate what
 * happened. A comment line starts with `#` and cannot match `^(\s*)key:`.
 * @param {string} key - the config key to repoint.
 * @param {string} value - the new value.
 * @returns {{index: number, before: string, after: string} | null} what changed, or null when the key is absent.
 */
function replaceValue(key, value) {
  const pattern = new RegExp(`^(\\s+)${key}:\\s*\\S.*$`, 'u')
  const index = lines.findIndex(line => pattern.test(line))
  if (index === -1) return null
  const before = lines[index]
  lines[index] = before.replace(pattern, `$1${key}: ${value}`)
  return { index, before, after: lines[index] }
}

const subjectChange = replaceValue('subject', projection.subject)
if (subjectChange === null) {
  refuse(BIND_REFUSE.OVERLAY_NAMES_NO_SUBJECT,
    `${overlayPath} has no 'subject:' value line, so there is nothing to repoint. A binding run that `
    + 'silently changed nothing would leave the queue on the identity it is on now.')
}
const approverChange = replaceValue('approverDid', approverDid)
if (approverChange === null) {
  refuse(BIND_REFUSE.OVERLAY_NAMES_NO_APPROVER,
    `${overlayPath} has no 'approverDid:' value line. The subject alone is a half binding: the queue `
    + 'would admit one identity and name another as its approver.')
}
if (subjectChange.before === subjectChange.after && approverChange.before === approverChange.after) {
  process.stdout.write(`ALREADY BOUND: ${overlayPath} already names this subject and this approver. `
    + 'The staged file is identical to the one in force.\n')
}

const nextText = lines.join('\n')
const nextPath = `${overlayPath}.next`
mkdirSync(dirname(nextPath), { recursive: true, mode: 0o700 })
const descriptor = openSync(nextPath, 'w', 0o600)
try {
  writeFileSync(descriptor, nextText, 'utf8')
} finally {
  closeSync(descriptor)
}
chmodSync(nextPath, 0o600)

process.stdout.write('\nDIFF (the two value lines, and nothing else):\n')
process.stdout.write(`- ${subjectChange.before.trim()}\n+ ${subjectChange.after.trim()}\n`)
process.stdout.write(`- ${approverChange.before.trim()}\n+ ${approverChange.after.trim()}\n`)
process.stdout.write(`\nSTAGED: ${nextPath}\n`)
process.stdout.write('NOT APPLIED: the overlay in force is unchanged. This file is applied by the '
  + 'quit-and-reopen after it has been promoted to the name above.\n')

// ── 3. RETIRE THE DISPOSABLE CONTROLLER, AFTER THE WRITE AND NEVER BEFORE ────────────────────
// The write above is complete by the time this runs: a refusal on any earlier path exits before it, so
// the disposable controller cannot be moved by a run whose binding did not happen. The patch list is
// read (never written) from the deployment's config, because the shell's retirement guard refuses to
// move a directory any composition still binds — and a guard that cannot read the composition must not
// guess.
if (patchPaths === null) {
  process.stdout.write(`NOT RETIRED: ${configPath} could not be read for the composition's patch list, `
    + 'so the disposable controller was left exactly where it is. Retiring a directory whose binding '
    + 'could not be checked is how a mount is broken to tidy a folder.\n')
} else {
  const retirement = retireTestController({ directory: absolute, patchPaths })
  process.stdout.write(retirement.retired
    ? `RETIRED: ${String(retirement.from)} -> ${String(retirement.to)}\n`
    : `NOT RETIRED: ${String(retirement.reason)}\n`)
}
process.exit(0)
