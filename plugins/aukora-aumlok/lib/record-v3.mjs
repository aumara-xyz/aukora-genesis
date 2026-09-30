/**
 * AUMLOK v3 — the public record, and the machine key this machine keeps.
 *
 * WHAT IS PUBLIC, AND NOTHING ELSE: rootId, both public keys, boundAt, genesisRef, epoch, receipt,
 * and the hook the succession chain hangs from. The record carries public facts only: the seven words
 * are the key, they are never written here, and they derive the same root on any machine.
 *
 * WHAT THIS MACHINE KEEPS: THE MACHINE KEY, AND THE ROOT IS KEPT NOWHERE (Y1, 2026-09-23). This module
 * used to write a second file, `root-seed-v3.json`, holding the root's ed25519 and ML-DSA seeds —
 * `keepRootSeed` here, called from `bind-v3.mjs` and `refresh-v3.mjs`. That file was on Peter's disk
 * after his 17:02 bind, and it was a second copy of the one thing the cold-root design says is
 * re-derived from handle + words and written by nobody. The writer and its reader are gone; a
 * root-class act re-derives the root from the handle and the seven words and asks for them.
 *
 * WHAT THE MACHINE KEY IS FOR: approvals sign day to day without re-typing the words, and an HKDF of
 * the root seed cannot re-key the identity or revoke anything. macOS Keychain for this user where the
 * deployment asks for it, otherwise a 0600 file. The same-UID ceiling is printed on the screen (plan
 * §6) — a file this user can read is a file anything running as this user can read, and saying so is
 * part of the design rather than a footnote.
 *
 * THE PHRASE IS NEVER WRITTEN HERE. Not to the record, not beside the machine key, not to a log; a
 * court scans every byte this module writes and fails if a single word of it appears.
 */
// ── THE STRICT READER IS A SIBLING, AND THAT IS A PACKAGING RULE AND NOT A STYLE ONE (AUMLOK-100) ──
//
// **MEASURED: THIS WAS `../../aukora-kira/lib/strict-read.mjs`, AND IT BROKE TWO THINGS.** The court's arm
// directly below reads *"every module in lib/ imports only node: builtins or its own siblings"* and sits
// immediately above *"the package declares no dependencies at all"* — **the rule is about this plugin
// SHIPPING ALONE, not about tidiness.** A `../` specifier means `aukora-aumlok` cannot be installed without
// a sibling checkout, which is exactly what the no-dependencies arm refuses.
//
// **AND IT BROKE THE MUTATION COPIES.** The court copies `lib/` into a disposable directory and imports
// from the copy, so a import that climbs OUT of `lib/` resolves against the COPY's location — in CI that
// was `/home/runner/aukora-kira/lib/strict-read.mjs`, which does not exist, and five mutation arms failed
// on a missing module rather than on the invariant they were breaking.
//
// **THE COPY IS VENDORED, AND AN ARM KEEPS IT HONEST.** `strict-read.mjs` imports only `node:fs` and
// `node:crypto`, so it is genuinely self-contained. Two copies of a security reader can drift, and the
// weaker one wins silently — so the court asserts the vendored copy is BYTE-IDENTICAL to KIRA's, and a
// divergence goes red rather than being discovered as behaviour.
import { readJsonStrictBytes } from './strict-read.mjs'
import { execFileSync } from 'node:child_process'
import { chmodSync, closeSync, existsSync, fchmodSync, fstatSync, lstatSync, mkdirSync, openSync, readFileSync,
  unlinkSync, writeFileSync, writeSync } from 'node:fs'
import { join } from 'node:path'

import { assertHandle, deriveGenesisRef } from './derive-v3.mjs'
// THE SUBJECT DERIVATION IS THE PORTED ONE, not a second hash of the same idea: a record whose
// projection hashed its genesis differently from `genesis.mjs` would name an identity that Deep's own
// reader does not.
import { aukoraIdFromGenesis } from './genesis.mjs'
// THE ONE CUSTODY CLASS AND THE ONE PROJECTION DOMAIN ARE IMPORTED, NOT RESPELLED. A second spelling
// of either is a second vocabulary for one fact, and `projection.mjs` is the module that defines both.
// This import adds no cycle: `projection.mjs` reaches genesis, control, canonical, did-key and
// validation, and none of those reaches this file.
import { LOCAL_AUMLOK_CUSTODY_CLASS, PUBLIC_CONTROL_DOMAIN } from './projection.mjs'
import { didKeyFromEd25519PublicKey, ed25519PublicKeyFromDidKey } from './did-key.mjs'
// THE FILENAME COMES FROM ITS READER, not from a second spelling here.
import { LOCAL_AUMLOK_CONTROL_FILENAME } from './store.mjs'
import { printPresenceCeiling } from './ceilings.mjs'

/**
 * The mode every custody file this module writes is given: the record and the machine key, both 0600.
 *
 * THIS CONSTANT IS STILL 0600 AND ITS NAME IS STILL HONEST. It was `ROOT_SEED_FILE_MODE` while a root
 * seed file was one of the things written with it; that file's writer is deleted, the two writers that
 * remain are `writeRecordV3` and `keepMachineSeed`, and the name follows them rather than a file that
 * no longer exists. A reader looking for the mode of the record or the machine key now finds it.
 */
