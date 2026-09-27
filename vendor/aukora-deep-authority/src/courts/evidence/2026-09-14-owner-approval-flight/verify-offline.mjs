#!/usr/bin/env node
/**
 * Offline verification of one exported attended-approval flight.
 *
 * Reads only files beside this script, so the whole check runs from a copy of this directory
 * anywhere. It never opens broker state, a private key, a pairing token, or the live effect path.
 *
 * Three claims are reported separately because they have different strengths:
 *   1. Signature and content. The receipt's Ed25519 signature over its own signed fields, and the
 *      exported bytes matching the signed content digest and length. This check verifies those.
 *   2. Key trust. A signature is only as strong as the public key supplied. The bundle carries the
 *      key beside the activation receipt key id it was pinned to, so agreeing values show internal
 *      consistency, not independent custody. A reader needing more must pin the key out of band.
 *   3. Human attendance. Nothing here establishes that a person saw or answered a prompt, and a
 *      scripted pass cannot. Attendance rests on the owner's own observation, outside this bundle.
 *
 * Negative controls are included: a tampered signature and tampered content must both refuse, so a
 * passing signature line cannot come from a verifier that accepts everything.
 *
 * @module courts/evidence/2026-09-14-owner-approval-flight
 */
import { createHash, createPublicKey } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { requestDigest, verifyReceipt } from '../../../aukora/broker/receipt.mjs'
import { canonicalEd25519PublicKey, receiptKeyIdForPublicKey } from '../../../aukora/host-dsh/src/grant.mjs'

/** The bundle to check: an explicit directory argument, else this script's own directory. */
const bundleDirectory = process.argv[2] ?? fileURLToPath(new URL('.', import.meta.url))
const read = (name) => readFileSync(join(bundleDirectory, name))
const readJson = (name) => JSON.parse(read(name).toString('utf8'))

const receipt = readJson('receipt.json')
const operation = readJson('operation.json')
const pin = readJson('pin.json')
const publicPem = read('broker-public.pem').toString('utf8')
const bytes = read('content.txt')

const sha256 = (value) => createHash('sha256').update(value).digest('hex')
const exportedContentSha256 = sha256(bytes)

/** The receipt's own claims for fields an off-host copy cannot re-observe; content and length are recomputed. */
const observation = {
  status: 'observed',
  contentSha256: exportedContentSha256,
  bytes: bytes.length,
  inode: receipt.inode,
  mtimeNs: receipt.mtimeNs,
}
const observe = (override) => () => ({ ...observation, ...override })

const checks = {
  exportedContentMatchesReceipt: exportedContentSha256 === receipt.contentSha256,
  exportedBytesMatchReceipt: bytes.length === receipt.bytes,
  signature: verifyReceipt({ receipt, brokerPublicKeyPem: publicPem, require: { class: pin.requiredClass }, observe: observe() }),
  rejectsTamperedSignature: verifyReceipt({
    receipt: { ...receipt, signature: Buffer.alloc(64).toString('base64') },
    brokerPublicKeyPem: publicPem,
    require: { class: pin.requiredClass },
    observe: observe(),
  }),
  rejectsTamperedContent: verifyReceipt({
    receipt,
    brokerPublicKeyPem: publicPem,
    require: { class: pin.requiredClass },
    observe: observe({ contentSha256: sha256(Buffer.concat([bytes, Buffer.from('tampered')])) }),
  }),
  suppliedKeyIsEd25519: canonicalEd25519PublicKey(publicPem) !== null,
  suppliedKeyId: receiptKeyIdForPublicKey(createPublicKey(publicPem)),
  binding: {
    pathMatchesRecordedDestination: receipt.path === operation.resolvedDestination,
    contentSha256MatchesSubmitted: receipt.contentSha256 === operation.submittedContentSha256,
    bytesMatchSubmitted: receipt.bytes === operation.submittedBytes,
    requestDigestMatchesRecomputed: receipt.requestDigest === requestDigest(operation.tool, operation.arguments),
  },
  recomputedRequestDigest: requestDigest(operation.tool, operation.arguments),
}
checks.suppliedKeyMatchesActivationPin = checks.suppliedKeyId === pin.activationReceiptKeyId

const expectations = [
  ['exported content matches signed digest', checks.exportedContentMatchesReceipt],
  ['exported length matches signed length', checks.exportedBytesMatchReceipt],
  ['signature verifies over signed fields', checks.signature.ok === true],
  ['tampered signature refused', checks.rejectsTamperedSignature.reason === 'receipt:signature-invalid'],
  ['tampered content refused', checks.rejectsTamperedContent.reason === 'receipt:content-mismatch'],
  ['supplied key is ed25519', checks.suppliedKeyIsEd25519],
  ['supplied key matches activation pin', checks.suppliedKeyMatchesActivationPin],
  ['path binds to recorded destination', checks.binding.pathMatchesRecordedDestination],
  ['content binds to submitted content', checks.binding.contentSha256MatchesSubmitted],
  ['length binds to submitted length', checks.binding.bytesMatchSubmitted],
  ['request digest binds to the submitted arguments', checks.binding.requestDigestMatchesRecomputed],
]

for (const [name, passed] of expectations) process.stdout.write(`${passed ? 'PASS' : 'FAIL'}  ${name}\n`)
process.stdout.write(`\nreceipt path:        ${receipt.path}\n`)
process.stdout.write(`content sha256:      ${receipt.contentSha256} (${receipt.bytes} bytes)\n`)
process.stdout.write(`request digest:      ${receipt.requestDigest}\n`)
process.stdout.write(`recomputed digest:   ${checks.recomputedRequestDigest}\n`)
process.stdout.write(`supplied key id:     ${checks.suppliedKeyId}\n`)
process.stdout.write(`activation key id:   ${pin.activationReceiptKeyId}\n`)
process.stdout.write(`signature verdict:   ${JSON.stringify(checks.signature)}\n`)
process.stdout.write(`refusal controls:    ${checks.rejectsTamperedSignature.reason} / ${checks.rejectsTamperedContent.reason}\n`)
process.stdout.write('\nSIGNATURE AND CONTENT: verified above, from this bundle alone.\n')
process.stdout.write('KEY TRUST:             the supplied key agrees with the activation pin recorded in this same bundle;\n')
process.stdout.write('                       that is internal consistency, not independent custody.\n')
process.stdout.write('HUMAN ATTENDANCE:      not established by this bundle. It rests on the owner observing and\n')
process.stdout.write('                       answering the prompts, and no scripted run can substitute for that.\n')

const failed = expectations.filter(([, passed]) => !passed)
process.stdout.write(`\n${failed.length === 0 ? 'VERIFIED' : `NOT VERIFIED (${failed.length} failing check(s))`}\n`)
process.exitCode = failed.length === 0 ? 0 : 1
