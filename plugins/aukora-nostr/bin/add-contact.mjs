#!/usr/bin/env node
/** Add a contact atomically, validating any supplied peer binding before touching the contacts file. */
import { closeSync, existsSync, mkdirSync, openSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { randomBytes } from 'node:crypto'
import { dirname, join, resolve } from 'node:path'
import { assertContactFields, npubDecode, npubEncode } from '../lib/identity.mjs'
import { controllerKeyOf, resolveContact } from '../lib/contact.mjs'
import { isMainModule } from '../lib/is-main.mjs'

/** The `domain` every contacts document must carry. A different one is a different format. */
export const CONTACTS_DOMAIN = 'aukora:nostr-contacts:v1'

/** Why this command refused, by name rather than as a boolean. */
export const ADD_CONTACT_REFUSE = Object.freeze({
  USAGE: 'nostr:add-contact-usage',
  BAD_NPUB: 'nostr:add-contact-bad-npub',
  BAD_CONTROLLER: 'nostr:add-contact-bad-controller',
  EXISTING_UNREADABLE: 'nostr:add-contact-existing-unreadable',
  BAD_BINDING: 'nostr:add-contact-bad-binding',
  BAD_NAME: 'nostr:add-contact-bad-name',
  /** Another writer holds the lock and its hold is not stale. A RETRY LATER is the answer. */
  LOCKED: 'nostr:add-contact-locked',
  /** `mode: 'insert'` found an entry for this npub. THE ANTI-OVERWRITE REFUSAL, held under the lock. */
  ALREADY_PRESENT: 'nostr:add-contact-already-present',
  /** `setContactConfirmation` was pointed at an npub this list does not carry. */
  NO_SUCH_CONTACT: 'nostr:add-contact-no-such-contact',
  REFRESH_TARGET: 'nostr:add-contact-refresh-target',
  REFRESH_BINDING: 'nostr:add-contact-refresh-binding',
})

const REFRESH_WINDOW_MS = 300_000
const CLOCK_SKEW_MS = 30_000

/**
 * How long a lock may sit before it is treated as abandoned.
 *
 * A PROCESS THAT DIES BETWEEN `openSync` AND `unlinkSync` LEAVES ITS LOCK BEHIND, and a lock with no
 * stale rule is a contacts file nobody can ever write to again — worse than the race it prevents. The
 * window is generous because the critical section is a read, a compare and a rename.
 */
const LOCK_STALE_MS = 30_000

/** How long to wait for a LIVE lock before giving up. Long enough for a rename, short enough to be an answer. */
const LOCK_WAIT_MS = 2_000

/** How long between attempts while waiting. */
const LOCK_RETRY_MS = 5

/**
 * Run `body` holding an exclusive lock beside the contacts document.
 *
 * THE LOCK IS `O_EXCL` — `openSync(path, 'wx')` — WHICH IS ATOMIC ON THE FILESYSTEM and therefore the
 * only part of this that can be trusted to be a mutual exclusion rather than a hopeful check. It wraps
 * READ → CHECK → WRITE → RENAME, because the whole point is that no other writer can slip between the
 * check and the write: checking outside the lock is exactly the race this closes.
 *
 * @param {string} file - the contacts document path.
 * @param {() => unknown} body - the critical section.
 * @returns whatever `body` returns.
 */
function withContactsLock(file, body) {
  const lock = `${file}.lock`
  mkdirSync(dirname(file), { recursive: true, mode: 0o700 })
  let handle
  // A LIVE LOCK IS WAITED FOR, NOT REFUSED ON. The critical section is a read, a compare and a rename,
  // so a holder is busy for MICROSECONDS — and refusing immediately means two people adding DIFFERENT
  // friends at the same moment lose one of them. That is the lost update this lock exists to prevent,
  // arriving by a different door. MEASURED by the court, not reasoned about: the first version threw
  // `nostr:add-contact-locked` and the two-different-npubs arm caught one add going missing.
  const deadline = Date.now() + LOCK_WAIT_MS
  for (;;) {
    try {
      handle = openSync(lock, 'wx', 0o600)
      break
    } catch (cause) {
      if (cause?.code !== 'EEXIST') throw cause
      // It is either a live writer or a dead one; the age is the only thing that can tell them apart.
      let ageMs = 0
      try { ageMs = Date.now() - statSync(lock).mtimeMs } catch { ageMs = 0 }
      if (ageMs >= LOCK_STALE_MS) {
        // STALE: the writer that made it is gone. Take it, and say so rather than pretending it was free.
        try { rmSync(lock, { force: true }); continue } catch { /* removal failure still respects the deadline below */ }
      }
      if (Date.now() >= deadline) {
        throw refuse(ADD_CONTACT_REFUSE.LOCKED,
          `${lock} is held by another writer (${Math.round(ageMs / 1000)}s old) and did not clear within `
          + `${String(LOCK_WAIT_MS)}ms; nothing was written. Retry in a moment.`)
      }
      // SLEEP SYNCHRONOUSLY: this function is sync by design, and `Atomics.wait` on a shared buffer is
      // the one way to yield without turning every caller into a promise.
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, LOCK_RETRY_MS)
    }
  }
  try {
    writeFileSync(lock, `${String(process.pid)} ${new Date().toISOString()}
`, { mode: 0o600, flag: 'a' })
    return body()
  } finally {
    // RELEASED ON EVERY PATH, INCLUDING A THROW INSIDE THE CRITICAL SECTION.
    try { closeSync(handle) } catch { /* already closed */ }
    try { rmSync(lock, { force: true }) } catch { /* the stale rule cleans it up */ }
  }
}