export const CUSTODY_FILE_MODE = 0o600
/** The machine key's own file, kept beside the record. 0600, like everything custody here. */
export const MACHINE_SEED_FILE = 'machine-seed-v3.json'
/**
 * The Keychain item the MACHINE key goes into.
 *
 * THERE WAS A SECOND SERVICE BESIDE THIS ONE (`aukora-aumlok-root-v3`) for the root seed's Keychain
 * custodian. It is deleted with the file custodian's writer: nothing may ask a person's keychain for a
 * root seed that the design says is re-derived rather than stored.
 */
export const MACHINE_KEYCHAIN_SERVICE = 'aukora-aumlok-machine-v3'

/** Where a caller's custodian choice lands when it is not named: the file, never the Keychain. */
export const DEFAULT_CUSTODIAN = 'file'

export class RootCustodyError extends Error {}

/** A machine the record has RETIRED. Its own word, so a caller can tell it from a record naming nobody. */
export const MACHINE_REVOKED_REFUSAL = 'aumlok:machine-revoked'
/** A revocation list this reader could not read. NOT the same fact as an empty one. */
export const MACHINE_REVOCATION_MALFORMED_REFUSAL = 'aumlok:machine-revocation-malformed'

/** True when this machine has the macOS keychain tool this deployment would use. */
export function keychainAvailable() {
  return process.platform === 'darwin' && existsSync('/usr/bin/security')
}

function keychainAccount() {
  return process.env['USER'] ?? 'unknown'
}

/**
 * The public record. `receipt` is present-but-null until a binding produces one, so the shape a
 * reader sees never changes between an unbound and a bound root.
 *
 * THE SUBJECT COMES FROM THE GENESIS WHEN ONE IS GIVEN, AND THAT IS THE POINT OF THE PARAMETER. A
 * record built from a v3 genesis carries that genesis's subject and reference — the epoch-0 identity —
 * rather than a subject recomputed from the keys in play. A refresh passes the SAME genesis with a
 * different root, and this function writes a record whose keys moved and whose subject did not, which
 * is the only way "the Kira chain follows the identity" can be true. Without a genesis the v2-era
 * behaviour stands (`subject` from the current rootId, `genesisRef` from rootId and boundAt) so the
 * existing courts and fixtures keep measuring what they were written to measure.
 *
 * `machines[]` AND `revokedMachines[]` ARE PUBLIC ON PURPOSE. A verifier must be able to decide
 * whether the key that signed something is a machine of this identity WITHOUT trusting the machine
 * that presents the signature — so the list of machines, and the list of machines that were revoked,
 * are part of what the identity publishes.
 *
 * `succession[]` IS THE CHAIN, AND IT WAS BEING DROPPED HERE. A refresh publishes one handover line
 * per epoch so a witness can walk from the root the genesis names to the root the record currently
 * publishes. Until this parameter existed, `buildRecordV3` accepted the field and silently discarded
 * it: `aukora-aumlok-refresh.test.mjs` arm 1 measured `publicRoot carries no succession[] array`, so
 * a refresh could have moved the keys with nothing on disk recording what it moved from. It is
 * carried the same way the machine lists are — only when a caller supplies it — and the lines are
 * copied into fresh frozen objects so a caller cannot mutate the chain after it is published.
 *
 * `handle` IS PUBLIC AND IS CARRIED THE SAME WAY (X8, Peter 2026-09-23 15:25). The handle salts the
 * key, and it is not a secret: it is published here because it is what a NIP-05 `name@domain` local
 * part is read from, and because a person recovering on a new machine has to know which handle their
 * words belong to. Uniqueness is a question for discovery and is deliberately NOT enforced anywhere —
 * a bind that consulted a registry would be a bind that could be denied. A record built without one
 * (the disposable fixtures, whose roots were never derived from a person's handle) keeps the shape its
 * court was written against, exactly as a pre-machine fixture does.
 * @param {object} input - the root, the moment, the epoch, the receipt, and optionally the genesis
 *   plus the machine lists, the succession chain and the public handle.
 * @returns {Readonly<object>} the v3 record.
 */
export function buildRecordV3({ root, boundAt, epoch = 0, receipt = null, genesisRef, genesis,
  machines, revokedMachines, succession, handle } = /** @type {never} */ ({})) {
  if (typeof root?.rootId !== 'string' || !/^[0-9a-f]{64}$/u.test(root.rootId)) {
    throw new RootCustodyError('buildRecordV3 needs a root with a 64-hex rootId')
  }
  const ref = genesisRef ?? genesis?.genesisRef ?? deriveGenesisRef({ rootId: root.rootId, boundAt })
  return Object.freeze({
    version: 3,
    publicRoot: Object.freeze({
      rootId: root.rootId,
      ed25519: root.ed25519PublicKeyHex,
      mlDsa65: root.mlDsa65PublicKeyHex,
      boundAt,
      genesisRef: ref,
      epoch,
      receipt,
      // THE HANDLE, WHEN THERE IS ONE, IN THE NORMALISED FORM THAT WAS HASHED. A handle that reached
      // here malformed would be a record whose published name is not the one its salt used, so the
      // shape is enforced rather than trusted.
      ...(handle === undefined ? {} : { handle: assertHandle(handle) }),
      // THE MACHINE LISTS APPEAR WHEN A CALLER SUPPLIES THEM, AND NOT OTHERWISE. A record written by
      // the ceremony always carries both, because the ceremony always derives machine 0 and passes it.
      // A pre-machine fixture that passes neither keeps the SEVEN-field shape those fixtures and their
      // courts were written against — MEASURED, this is what the derivation court's closed-set arm
      // asserts, and an always-present pair of empty lists broke it. What may never happen is a
      // PRIVATE field appearing here: the arm still holds this object to a closed set either way.
      ...(machines === undefined ? {} : {
        machines: Object.freeze(machines.map(entry => Object.freeze({ ...entry }))),
      }),
      ...(revokedMachines === undefined ? {} : {
        revokedMachines: Object.freeze(revokedMachines.map(entry => Object.freeze({ ...entry }))),
      }),
      // THE CHAIN, COPIED OUT OF THE CALLER'S HANDS for the same reason the machine lists are: a
      // record that published a reference to an array its caller still held could have its history
      // edited after the fact, and a history that can be edited is not a chain.
      ...(succession === undefined ? {} : {
        succession: Object.freeze(succession.map(line => Object.freeze({ ...line }))),
      }),
      ...(genesis === undefined ? {} : { genesis: genesis.genesis, genesisNonce: genesis.genesisNonce }),
    }),
  })
}

