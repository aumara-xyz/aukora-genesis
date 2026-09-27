#!/usr/bin/env node
/**
 * OPERATOR COMMAND — mint one one-use grant for one exact memory.put.
 *
 * This exists so that the model never mints. The governed transition needs a
 * grant, and a grant must come from something that holds the issuer key and
 * decided to authorize one write. Here that is a person running this command:
 * it stages the declared record, mints the grant for those exact bytes, and
 * writes both to disk. The agent turn that follows can only *present* it.
 *
 *   node plugins/aukora-kira/bin/kira-grant.mjs \
 *     --state <stateDir> --note "Cedar endpoint listens on port 8098" \
 *     --out <stateDir>/grant.json
 *
 * The grant binds the EFFECT digest. A turn that stages different bytes cannot
 * spend it: the owner checks the byte binding before the nonce, so a
 * substitution is refused AND leaves the grant unspent for its real payload.
 *
 * A GRANT IS HALF OF A WRITE, AND THIS COMMAND MINTS NOTHING ELSE. Settlement also requires a
 * verified owner approval for exactly these bytes, which is a DIFFERENT act by a different command:
 * this one proves the installation decided to authorize a write, and `scripts/aumlok/approve-operation`
 * — the shipped approval producer, which holds no key and asks a separate signer process — produces
 * the owner's signed `aukora:approval-receipt:v1` artifact that the settlement path consumes.
 *
 * THE SUBJECT GRAMMAR IS THE APPROVAL LANE'S. `--subject` defaults to a labelled placeholder in
 * Aumlok's `aukora:1:<64 hex>` form, because an approval record outside that grammar cannot be
 * minted OR parsed by the approving lane at all: a grant minted for `aumlok:subject:owner` in this
 * default would authorize a record that no owner can ever approve, and the settlement would refuse
 * at the approval step with the grant already spent. The record layer itself is
 * subject-AGNOSTIC — an explicit `--subject <anything>` still stages and mints — but only a subject
 * in Aumlok's grammar has an approval path.
 *
 * Exit codes: 0 minted, 2 refused with a named code, 1 could not run.
 */
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { stageKiraMemoryRecord } from '../lib/record.mjs'
import { createMemoryOwner, MEMORY_OWNER_CEILINGS } from '../lib/memory-owner.mjs'

const args = process.argv.slice(2)
/** @param {string} name @param {string} [fallback] */
const option = (name, fallback) => {
  const index = args.indexOf(name)
  return index === -1 ? fallback : args[index + 1]
}

const stateDir = option('--state')
const note = option('--note')
// A labelled placeholder in the approval lane's `aukora:1:<sha256>` grammar — the only form whose
// records that lane can mint or parse. `7a` repeated is not an identity of anyone's.
const subject = option('--subject', `aukora:1:${'7a'.repeat(32)}`)
const out = option('--out')
const expiresIn = Number(option('--expires-in', '300'))

if (stateDir === undefined || note === undefined || out === undefined) {
  process.stderr.write('usage: kira-grant.mjs --state <dir> --note <text> --out <grant.json> [--subject <aukora:1:hex>] [--expires-in <seconds>]\n')
  process.exit(1)
}

try {
  const staged = stageKiraMemoryRecord({
    subject,
    kind: 'observation',
    source: [],
    content: { note },
    links: [],
    privacy: 'local',
    // A declared instant, not a clock reading: the record's identity must be
    // reproducible by the turn that will present this grant.
    createdAt: option('--created-at', '2026-09-08T00:00:00Z'),
  })
  const owner = createMemoryOwner({ stateDir })
  const grant = owner.grantFor(staged.memoryPut, { expiry: Math.floor(Date.now() / 1000) + expiresIn })

  mkdirSync(dirname(resolve(out)), { recursive: true })
  // The record travels beside the grant so the turn does not have to re-derive
  // it: the turn presents these exact bytes or it is refused.
  writeFileSync(resolve(out), `${JSON.stringify({ grant, record: staged.record, subject }, null, 2)}\n`, { mode: 0o600 })

  process.stdout.write(
    `minted one-use grant for ${staged.recordId}\n`
    + `  effect digest : ${grant.effectDigest}\n`
    + `  nonce         : ${grant.nonce}\n`
    + `  expiry        : ${grant.expiry}\n`
    + `  written to    : ${resolve(out)}\n`
    // THE WHOLE INVENTORY, NOT A SUMMARY OF IT (AUKORA-37 class 5, review 5c). This line named three
    // ceilings while the module promised seven: a hardcoded subset cannot be kept in step with the list,
    // and the two it omitted — NOT_CONFINEMENT and APPROVAL_CONSUMED_IN_STORE — are exactly the ones a
    // reader of this output would otherwise never meet. It is printed from the module that owns it now.
    + `  ceilings      : ${MEMORY_OWNER_CEILINGS.join(' | ')}\n`
    + '  this grant authorizes ONE write of exactly these bytes and nothing else\n',
  )
} catch (error) {
  process.stderr.write(`REFUSE: ${error?.code ?? 'UNKNOWN'}: ${error?.message ?? String(error)}\n`)
  // CEILINGS ON THE REFUSED PATH TOO (AUKORA-37 review class 4), and PRINTED FROM THE OWNER'S LIST so
  // this line cannot drift from the sentence the success path above prints.
  process.stderr.write(`  ceilings      : ${MEMORY_OWNER_CEILINGS.join(' | ')}\n`)
  process.exit(error?.code === undefined ? 1 : 2)
}