const HEX64 = /^[0-9a-f]{64}$/iu
const refuse = (code, detail) => Object.assign(new Error(detail), { code })
const isRecord = value => value !== null && typeof value === 'object'
  && (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null)

/** Re-encoding closes the decoder's padding loophole; only uniform case may be normalized. */
function canonicalNpub(value) {
  if (typeof value !== 'string' || (value !== value.toLowerCase() && value !== value.toUpperCase())) {
    throw new Error('npub must be a string in uniform case')
  }
  const lower = value.toLowerCase()
  const canonical = npubEncode(npubDecode(lower))
  if (canonical !== lower) throw new Error('npub is not canonically encoded')
  return canonical
}

/** `--flag value`, where an unknown flag is an error rather than something ignored. */
function parseArgs(argv, known) {
  const out = {}
  for (let i = 0; i < argv.length; i++) {
    const flag = argv[i]
    if (!flag.startsWith('--')) throw refuse(ADD_CONTACT_REFUSE.USAGE, `unexpected argument ${flag}`)
    if (!known.has(flag)) throw refuse(ADD_CONTACT_REFUSE.USAGE, `unknown argument ${flag}; known: ${[...known].join(' ')}`)
    const value = argv[++i]
    if (value === undefined || value.startsWith('--')) throw refuse(ADD_CONTACT_REFUSE.USAGE, `${flag} needs a value`)
    out[flag.slice(2)] = value
  }
  return out
}

/** The path of the contacts document inside a state directory. */
export function contactsPath(stateDir) {
  return join(resolve(stateDir), 'nostr', 'contacts.json')
}

/**
 * Read the existing document, or refuse.
 *
 * A MISSING file is not an error — that is the first contact. A file that exists and cannot be read
 * as a contacts document IS an error, and it is one this command will not resolve by overwriting.
 *
 * @param {string} file - the contacts document path.
 * @returns {readonly unknown[]} the existing records, including malformed rows left for repair.
 */
export function readExistingContacts(file) {
  if (!existsSync(file)) return Object.freeze([])
  let parsed
  try {
    parsed = JSON.parse(readFileSync(file, 'utf8'))
  } catch {
    // JSON parser errors can quote hostile or private contact bytes.
    throw refuse(ADD_CONTACT_REFUSE.EXISTING_UNREADABLE,
      `${file} exists but is not readable JSON; refusing to overwrite a contacts list this tool cannot read`)
  }
  if (parsed?.domain !== CONTACTS_DOMAIN || !Array.isArray(parsed.contacts)) {
    throw refuse(ADD_CONTACT_REFUSE.EXISTING_UNREADABLE,
      `${file} exists but is not a ${CONTACTS_DOMAIN} document; refusing to overwrite it`)
  }
  try {
    // Validate the envelope only. Malformed sibling rows remain unchanged as JSON values
    // when another contact is added or confirmed; the listing reports them independently.
    for (const [key, value] of Object.entries(parsed)) {
      assertContactFields(key)
      if (key !== 'contacts') assertContactFields(value)
    }
  } catch {
    throw refuse(ADD_CONTACT_REFUSE.EXISTING_UNREADABLE, 'the contacts document envelope contains invalid fields')
  }
  return Object.freeze(parsed.contacts)
}