/**
 * Write one v3 record where its own reader looks for it, in the form that reader accepts.
 *
 * WHY THIS LIVES HERE AND NOT IN A SCRIPT. The format has ONE author or it has a disagreement: the
 * loader in `store.mjs` refuses a record it cannot parse, and a second writer under `scripts/` would
 * be a second opinion about the bytes whose reader is the gate. A one-field disagreement there does
 * not fail loudly — it prints success while the app reads nothing — so the writer that produces the
 * bytes sits beside the builder that shapes them.
 *
 * THE THREE THINGS THE READER MEASURES, AND THIS FUNCTION SATISFIES ALL THREE: the file is mode
 * 0600 (the same-uid-posix-mode-only custody class), it is ONE line terminated by exactly one
 * newline (`store.mjs` refuses a record whose body contains a newline, or whose last byte is not
 * one), and it is under that reader's 32 KiB bound. Encoding is written as UTF-8 without a BOM: a
 * JSON.parse of the raw text is what the reader does, and a BOM would fail it.
 *
 * THE MODE IS SET, NOT REQUESTED. `writeFileSync`'s mode is masked by the umask on creation, so a
 * process running under a 0077 umask would otherwise create this file at 0600 only by luck and at
 * 0600-or-tighter in general — which is why the mode is asserted afterwards rather than assumed.
 * @param {object} input - the record and where it goes.
 * @param {unknown} input.record - a record from {@link buildRecordV3}.
 * @param {string} input.directory - the controller directory the composition declares.
 * @param {boolean} [input.exclusive] - first binding creates a record without replacing any existing entry.
 * @returns {{path: string, bytes: number, created?: {dev: number, ino: number}}} the write and its rollback identity.
 */
export function writeRecordV3({ record, directory, exclusive = false } = /** @type {never} */ ({})) {
  if (typeof directory !== 'string' || directory.length === 0) {
    throw new RootCustodyError('writeRecordV3 needs a directory to write into')
  }
  if (typeof record !== 'object' || record === null) {
    throw new RootCustodyError('writeRecordV3 needs a record object')
  }
  const bytes = Buffer.from(`${JSON.stringify(record)}\n`, 'utf8')
  // THE READER'S OWN BOUND, CHECKED HERE SO A RECORD THAT COULD NEVER BE READ IS NEVER WRITTEN.
  if (bytes.length > 32 * 1024) {
    throw new RootCustodyError(`writeRecordV3 refused a record of ${String(bytes.length)} bytes; the `
      + 'reader refuses anything over 32 KiB, so writing it would put an unreadable file on disk')
  }
  mkdirSync(directory, { recursive: true, mode: 0o700 })
  chmodSync(directory, 0o700)
  const path = join(directory, LOCAL_AUMLOK_CONTROL_FILENAME)
  if (exclusive) {
    return { path, bytes: bytes.length, created: writeExclusiveCustody(path, bytes) }
  }
  writeFileSync(path, bytes, { mode: CUSTODY_FILE_MODE })
  chmodSync(path, CUSTODY_FILE_MODE)
  return { path, bytes: bytes.length }
}

/** First binding owns only files it creates, including the machine seed. */
function writeExclusiveCustody(path, bytes) {
  const descriptor = openSync(path, 'wx', CUSTODY_FILE_MODE)
  let created
  try {
    created = fstatSync(descriptor)
    fchmodSync(descriptor, CUSTODY_FILE_MODE)
    for (let done = 0; done < bytes.length;) {
      const count = writeSync(descriptor, bytes, done, bytes.length - done)
      if (count === 0) throw new Error('custody write made no progress')
      done += count
    }
  } catch (cause) {
    if (created !== undefined) removeIfCreated(path, created)
    throw cause
  } finally {
    closeSync(descriptor)
  }
  return { dev: created.dev, ino: created.ino }
}

/** Roll back only the regular file this exclusive write created. */
export function removeIfCreated(path, created) {
  try {
    const now = lstatSync(path)
    if (!now.isFile() || now.dev !== created?.dev || now.ino !== created?.ino) return false
    unlinkSync(path)
    return true
  } catch {
    return false
  }
}

