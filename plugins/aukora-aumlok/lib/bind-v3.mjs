/**
 * AUMLOK v3 — the FIRST BINDING: seven words in, one identity written to disk.
 *
 * WHY THIS MODULE EXISTS, MEASURED RATHER THAN ARGUED. The shell's `submit` used to compare the typed
 * words with the drawn ones and answer `{ok:true, reason:'aumlok:ceremony-verified'}` — and write
 * nothing. It imported no writer, kept no seed and derived no root; its own docstring said "this shell
 * has nothing to write at this point in the plan". So the screen read a success, re-read the controller,
 * found no record, and drew UNBOUND again: Peter typed his seven words, pressed Bind, watched the words
 * vanish and the screen return to "Give me my phrase", and `state/aumlok` was never touched. The
 * ceremony reported a success it had not achieved, which is worse than an error, and no guard on the
 * store path could have caught it because nothing ever reached a store.
 *
 * THE SIBLING WAS ALREADY HERE. `refresh-v3.mjs` performs a refresh and writes — `writeRecordV3`,
 * `keepMachineSeed`, `keepRootSeed` — and its comment says what is kept "MIRRORS `bind`". There was no
 * bind to mirror: `deriveRootFromPhrase`, `buildGenesisV3` and the three writers had callers only in
 * courts and in re-exports. This file is that missing half, and it is deliberately the same shape as
 * its sibling so the two ceremonies cannot drift about what a binding is made of.
 *
 * THE ORDER OF THE WRITES IS THE SAFETY PROPERTY. `writeRecordV3` comes first and it is the call that
 * creates the directory: it is the one write that can fail for a reason that has nothing to do with
 * custody (the path is absent, a file sits where the directory should be, the volume is read-only), and
 * a failure there must leave NOTHING behind rather than a directory holding a machine key for a record
 * that was never written. The two seed writes follow, and they are the reason a binding can sign
 * tomorrow without the words.
 *
 * THE PHRASE IS NEVER WRITTEN, LOGGED OR RETURNED. It arrives as seven words, is joined once for the
 * KDF, and is not kept: what this module returns is public facts, the seeds the machine keeps, and the
 * paths they went to. A court scans every byte it writes and fails if a single word of the phrase
 * appears, which is the same arm `record-v3.mjs` is held to.
 *
 * A BIND NEVER REPORTS SUCCESS IT DID NOT ACHIEVE. Every failure is a `BindV3Error` carrying a NAME
 * from {@link BIND_REFUSE}, and the caller's whole obligation is to put that name on the screen. The
 * refusal is the product here: X1's rule is that a bind either writes the record and shows BOUND, or
 * shows a named refusal — never silence.
 * @module @aukora/dsh-plugin-aumlok/bind-v3
 */
import { randomBytes } from 'node:crypto'
import { lstatSync } from 'node:fs'
import { join } from 'node:path'
import { LOCAL_AUMLOK_CONTROL_FILENAME } from './store.mjs'

import { assertHandle, deriveRootFromPhrase, requireHandle } from './derive-v3.mjs'
// THE SHAPE OF A WORD, FROM THE MODULE THAT OWNS IT.
import { WORD_PATTERN } from './themed-entropy.mjs'
import { buildGenesisV3 } from './genesis-v3.mjs'
import { deriveMachineKeyV3 } from './machine-key-v3.mjs'
import {
  buildRecordV3,
  keepMachineSeed,
  recordProjection,
  removeIfCreated,
  writeRecordV3,
} from './record-v3.mjs'

/** The names this ceremony refuses by. Stable strings; a screen renders them, never parses prose. */
export const BIND_REFUSE = Object.freeze({
  /** The seven typed words are not seven lower-case words. */
  PHRASE_MALFORMED: 'aumlok:bind-phrase-malformed',
  /** No directory was resolved, so a binding has nowhere to go. */
  DIRECTORY_ABSENT: 'aumlok:bind-directory-absent',
  /**
   * The write itself failed. The detail — the errno, when there is one — is appended to this name, so
   * a person sees a named refusal AND the machine-readable cause, rather than a raw `undefined`.
   */
  WRITE_FAILED: 'aumlok:bind-write-failed',
  /** The binding landed but cannot be read back, which means it is not a binding. */
  RECORD_UNREADABLE: 'aumlok:bind-record-unreadable',
  ALREADY_BOUND: 'aumlok:bind-already-bound',
})

