#!/usr/bin/env node
/**
 * Project one AUMLOK controller's PUBLIC control, from the command line.
 *
 * This is the lane's front door: the same reader the host and KIRA use, driven the
 * way a stranger would drive it — one directory in, the public identity facts and
 * the ceilings out. It prints a named refusal and exits non-zero when the
 * controller is absent, malformed, not private, or no longer the identity that was
 * pinned. It never prints private material, and it has no `--key` flag: this lane
 * does not sign, and a CLI that could reach a private key would be the wrong shape
 * for an adapter whose whole claim is that consumers need only the public half.
 *
 *   node scripts/aumlok/project.mjs <directory> [--expect-subject <aukora:1:…>] [--expect-control <sha256>]
 *
 * Exit 0: the projection was produced. Exit 1: a named refusal. Exit 2: usage.
 *
 * @module scripts/aumlok/project
 */
import { readFileSync } from 'node:fs'
import {
  admitPublicControl,
  controlFieldsOfRecordV3Projection,
  loadLocalAumlokPublicControl,
  printCeilings,
  publicControlDigest,
} from '../../plugins/aukora-aumlok/lib/index.mjs'

/** Read one `--flag value` argument, or undefined. */
function option(flag) {
  const index = process.argv.indexOf(flag)
  return index === -1 ? undefined : process.argv[index + 1]
}

const directory = process.argv[2]
if (directory === undefined || directory.startsWith('--')) {
  process.stderr.write('usage: node scripts/aumlok/project.mjs <controller-directory> '
    + '[--expect-subject <aukora:1:…>] [--expect-control <sha256>] [--signer-pem <path>]\n')
  process.exit(2)
}

const expectSubject = option('--expect-subject')
const expectControl = option('--expect-control')
const signerPemPath = option('--signer-pem')

/** Print a named refusal, the ceilings, and exit non-zero. */
function refuse(reason, detail) {
  process.stdout.write(`REFUSED: ${reason}\n`)
  if (detail !== undefined && detail !== '') process.stdout.write(`DETAIL: ${detail}\n`)
  printCeilings()
  process.exit(1)
}

// A pin is a PAIR: naming only one half would compare against `undefined` and be
// refused as a malformed expectation, which reads as a bad record rather than a
// bad command. So a half pin is a usage error, not a refusal.
if ((expectSubject === undefined) !== (expectControl === undefined)) {
  process.stderr.write('usage: --expect-subject and --expect-control must be given together; '
    + 'a pin names both the subject and the active control digest\n')
  process.exit(2)
}
const pin = expectSubject === undefined
  ? undefined
  : { subject: expectSubject, activeControlDigest: expectControl }

let loaded
try {
  loaded = loadLocalAumlokPublicControl(directory, pin)
} catch (error) {
  refuse(error?.code ?? 'aumlok:unavailable', error instanceof Error ? error.message : String(error))
}

const { projection } = loaded
process.stdout.write(`SUBJECT: ${projection.subject}\n`)
process.stdout.write(`EPOCH: ${String(projection.epoch)}\n`)
process.stdout.write(`ACTIVE_CONTROL_DIGEST: ${projection.activeControlDigest}\n`)
process.stdout.write(`REVOKED: ${String(projection.revoked)}\n`)
process.stdout.write(`APPROVAL_KEY_DID: ${projection.approvalKeyDid}\n`)
process.stdout.write(`CUSTODY_CLASS: ${projection.custodyClass}\n`)

// NARROW BEFORE ADMITTING, AND THIS IS THE ORGAN'S OWN ROUTE RATHER THAN A TOLERANCE ADDED HERE.
// The two calls below read a CLOSED record: `publicControlDigest` re-parses it and `admitPublicControl`
// holds it to exactly the seven control fields, and an extra field is a refusal at both. That strictness
// is the protection — it is what stops a private half riding along on a projection — so the fix for a
// projection that carries extras is to hand the admitting calls the seven, NOT to teach the readers to
// ignore what they did not expect.
//
// WHY THERE ARE EXTRAS AT ALL. For a v1 record `loadLocalAumlokPublicControl` answers with
// `projectPublicControl`, which is already exactly the seven. For a v3 record it answers with
// `projectRecordV3Control`, which is the seven PLUS `boundAt`, and PLUS `handle` when the record has
// one, because the screen reads both and dropping them to satisfy a parser two layers away would be one
// consumer deciding what every other consumer may see. `controlFieldsOfRecordV3Projection` is that
// component's stated answer: `record-v3.mjs` says a caller that wants to ADMIT calls it first.
//
// MEASURED, on Peter's own v3 shape, before this change (record written by `writeRecordV3`, 568 bytes,
// one line, one trailing newline):
//   LOADED_PROJECTION_KEYS domain,subject,epoch,activeControlDigest,revoked,approvalKeyDid,custodyClass,boundAt
//   PROJECTION_DIGEST line: aumlok:control-malformed: fields must be exactly [……]   (exit 1, projection.mjs:181)
//   ADMIT_RAW {"ok":false,"reason":"aumlok:control-malformed"}
// and after: the digest prints, and admission returns ok. `tests/aukora-v3-control-record.test.mjs`'s
// last three arms drive this command as a subprocess and fail if either stops holding.
let admitted
try {
  admitted = controlFieldsOfRecordV3Projection(projection)
} catch (error) {
  refuse(error?.code ?? 'aumlok:control-malformed', error instanceof Error ? error.message : String(error))
}

process.stdout.write(`PROJECTION_DIGEST: ${publicControlDigest(admitted)}\n`)

const signerPublicKeyPem = signerPemPath === undefined ? undefined : readFileSync(signerPemPath, 'utf8')

// With no pin the projection is compared against itself, which checks nothing but
// still lets the signer-key rule run. That is stated in the output rather than
// left for a reader to assume a comparison happened.
const verdict = admitPublicControl({
  projection: admitted,
  expected: pin ?? { subject: admitted.subject, activeControlDigest: admitted.activeControlDigest },
  signerPublicKeyPem,
})
const pinState = pin === undefined ? 'none (subject and digest were not compared)' : 'compared'
process.stdout.write(`ADMISSION: ${verdict.ok ? `ADMITTED (pin: ${pinState})` : `REFUSED ${verdict.reason}`}\n`)
if (!verdict.ok) {
  process.stdout.write(`ADMISSION_DETAIL: ${verdict.detail}\n`)
}
printCeilings()
if (!verdict.ok) process.exit(1)