/**
 * Keep one machine's key where this machine can find it, and NOT the root seed it came from.
 *
 * THE MACHINE KEY IS THE THING THAT LIVES ON A LAPTOP. It is an HKDF of the root seed, so it can sign
 * approvals, and it CANNOT derive the root, re-key the identity or revoke anything — which is what
 * makes "a stolen machine = one root-signed revoke and one bind" true rather than aspirational. The
 * custodian defaults to the file so a court can keep a disposable machine key without writing to a
 * person's login keychain.
 *
 * IT IS THE ONLY SEED THIS MODULE WRITES. `keepRootSeed` stood beside it and wrote the root's own
 * ed25519 and ML-DSA seeds into the same directory; Y1 deleted the writer and its reader, so there is
 * no longer a root-seed file for anything to find in a controller directory.
 *
 * WHAT IT WRITES IS THE MACHINE SEED AND ITS INDEX. The index is kept because a record lists machines
 * by index, so a machine that forgot its own index could not tell which entry is it.
 * @param {{machineIndex: number, ed25519SeedHex: string, ed25519PublicKeyHex: string}} machine - from
 *   `deriveMachineKeyV3`.
 * @param {{directory: string, custodian?: 'file'|'keychain', exclusive?: boolean}} options - where to keep it.
 * @returns {{custodian: string, path: string, phraseStored: false}} what was kept and where.
 */
export function keepMachineSeed(machine, options = {}) {
  const directory = options.directory
  if (typeof directory !== 'string' || directory.length === 0) {
    throw new RootCustodyError('keepMachineSeed needs a directory to keep the key in')
  }
  if (typeof machine?.ed25519SeedHex !== 'string' || !/^[0-9a-f]{64}$/u.test(machine.ed25519SeedHex)) {
    throw new RootCustodyError('keepMachineSeed needs a derived machine key, not a seed of unknown shape')
  }
  const custodian = options.custodian ?? DEFAULT_CUSTODIAN
  const payload = JSON.stringify({
    version: 3,
    machineIndex: machine.machineIndex,
    ed25519SeedHex: machine.ed25519SeedHex,
    ed25519PublicKeyHex: machine.ed25519PublicKeyHex,
    kdf: 'aumlok-machine-kdf-v1',
  }, null, 2)
  if (custodian === 'keychain') {
    if (!keychainAvailable()) {
      throw new RootCustodyError('the keychain custodian was asked for on a machine that has none')
    }
    try {
      execFileSync('/usr/bin/security',
        ['add-generic-password', ...(options.exclusive === true ? [] : ['-U']),
          '-a', keychainAccount(), '-s', MACHINE_KEYCHAIN_SERVICE, '-w', payload],
        { stdio: 'ignore' })
    } catch {
      // execFileSync's message includes argv, including the private seed in -w.
      throw new RootCustodyError('machine keychain write failed')
    }
    return { custodian, path: `keychain:${MACHINE_KEYCHAIN_SERVICE}`, phraseStored: false }
  }
  if (custodian !== 'file') throw new RootCustodyError(`unknown custodian ${String(custodian)}`)
  mkdirSync(directory, { recursive: true, mode: 0o700 })
  const path = join(directory, MACHINE_SEED_FILE)
  if (options.exclusive === true) writeExclusiveCustody(path, Buffer.from(payload, 'utf8'))
  else {
    writeFileSync(path, payload, { mode: CUSTODY_FILE_MODE })
    chmodSync(path, CUSTODY_FILE_MODE)
  }
  return { custodian, path, phraseStored: false }
}

/** Read back the machine key this machine kept, or throw if there is none. */
export function readKeptMachineSeed(options = {}) {
  // **THE CEILING, AT THE MOMENT THE SEED IS READ (AUMLOK-115, SECURITY).** This function is where a machine
  // seed stops being a secret and becomes an array of bytes in this process — and NEITHER custodian asks a
  // person for anything. MEASURED: the file custodian (the DEFAULT) is a plain 0600 read, and the keychain
  // item is created without `-T`, so a different process read it with no prompt.
  printPresenceCeiling()

  const custodian = options.custodian ?? DEFAULT_CUSTODIAN
  let parsed
  if (custodian === 'keychain') {
    if (!keychainAvailable()) {
      throw new RootCustodyError('the keychain custodian was asked for on a machine that has none')
    }
    // **THE KEYCHAIN IS NOT A FILE, SO THE FILE CHECKS DO NOT APPLY TO IT.** `security` answers on stdout:
    // there is no path to follow, no descriptor to pin and no mode to read. The parse is still strict about
    // the VALUE below, because a seed that is not a seed is refused wherever it came from.
    const text = execFileSync('/usr/bin/security',
      ['find-generic-password', '-a', keychainAccount(), '-s', MACHINE_KEYCHAIN_SERVICE, '-w'],
      { encoding: 'utf8' })
    parsed = JSON.parse(text)
  } else {
    // **THE WHOLE STRICT READER, NOT ONE OF ITS HELPERS (AUMLOK-94, VULNERABILITY 14).** MEASURED: this
    // shipped `assertNoDuplicateKeys` alone, so the seed was still read with a plain `readFileSync` —
    // **following a symlink, with no regular-file check and no `O_NONBLOCK`**, which is the `map` entry's own
    // words: *"Aumlok config reads follow symlinks."* `readJsonStrictBytes` is the single open the helpers
    // are built on: `O_NOFOLLOW`, `O_NONBLOCK`, `fstat` THE DESCRIPTOR, read from that fd, a depth bound, a
    // fatal decode, and the duplicate scan.
    ;({ value: parsed } = readJsonStrictBytes(join(options.directory, MACHINE_SEED_FILE),
      { label: MACHINE_SEED_FILE }))
  }
  return Object.freeze({
    machineIndex: parsed.machineIndex,
    ed25519SeedHex: parsed.ed25519SeedHex,
    ed25519PublicKeyHex: parsed.ed25519PublicKeyHex,
  })
}