function alreadyBound(directory) {
  throw new BindV3Error(BIND_REFUSE.ALREADY_BOUND, `${directory} already holds an Aumlok record; nothing was replaced`)
}

/** Refuse an occupied record before deriving keys; the exclusive write also closes the race. */
function refuseIfBound(directory) {
  try {
    const folder = lstatSync(directory)
    if (!folder.isDirectory()) throw new BindV3Error(
      `${BIND_REFUSE.WRITE_FAILED}:${folder.isSymbolicLink() ? 'ELOOP' : 'ENOTDIR'}`, 'not a plain key directory')
  } catch (cause) {
    if (cause instanceof BindV3Error) throw cause
    if (cause?.code !== 'ENOENT') throw new BindV3Error(`${BIND_REFUSE.WRITE_FAILED}${errnoSuffix(cause)}`, 'cannot inspect key directory')
  }
  try {
    lstatSync(join(directory, LOCAL_AUMLOK_CONTROL_FILENAME))
  } catch (cause) {
    if (cause?.code === 'ENOENT') return
    throw new BindV3Error(`${BIND_REFUSE.WRITE_FAILED}${errnoSuffix(cause)}`, 'cannot inspect binding')
  }
  alreadyBound(directory)
}

/** A binding this module will not perform, or a binding that failed on the way to disk. */
export class BindV3Error extends TypeError {
  /**
   * @param {string} code - one {@link BIND_REFUSE} value, or that value with an errno appended.
   * @param {string} detail - the observed defect, in a sentence a person can act on.
   */
  constructor(code, detail) {
    super(`${code}: ${detail}`)
    this.name = 'BindV3Error'
    this.code = code
  }
}

/** The only shape a word of the phrase may have when it arrives here: lower case, 4 to 9 letters. */
// THE WORD SHAPE IS THE ORGAN'S, NOT A SECOND COPY OF IT. This file used to spell the regex itself, and so
// did the drawer and the two harvest scripts — four places writing one rule, which is four places to change
// when the width moves and four chances for three of them to be updated. It is imported now, so widening
// `WORD_PATTERN` is ONE edit and `tests/aukora-word-shape.test.mjs` holds the copies that remain (the
// drawer's, because the shell does not import the organ; the two Python shapes, because Python cannot).
const WORD = WORD_PATTERN
/** The plan's phrase: one anchor and six words. */
const PHRASE_LENGTH = 7
/** 32 bytes of hex, which is what `buildGenesisV3` requires and what makes two installations differ. */
const NONCE = /^[0-9a-f]{64}$/u

/**
 * The errno from a failure, as a short suffix for a refusal name, or nothing at all.
 *
 * A REFUSAL NAME THAT SWALLOWED THE ERRNO WOULD BE A WORSE REFUSAL. `aumlok:bind-write-failed` alone
 * tells a person the write failed; `aumlok:bind-write-failed:EACCES` tells them it was permissions and
 * not a full disk, and that is the difference between two different mornings. The suffix is bounded to
 * the shape of an errno so a long or hostile message cannot ride into the name.
 * @param {unknown} cause - whatever was thrown.
 * @returns {string} the suffix, including its leading colon, or an empty string.
 */
function errnoSuffix(cause) {
  const code = cause?.code
  if (typeof code !== 'string' || !/^[A-Z][A-Z0-9]{1,15}$/u.test(code)) return ''
  return `:${code}`
}