/** A malformed stored row must never be silently overwritten while updating a valid contact. */
function isWritableContact(value) {
  if (!isRecord(value)) return false
  try {
    assertContactFields(value)
    if (canonicalNpub(value.npub) !== value.npub) return false
  } catch { return false }
  return typeof value.name === 'string' && value.name.trim() !== '' && value.name.length <= 120
    && typeof value.peerControllerKey === 'string'
    && (HEX64.test(value.peerControllerKey) || (value.peerControllerKey === '' && value.binding === null))
    && value.binding !== undefined
}

/**
 * Add or update one contact, and write the document back.
 *
 * @param {Readonly<{stateDir: string, npub: string, controller?: string, name?: string, binding?: object|null, bindingPath?: string, mode?: string}>} input - who to add and where.
 * @returns {Readonly<Record<string, unknown>>} what was written.
 */
export function addContact(input) {
  const mode = input.mode ?? 'insert'
  if (mode !== 'insert' && mode !== 'refresh') {
    throw refuse(ADD_CONTACT_REFUSE.USAGE, 'mode must be insert or explicit refresh')
  }
  const name = input.name ?? (typeof input.npub === 'string' ? input.npub.slice(0, 16) : '')
  try {
    assertContactFields(name)
    if (typeof name !== 'string' || !name.trim() || name.length > 120) throw new Error('invalid name')
  } catch { throw refuse(ADD_CONTACT_REFUSE.BAD_NAME, 'contact name is invalid') }
  try { assertContactFields(input) } catch {
    throw refuse(ADD_CONTACT_REFUSE.BAD_BINDING, 'contact fields contain control or format characters')
  }
  const stateDir = resolve(input.stateDir)
  let npub
  try {
    npub = canonicalNpub(input.npub)
  } catch (cause) {
    throw refuse(ADD_CONTACT_REFUSE.BAD_NPUB, `--npub is invalid: ${cause?.message ?? cause}`)
  }
  if (input.binding !== undefined && input.bindingPath !== undefined) {
    throw refuse(ADD_CONTACT_REFUSE.BAD_BINDING, 'supply a binding object or bindingPath, not both')
  }
  const hasBinding = (input.binding !== undefined && input.binding !== null) || input.bindingPath !== undefined
  const controller = input.controller === undefined ? '' : input.controller
  if (typeof controller !== 'string' || ((controller !== '' || hasBinding) && !HEX64.test(controller))) {
    throw refuse(ADD_CONTACT_REFUSE.BAD_CONTROLLER,
      '--controller must be the other side\'s controller ed25519 public key: 64 hex characters')
  }
  let binding = input.binding ?? null
  if (hasBinding) {
    try {
      if (input.bindingPath !== undefined) {
        binding = JSON.parse(readFileSync(resolve(input.bindingPath), 'utf8'))
      }
      if (!isRecord(binding)) throw new Error('binding must be a JSON record')
      assertContactFields(binding)
      // Validate the same JSON bytes that will be stored, including serialization failures.
      binding = JSON.parse(JSON.stringify(binding))
      if (!isRecord(binding) || !isRecord(binding.statement)
        || typeof binding.statement.handle !== 'string'
        || (Object.hasOwn(binding, 'approvalKeyDid') && controllerKeyOf(binding) === null)
        || (Object.hasOwn(binding, 'label') && typeof binding.label !== 'string')) {
        throw new Error('binding has malformed fields')
      }
    } catch {
      throw refuse(ADD_CONTACT_REFUSE.BAD_BINDING, 'binding is unreadable or has malformed fields')
    }
  }

  // No confirmation is imported. A verified peer signature earns BOUND or TEST only.
  let resolvedContact = { state: 'UNBOUND', binding: 'absent' }
  if (controller !== '') {
    try {
      resolvedContact = resolveContact({ npub, peerControllerKey: controller, binding })
      if (hasBinding && (resolvedContact.binding !== 'verified'
        || !['BOUND', 'TEST'].includes(resolvedContact.state))) {
        throw new Error(resolvedContact.code ?? 'binding did not resolve')
      }
    } catch (cause) {
      throw refuse(ADD_CONTACT_REFUSE.BAD_BINDING, `binding is invalid: ${cause?.message ?? cause}`)
    }
  }

  const file = contactsPath(stateDir)

  // Refresh is explicit and cannot rotate an existing trust anchor. It requires a new peer-signed
  // binding and clears the owner's confirmation: the normal full comparison must happen again.
  const insertOnly = mode === 'insert'

  // EVERYTHING THAT READS THE FILE HAPPENS INSIDE THE LOCK. A check outside it would be the race this
  // exists to close: read, decide, and let another writer land in between.
  return withContactsLock(file, () => {
    const existing = readExistingContacts(file)
    const sameContact = current => {
      if (current?.npub === npub) return true
      // CANONICAL, NOT LITERAL: two encodings of one key are one friend.
      try { return npubDecode(current?.npub?.toLowerCase()) === npubDecode(npub) } catch { return false }
    }
    if (insertOnly && existing.some(sameContact)) {
      throw refuse(ADD_CONTACT_REFUSE.ALREADY_PRESENT,
        `${npub} is already in ${file}; this writer is insert-only and will not re-point an existing contact.`)
    }
    let entry = { npub, name, peerControllerKey: controller.toLowerCase(), binding }
    if (mode === 'refresh') {
      const targets = existing.filter(sameContact)
      const current = targets[0]
      if (targets.length !== 1 || !isWritableContact(current)
        || (current.peerControllerKey !== '' && current.peerControllerKey.toLowerCase() !== controller.toLowerCase())) {
        throw refuse(ADD_CONTACT_REFUSE.REFRESH_TARGET, 'refresh needs one readable contact with the same controller key')
      }
      if (!hasBinding || resolvedContact.state !== 'BOUND' || resolvedContact.binding !== 'verified') {
        throw refuse(ADD_CONTACT_REFUSE.REFRESH_BINDING, 'refresh needs a non-test peer-signed binding')
      }
      let previousAt = -Infinity
      if (current.binding !== null) {
        const previous = resolveContact({ npub, peerControllerKey: current.peerControllerKey, binding: current.binding })
        if (previous.binding !== 'verified' || !['BOUND', 'TEST'].includes(previous.state)
          || current.binding.statement.subject !== binding.statement.subject) {
          throw refuse(ADD_CONTACT_REFUSE.REFRESH_TARGET, 'refresh cannot replace an unverified binding or another subject')
        }
        previousAt = Date.parse(current.binding.statement.createdAt)
      }
      const createdAt = binding.statement.createdAt
      const createdMs = Date.parse(createdAt)
      const now = Date.now()
      if (!Number.isFinite(createdMs) || (!Number.isFinite(previousAt) && previousAt !== -Infinity)
        || new Date(createdMs).toISOString().replace('.000Z', 'Z') !== createdAt
        || createdMs <= previousAt || createdMs > now + CLOCK_SKEW_MS || now - createdMs > REFRESH_WINDOW_MS) {
        throw refuse(ADD_CONTACT_REFUSE.REFRESH_BINDING, 'refresh needs a newer binding signed within five minutes')
      }
      const { confirmation: _oldConfirmation, ...unchanged } = current
      entry = { ...unchanged, npub, name: current.name, peerControllerKey: controller.toLowerCase(), binding }
    }

    // Only the validated explicit refresh can replace a row; insert refuses duplicates above.
    const others = existing.filter(current => !sameContact(current) || !isWritableContact(current))
    const contacts = [...others, entry]

    mkdirSync(dirname(file), { recursive: true, mode: 0o700 })
    // WRITE BESIDE AND RENAME: a crash mid-write leaves the old list intact rather than a truncated one.
    // THE TEMP NAME IS UNIQUE PER WRITER: a shared `<file>.tmp` lets two writers fill the same file and
    // rename each other's half-written bytes into place. The lock already excludes them; this is the
    // second belt, for a writer that ignores the lock or a lock that went stale mid-write.
    const temporary = `${file}.${String(process.pid)}.${randomBytes(6).toString('hex')}.tmp`
    try {
      writeFileSync(temporary, `${JSON.stringify({ domain: CONTACTS_DOMAIN, contacts }, null, 2)}\n`, { mode: 0o600 })
      renameSync(temporary, file)
    } catch (cause) {
      try { rmSync(temporary, { force: true }) } catch { /* the sweep below catches it */ }
      throw cause
    }
    return Object.freeze({ path: file, total: contacts.length, replaced: existing.length !== others.length,
      entry, state: resolvedContact.state, bindingStatus: resolvedContact.binding })
  })
}

