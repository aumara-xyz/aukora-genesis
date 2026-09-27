/**
 * THE MACHINE KEY: what this machine holds, so that the root does not have to be here.
 *
 * WHY THIS MODULE EXISTS. The root is the identity: whoever holds it can re-key, revoke and hand over.
 * If the thing kept on a laptop IS the root, then a stolen laptop is a stolen identity, and the plan's
 * answer to that — one root-signed revoke and one bind of a replacement — cannot work, because the
 * thief holds exactly the key that would be needed to refuse it. So the machine keeps a key DERIVED
 * from the root seed and never the root seed itself:
 *
 *   machineSeed = HKDF-SHA256(ikm = root seed, salt = "aumlok-machine-kdf-v1", info = machine index)
 *
 * THE PINNED CONSTANT IS THE DOMAIN SEPARATION, and it is pinned as a literal rather than composed, so
 * a change to it is a visible edit in a diff rather than something that happens because two strings
 * were joined in a different order. Every machine derives the SAME key from the same root at the same
 * index — that is what makes a re-install recoverable from the seven words — while two machines at
 * different indices get unrelated keys, so revoking one leaves the other working.
 *
 * WHAT THIS KEY MAY DO, AND WHAT IT MAY NOT. Approvals sign with it: that is the whole point, because
 * an approval is per-operation and the person should not re-type seven words for each one. ROOT-CLASS
 * acts — refresh, revoke, vouch, delegation, forget, cortex change — verify ONLY under the root, and
 * the refusal for a machine key attempting one is a NAMED code in `root-class-v3.mjs`. A machine key
 * that could sign a refresh would make the cold root decorative.
 *
 * THE ROOT SEED PASSED IN HERE IS TRANSIENT. It exists inside the ceremony and inside this call, and
 * nothing in this module stores it, returns it or writes it anywhere. What comes back is the machine's
 * seed and public key; the caller keeps those and drops the root.
 *
 * @module @aukora/dsh-plugin-aumlok/machine-key-v3
 */
import { hkdfSync } from 'node:crypto'
import { didKeyFromEd25519PublicKey } from './did-key.mjs'
import { ed25519FromSeed } from './derive-v3.mjs'

/**
 * The pinned domain separation constant. NOT composed from other strings: a derivation whose salt is
 * assembled can be changed by an edit somewhere else, and a machine key that silently became a
 * different key would strand every approval signed with the old one.
 */
export const AUMLOK_MACHINE_KDF = 'aumlok-machine-kdf-v1'

/** The Ed25519 seed length, in bytes. HKDF is asked for exactly this and nothing longer. */
export const MACHINE_SEED_BYTES = 32

/** Refusals this module produces by name. */
export const MACHINE_KEY_REFUSE = Object.freeze({
  ROOT_MALFORMED: 'aumlok:machine-root-malformed',
  INDEX_MALFORMED: 'aumlok:machine-index-malformed',
})

/** A machine key this module will not derive. */
export class MachineKeyError extends TypeError {
  /**
   * @param {string} code - one {@link MACHINE_KEY_REFUSE} value.
   * @param {string} detail - the observed defect.
   */
  constructor(code, detail) {
    super(`${code}: ${detail}`)
    this.name = 'MachineKeyError'
    this.code = code
  }
}

const SEED_HEX = /^[0-9a-f]{64}$/u

/**
 * One machine's key, derived from the root seed and this machine's index.
 *
 * THE ROOT SEED IS READ FROM `root.ed25519SeedHex`, which is the transient derivation result and never
 * a file. A caller that has only the kept machine seed cannot call this, which is the property that
 * keeps a machine from minting another machine: the seven words, or a ceremony, are what produce a
 * root.
 * @param {{root: object, machineIndex: number}} input - the transient root and this machine's index.
 * @returns {Readonly<{machineIndex: number, ed25519SeedHex: string, ed25519PublicKeyHex: string,
 *   ed25519DidKey: string, kdf: string}>} the machine key.
 */
export function deriveMachineKeyV3({ root, machineIndex } = /** @type {never} */ ({})) {
  if (typeof root !== 'object' || root === null
    || typeof root.ed25519SeedHex !== 'string' || !SEED_HEX.test(root.ed25519SeedHex)) {
    throw new MachineKeyError(MACHINE_KEY_REFUSE.ROOT_MALFORMED,
      'a machine key is derived from the transient root, which must carry its 32-byte Ed25519 seed')
  }
  if (typeof machineIndex !== 'number' || !Number.isSafeInteger(machineIndex) || machineIndex < 0) {
    throw new MachineKeyError(MACHINE_KEY_REFUSE.INDEX_MALFORMED,
      'the machine index must be a non-negative integer; it is the only thing that separates two '
      + 'machines sharing one root, so an invented one is an unrelated key')
  }
  const seed = Buffer.from(hkdfSync(
    'sha256',
    Buffer.from(root.ed25519SeedHex, 'hex'),
    Buffer.from(AUMLOK_MACHINE_KDF, 'utf8'),
    Buffer.from(String(machineIndex), 'utf8'),
    MACHINE_SEED_BYTES,
  ))
  const pair = ed25519FromSeed(seed)
  return Object.freeze({
    machineIndex,
    ed25519SeedHex: seed.toString('hex'),
    ed25519PublicKeyHex: pair.publicKeyHex,
    ed25519DidKey: didKeyFromEd25519PublicKey(pair.publicKeyHex),
    kdf: AUMLOK_MACHINE_KDF,
  })
}

/**
 * Which machine index a record should use next.
 *
 * THE LOWEST FREE INDEX, NOT THE COUNT. A record that revoked machine 0 and later bound a replacement
 * has as many machines as it has ever had, so `machines.length` would hand out an index that is
 * already listed as revoked — and a revoked index that comes back to life is a revocation that did not
 * happen.
 * @param {unknown} record - a v3 record, or a projection of one.
 * @returns {number} the lowest index not present in `machines[]` and not listed in `revokedMachines[]`.
 */
export function nextMachineIndex(record) {
  const root = record?.publicRoot ?? record ?? {}
  const taken = new Set()
  for (const entry of Array.isArray(root.machines) ? root.machines : []) {
    if (typeof entry?.index === 'number') taken.add(entry.index)
  }
  for (const entry of Array.isArray(root.revokedMachines) ? root.revokedMachines : []) {
    if (typeof entry?.index === 'number') taken.add(entry.index)
  }
  let index = 0
  while (taken.has(index)) index += 1
  return index
}