/**
 * WHETHER A PARSED VALUE IS A v3 RECORD, and the projection the rest of the organ reads.
 *
 * These replace `isOwnerRecordV2`/`ownerRecordProjection` from the deleted v2 reader. The subject is
 * the same grammar the Kira overlay pins — `aukora:1:<rootId>` — because identity did not change when
 * the custody model did: only how the root is obtained (derived from the handle and the words).
 *
 * A HANDLE, WHEN THE RECORD CARRIES ONE, MUST BE ONE: a record whose published handle is not the shape
 * the salt hashed is a record nobody can rediscover on a new machine, and it is refused as malformed
 * rather than read as a name. A record WITHOUT one is still a v3 record — the disposable fixtures
 * derive from a seed rather than from a person's handle, and a reader that refused them would refuse
 * every fixture the cold-root and generator courts are built on. What the ceremony writes always
 * carries one, and `tests/aukora-aumlok-handle.test.mjs` holds the ceremony's own bytes to that.
 */
export function isRecordV3(record) {
  if (!(record !== null && typeof record === 'object' && record.version === 3
    && typeof record.publicRoot?.rootId === 'string' && /^[0-9a-f]{64}$/u.test(record.publicRoot.rootId))) {
    return false
  }
  if (record.publicRoot.handle === undefined) return true
  try {
    assertHandle(record.publicRoot.handle)
    return true
  } catch {
    return false
  }
}

/**
 * The public view of a v3 record: the subject, and every public field, and nothing else.
 *
 * THIS IS THE RECORD'S VIEW, AND IT CARRIES NO CONTROL FIELDS. `activeControlDigest` and
 * `approvalKeyDid` belong to {@link projectRecordV3Control}, which is the projection a caller pins an
 * identity or names an approver with. Keeping the two field sets DISJOINT is what lets a reader tell
 * which value it holds by asking one predicate, instead of by the order of two `if`s — and the face's
 * parser is exactly such a reader, with a closed set for each shape and a refusal for anything else.
 * MEASURED while this lane was built: putting `activeControlDigest` on this projection as well made both
 * predicates match one value, and the face refused the control shape it was supposed to accept.
 *
 * THE APPROVAL KEY IS STILL NAMED, BY THE CONTROL PROJECTION, FROM THE SAME FUNCTION. What was wrong
 * before this change was not that this view lacked the key — it is that NOTHING a screen read had it,
 * so the screen derived one from `publicRoot.ed25519`, which is the ROOT. {@link projectRecordV3Control}
 * names the machine, and the loader a screen calls answers with it.
 * @param {unknown} record - a v3 record.
 * @returns {Readonly<Record<string, unknown>>} the public projection.
 */
export function recordProjection(record) {
  if (!isRecordV3(record)) {
    throw new RootCustodyError('recordProjection needs a v3 record')
  }
  const root = record.publicRoot
  // THE SUBJECT IS THE GENESIS WHEN THE RECORD CARRIES ONE, which every record written by a v3
  // ceremony does. `aukoraIdFromGenesis` re-derives it from the committed bytes rather than reading a
  // string the record asserts about itself, so a record whose stored subject disagreed with its own
  // genesis could not be projected at all. A pre-genesis record still projects `aukora:1:<rootId>`,
  // which is what the existing fixtures and courts expect.
  const subject = root.genesis === undefined
    ? `aukora:1:${root.rootId}`
    : aukoraIdFromGenesis(root.genesis)
  return Object.freeze({
    subject,
    rootId: root.rootId,
    ed25519: root.ed25519,
    mlDsa65: root.mlDsa65,
    boundAt: root.boundAt,
    genesisRef: root.genesisRef,
    epoch: root.epoch,
    receipt: root.receipt,
    // THE PUBLIC HANDLE, WHEN THE RECORD CARRIES ONE, and no key at all when it does not: a
    // handle-less record projects exactly the shape its courts already read.
    ...(root.handle === undefined ? {} : { handle: root.handle }),
  })
}

/**
 * The approval key a v3 record's own bytes name, or `null` when they do not settle it.
 *
 * THE MACHINE IS WHAT SIGNS, AND THE RECORD IS WHERE THE MACHINE IS LISTED. Y1 deleted the root seed
 * (there is no root-class key on a laptop to approve with), `root-class-v3.mjs` refuses a root-class
 * act signed by a machine key, and `scripts/aumlok/bind-overlay.mjs` derives the deployment's pinned
 * `approverDid` from `machines[]` for exactly this reason. So the approval key of a v3 identity is one
 * of its MACHINES, and never `publicRoot.ed25519`.
 *
 * ONE MACHINE SETTLES IT; TWO DO NOT. With a single `machines[]` entry the record says which key
 * approves and nothing needs reading; with several it does not, because which one holds the seed is a
 * fact about THIS laptop rather than about the record — `readKeptMachineSeed` answers it, and
 * {@link projectRecordV3Control} is the function that takes that answer. Guessing the first entry
 * would name another machine's key as this one's approver, which is the failure this lane exists to
 * close rather than to re-commit in a new place.
 *
 * A RECORD WITH NO `machines[]` AT ALL IS NOT A BOUND MACHINE. The disposable pre-machine fixtures
 * carry none and are read through `recordProjection` by courts that never sign anything, so this
 * answers `null` and they keep projecting the shape they were written against.
 * @param {unknown} record - a v3 record.
 * @returns {string|null} the `did:key` of the one listed machine, or null when the record does not say.
 */
