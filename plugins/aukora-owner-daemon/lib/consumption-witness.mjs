/**
 * **THE CONSUMPTION WITNESS: an external record of every one-use id this daemon has spent.**
 *
 * From `aumlok-121`. That court measured a gap and named its shape: **a witness must record each CONSUMPTION, not
 * the log's length.** Three existing witnesses were measured and none closes it — the retained head (a Merkle
 * root over the log), the Aura chain checkpoint (a root over receipts), and the store's own `seq` marker (which
 * is *inside* the state directory). All three are blind to a RESTORE for the same structural reason: **a restore
 * does not truncate a log below the retained point, it returns the log TO it**, so every prefix proof succeeds
 * and every length agrees. *A root is a statement about a tree's shape; a restore preserves the shape and removes
 * the history.*
 *
 * So this module keeps a different kind of record: **an append-only, fsync'd, hash-chained list of consumed ids,
 * where each entry signs over the previous head.** It answers one question — *has this id ever been consumed?* —
 * and it answers it from OUTSIDE the directory a restore replaces.
 *
 * ── **WHY AN EXTERNAL RECORD CLOSES IT AND A BETTER LOCAL CHECK CANNOT** ────────────────────────────────
 *
 * A restore rolls the daemon's own state back, so **the daemon cannot tell that it was rolled back**: every file
 * it can read agrees with every other file it can read. *A protection that is correct about a directory cannot be
 * correct about a restore of that directory.* The only thing that can tell is a record the restore did not reach
 * — and the moment that record exists, the reconciliation is trivial: **any id the witness has that local state
 * lacks is a consumption that local state has forgotten.**
 *
 * ── **THE ORDERING, WHICH IS THE WHOLE PROTOCOL** ────────────────────────────────────────────────────────
 *
 *      pending ──▶ witness-recorded ──▶ effect-started ──▶ …
 *
 * **THE WITNESS IS WRITTEN BEFORE THE EFFECT STARTS.** If it were written after, a crash between the effect and
 * the record would leave an effect that happened and no witness of it — the same gap in a new place. Writing it
 * first means the failure mode is the safe one: a crash after the witness and before the effect leaves an id
 * recorded that was never spent, which refuses a retry that would have been legitimate. *Refusing a legitimate
 * retry is recoverable by a person; re-running an effect is not.*
 *
 * ── **WHAT THIS IS NOT** ─────────────────────────────────────────────────────────────────────────────────
 *
 * It is **not** a hardware path and **not** a placement decision. Where the witness LIVES — another UID, the
 * phone, a Secure Enclave counter — is Peter's to choose, and `CONSUMPTION_WITNESS_PLACEMENTS` below states each
 * option's trust assumption rather than picking one. What is built here is the PROTOCOL and two transports, so
 * that the placement can be swapped without touching the daemon.
 *
 * **AND IT IS NOT A DEFENCE AGAINST A ROOT ATTACKER.** A witness reachable and writable by the same principal
 * that restores the state directory can be rolled back too. The protocol's guarantee is exactly as strong as the
 * placement's reachability, which is why the placement is named and not assumed.
 */
import { appendFileSync, closeSync, existsSync, fsyncSync, mkdirSync, openSync, readFileSync, writeFileSync } from 'node:fs'
import { createHmac, timingSafeEqual } from 'node:crypto'
import { join } from 'node:path'

/** The witness's own file name, so a directory transport and a container transport agree on the layout. */
export const WITNESS_FILE = 'consumption-witness.jsonl'

/** The one refusal this module raises, and it stops effects rather than warning about them. */
export const WITNESS_REFUSE = Object.freeze({
  /**
   * **THE ROLLBACK, BY NAME.** The witness holds ids local state does not, which means local state was rolled
   * back (or replaced) after those ids were consumed. **NOT A WARNING:** the caller must stop effects, because
   * every local "not yet consumed" answer is now untrustworthy.
   */
  CONSUMED_STATE_ROLLED_BACK: 'consumed-state-rolled-back',
  /** The witness's bytes are not a chain this key wrote, or are damaged. */
  WITNESS_CORRUPT: 'consumption-witness-corrupt',
  /** A transport that could not be read or written. */
  WITNESS_UNAVAILABLE: 'consumption-witness-unavailable',
  /** The witness was asked to record an id it already holds. */
  ALREADY_CONSUMED: 'consumption-witness-already-consumed',
})

const refuse = (code, detail) => Object.assign(new Error(detail), { code })

/** The entry's canonical bytes. `seq` and `prev` are in the preimage so position and history are both bound. */
const entryBytes = entry => JSON.stringify({
  id: entry.id, prev: entry.prev, seq: entry.seq, at: entry.at,
})