/**
 * Attach the owner's signed confirmation to an EXISTING contact.
 *
 * IT ADDS A FIELD AND NOTHING ELSE. It will not create a contact, will not change a binding, and will
 * not touch the peer's controller key: a confirmation is a statement ABOUT a key, and a writer that
 * could also change the key would let one call move the thing it is a statement about.
 *
 * THE SAME LOCK AS AN ADD, for the same reason — a confirmation arriving while somebody adds a friend
 * must not lose either write. The caller is expected to have VERIFIED the confirmation already; this
 * writes what it is given, and the rule about what may be written lives where the signature is checked.
 *
 * @param {{stateDir: string, npub: string, confirmation: unknown}} input - where, whom, and the document.
 * @returns {Readonly<{path: string, total: number, entry: object}>} what was written.
 */
export function setContactConfirmation(input) {
  assertContactFields(input)
  npubDecode(input.npub)
  const file = contactsPath(resolve(input.stateDir))
  return withContactsLock(file, () => {
    const existing = readExistingContacts(file)
    const index = existing.findIndex(current => current?.npub === input.npub && isWritableContact(current))
    if (index === -1) {
      throw refuse(ADD_CONTACT_REFUSE.NO_SUCH_CONTACT,
        `${input.npub} is not in ${file}; a confirmation is a statement about a contact, so there must be one.`)
    }
    const contacts = existing.map((current, at) => (at === index ? { ...current, confirmation: input.confirmation } : current))
    const temporary = `${file}.${String(process.pid)}.${randomBytes(6).toString('hex')}.tmp`
    try {
      writeFileSync(temporary, `${JSON.stringify({ domain: CONTACTS_DOMAIN, contacts }, null, 2)}\n`, { mode: 0o600 })
      renameSync(temporary, file)
    } catch (cause) {
      try { rmSync(temporary, { force: true }) } catch { /* nothing else to do */ }
      throw cause
    }
    return Object.freeze({ path: file, total: contacts.length, entry: contacts[index] })
  })
}

