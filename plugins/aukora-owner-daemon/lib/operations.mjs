/**
 * THE CANONICAL OPERATION AND SCOPE SPELLINGS. **ONE PLACE, AND NOBODY RE-SPELLS THEM.**
 *
 * The dispatch table keyed on operations and scopes exposed five spellings for two effects:
 *
 *     tests/kira-owner-settle-join.test.mjs   operation 'memory.put'    scope 'kira:memory'
 *     tests/aukora-owner-protocol.test.mjs    operation 'kira.settle'   scope 'memory.put'
 *
 * They are NORMALISED HERE rather than merely tolerated, and the reason it is safe now is a fact rather than
 * an opinion: **NO OWNER DAEMON IS INSTALLED ANYWHERE, so no owner has ever been shown a frozen proposal
 * carrying either old spelling.** The only holders are tests in this repository, which is the one moment a
 * rename costs nothing. After the first installation this becomes a storage-format change with a migration.
 *
 * ── WHAT A SCOPE IS, WHICH IS THE PART THAT WAS WRONG ──
 *
 * **THE SCOPE NAMES *WHERE* THE EFFECT LANDS; THE OPERATION NAMES *WHAT* IT IS.** An earlier version of the
 * scope check passed Kira's own `OPERATIONS` list as the accepted scopes and crashed the join court, because
 * `OPERATIONS` is `['memory.put']` — a WHAT — and the scope is a WHERE.
 *
 *     kira.store:<ledgerId>    one Kira store, named by the ledger the person read on the sheet
 *     gate.release:<release>   one composition release, named by the release the grant admits into
 *
 * So a scope is not a category: it names an exact target, and the check is that the target is the one this
 * daemon is configured for. **A scope of the right KIND but the wrong TARGET is a different act from the one
 * the person authorised**, and it is refused.
 */

/** What an approved operation IS. */
export const OPERATIONS = Object.freeze({
  /** Write one memory record through Kira's owner store. The single canonical Kira operation. */
  KIRA_MEMORY_PUT: 'kira.memory.put',
  /** Sign an admission grant for one artifact. Writes nothing. */
  ADMIT_ARTIFACT: 'admit-plugin-artifact',
  /** Sign an admission grant covering a set. Writes nothing. */
  ADMIT_SET: 'admit-plugin-set',
  // ── **A KNOWN KIND WITH NO EFFECT, AND THAT IS THE WHOLE POINT OF LISTING IT (plan row 2)** ─────────────
  //
  // `repo.advance` is the operation that will move main (plan section 2 step 10; section 5 row 3 is the
  // verifier, and it is ALPHA's). **IT IS NAMED HERE SO THE OPERATION IS RECOGNISED, AND WIRED NOWHERE SO IT
  // CANNOT ACT.** A signed approval naming it therefore grants nothing: dispatch refuses it by name, and the
  // refusal says the operation exists and is not enabled — *which is a different sentence from "this daemon has
  // never heard of it", and the difference is what tells a reader whether to wait or to stop.*
  //
  // **WHY LIST IT BEFORE IT WORKS RATHER THAN AFTER.** An operation absent from this table is refused as
  // unknown, so a proposal could not even be written and reviewed. Naming it now lets the record, the display
  // and the review be built and approved while the effect stays off — **the brick Peter asked for, and no more
  // than the brick.** The plan's own order is why: the record and its display are AUMLOK's, the verifier and the
  // push are ALPHA's and Peter's.
  REPO_ADVANCE: 'repo.advance',
  // ── **THE RELEASE SWITCH, NAMED AND NOT WIRED (plan section 5 row 9)** ─────────────────────────────────
  //
  // Switching the live app to a release changes what Peter opens in the morning, and it is the one action with no
  // record of why. The record (`aukora:release-activate:v1`) binds the release id, the commit it was cut from,
  // the prepare-receipt digest and the composition sha, and requires that commit to be at or behind
  // `refs/aukora/green`. **THE EFFECT IS NOT WIRED**, so a signed approval naming this operation grants nothing.
  RELEASE_ACTIVATE: 'release.activate',
})

/** The two kinds of place an effect can land, as a scope's prefix. */
export const SCOPE_KINDS = Object.freeze({
  KIRA_STORE: 'kira.store',
  GATE_RELEASE: 'gate.release',
})

/** The scope for one Kira store, named by the ledger the person read. */
export const kiraStoreScope = ledgerId => `${SCOPE_KINDS.KIRA_STORE}:${String(ledgerId)}`

/** The scope for one composition release. */
export const gateReleaseScope = release => `${SCOPE_KINDS.GATE_RELEASE}:${String(release)}`

/**
 * Split a scope into its kind and its target, or `null` when it is not a scope this daemon writes.
 * @param {unknown} scope
 * @returns {Readonly<{kind: string, target: string}>|null}
 */
export function parseScope(scope) {
  const text = typeof scope === 'string' ? scope : ''
  const at = text.indexOf(':')
  if (at <= 0) return null
  const kind = text.slice(0, at)
  const target = text.slice(at + 1)
  if (!Object.values(SCOPE_KINDS).includes(kind)) return null
  // A SCOPE WITH NO TARGET NAMES NO PLACE. `kira.store:` would otherwise parse as a kind matching every
  // store, which is the fail-open shape this module exists to remove.
  if (target.length === 0) return null
  return Object.freeze({ kind, target })
}