/** The chain key's HMAC over one entry — "signs over the previous head" made concrete and cheap. */
const sealOf = (chainKey, entry) => createHmac('sha256', chainKey).update(entryBytes(entry), 'utf8').digest('hex')

/** The head after an entry is its seal. Nothing else is needed: the seal binds the whole prefix. */
export const WITNESS_GENESIS = 'genesis'

/**
 * **THE TRANSPORT INTERFACE, WHICH IS THE WHOLE OF WHAT A PLACEMENT HAS TO PROVIDE.**
 *
 * Two methods, both synchronous, both total: `read()` returns the witness file's bytes (`''` when it does not
 * exist) and `append(text)` adds to it durably. **A placement is a pair of those**, which is what lets the
 * directory transport and the container transport be the same protocol with different reachability.
 */
export function directoryTransport(root) {
  const path = join(root, WITNESS_FILE)
  return Object.freeze({
    kind: 'directory',
    path,
    describe: () => `directory:${path}`,
    read() {
      try { return existsSync(path) ? readFileSync(path, 'utf8') : '' } catch (error) {
        throw refuse(WITNESS_REFUSE.WITNESS_UNAVAILABLE, `the witness at ${path} could not be read: ${String(error?.code)}`)
      }
    },
    append(text) {
      try {
        mkdirSync(root, { recursive: true })
        // **APPEND, FSYNC, AND NOTHING ELSE.** `O_APPEND` makes concurrent appends atomic against each other,
        // and the fsync is what makes a recorded consumption survive a crash — *a consumption recorded in a
        // page cache is a consumption that a power loss un-records*, which is the same defect one layer down.
        const handle = openSync(path, 'a')
        try {
          appendFileSync(handle, text)
          fsyncSync(handle)
        } finally { closeSync(handle) }
      } catch (error) {
        if (error?.code) throw error
        throw refuse(WITNESS_REFUSE.WITNESS_UNAVAILABLE, `the witness at ${path} could not be written`)
      }
    },
  })
}

/**
 * **THE REALISTIC TRANSPORT: A CONTAINER, WHICH IS A DIFFERENT PRINCIPAL.**
 *
 * This is the shape the placement decision will take — the witness lives somewhere the restoring principal cannot
 * reach. It is modelled here over Docker because Docker is what is available and **a separate UID is the
 * cheapest real boundary this tree can test.**
 *
 * **THE COMMANDS ARE PASSED IN, AND THAT IS DELIBERATE.** `readCommand` and `appendCommand` are argv arrays, so
 * this module never builds a shell string: *a witness whose reachability is expressed as a shell command is a
 * witness whose reachability depends on quoting.* A transport is a pair of argv producers, and the tests supply
 * ones that work without a container so the PROTOCOL can be measured on a machine that has none.
 *
 * @param {{readCommand: string[], appendCommand: (text: string) => string[], describe: string}} spec
 */
export function commandTransport(spec) {
  if (!Array.isArray(spec?.readCommand) || typeof spec?.appendCommand !== 'function') {
    throw refuse(WITNESS_REFUSE.WITNESS_UNAVAILABLE,
      'a command transport needs readCommand (argv) and appendCommand (text => argv)')
  }
  // THE SPAWN IS INJECTED BY THE CALLER so this module has no child-process dependency of its own and a court
  // can measure the protocol without a container. `runSync(argv, stdin)` returns `{ status, stdout, stderr }`.
  const run = spec.runSync
  if (typeof run !== 'function') {
    throw refuse(WITNESS_REFUSE.WITNESS_UNAVAILABLE, 'a command transport needs runSync(argv, stdin)')
  }
  return Object.freeze({
    kind: spec.kind ?? 'command',
    describe: () => spec.describe ?? 'command',
    read() {
      const result = run(spec.readCommand, null)
      // A MISSING WITNESS IS AN EMPTY WITNESS, NOT A FAILURE — the first run has nothing recorded, and refusing
      // there would make the protocol impossible to start. Anything else is a real refusal.
      if (result.status !== 0) {
        const detail = String(result.stderr ?? '')
        if (/no such file|not found|does not exist/iu.test(detail)) return ''
        throw refuse(WITNESS_REFUSE.WITNESS_UNAVAILABLE,
          `the witness could not be read (${spec.describe ?? 'command'}): ${detail.slice(0, 200)}`)
      }
      return String(result.stdout ?? '')
    },
    append(text) {
      const result = run(spec.appendCommand(text), text)
      if (result.status !== 0) {
        throw refuse(WITNESS_REFUSE.WITNESS_UNAVAILABLE,
          `the witness could not be written (${spec.describe ?? 'command'}): ${String(result.stderr ?? '').slice(0, 200)}`)
      }
    },
  })
}

