#!/usr/bin/env node
/**
 * **ONE COMMAND TO INSTALL PETER'S REAL OWNER PIN.**
 *
 *     node scripts/aumlok/install-owner-pin.mjs
 *
 * `docs/owner-pin.json` names a FIXTURE `did:key`, so **no approval by Peter can ever land**: the verifier checks
 * the signer's key against the pin, the fixture is not his key, and every approval refuses at the anchor. This
 * copies the pin that names **his live signer's public key** over the fixture one.
 *
 * ── **IT READS THE PUBLIC KEY AND NOTHING ELSE** ────────────────────────────────────────────────────────
 *
 * The source is `~/.aukora/signer/daemon-ed25519.pem.pub` — **a public key file.** The private key and the phrase
 * are never opened, read or copied by this program or by the pin it installs: *a pin is a list of keys whose
 * signatures are accepted, and a list of public keys is what that is.*
 *
 * **AND IT READS THE PIN FILE RATHER THAN RE-DERIVING IT.** `docs/owner-pin.real.json` is the pin, reviewed as a
 * file; deriving the key again here would mean the installed pin and the reviewed pin could differ — *a value that
 * reaches the gate without being in the file a person read is a value nobody approved.* The public key is checked
 * AGAINST that file so a stale one is caught rather than installed.
 */
import { readFileSync, copyFileSync, existsSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { ed25519PublicKeyFromPem, didKeyFromEd25519PublicKey } from '../../plugins/aukora-aumlok/lib/did-key.mjs'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..')
const SOURCE = join(ROOT, 'docs', 'owner-pin.real.json')
const TARGET = join(ROOT, 'docs', 'owner-pin.json')
const PUB = join(homedir(), '.aukora', 'signer', 'daemon-ed25519.pem.pub')

if (!existsSync(SOURCE)) { console.error(`REFUSED: ${SOURCE} is not there, so there is no pin to install`); process.exit(2) }
const pin = JSON.parse(readFileSync(SOURCE, 'utf8'))
if (!Array.isArray(pin.approvalKeys) || pin.approvalKeys.length === 0) {
  console.error('REFUSED: the pin names no approval key, so it would accept nobody')
  process.exit(2)
}
if (existsSync(PUB)) {
  const live = didKeyFromEd25519PublicKey(ed25519PublicKeyFromPem(readFileSync(PUB, 'utf8')))
  if (!pin.approvalKeys.includes(live)) {
    console.error(`REFUSED: the pin names ${pin.approvalKeys.join(', ')} and the live signer's public key is ${live}.\n`
      + '  Installing it would pin a key the running signer does not hold.')
    process.exit(2)
  }
  console.log(`  the live signer's public key is ${live}`)
  console.log('  and the pin names it.')
} else {
  console.log(`  no signer public key at ${PUB} — installing the reviewed pin as it stands.`)
}
console.log(`  ${pin.approvalKeys.length} approval key(s): ${pin.approvalKeys.join(', ')}`)
console.log(`  ${pin.gatePaths.length} gate path(s)`)
copyFileSync(SOURCE, TARGET)
console.log(`\n  INSTALLED: ${SOURCE} -> ${TARGET}`)
console.log('  the fixture key is gone; an approval by Peter can now land.')