const USAGE = [
  'usage: add-contact.mjs --state <dir> --npub <npub1…> --controller <64 hex> [--name <name>] [--binding <path>]',
  '  --state      the app state directory (the document is written to <state>/nostr/contacts.json)',
  '  --npub       the other side\'s Nostr address',
  '  --controller the other side\'s controller ed25519 public key, 64 hex characters',
  '  --name       what to call them on the Messages screen (default: the start of their npub)',
  '  --binding    a binding document THEY issued, if you have one; without it the contact is UNBOUND',
  '  --mode       insert (default) refuses duplicates; refresh requires a fresh signed binding and clears confirmation',
].join('\n')

async function main(argv) {
  try {
    const args = parseArgs(argv, new Set(['--state', '--npub', '--controller', '--name', '--binding', '--mode']))
    if (args.state === undefined || args.npub === undefined) {
      throw refuse(ADD_CONTACT_REFUSE.USAGE, '--state and --npub are required')
    }
    const result = addContact({
      stateDir: args.state,
      npub: args.npub,
      controller: args.controller,
      name: args.name,
      bindingPath: args.binding,
      // Existing trust changes only through explicit refresh and a new verification ceremony.
      mode: args.mode,
    })
    console.log(`contacts    : ${result.path}`)
    console.log(`name        : ${result.entry.name}`)
    console.log(`npub        : ${result.entry.npub}`)
    console.log(`controller  : ${result.entry.peerControllerKey}`)
    console.log(`binding     : ${result.entry.binding === null ? 'none — this contact is UNBOUND until they issue one' : 'attached'}`)
    console.log(`total       : ${result.total}${result.replaced ? ' (an existing entry for this npub was replaced)' : ''}`)
    return 0
  } catch (cause) {
    console.error(`${cause?.code ?? 'error'}: ${cause?.message ?? cause}`)
    if (cause?.code === ADD_CONTACT_REFUSE.USAGE) console.error(USAGE)
    return cause?.code === ADD_CONTACT_REFUSE.USAGE ? 2 : 1
  }
}

if (isMainModule(import.meta.url)) {
  process.exitCode = await main(process.argv.slice(2))
}