export function approvalKeyDidOfRecordV3(record) {
  const machines = record?.publicRoot?.machines
  if (!Array.isArray(machines) || machines.length !== 1) return null
  const key = machines[0]?.ed25519
  if (typeof key !== 'string' || !/^[0-9a-f]{64}$/u.test(key)) return null
  // A REVOKED MACHINE IS NEVER AN APPROVER, AND IT IS REFUSED BY NAME RATHER THAN ANSWERED WITH `null`.
  // MEASURED BEFORE THIS LINE EXISTED: this function read `machines[]` and never looked at
  // `revokedMachines`, so a record that listed a machine and then revoked it STILL settled on that
  // machine, and a retired key would keep approving. "This key was retired" and "this record names
  // nobody" are different facts, so a silent `null` would hide the first behind the second and a caller
  // could report neither. The check lives HERE, in the selector every approver is chosen through, so a
  // verifier that calls it — Beta's `verifySasConfirmation` is being repointed to — inherits it rather
  // than each consumer having to remember.
  const revoked = revokedMachinesOf(record)
  if (revoked.has(key)) {
    throw new RootCustodyError(
      `${MACHINE_REVOKED_REFUSAL}: the one machine this record lists (${key.slice(0, 16)}…) is named in its `
      + 'own `revokedMachines[]`, so the identity has retired it and it may not approve anything. This is '
      + 'not a record with no approver: it is a record whose approver was retired, and the difference is '
      + 'the whole point of keeping the revocation list.',
    )
  }
  return didKeyFromEd25519PublicKey(key)
}

/**
 * The keys a record's own `revokedMachines[]` names, or an EMPTY set when the record carries none.
 *
 * FAIL CLOSED ON A LIST THAT CANNOT BE READ. "I could not read the revocation list" is not "there is
 * nothing revoked", and treating the two as one is exactly how a retired key approves again. A list that
 * is present and is not an array, or an entry that does not carry a 64-hex key, is refused by its own
 * name — a different fact from a machine being revoked, and so a different word.
 *
 * AN ABSENT LIST IS EMPTY AND IS NOT A REFUSAL. MEASURED on the owner's live record, public fields only:
 * `publicRoot.machines` holds one entry and `revokedMachines` is not present at all. A check that read
 * absence as malformed would refuse the owner's own identity on the day it shipped.
 * @param {unknown} record - a v3 record.
 * @returns {Set<string>} the revoked machine keys.
 */
function revokedMachinesOf(record) {
  const list = /** @type {{publicRoot?: {revokedMachines?: unknown}}} */ (record)?.publicRoot?.revokedMachines
  if (list === undefined) return new Set()
  if (!Array.isArray(list)) {
    throw new RootCustodyError(
      `${MACHINE_REVOCATION_MALFORMED_REFUSAL}: \`revokedMachines\` is present and is not an array, so this `
      + 'reader cannot tell which machines the identity has retired. Refusing rather than reading it as '
      + 'empty: an unreadable revocation list is not an empty one.',
    )
  }
  const keys = new Set()
  for (const [index, entry] of list.entries()) {
    const key = /** @type {{ed25519?: unknown}} */ (entry)?.ed25519
    if (typeof key !== 'string' || !/^[0-9a-f]{64}$/u.test(key)) {
      throw new RootCustodyError(
        `${MACHINE_REVOCATION_MALFORMED_REFUSAL}: \`revokedMachines[${String(index)}]\` does not carry a `
        + '64-hex `ed25519` key, so this reader cannot tell what it retires. Refusing rather than skipping '
        + 'the entry: an entry that cannot be read is not an entry that is absent.',
      )
    }
    keys.add(key)
  }
  return keys
}

/** The exact fields {@link projectRecordV3Control} returns, in this order. */
export const RECORD_CONTROL_FIELDS = Object.freeze([
  'domain',
  'subject',
  'epoch',
  'activeControlDigest',
  'revoked',
  'approvalKeyDid',
  'custodyClass',
])

/**
 * The record facts this projection carries BESIDE the control fields, and why they are here.
 *
 * THEY ARE NOT CONTROL FIELDS AND THEY ARE NOT ADMITTED. `admitPublicControl` holds a projection to
 * exactly {@link RECORD_CONTROL_FIELDS} — an extra field there is a refusal, which is the strictness
 * that stops a private half riding along — so a caller that wants to ADMIT calls
 * {@link controlFieldsOfRecordV3Projection} first and hands that narrowed value over. What these two
 * fields are for is the SCREEN: `boundAt` is the one field a person reads as "when did I do this" and
 * `handle` is the public name half of the key, and both were carried by this read before it started
 * answering with control fields. Dropping them to satisfy a closed parser two layers away would have
 * been the strictness of one consumer deciding what every other consumer may see.
 */
export const RECORD_CONTROL_EXTRA_FIELDS = Object.freeze(['boundAt', 'handle'])

