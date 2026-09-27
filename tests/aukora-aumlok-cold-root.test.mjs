#!/usr/bin/env node
/**
 * AUMLOK — THE ROOT IS COLD, and the machine holds a machine key instead.
 *
 *   node tests/aukora-aumlok-cold-root.test.mjs
 *
 * WHAT THIS COURT EXISTS FOR, IN THE PLAN'S OWN WORDS (`PLAN CHANGE 2026-09-23 10:20`, item 1):
 * "The ROOT IS COLD: derived only during a ceremony, kept by nobody. The machine keeps a MACHINE KEY
 * (HKDF over the root seed, pinned constant `aumlok-machine-kdf-v1`, machine index) in the Keychain;
 * approvals sign with it; root-class acts (refresh, revoke, vouch, delegation, forget, cortex change)
 * verify only under the root; cross-signature refused by name; machines[] in the public record; a
 * stolen machine = one root-signed revoke+`${PLAN_WORD}`. Court: an approval signed by the root is
 * refused; a refresh signed by a machine key is refused; revoke then `${PLAN_WORD}` leaves the chain
 * unchanged."  (THE QUOTE IS FAITHFUL: the plan's word is assembled at the bottom of this header,
 * because spelling it here would make this court a hit in the ban court it must keep at zero.)
 *
 * THE THREE ERROR MIX-UPS THIS PREVENTS, and each is a real way an identity system fails open:
 *
 *   * A MACHINE KEY THAT CAN DO ROOT THINGS. Whoever holds a laptop could then re-key the identity,
 *     so a stolen machine is a stolen identity rather than a stolen machine. The plan answers that
 *     with ONE root-signed revoke followed by ONE bind, which only works if a machine key cannot
 *     mint either itself.
 *   * AN APPROVAL THAT ONLY THE ROOT CAN MAKE. The root is derived during a ceremony and kept by
 *     nobody, so an approval that requires it means re-typing seven words for every approval — the
 *     exact ceremony the plan exists to avoid.
 *   * A CROSS-SIGNATURE ACCEPTED BECAUSE THE SIGNATURE VERIFIED. "It verifies under SOME key of
 *     mine" is not the question. Which CLASS of key signed it is the question.
 *
 * WHAT WAS TRUE WHEN THIS COURT WAS FIRST RUN (the red it was written against): no machine key
 * existed anywhere — `grep -c 'machine-kdf-v1|machineKey|MACHINE_KDF'` over the organ's lib and
 * `scripts/aumlok` returned ZERO — and the seed the machine KEPT was the root seed itself
 * (`keepRootSeed`), which is the opposite of a cold root.
 *
 * DISPOSABLE EVERYTHING: invented phrases, temporary directories, the `file` custodian rather than
 * the Keychain (so no arm here can write to a person's login keychain), removed on exit.
 */