/**
 * Perform one first binding: derive the root from the words and write the identity down.
 *
 * THE SUBJECT IS NAMED HERE AND ONLY HERE, by `buildGenesisV3`, with a nonce generated in this process.
 * The nonce is what makes two people who chose the same seven words two identities, so it is minted
 * fresh for every first binding and carried — never re-invented — by every refresh. It is written into
 * the record as part of the genesis, which is what lets `recordProjection` re-derive the subject from
 * the record's own bytes instead of trusting a string the record asserts about itself.
 *
 * @param {object} input - the handle, the phrase, where to bind, and the moment.
 * @param {string} input.handle - the person's PUBLIC handle: half of the key (X8). Checked for shape
 *   here, before any key work, and REFUSED BY NAME when it is absent or cannot be a handle.
 * @param {readonly string[]} input.words - the seven typed words, in order, anchor first.
 * @param {string} input.directory - the controller directory the composition declares.
 * @param {string} input.boundAt - the moment of binding, ISO 8601, stored in the record.
 * @param {'file'} [input.custodian] - file custody; other custodians are refused before writing.
 * @returns {Promise<Readonly<object>>} the record, the projection, and what was written and kept.
 */
export async function bindV3({ handle, words, directory, boundAt, custodian } = /** @type {never} */ ({})) {
  if (typeof directory !== 'string' || directory.length === 0) {
    throw new BindV3Error(BIND_REFUSE.DIRECTORY_ABSENT,
      'a binding needs the controller directory to write into, and this launch resolved none: the '
      + 'composition carries no aukora-aumlok row with a config.directory, so there is nowhere for an '
      + 'identity to live. The refusal is the whole of the effect.')
  }
  if (typeof boundAt !== 'string' || boundAt.length === 0) {
    throw new BindV3Error(BIND_REFUSE.PHRASE_MALFORMED, 'a binding names the moment it happened')
  }
  if (custodian !== undefined && custodian !== 'file') {
    throw new BindV3Error(BIND_REFUSE.WRITE_FAILED,
      'first binding requires file custody; this app does not discover a keychain-backed signer')
  }
  // THE HANDLE FIRST, AND BEFORE ANY KEY WORK, FOR THE SAME REASON THE WORDS ARE CHECKED HERE: a
  // malformed handle must cost no scrypt seconds, and the refusal must be reachable only by a shape a
  // face would actually send. THE REFUSAL IS THE CONTRACT'S OWN NAME (`aumlok:kdf-handle-absent` /
  // `aumlok:kdf-handle-malformed`), passed through unchanged, because the salt is the contract's and
  // two names for one fact is how a refusal stops being recognisable on a screen.
  const normalizedHandle = requireHandle(handle)
  refuseIfBound(directory)
  // THE WORDS ARE CHECKED BEFORE ANY KEY WORK, so a malformed submit costs no scrypt seconds and the
  // refusal cannot be reached by a shape the face would never have sent.
  const offered = Array.isArray(words) ? words : null
  if (offered === null || offered.length !== PHRASE_LENGTH
    || !offered.every(word => typeof word === 'string' && WORD.test(word))) {
    throw new BindV3Error(BIND_REFUSE.PHRASE_MALFORMED,
      `a binding needs ${String(PHRASE_LENGTH)} lower-case words of 4 to 9 letters, anchor first`)
  }

  // THE PHRASE IS JOINED ONCE, HERE, AND THE JOINED STRING IS NOT KEPT. `normalizePhrase` inside the
  // KDF folds any of space, underscore and hyphen to one separator, so the seven words are the phrase
  // whichever of those the surface used between them. THE HANDLE GOES IN BESIDE IT AS THE SALT.
  // ── **THE ENTROPY OF THE THING BEING DERIVED, PRINTED WHERE IT IS DERIVED (AUMLOK-113)** ────────────────
  //
  // REVIEWER ROW 8, DISCLOSED BY PETER'S RULING: this path is the one that turns seven words and a PUBLIC handle
  // into the root key, and **the pair is worth about 34.14 bits.** A reader of this output is watching a root key
  // come into existence and is entitled to know what it is worth before anything is written.
  //
  // **AND THE LAW IT BREAKS IS THE REASON IT MUST BE SAID HERE RATHER THAN IN A DESIGN NOTE.** The project's own
  // statement is that the phrase never derives the key — a presence check over a secret held elsewhere. **This
  // line is where that is untrue**: the words ARE the secret, so a photograph of them, or a backup, is the root.
  console.log('CEILING: ROOT_KEY_OFFLINE_GUESSABLE — about 34.14 bits from the seven words plus a PUBLIC '
    + 'handle, public salt, roughly 1 second per guess. Whoever has the phrase rebuilds the root OFFLINE, with '
    + 'no access to this machine. The acrostic stays; what it unlocks is being redesigned.')
  const root = await deriveRootFromPhrase(offered.join('-'), { handle: normalizedHandle })
  const genesis = buildGenesisV3({ root, genesisNonce: randomBytes(32).toString('hex') })
  if (!NONCE.test(genesis.genesisNonce)) {
    // A GUARD ON OUR OWN OUTPUT, not on a caller's: a genesis whose nonce is not the shape the subject
    // derivation hashes would name an identity this module cannot reproduce, and that must never reach
    // a write.
    throw new BindV3Error(BIND_REFUSE.RECORD_UNREADABLE,
      'the genesis this ceremony built carries no usable nonce, so its subject is not reproducible')
  }
  const machine = deriveMachineKeyV3({ root, machineIndex: 0 })
  const record = buildRecordV3({
    root,
    boundAt,
    epoch: 0,
    receipt: null,
    genesis,
    // THE HANDLE IS PUBLISHED WITH THE ROOT IT SALTED. It is what a new machine reads to know which
    // handle to type first, and what a NIP-05 `name@domain` local part comes from; it is not a secret
    // and it is not a uniqueness claim.
    handle: normalizedHandle,
    machines: [{ index: machine.machineIndex, ed25519: machine.ed25519PublicKeyHex }],
  })

  // Validate the public projection before writing: a rejected record must not occupy a first-bind slot.
  let projection
  try {
    projection = recordProjection(record)
  } catch (cause) {
    throw new BindV3Error(BIND_REFUSE.RECORD_UNREADABLE,
      `the record does not project: ${cause instanceof Error ? cause.message : String(cause)}`)
  }

  let written
  let keptMachine
  try {
    // THE RECORD FIRST: this is the call that creates the directory, and the only one whose failure
    // must leave nothing at all behind.
    written = writeRecordV3({ record, directory, exclusive: true })
    keptMachine = keepMachineSeed(machine, { directory, custodian, exclusive: true })
    // THE ROOT IS KEPT NOWHERE (Y1, 2026-09-23). This line used to write `root-seed-v3.json` holding
    // the root's Ed25519 and ML-DSA-65 seeds, with the Ed25519 half swapped for the machine key's. The
    // swap narrowed the exposure without changing the fact: the root's POST-QUANTUM seed still landed
    // on the laptop, and the cold-root design says the root is re-derived from handle + words and
    // written by nobody. It was on Peter's disk after his 17:02 bind. A root-class act re-derives.
  } catch (cause) {
    if (written === undefined && cause?.code === 'EEXIST' && cause?.syscall === 'open'
      && cause?.path === join(directory, LOCAL_AUMLOK_CONTROL_FILENAME)) alreadyBound(directory)
    // A failed seed write must not strand an unusable identity or remove somebody else's record.
    const rollbackFailed = written?.created !== undefined && !removeIfCreated(written.path, written.created)
    const code = `${BIND_REFUSE.WRITE_FAILED}${errnoSuffix(cause)}`
    throw new BindV3Error(code,
      `the binding could not be written into ${directory}: `
      + `${cause instanceof Error ? cause.message : String(cause)}. No usable binding confirmed. `
      + (rollbackFailed ? 'Record cleanup failed; inspect the key directory before retrying.'
        : 'Any pre-existing files were preserved; partial files may remain after an I/O failure.'))
  }

  return Object.freeze({
    record,
    projection,
    genesis,
    machine,
    // THE HANDLE IS A PUBLIC FACT OF THIS BINDING, so it is returned with the other public facts
    // rather than left for a caller to re-read out of the record.
    handle: normalizedHandle,
    written: Object.freeze({ path: written.path, bytes: written.bytes }),
    // ONLY THE MACHINE SEED IS KEPT, so only the machine seed is reported. This used to carry
    // `root: keptRoot.path` beside `rootEd25519SeedKept: false` — a return value that named a root
    // seed file it had just written while denying it had kept the seed, which is the contradiction
    // Y1's red arm caught. A caller can no longer be told about a kept root, because there is none.
    kept: Object.freeze({
      machine: keptMachine.path,
      rootKept: false,
    }),
  })
}