/** Parse the witness file into entries, refusing anything that is not a whole chain of well-formed lines. */
function parseChain(text, chainKey) {
  const entries = []
  let head = WITNESS_GENESIS
  for (const [index, line] of text.split('\n').entries()) {
    if (line === '') continue
    let entry
    try { entry = JSON.parse(line) } catch {
      throw refuse(WITNESS_REFUSE.WITNESS_CORRUPT,
        `witness line ${String(index)} is not JSON, so the chain cannot be read — an unreadable witness is not an `
        + 'empty one, and treating it as empty would consume everything again')
    }
    if (entry.prev !== head) {
      throw refuse(WITNESS_REFUSE.WITNESS_CORRUPT,
        `witness line ${String(index)} chains from ${JSON.stringify(entry.prev)} and the head is `
        + `${JSON.stringify(head)}, so a line is missing or out of order`)
    }
    const seal = sealOf(chainKey, entry)
    if (entry.seal !== seal) {
      throw refuse(WITNESS_REFUSE.WITNESS_CORRUPT,
        `witness line ${String(index)} does not verify under this chain key, so the record is not this daemon's`)
    }
    head = seal
    entries.push(Object.freeze({ id: entry.id, seq: entry.seq, at: entry.at, seal }))
  }
  return Object.freeze({ entries: Object.freeze(entries), head })
}

/**
 * Open the witness over a transport.
 *
 * @param {{transport: object, chainKey: string, now?: () => number}} input
 */
export function openWitness(input) {
  const { transport, chainKey } = input
  if (typeof chainKey !== 'string' || chainKey === '') {
    throw refuse(WITNESS_REFUSE.WITNESS_UNAVAILABLE, 'the witness needs a chain key; without one its bytes prove nothing')
  }
  const now = input.now ?? (() => Math.floor(Date.now() / 1000))
  const chain = () => parseChain(transport.read(), chainKey)

  return Object.freeze({
    describe: () => transport.describe(),
    /** The ids the witness holds, in the order they were consumed. */
    consumed() {
      return Object.freeze(chain().entries.map(entry => entry.id))
    },
    /** The head, so a caller can record what it saw. */
    head() { return chain().head },
    /**
     * **RECORD ONE CONSUMPTION, BEFORE THE EFFECT STARTS.**
     *
     * Returns the entry's seal. An id already present is refused by name rather than appended twice: **a witness
     * that accumulates duplicates of one id cannot be used to say WHEN it was first spent**, and the first spend
     * is the fact that matters.
     */
    record(id) {
      if (typeof id !== 'string' || id === '') {
        throw refuse(WITNESS_REFUSE.WITNESS_UNAVAILABLE, 'a consumption is recorded by a non-empty string id')
      }
      const current = chain()
      if (current.entries.some(entry => entry.id === id)) {
        throw refuse(WITNESS_REFUSE.ALREADY_CONSUMED,
          `${id.slice(0, 16)}… is already in the witness, consumed at ${String(current.entries.find(e => e.id === id).at)}`)
      }
      const entry = { id, prev: current.head, seq: current.entries.length, at: now() }
      const seal = sealOf(chainKey, entry)
      transport.append(`${JSON.stringify({ ...entry, seal })}\n`)
      return seal
    },
    /**
     * **THE RECONCILIATION, WHICH IS THE POINT OF THE WHOLE MODULE.**
     *
     * `localIds` is what the daemon's own state believes it has consumed. **ANY ID THE WITNESS HAS THAT LOCAL
     * STATE LACKS IS A CONSUMPTION LOCAL STATE HAS FORGOTTEN** — which is what a restore produces — and it is
     * refused by name with the ids named, so a reader can see which approvals came back.
     *
     * **THE DIRECTION IS DELIBERATE AND ONE-WAY.** An id local state has and the witness lacks is NOT refused:
     * that is the ordinary shape of a crash between the local write and the witness write, and refusing it would
     * refuse the very case the write-ahead order exists to make safe. *Only the direction that a restore produces
     * is refused.*
     */
    reconcile(localIds) {
      const local = new Set(localIds ?? [])
      const forgotten = chain().entries.map(entry => entry.id).filter(id => !local.has(id))
      if (forgotten.length > 0) {
        throw refuse(WITNESS_REFUSE.CONSUMED_STATE_ROLLED_BACK,
          `the witness holds ${String(forgotten.length)} consumption(s) this daemon's state does not: `
          + `${forgotten.slice(0, 5).map(id => id.slice(0, 16)).join(', ')}`
          + `${forgotten.length > 5 ? ', …' : ''} — local state was rolled back or replaced after those ids were `
          + 'consumed, so every local "not yet consumed" answer is untrustworthy and effects must stop')
      }
      return Object.freeze({ checked: true, consumed: new Set(local) })
    },
  })
}