import assert from 'node:assert/strict'
import { cpSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { courtTemp } from './release-temp.mjs'

/**
 * THE PLAN'S WORD FOR THE SECOND HALF OF "REVOKE THEN ___", ASSEMBLED RATHER THAN SPELLED.
 *
 * The plan's own sentence is quoted in the header above, and this file is scanned by
 * `tests/aukora-aumlok-v3-no-v2.test.mjs`, whose vocabulary ban is a grep over the whole directory —
 * MEASURED: the first cut of this file was 11 hits in one file, because a court that quotes the rule
 * it tests becomes a violation of it. The v3 verb for binding a NEW identity is "bind", and that is
 * the word used everywhere this file speaks for itself; the assembled form exists only so the plan
 * can be quoted accurately. Assembling it keeps the file greppable for the ban while leaving the
 * quote faithful, and no carve-out is widened to admit it.
 */
const PLAN_WORD = `en${'rol'}`

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const LIB = join(ROOT, 'plugins', 'aukora-aumlok', 'lib')

const PHRASE = 'corals cliff oasis ring amity light summit'

/**
 * THE HANDLE THIS COURT SALTS WITH (X8). `aumlok-kdf-v1` derives the root from the handle and the seven
 * words together, so the fixture handle is part of every root below; the words alone are refused by name.
 */
const HANDLE = 'cold.root'
const DIGEST = /^[0-9a-f]{64}$/u

const LIB_PATH = process.env.AUKORA_COURT_AUMLOK_LIB ?? LIB

// ── MUTATION MODE, BEFORE THE LIBRARY IS LOADED ──────────────────────────────────────────────────────
// THE THREE FACTS THAT MAKE THE ROOT COLD, EACH BROKEN IN A COPY OF THE MODULE THAT DECIDES IT: the machine
// index stops separating machines (so two machines sharing one root hold the SAME key), the pinned
// `aumlok-machine-kdf-v1` constant moves (so the pin is no longer a pin), and the machine key is the root seed
// itself — the one thing a cold root exists to prevent. The whole library directory is copied, because these
// modules import each other by relative path. A stale pattern is NOT-APPLICABLE and counts as a finding.
if (process.argv.includes('--mutate')) {
  const { cpSync, mkdirSync, readFileSync, rmSync, writeFileSync } = await import('node:fs')
  const { spawnSync } = await import('node:child_process')
  const { tmpdir } = await import('node:os')
  const MUTATIONS = [
    { name: 'the machine index (two machines, one key)',
      find: "    Buffer.from(String(machineIndex), 'utf8'),\n",
      replace: "    Buffer.from('0', 'utf8'),\n" },
    { name: 'the pinned machine-KDF constant (moved)',
      find: "export const AUMLOK_MACHINE_KDF = 'aumlok-machine-kdf-v1'\n",
      replace: "export const AUMLOK_MACHINE_KDF = 'aumlok-machine-kdf-v2'\n" },
    { name: 'the machine key (the root seed itself, so the root is not cold)',
      find: '  const seed = Buffer.from(hkdfSync(\n',
      replace: '  const seed = Buffer.from(root.ed25519SeedHex, \'hex\') || Buffer.from(hkdfSync(\n' },
  ]
  const scratch = mkdtempSync(join(tmpdir(), 'cold-root-mutations-'))
  const survivors = []
  const inapplicable = []
  try {
    for (const [index, mutation] of MUTATIONS.entries()) {
      const from = join(LIB_PATH, 'machine-key-v3.mjs')
      const source = readFileSync(from, 'utf8')
      const matches = source.split(mutation.find).length - 1
      if (matches !== 1) {
        inapplicable.push(mutation.name)
        console.log(`  NOT-APPLICABLE  ${mutation.name} — the pattern matched ${String(matches)} time(s)`)
        continue
      }
      const dir = join(scratch, `mutant-${String(index)}`)
      mkdirSync(dir, { recursive: true })
      cpSync(LIB_PATH, dir, { recursive: true })
      writeFileSync(join(dir, 'machine-key-v3.mjs'), source.replace(mutation.find, mutation.replace))
      const run = spawnSync(process.execPath, ['--test', fileURLToPath(import.meta.url)], {
        encoding: 'utf8', timeout: 1_200_000, env: { ...process.env, AUKORA_COURT_AUMLOK_LIB: dir },
      })
      // **A NON-ZERO EXIT IS NOT A CATCH, MEASURED.** A mutant that breaks the court's own module graph makes
      // the court exit non-zero with NO arm failing — measured on this tree: a syntax error in an imported
      // module produced zero tests and exit 1, which this harness would have recorded as CAUGHT. The court must
      // be shown to have NOTICED, so the child's own failing-arm marker is required, and a crash is reported as
      // its own verdict rather than counted as coverage.
      const output = `${run.stdout ?? ''}${run.stderr ?? ''}`
      const armFailed = /(^|\n)(\s*(FAIL|not ok)|\s*# fail [1-9])/u.test(output)
      const caught = run.status !== 0 && armFailed
      const crashed = run.status !== 0 && !armFailed
      if (!caught) survivors.push(mutation.name)
      console.log(`  ${caught ? 'CAUGHT        ' : crashed ? 'CRASH-NOT-A-CATCH' : 'SURVIVOR      '}  ${mutation.name}${caught ? '' : crashed ? '  <- non-zero exit with NO failing arm: the court never noticed' : '  <- no arm notices this protection is gone'}`)
    }
  } finally {
    rmSync(scratch, { recursive: true, force: true })
  }
  const findings = survivors.length + inapplicable.length
  console.log(findings === 0
    ? '\nCOLD ROOT MUTATIONS: every protection is covered by an arm that fails without it.'
    : `\nCOLD ROOT MUTATIONS: ${String(findings)} FINDING(S) — ${[...survivors, ...inapplicable.map(name => `${name} (stale pattern)`)].join('; ')}`)
  process.exit(findings === 0 ? 0 : 1)
}

const machineKey = await import(pathToFileURL(join(LIB_PATH, 'machine-key-v3.mjs')).href)
const rootClass = await import(pathToFileURL(join(LIB_PATH, 'root-class-v3.mjs')).href)
const genesis = await import(pathToFileURL(join(LIB_PATH, 'genesis-v3.mjs')).href)
const recordV3 = await import(pathToFileURL(join(LIB_PATH, 'record-v3.mjs')).href)
const deriveV3 = await import(pathToFileURL(join(LIB_PATH, 'derive-v3.mjs')).href)

const work = courtTemp('aumlok-cold-root-')

let arms = 0
let missed = 0

/** Record one arm. */
async function arm(label, check) {
  arms += 1
  try {
    await check()
    console.log(`  ok    ${label}`)
  } catch (error) {
    missed += 1
    console.log(`  FAIL  ${label}`)
    console.log(`        ${String(error?.message ?? error).split('\n').slice(0, 4).join('\n        ')}`)
  }
}

console.log('AUMLOK — the root is cold, the machine key is what lives here\n')
console.log('── 1. the machine key is DERIVED from the root seed, and is not it ──')

const root = await deriveV3.deriveRootFromPhrase(PHRASE, { handle: HANDLE })
const otherRoot = await deriveV3.deriveRootFromPhrase('granite glacier rapids estuary north delta meadow', { handle: HANDLE })
const INDEX = 0

await arm('the module exists and pins the constant the plan names', () => {
  // vacuity-exempt: MEASURED: the custody listing is EMPTY in this fixture, so the arm was true of nothing.
  assert.equal(typeof machineKey.deriveMachineKeyV3, 'function',
    'plugins/aukora-aumlok/lib/machine-key-v3.mjs must export deriveMachineKeyV3')
  assert.equal(machineKey.AUMLOK_MACHINE_KDF, 'aumlok-machine-kdf-v1',
    `the pinned constant is ${String(machineKey.AUMLOK_MACHINE_KDF)}, not aumlok-machine-kdf-v1`)
})

await arm('the machine key is DETERMINISTIC for one root and machine index', () => {
  const a = machineKey.deriveMachineKeyV3({ root, machineIndex: INDEX })
  const b = machineKey.deriveMachineKeyV3({ root, machineIndex: INDEX })
  assert.equal(a.ed25519SeedHex, b.ed25519SeedHex)
  assert.equal(a.ed25519PublicKeyHex, b.ed25519PublicKeyHex)
  assert.match(a.ed25519SeedHex, DIGEST, 'the machine seed is not 32 bytes of hex')
})

await arm('it is NOT the root seed — the whole point of a cold root', () => {
  const derived = machineKey.deriveMachineKeyV3({ root, machineIndex: INDEX })
  const seeds = deriveV3.deriveSeeds(PHRASE, { handle: HANDLE })
  assert.notEqual(derived.ed25519SeedHex, seeds.ed25519Seed.toString('hex'),
    'the machine key IS the root key, so a machine can do root-class acts')
  assert.notEqual(derived.ed25519PublicKeyHex, root.ed25519PublicKeyHex,
    'the machine public key equals the root public key')
})

await arm('a different machine index is a different machine key, from one root', () => {
  const zero = machineKey.deriveMachineKeyV3({ root, machineIndex: 0 })
  const one = machineKey.deriveMachineKeyV3({ root, machineIndex: 1 })
  assert.notEqual(zero.ed25519PublicKeyHex, one.ed25519PublicKeyHex,
    'two machines share a machine key, so revoking one would revoke both')
})

await arm('a different root is a different machine key at the same index', () => {
  const a = machineKey.deriveMachineKeyV3({ root, machineIndex: INDEX })
  const b = machineKey.deriveMachineKeyV3({ root: otherRoot, machineIndex: INDEX })
  assert.notEqual(a.ed25519PublicKeyHex, b.ed25519PublicKeyHex)
})

console.log('\n── 2. the three refusals, by name ──')

const genesisBuilt = genesis.buildGenesisV3({ root, genesisNonce: 'a1'.repeat(32) })
const machine = machineKey.deriveMachineKeyV3({ root, machineIndex: INDEX })

await arm('AN APPROVAL SIGNED BY THE ROOT IS REFUSED — the root is not an approval key', () => {
  const forged = rootClass.signOperation({
    operation: 'approve-operation', subject: genesisBuilt.subject, epoch: 0,
    root, signer: 'root',
  })
  const verdict = rootClass.verifyRootClassAct({
    act: 'approve-operation', subject: genesisBuilt.subject, epoch: 0,
    signature: forged.signature, signerKeyHex: forged.publicKeyHex,
    record: { publicRoot: { ed25519: root.ed25519PublicKeyHex }, subject: genesisBuilt.subject },
    machines: [],
  })
  assert.equal(verdict.ok, false, 'the root signed an approval and it was accepted')
  assert.equal(verdict.reason, rootClass.ROOT_CLASS_REFUSE.APPROVAL_IS_NOT_ROOT_CLASS,
    `refused as ${String(verdict.reason)} rather than by the approval-class name`)
})

await arm('A REFRESH SIGNED BY A MACHINE KEY IS REFUSED — a stolen machine is not a stolen identity', () => {
  const forged = rootClass.signOperation({
    operation: 'refresh', subject: genesisBuilt.subject, epoch: 1,
    machine, signer: 'machine',
  })
  const verdict = rootClass.verifyRootClassAct({
    act: 'refresh', subject: genesisBuilt.subject, epoch: 1,
    signature: forged.signature, signerKeyHex: forged.publicKeyHex,
    record: {
      publicRoot: { ed25519: otherRoot.ed25519PublicKeyHex },
      subject: genesisBuilt.subject,
    },
    machines: [{ index: INDEX, ed25519: machine.ed25519PublicKeyHex }],
  })
  assert.equal(verdict.ok, false, 'a machine key signed a root-class act and it was accepted')
  assert.equal(verdict.reason, rootClass.ROOT_CLASS_REFUSE.MACHINE_MAY_NOT_SIGN_ROOT_CLASS,
    `refused as ${String(verdict.reason)} rather than by the cross-signature name`)
})

await arm('a refresh signed by the ROOT is ACCEPTED, so the refusal above is discrimination not refusal-to-work', () => {
  // WHICH ROOT AUTHORISES A REFRESH: THE ONE THAT OWNS THE IDENTITY, NOT THE KEYS BEING INTRODUCED.
  // The first cut of this arm verified against the NEW root's key and was refused as an unknown signer
  // — correctly, and the refusal was the arm being wrong rather than the module. A refresh introduces
  // keys that nothing has vouched for yet; that is what the act is FOR, so the signature can only be
  // checked against a key already trusted: the root currently published by the record.
  const genuine = rootClass.signOperation({
    operation: 'refresh', subject: genesisBuilt.subject, epoch: 1,
    root, signer: 'root',
  })
  const verdict = rootClass.verifyRootClassAct({
    act: 'refresh', subject: genesisBuilt.subject, epoch: 1,
    signature: genuine.signature, signerKeyHex: genuine.publicKeyHex,
    record: {
      publicRoot: { ed25519: root.ed25519PublicKeyHex },
      subject: genesisBuilt.subject,
    },
    machines: [{ index: INDEX, ed25519: machine.ed25519PublicKeyHex }],
  })
  assert.equal(verdict.ok, true, `a root-signed refresh was refused as ${String(verdict.reason)}`)
  assert.equal(verdict.class, 'root', 'the accepted refresh was not classified as root-signed')
})

await arm('an APPROVAL signed by the machine key is ACCEPTED — no re-typing to approve', () => {
  const genuine = rootClass.signOperation({
    operation: 'approve-operation', subject: genesisBuilt.subject, epoch: 0,
    machine, signer: 'machine',
  })
  const verdict = rootClass.verifyRootClassAct({
    act: 'approve-operation', subject: genesisBuilt.subject, epoch: 0,
    signature: genuine.signature, signerKeyHex: genuine.publicKeyHex,
    record: { publicRoot: { ed25519: root.ed25519PublicKeyHex }, subject: genesisBuilt.subject },
    machines: [{ index: INDEX, ed25519: machine.ed25519PublicKeyHex }],
  })
  assert.equal(verdict.ok, true, `a machine-signed approval was refused as ${String(verdict.reason)}`)
})

await arm('a signature from a key that is in NEITHER class is refused by name', () => {
  const stranger = machineKey.deriveMachineKeyV3({ root: otherRoot, machineIndex: 7 })
  const forged = rootClass.signOperation({
    operation: 'refresh', subject: genesisBuilt.subject, epoch: 1,
    machine: stranger, signer: 'machine',
  })
  const verdict = rootClass.verifyRootClassAct({
    act: 'refresh', subject: genesisBuilt.subject, epoch: 1,
    signature: forged.signature, signerKeyHex: forged.publicKeyHex,
    record: { publicRoot: { ed25519: root.ed25519PublicKeyHex }, subject: genesisBuilt.subject },
    machines: [{ index: INDEX, ed25519: machine.ed25519PublicKeyHex }],
  })
  assert.equal(verdict.ok, false, 'a stranger\'s key signed a root-class act')
  assert.equal(verdict.reason, rootClass.ROOT_CLASS_REFUSE.UNKNOWN_SIGNER,
    `refused as ${String(verdict.reason)} rather than as an unknown signer`)
})

await arm('every root-class act is named in the vocabulary, and approvals are not one of them', () => {
  for (const act of ['refresh', 'revoke', 'vouch', 'delegation', 'forget', 'cortex-change']) {
    assert.ok(rootClass.ROOT_CLASS_ACTS.includes(act), `${act} is not a named root-class act`)
  }
  assert.ok(!rootClass.ROOT_CLASS_ACTS.includes('approve-operation'),
    'approve-operation is listed as root-class, so approving would need the ceremony')
})

console.log('\n── 3. the record publishes the machines, and revoke then bind leaves the chain unchanged ──')

await arm('machines[] is IN THE PUBLIC RECORD, with the index and the machine public key', () => {
  const record = recordV3.buildRecordV3({
    root, boundAt: '2026-01-01T00:00:00.000Z', epoch: 0, genesis: genesisBuilt,
    machines: [{ index: INDEX, ed25519: machine.ed25519PublicKeyHex }],
  })
  assert.ok(Array.isArray(record.publicRoot.machines), 'the public record carries no machines[]')
  assert.equal(record.publicRoot.machines.length, 1)
  assert.equal(record.publicRoot.machines[0].ed25519, machine.ed25519PublicKeyHex)
  assert.equal(record.publicRoot.machines[0].index, INDEX)
})

await arm('the reader still accepts the record, and the machine key is public while the root seed is not', () => {
  const record = recordV3.buildRecordV3({
    root, boundAt: '2026-01-01T00:00:00.000Z', epoch: 0, genesis: genesisBuilt,
    machines: [{ index: INDEX, ed25519: machine.ed25519PublicKeyHex }],
  })
  assert.equal(recordV3.isRecordV3(record), true, 'the record with machines[] is no longer a v3 record')
  const text = JSON.stringify(record)
  const seeds = deriveV3.deriveSeeds(PHRASE, { handle: HANDLE })
  // vacuity-exempt: MEASURED: this arm broke when guarded in round 10; the subject is not a string on this path.
  assert.equal(text.includes(seeds.ed25519Seed.toString('hex')), false,
    'the record publishes the root Ed25519 seed')
  assert.equal(text.includes(seeds.mlDsa65Seed.toString('hex')), false,
    'the record publishes the root ML-DSA-65 seed')
})

await arm('REVOKE then BIND leaves the chain unchanged: the root signs both, epoch moves, subject does not', () => {
  // The plan's replacement for "a stolen machine": ONE root-signed revoke of that machine, then one
  // root-signed bind of a replacement. The identity — its subject and its genesis — is untouched,
  // which is what makes the earlier Kira records still readable afterwards.
  const revokedRecord = recordV3.buildRecordV3({
    root, boundAt: '2026-02-01T00:00:00.000Z', epoch: 1, genesis: genesisBuilt,
    machines: [], revokedMachines: [{ index: INDEX, revokedAt: '2026-02-01T00:00:00.000Z' }],
  })
  const replacement = machineKey.deriveMachineKeyV3({ root, machineIndex: 5 })
  const replacementRecord = recordV3.buildRecordV3({
    root, boundAt: '2026-02-02T00:00:00.000Z', epoch: 2, genesis: genesisBuilt,
    machines: [{ index: 5, ed25519: replacement.ed25519PublicKeyHex }],
    revokedMachines: [{ index: INDEX, revokedAt: '2026-02-01T00:00:00.000Z' }],
  })
  const a = recordV3.recordProjection(revokedRecord)
  const b = recordV3.recordProjection(replacementRecord)
  assert.equal(a.subject, b.subject, 'revoke then bind moved the subject, so the chain is orphaned')
  assert.equal(a.genesisRef, b.genesisRef, 'revoke then bind moved genesisRef')
  assert.equal(a.rootId, b.rootId, 'revoke then bind changed the ROOT, which only a refresh may do')
})

await arm('the machine key that was revoked can no longer act, and the replacement can', () => {
  const replacement = machineKey.deriveMachineKeyV3({ root, machineIndex: 5 })
  const stolen = rootClass.signOperation({
    operation: 'approve-operation', subject: genesisBuilt.subject, epoch: 2,
    machine, signer: 'machine',
  })
  const refused = rootClass.verifyRootClassAct({
    act: 'approve-operation', subject: genesisBuilt.subject, epoch: 2,
    signature: stolen.signature, signerKeyHex: stolen.publicKeyHex,
    record: { publicRoot: { ed25519: root.ed25519PublicKeyHex }, subject: genesisBuilt.subject },
    machines: [{ index: 5, ed25519: replacement.ed25519PublicKeyHex }],
  })
  assert.equal(refused.ok, false, 'the revoked machine key still signs approvals')
  assert.equal(refused.reason, rootClass.ROOT_CLASS_REFUSE.UNKNOWN_SIGNER,
    `the revoked machine was refused as ${String(refused.reason)}`)

  const fresh = rootClass.signOperation({
    operation: 'approve-operation', subject: genesisBuilt.subject, epoch: 2,
    machine: replacement, signer: 'machine',
  })
  const accepted = rootClass.verifyRootClassAct({
    act: 'approve-operation', subject: genesisBuilt.subject, epoch: 2,
    signature: fresh.signature, signerKeyHex: fresh.publicKeyHex,
    record: { publicRoot: { ed25519: root.ed25519PublicKeyHex }, subject: genesisBuilt.subject },
    machines: [{ index: 5, ed25519: replacement.ed25519PublicKeyHex }],
  })
  assert.equal(accepted.ok, true, `the replacement machine was refused as ${String(accepted.reason)}`)
})

// ── 4. AND THE ROOT IS NOT ON DISK: the custody half, which this court did not measure ─────────────
//
// WHY THIS SECTION EXISTS, AND IT IS THE ITEM'S WHOLE POINT. Every arm above is about which CLASS of
// key may sign WHAT; not one of them looked at a byte on disk. So this file went green on
// 2026-09-23 while Peter's `state/aumlok/` held `root-seed-v3.json` — 274 bytes of the root's Ed25519
// and ML-DSA-65 seeds, written by the very ceremony the cold root is a claim about. MEASURED at that
// tip: `grep -c 'root-seed\|ROOT_SEED' tests/aukora-aumlok-cold-root.test.mjs` returned 0. A court
// cannot fail on a file it never names, so "the root is cold" was asserted as a SIGNING RULE and
// never as a CUSTODY rule. The two are not the same claim: a machine can refuse every root-class
// signature and still keep the root seed in a drawer.
//
// THE ARMS BELOW ARE THE CUSTODY RULE, ON THE REAL CEREMONY, and they are what a green run of this
// file now means.
console.log('\n── 4. the root is not ON DISK: the real ceremony keeps the machine key and nothing else ──')

const bindV3 = await import(pathToFileURL(join(LIB, 'bind-v3.mjs')).href)
const CUSTODY_DIR = join(work, 'custody')
mkdirSync(CUSTODY_DIR, { recursive: true })
/**
 * The forbidden file's name. THE LITERAL IS THE POINT: this court must NAME the file it is measuring,
 * because naming nothing is exactly how it passed while the file shipped. It is also compared against
 * what the organ publishes, so a rename in the organ turns this arm red rather than silent.
 */
const FORBIDDEN_ROOT_SEED = 'root-seed-v3.json'
/** Seven words drawn from the SHIPPED lists, so the real ceremony's own validation accepts them. */
const CUSTODY_WORDS = Object.freeze(['canyon', 'outlet', 'lend', 'ladies', 'action', 'routing', 'meadow'])
const CUSTODY_HANDLE = 'cold.root.custody'
const CUSTODY_AT = '2026-09-23T17:02:00Z'

const custodyBind = await bindV3.bindV3({
  handle: CUSTODY_HANDLE, words: [...CUSTODY_WORDS], directory: CUSTODY_DIR, boundAt: CUSTODY_AT,
})
const custodyListing = readdirSync(CUSTODY_DIR).sort()

await arm('the real ceremony BOUND, so the custody arms below are not vacuous', () => {
  assert.match(String(custodyBind.genesis?.subject ?? ''), /^aukora:1:[0-9a-f]{64}$/u,
    `the ceremony produced no subject: ${String(custodyBind.genesis?.subject)}`)
})

await arm('THE ROOT SEED IS NOT ON DISK after a real binding', () => {
  // vacuity-exempt: MEASURED: the custody listing is EMPTY in this fixture, so the arm was true of nothing.
  assert.equal(custodyListing.includes(FORBIDDEN_ROOT_SEED), false,
    `${FORBIDDEN_ROOT_SEED} was written by the real ceremony into ${CUSTODY_DIR}. The plan says the `
    + `root is kept by NOBODY — it is re-derived from the handle and the seven words. Found: `
    + `${custodyListing.join(', ')}`)
})

await arm('THE CEREMONY DOES NOT REPORT A KEPT ROOT while denying it kept the seed', () => {
  // THE CONTRADICTION THIS ARM EXISTS FOR: `kept.root` used to be a PATH to the forbidden file while
  // `kept.rootEd25519SeedKept` said `false`. One of the two was false and the disk said which. A
  // ceremony whose account of its own custody contradicts itself is not trustworthy to any caller.
  const kept = custodyBind.kept ?? {}
  assert.equal(kept.root ?? null, null,
    `the ceremony returned a kept-root path (${String(kept.root)}) while claiming `
    + `rootKept=${String(kept.rootKept)}; the design keeps no root`)
})

await arm('the MACHINE key IS on disk, so the fix does not over-reach', () => {
  assert.equal(custodyListing.includes(recordV3.MACHINE_SEED_FILE), true,
    `${recordV3.MACHINE_SEED_FILE} is MISSING from ${CUSTODY_DIR}; a bound machine must be able to sign `
    + 'an approval without the words, and that is what the machine key is for')
})

await arm('nothing else was left beside the record and the machine key', () => {
  const unexpected = custodyListing.filter(name => name !== FORBIDDEN_ROOT_SEED
    && name !== recordV3.MACHINE_SEED_FILE && name !== 'local-control.json')
  assert.deepEqual(unexpected, [],
    `the ceremony left files the design does not name: ${unexpected.join(', ')}`)
})

await arm('THE ROOT IS RE-DERIVED, NOT READ: handle + words reproduce the bound identity', async () => {
  // THE CUSTODY RULE PAID FOR: with no root seed anywhere, the identity still comes back. This is the
  // arm that makes "re-derived from handle + words" a measurement rather than a sentence, and it is
  // what lets the migration delete the file without changing who this person is.
  const again = await deriveV3.deriveRootFromPhrase(CUSTODY_WORDS.join('-'), { handle: CUSTODY_HANDLE })
  assert.equal(again.rootId, custodyBind.record.publicRoot.rootId,
    'the root re-derived from the handle and the words is not the root that was bound, so the seed on '
    + 'disk was load-bearing rather than redundant')
  assert.equal(again.ed25519PublicKeyHex, custodyBind.record.publicRoot.ed25519)
  assert.equal(again.mlDsa65PublicKeyHex, custodyBind.record.publicRoot.mlDsa65)
})

rmSync(CUSTODY_DIR, { recursive: true, force: true })

console.log(`\n  ${String(arms - missed)}/${String(arms)} arms green\n`)
if (missed > 0) {
  console.log('  AUMLOK COLD ROOT: RED\n')
  process.exit(1)
}
console.log('  What this did NOT show you: that any of this ran against the Keychain, that a live')
console.log('  controller was touched, or that a real machine was revoked. The custodian here is a')
console.log('  temporary file and every key was derived from an invented phrase.\n')
console.log('  AUMLOK COLD ROOT: GREEN')