/**
 * Narrow a projector's answer to EXACTLY the seven control fields, or throw.
 *
 * THE BROKER'S OWN STEP, AND IT IS THE ORGAN'S RATHER THAN EACH CALLER'S. `admitPublicControl` refuses an
 * extra field by name, so a read that carries record facts as well — `boundAt` and `handle`, which the
 * SCREEN reads and which `projectRecordV3Control` emits for it — has to be narrowed somewhere before
 * admission. Doing it here means ONE implementation of "which fields does admission read" instead of one
 * per caller.
 *
 * IT FAILS CLOSED ON A MISSING FIELD AND DROPS AN EXTRA ONE, AND THE ASYMMETRY IS THE POINT. A MISSING
 * control field throws, because admitting against a hole is exactly the failure this exists to prevent.
 * An EXTRA field is dropped, because that is what narrowing means and because the extra fields here are
 * DELIBERATE: the loader's answer carries the screen's `boundAt` and `handle` on purpose, and a function
 * that refused them would refuse the very projection it exists to narrow. MEASURED, and this is the
 * version that first shipped and broke the round trip: refusing extras turned a projectable controller
 * into `aumlok:control-malformed: this projection carries boundAt, handle beside the control fields`.
 * What the caller receives back is a NEW frozen object of the seven, so nothing it held can widen it.
 * @param {unknown} projection - a value from {@link projectRecordV3Control} or a public-control read.
 * @returns {Readonly<Record<string, unknown>>} exactly {@link RECORD_CONTROL_FIELDS}.
 */
export function controlFieldsOfRecordV3Projection(projection) {
  const fields = /** @type {Record<string, unknown>} */ (projection)
  if (fields === null || typeof fields !== 'object') {
    throw new RootCustodyError('aumlok:control-malformed: this projection is not a record at all')
  }
  const narrowed = {}
  for (const field of RECORD_CONTROL_FIELDS) {
    if (!Object.hasOwn(fields, field)) {
      throw new RootCustodyError(
        `aumlok:control-malformed: this projection carries no ${field}, so it cannot be admitted: `
        + `admission reads exactly ${RECORD_CONTROL_FIELDS.join(', ')}`,
      )
    }
    narrowed[field] = fields[field]
  }
  return Object.freeze(narrowed)
}

/**
 * A v3 record as a PUBLIC CONTROL PROJECTION — the seven fields the admission machinery reads.
 *
 * WHY THIS EXISTS. `recordProjection` above is the RECORD's view: which keys the identity publishes,
 * when it was bound, which genesis it descends from. It is not the CONTROL projection
 * `projection.mjs` defines, and the two were being conflated at the one seam where it costs money:
 * `loadLocalAumlokPublicControl` returned the record view, `approveOperation` pinned a subject and a
 * control digest against it, and the record view carries NEITHER `activeControlDigest` NOR
 * `approvalKeyDid`. So the controller was refused `aumlok-local:expectation-malformed` — the pin's
 * digest came off a field that is not there — before any socket was dialled, and the signer the shell
 * had just bound was never reached. MEASURED, and the arm that measured it is
 * `tests/aukora-approval-roundtrip.test.mjs`.
 *
 * THE APPROVAL KEY IS THE MACHINE, AND THE CALLER SAYS WHICH MACHINE THIS IS. `machinePublicKeyHex` is
 * the public half of the seed this laptop kept (`readKeptMachineSeed`), because that is the key an
 * approval from here is actually signed with. It is held to the record's own `machines[]` list: a key
 * the identity does not list is refused by name, because a signature under it is one the identity
 * never agreed to and finding that out at the broker is finding it out after a person was asked.
 *
 * WHEN THIS LAPTOP HOLDS NO SEED — a record copied to a second machine, or a court reading a fixture —
 * the caller passes `null` and the SINGLE listed machine answers instead, so a read-only projection
 * still names the key the deployment must pin. Neither route can return `publicRoot.ed25519`.
 * @param {object} input - the record, which machine this is, and the custody class to declare.
 * @param {unknown} input.record - a v3 record.
 * @param {string|null} [input.machinePublicKeyHex] - the public half of the machine seed this machine
 *   kept, or null when this machine has none.
 * @param {string} [input.custodyClass] - the declared custody ceiling; defaults to the one local class.
 * @returns {Readonly<Record<string, unknown>>} a frozen projection of exactly {@link RECORD_CONTROL_FIELDS}.
 */
