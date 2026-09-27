#!/usr/bin/env node
/**
 * Verify one Receipt v3 document from a file, printing every reason by name.
 *
 * This is the portable entry point: it is the copy a stranger runs. It opens the
 * document and the key files it is told about, and nothing else — no repository,
 * no broker state, no network, no clock it trusts.
 *
 *   node verify-bin.mjs <receipt.json> --executor-key <pem> [--issuer-key <pem>] [--owner-key <pem>]
 *
 * THREE KEY SETS BECAUSE A DOCUMENT NAMES THREE KEYS:
 *   --executor-key  signs the document core and the head statement. Required.
 *   --issuer-key    signs the embedded grant. A v4 authorization is signed by the
 *                   issuer root, whose key is deliberately unavailable to the
 *                   executor process, so a recipient anchors it separately.
 *                   Omitted, the executor set is used, which is correct only when
 *                   one key plays both parts.
 *   --owner-key     signs the approval, for a `human-ceremony` document.
 *
 * Exit 0 CONFORMING, 1 NON-CONFORMING, 2 usage.
 *
 * @module @aukora/receipt-v3/verify-bin
 */
import { readFileSync } from 'node:fs'
import { verifyReceiptV3 } from './verify.mjs'

const USAGE = 'usage: node verify-bin.mjs <receipt.json> --executor-key <pem> [--issuer-key <pem>] [--owner-key <pem>]'

const arguments_ = process.argv.slice(2)
const positional = []
/** @type {string[]} */
const executorKeys = []
/** @type {string[]} */
const issuerKeys = []
/** @type {string[]} */
const ownerKeys = []

for (let index = 0; index < arguments_.length; index += 1) {
  const argument = arguments_[index]
  if (argument === '--executor-key' || argument === '--issuer-key' || argument === '--owner-key') {
    const value = arguments_[index + 1]
    if (value === undefined || value.startsWith('--')) {
      process.stderr.write(`${USAGE}\nmissing value for ${argument}\n`)
      process.exit(2)
    }
    if (argument === '--executor-key') executorKeys.push(value)
    else if (argument === '--issuer-key') issuerKeys.push(value)
    else ownerKeys.push(value)
    index += 1
  } else if (argument.startsWith('--')) {
    process.stderr.write(`${USAGE}\nunknown option ${argument}\n`)
    process.exit(2)
  } else {
    positional.push(argument)
  }
}

if (positional.length !== 1 || executorKeys.length === 0) {
  process.stderr.write(`${USAGE}\n`)
  process.exit(2)
}

const readText = (path, label) => {
  try {
    return readFileSync(path, 'utf8')
  } catch (error) {
    process.stderr.write(`${USAGE}\ncannot read ${label} ${path}: ${String(error?.message ?? error)}\n`)
    process.exit(2)
  }
}

const documentText = readText(positional[0], 'document')
let document
try {
  document = JSON.parse(documentText)
} catch (error) {
  process.stdout.write(`REFUSED receipt:malformed — the document is not JSON (${String(error?.message ?? error)})\n`)
  process.stdout.write('VERDICT NON-CONFORMING\n')
  process.exit(1)
}

const result = verifyReceiptV3({
  document,
  executorPublicKeys: executorKeys.map((path) => readText(path, 'executor key')),
  issuerPublicKeys: (issuerKeys.length === 0 ? executorKeys : issuerKeys).map((path) => readText(path, 'issuer key')),
  ownerPublicKeys: ownerKeys.map((path) => readText(path, 'owner key')),
})

process.stdout.write(`document:   ${positional[0]}\n`)
process.stdout.write(`executor:   ${executorKeys.length} key(s) supplied\n`)
process.stdout.write(`issuer:     ${issuerKeys.length === 0 ? 'none supplied (falling back to the executor set)' : `${issuerKeys.length} key(s) supplied`}\n`)
process.stdout.write(`owner:      ${ownerKeys.length} key(s) supplied\n\n`)
for (const line of result.lines) process.stdout.write(`${line}\n`)
if (result.reasons.length === 0) process.stdout.write('\nno named refusal was measured\n')
else process.stdout.write(`\n${result.reasons.length} named refusal(s)\n`)
process.exit(result.verdict === 'CONFORMING' ? 0 : 1)
