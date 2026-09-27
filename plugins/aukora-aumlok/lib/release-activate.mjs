/**
 * **THE RELEASE SWITCH IS A RECORD TOO — `aukora:release-activate:v1`.**
 *
 * Plan section 5 row 9 and section 2 step 14. Switching the live app to a release is the most consequential thing
 * this tree can do: it changes what Peter opens in the morning. **AND IT IS THE ONE ACTION WITH NO RECORD OF WHY**
 * — a release is materialized, a symlink moves, and afterwards the only account of it is a sentence in a lane's
 * report. *A switch whose evidence lives in a conversation is a switch nobody can audit.*
 *
 * So the switch becomes a record that binds four facts, and the record is approved through the same receipt path
 * as everything else:
 *
 *   * **THE RELEASE ID** — which materialized release is being switched to;
 *   * **THE COMMIT IT WAS CUT FROM** — the revision whose bytes are in that release;
 *   * **THE PREPARE-RECEIPT DIGEST** — the receipt the release's own preparation produced, so the switch is bound
 *     to the artifact that was prepared and not merely to its name;
 *   * **THE COMPOSITION SHA** — the composition the release carries, so a switch cannot point at a release whose
 *     composition nobody hashed.
 *
 * ── **AND THE COMMIT MUST BE AT OR BEHIND THE GREEN FRONTIER** ───────────────────────────────────────────
 *
 * `refs/aukora/green` is ALPHA's frontier: the revision every court has passed on. **A RELEASE CUT FROM A COMMIT
 * AHEAD OF IT IS REFUSED**, and that single check is what stops a release switch from being a way around the
 * gate — *switching the app to code the courts have not seen is a push by another name.* Being AT the frontier is
 * allowed and is the ordinary case: the frontier is the newest green revision, and a release is normally cut from
 * exactly it. Being BEHIND is allowed too, and is what a rollback looks like.
 *
 * **THE FRONTIER IS READ, NEVER ASSUMED.** The caller supplies what `git rev-parse refs/aukora/green` said and
 * what ancestry said; this module does not run git. *A module that shelled out would be untestable without a
 * remote, and its refusals would be the ones nobody measures.*
 */
import { createHash } from 'node:crypto'
import { canonicalJSON } from './repo-advance.mjs'

/** The record's kind, and the FIRST THING IN ITS ENCODING. */
export const RELEASE_ACTIVATE_KIND = 'aukora:release-activate:v1'

/** The frontier ref this record is checked against. */
export const GREEN_FRONTIER_REF = 'refs/aukora/green'

/** Every refusal, by name. */
export const RELEASE_REFUSE = Object.freeze({
  NOT_AN_OBJECT: 'release-activate:not-an-object',
  EXTRA_FIELD: 'release-activate:extra-field',
  MISSING_FIELD: 'release-activate:missing-field',
  BAD_RELEASE_ID: 'release-activate:bad-release-id',
  BAD_SHA: 'release-activate:bad-sha',
  BAD_DIGEST: 'release-activate:bad-digest',
  /** The commit is not at or behind `refs/aukora/green`. */
  AHEAD_OF_FRONTIER: 'release-activate:ahead-of-frontier',
  /** The frontier itself could not be read, so ancestry cannot be established. */
  FRONTIER_UNKNOWN: 'release-activate:frontier-unknown',
})

const refuse = (code, detail) => Object.assign(new Error(detail), { code })

const FIELDS = Object.freeze(['kind', 'releaseId', 'cutFrom', 'prepareReceiptDigest', 'compositionSha'])
const HEX40 = /^[0-9a-f]{40}$/u
const HEX64 = /^[0-9a-f]{64}$/u
const RELEASE_ID = /^[a-z0-9][a-z0-9._-]*$/u

/**
 * Build a release-activate record, or refuse it by name.
 *
 * @param {{releaseId: string, cutFrom: string, prepareReceiptDigest: string, compositionSha: string}} input
 */