export function projectRecordV3Control({ record, machinePublicKeyHex = null, custodyClass } = /** @type {never} */ ({})) {
  if (!isRecordV3(record)) {
    throw new RootCustodyError('projectRecordV3Control needs a v3 record')
  }
  const root = record.publicRoot
  const revoked = revokedMachinesOf(record)
  const machines = Array.isArray(root.machines) ? root.machines : []
  let approvalKeyHex = null
  if (typeof machinePublicKeyHex === 'string' && /^[0-9a-f]{64}$/u.test(machinePublicKeyHex)) {
    const listed = machines.find(entry => entry?.ed25519 === machinePublicKeyHex)
    if (listed === undefined) {
      throw new RootCustodyError(
        `aumlok:machine-signer-not-listed-by-the-record: the machine key this machine holds `
        + `(${machinePublicKeyHex.slice(0, 16)}…) is not one of the ${String(machines.length)} machine(s) this `
        + 'record lists, so an approval signed with it is one the identity never registered. This is what a '
        + 'machine sees after a refresh performed elsewhere: bind again here, and the key this projection '
        + 'names will be the one that signs.',
      )
    }
    approvalKeyHex = machinePublicKeyHex
  } else if (machines.length === 1 && typeof machines[0]?.ed25519 === 'string') {
    approvalKeyHex = machines[0].ed25519
  }
  // THE SAME RULE ON THE OTHER READER OF `machines[]`, and it covers BOTH routes: the machine this
  // laptop kept a seed for, and the single listed machine a read-only projection falls back to. A retired
  // key is not an approver however it was arrived at, and it is refused by name rather than by falling
  // through to another machine — silently signing with a different key would be a different identity's
  // approval answering this one's question.
  if (approvalKeyHex !== null && revoked.has(approvalKeyHex)) {
    throw new RootCustodyError(
      `${MACHINE_REVOKED_REFUSAL}: this record has retired the machine key `
      + `(${approvalKeyHex.slice(0, 16)}…) that would approve here, so this laptop may not sign for this `
      + 'identity. The key is in the record\'s own `revokedMachines[]`; it is not a key the record does '
      + 'not list, and it is not a record naming nobody.',
    )
  }
  if (approvalKeyHex === null) {
    // WHICH TOOL ANSWERS FOR A MULTI-MACHINE RECORD, NAMED IN THE REFUSAL RATHER THAN LEFT TO BE FOUND.
    // This is the PUBLIC path, and it is right that it refuses: which of several listed machines is
    // "this" laptop is not in the record. But a refusal that does not say who CAN answer sends the
    // reader to the wrong place, and Peter plans several devices, so the message names the reader that
    // does — `openMachineSignerV3` in `machine-signer-v3.mjs`, which is the reader the AUKORA shell's
    // signer uses. It opens `machine-seed-v3.json` for its own PRIVATE purpose, reads the `machineIndex`
    // kept beside the seed, and holds the key it finds to the record's own `machines[]`.
    //
    // MEASURED, on a record listing two machines with index 1 kept on this laptop:
    //   openMachineSignerV3({directory, record}) -> ok: true, machineIndex: 1, key = machines[1].ed25519
    // so the tool this message names is the tool that answers, not a hopeful pointer. The court that
    // asserts the message also CALLS that function, so a message naming a reader that cannot answer
    // would redden rather than soothe.
    // ZERO MACHINES AND SEVERAL ARE DIFFERENT FACTS AND NOW GET DIFFERENT SENTENCES. A record that
    // names none is a record nobody finished binding; a record that names several is a finished record
    // read by a caller that did not say which machine it is. One sentence for both asked "which one is
    // this laptop" of a record that lists none, which is a question with no referent.
    //
    // AND THE SENTENCE THAT STOOD HERE WAS FALSE. It named `openMachineSignerV3` as "what the AUKORA
    // shell's signer uses", and Fable measured the opposite: `aumlok-bridge.mjs:389` says
    // `machine-signer-v3.mjs NOT ADDED`, the shell's signer reads `readKeptMachineSeed` plus an inline
    // machines[] check (`aumlok-signer.mjs:857`), and `openMachineSignerV3` has NO caller outside tests.
    // "Run the shell and let its signer answer" therefore dead-ended at the one thing it named. What
    // answers now is the caller-supplied key below, and the shell is named because the shell really
    // does hand it over.
    if (machines.length === 0) {
      throw new RootCustodyError(
        'aumlok:record-names-no-machine: this record lists NO machine, so there is no approval key to '
        + 'project. A v3 binding records the machine key it derived and kept, and this record names none. '
        + 'BIND AGAIN on this laptop: the bind writes the machine entry this projection reads. Naming the '
        + 'root instead would name a key that is kept nowhere and that root-class-v3.mjs refuses an '
        + 'approval from by name.',
      )
    }
    throw new RootCustodyError(
      'aumlok:record-names-no-machine: this record lists '
      + `${String(machines.length)} machine(s) and this read was given no machine key, so it cannot say `
      + 'which one is this laptop. A caller that knows which machine it is passes it as the third '
      + 'argument — loadLocalAumlokPublicControl(directory, expectation, machinePublicKeyHex) — and the '
      + 'AUKORA shell does exactly that: aumlok-bridge.mjs reads machine-seed-v3.json with '
      + 'readKeptMachineSeed and hands the key over, so a second device reads BOUND. Naming the root '
      + 'instead would name a key that is kept nowhere and that root-class-v3.mjs refuses an approval '
      + 'from by name.',
    )
  }
  const subject = root.genesis === undefined ? `aukora:1:${root.rootId}` : aukoraIdFromGenesis(root.genesis)
  const declaredCustody = custodyClass ?? LOCAL_AUMLOK_CUSTODY_CLASS
  if (declaredCustody !== LOCAL_AUMLOK_CUSTODY_CLASS) {
    throw new RootCustodyError(`aumlok:custody-class-unrecognized: custodyClass must equal ${LOCAL_AUMLOK_CUSTODY_CLASS}`)
  }
  return Object.freeze({
    domain: PUBLIC_CONTROL_DOMAIN,
    subject,
    epoch: root.epoch,
    activeControlDigest: root.rootId,
    // THERE IS NO REVOCATION IN A v3 RECORD AND NO CONTROL HEAD TO REVOKE, so this reads the honest
    // value for a record that carries no such statement. A lost phrase is a NEW INSTANCE, not a
    // terminal state to publish.
    revoked: false,
    approvalKeyDid: didKeyFromEd25519PublicKey(approvalKeyHex),
    custodyClass: declaredCustody,
    // THE RECORD FACTS THIS READ HAS ALWAYS CARRIED, KEPT BECAUSE THE SCREEN READS THEM. See
    // {@link RECORD_CONTROL_EXTRA_FIELDS}: they are not admitted and a caller that admits narrows with
    // {@link controlFieldsOfRecordV3Projection} first. `handle` is spread only when the record has one,
    // exactly as `recordProjection` does it, so a record bound before X8 keeps the shape it had.
    boundAt: root.boundAt,
    ...(root.handle === undefined ? {} : { handle: root.handle }),
  })
}