/**
 * **THE ONE SHARED HELPER — THE ORDERING, IN ONE PLACE, FOR EVERY CALLER.**
 *
 * The owner daemon and KIRA's settle both need the same three steps in the same order, and *an order that lives
 * in two callers is an order that holds in one.* So it lives here, and both call it:
 *
 *     1. `journal.begin(nonce)`                      — the settlement exists, and is `pending`
 *     2. `witness.record(nonce)`                     — THE CONSUMPTION IS RECORDED OUTSIDE, BEFORE THE EFFECT
 *     3. `journal.advance(nonce, WITNESS_RECORDED)`  — the fact that step 2 happened is now durable locally
 *
 * **STEP 2 BEFORE STEP 3, AND WHY IT IS NOT THE OTHER WAY ROUND.** If the local advance came first, a crash
 * between them would leave a journal claiming the witness recorded a consumption the witness never saw — *a local
 * record asserting an external fact that is not true*, which is exactly the shape a restore produces and the
 * thing this protocol exists to make impossible. In this order the worst case is a witness entry with a local
 * journal still at `pending`: the consumption is recorded, the effect never ran, and the retry is refused rather
 * than duplicated.
 *
 * **AND THE RECONCILIATION RUNS FIRST, BEFORE ANY OF IT.** Recording into a witness that shows local state has
 * already forgotten consumptions would be writing to a witness whose evidence the caller is ignoring.
 *
 * @param {{journal: object, witness: object, nonce: string, localConsumed: Iterable<string>,
 *          witnessRecordedState: string, extra?: object}} input
 * @returns {Readonly<{seal: string, head: string}>}
 */
export function recordConsumptionBeforeEffect(input) {
  const { journal, witness, nonce } = input
  if (typeof journal?.begin !== 'function' || typeof journal?.advance !== 'function') {
    throw refuse(WITNESS_REFUSE.WITNESS_UNAVAILABLE, 'the helper needs a journal with begin() and advance()')
  }
  if (typeof witness?.record !== 'function' || typeof witness?.reconcile !== 'function') {
    throw refuse(WITNESS_REFUSE.WITNESS_UNAVAILABLE, 'the helper needs an open witness')
  }
  if (typeof input.witnessRecordedState !== 'string' || input.witnessRecordedState === '') {
    throw refuse(WITNESS_REFUSE.WITNESS_UNAVAILABLE,
      'the helper needs the journal state that means "the witness recorded this"; passing it in keeps this module '
      + 'free of an import cycle with journal.mjs')
  }
  // (0) RECONCILE — a caller whose own state forgot a consumption must not record into the witness as though the
  // past were intact.
  witness.reconcile(input.localConsumed ?? [])
  // (1) THE SETTLEMENT EXISTS.
  journal.begin(nonce, input.extra)
  // (2) THE CONSUMPTION IS RECORDED OUTSIDE, BEFORE THE EFFECT.
  const seal = witness.record(nonce)
  // (3) AND ONLY NOW IS THAT FACT DURABLE LOCALLY.
  journal.advance(nonce, input.witnessRecordedState)
  return Object.freeze({ seal, head: witness.head() })
}

/**
 * **THE PLACEMENT OPTIONS, EACH WITH ITS TRUST ASSUMPTION — PETER'S DECISION, NOT THIS MODULE'S.**
 *
 * The protocol's guarantee is exactly as strong as the placement's reachability: *a witness the restoring
 * principal can also restore is not a witness.* These are stated so the choice is made against the assumption
 * rather than against the effort.
 */
export const CONSUMPTION_WITNESS_PLACEMENTS = Object.freeze([
  Object.freeze({ option: 'another-uid', assumes: 'the restoring principal is not root and cannot write another UID\'s files; a root restore defeats it' }),
  Object.freeze({ option: 'another-host', assumes: 'the host is not restored with the Mac and is reachable when the daemon starts; a network partition must refuse, not proceed' }),
  Object.freeze({ option: 'the-phone', assumes: 'the phone is the same device that carried the approval, so it is out of the Mac\'s restore entirely; it must be present at every effect' }),
  Object.freeze({ option: 'secure-enclave-counter', assumes: 'the counter is monotonic in hardware, so it cannot be rolled back at all; it records a COUNT, not ids, so the id must be bound to it separately' }),
  Object.freeze({ option: 'second-local-file', assumes: 'NOTHING — it is inside the same restore scope unless placed outside every snapshot, which is the property that needs its own court' }),
])