export function buildReleaseActivate(input) {
  if (input === null || typeof input !== 'object' || Array.isArray(input)) {
    throw refuse(RELEASE_REFUSE.NOT_AN_OBJECT, 'a release activation is an object')
  }
  const record = { kind: RELEASE_ACTIVATE_KIND, ...input }
  const extra = Object.keys(record).filter(key => !FIELDS.includes(key))
  if (extra.length > 0) {
    throw refuse(RELEASE_REFUSE.EXTRA_FIELD,
      `this record carries field(s) the format does not have: ${extra.join(', ')} — a field the format does not `
      + 'name is a field no check will read')
  }
  const missing = FIELDS.filter(key => !(key in record))
  if (missing.length > 0) {
    throw refuse(RELEASE_REFUSE.MISSING_FIELD, `this record is missing: ${missing.join(', ')}`)
  }
  if (typeof record.releaseId !== 'string' || !RELEASE_ID.test(record.releaseId)) {
    throw refuse(RELEASE_REFUSE.BAD_RELEASE_ID, `${JSON.stringify(record.releaseId)} is not a release id`)
  }
  if (typeof record.cutFrom !== 'string' || !HEX40.test(record.cutFrom)) {
    throw refuse(RELEASE_REFUSE.BAD_SHA, `cutFrom is ${JSON.stringify(record.cutFrom)} and a commit is forty lowercase hex`)
  }
  if (typeof record.compositionSha !== 'string' || !HEX64.test(record.compositionSha)) {
    throw refuse(RELEASE_REFUSE.BAD_DIGEST, `compositionSha is ${JSON.stringify(record.compositionSha)} and a sha256 is sixty-four lowercase hex`)
  }
  if (typeof record.prepareReceiptDigest !== 'string' || !HEX64.test(record.prepareReceiptDigest)) {
    throw refuse(RELEASE_REFUSE.BAD_DIGEST,
      `prepareReceiptDigest is ${JSON.stringify(record.prepareReceiptDigest)} — a switch is bound to the artifact `
      + 'that was PREPARED, not merely to its name, so this digest is required')
  }
  return Object.freeze(record)
}

/** The canonical bytes and digest, through the same encoder as the other records. */
export const releaseActivateBytes = record => canonicalJSON(record)
export const releaseActivateDigest = record =>
  createHash('sha256').update(releaseActivateBytes(record), 'utf8').digest('hex')

/**
 * **THE FRONTIER CHECK, AND IT IS THE ONE THAT MATTERS.**
 *
 * @param {{record: object, frontier: string|null, isAncestor: boolean|null}} input
 *   `frontier` is what `git rev-parse refs/aukora/green` said, or `null` if it could not be read; `isAncestor` is
 *   whether `cutFrom` is an ancestor of it, or `null` if ancestry could not be established.
 * @returns {Readonly<{ok: true, atFrontier: boolean}>}
 */
export function assertAtOrBehindFrontier(input) {
  const { record, frontier, isAncestor } = input
  if (frontier === null || frontier === undefined || !HEX40.test(String(frontier))) {
    throw refuse(RELEASE_REFUSE.FRONTIER_UNKNOWN,
      `${GREEN_FRONTIER_REF} could not be read, so whether this release is behind the green frontier cannot be `
      + 'established — a switch that proceeds without its frontier is a switch that skips the gate')
  }
  // **BEING AT THE FRONTIER IS THE ORDINARY CASE AND IS ALLOWED.** The frontier is the newest green revision and a
  // release is normally cut from exactly it; refusing equality would refuse every ordinary switch.
  const atFrontier = record.cutFrom === frontier
  if (atFrontier) return Object.freeze({ ok: true, atFrontier: true })
  if (isAncestor !== true) {
    throw refuse(RELEASE_REFUSE.AHEAD_OF_FRONTIER,
      `this release was cut from ${record.cutFrom.slice(0, 7)} and ${GREEN_FRONTIER_REF} is at `
      + `${String(frontier).slice(0, 7)}, which does not contain it — switching the app to code the courts have not `
      + 'seen is a push by another name, so the commit must be at or behind the frontier')
  }
  return Object.freeze({ ok: true, atFrontier: false })
}
