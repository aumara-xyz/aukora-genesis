/**
 * Verify the activation an installed broker job was launched under.
 *
 * The parent supervisor measures a closed `ActivationStatement` before it
 * starts a child and passes only the digest. A LaunchDaemon has no such
 * parent: the digest arrives in the job's environment, where it is transport
 * and not evidence. Anyone able to edit the property list could otherwise
 * assert any digest and the broker would bind it.
 *
 * This module supplies the missing half. The statement itself is retained
 * beside the implementation it describes, and every member it names is
 * re-measured against the bytes on disk at launch. The environment value is
 * accepted only when the re-measured statement digests to exactly it, so the
 * evidence is the measurement and the environment only says which measurement
 * to expect.
 *
 * Re-measuring at launch rather than trusting the install-time manifest is the
 * point: the installer measured these bytes when it staged them, and this
 * process is what actually executes them.
 *
 * @module scripts/launchd-activation
 */
import { closeSync, fstatSync, openSync, readFileSync } from 'node:fs'
import { constants } from 'node:fs'
import { isAbsolute, join, normalize, relative, resolve } from 'node:path'
import { measureDigestManifest, measureVerifiedDigestManifest } from '../aukora/activation/measure.mjs'
import {
  ACTIVATION_STATEMENT_DOMAIN,
  activationDigest,
  assertActivationDigest,
  encodeActivationStatement,
  parseActivationStatement,
  parseActivationStatementFrame,
} from '../aukora/activation/statement.mjs'

/** Named refusals raised before the broker is served. */
/**
 * The retained statement's fixed name inside the implementation root.
 *
 * Fixed rather than configured: a statement path the job could name would let
 * whoever writes the property list also choose which statement is verified.
 */
export const INSTALLED_ACTIVATION_STATEMENT = 'activation.json'

export const LAUNCHD_ACTIVATION_REFUSE = Object.freeze({
  STATEMENT_UNREADABLE: 'launchd-activation:statement-unreadable',
  ROOT_INVALID: 'launchd-activation:implementation-root-invalid',
  CLOSURE_NAME_UNRESOLVED: 'launchd-activation:closure-name-unresolved',
  CLOSURE_INCOMPLETE: 'launchd-activation:closure-incomplete',
})

/**
 * The one member name that does not live under the implementation root.
 *
 * Its path is never taken from an activation statement or from a job's
 * environment; each caller states which interpreter it is asking about, and the
 * two callers ask different questions. A running entry asks about the
 * interpreter executing it. An installer asks about the binary the job it is
 * about to write will launch, which is not the installer's own.
 */
const INTERPRETER_MEMBER = 'node'

/**
 * Members every installed activation must name. Without a floor a statement
 * satisfies all three manifests by committing to one innocuous readable file,
 * measuring none of the code it is supposed to protect.
 */
const REQUIRED_MEMBERS = Object.freeze({
  coreManifest: Object.freeze(['aukora/broker/broker.mjs']),
  executable: Object.freeze([
    INTERPRETER_MEMBER,
    'scripts/launchd-broker-entry.mjs',
    'scripts/launchd-broker-review.mjs',
    'scripts/launchd-review-transport.mjs',
    'scripts/launchd-socket-listener.mjs',
  ]),
  resolver: Object.freeze([
    'scripts/launchd-activation.mjs',
    'aukora/activation/measure.mjs',
    'aukora/activation/statement.mjs',
  ]),
})

/** A named refusal from installed-activation verification. */
export class LaunchdActivationError extends Error {
  /**
   * @param {string} reason stable refusal reason from `LAUNCHD_ACTIVATION_REFUSE`
   * @param {string} detail human-readable detail
   */
  constructor(reason, detail) {
    super(`${reason}: ${detail}`)
    this.name = 'LaunchdActivationError'
    this.reason = reason
  }
}

/** Read one exact regular file without following its leaf. */
function readExactText(path) {
  let descriptor
  try {
    descriptor = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW)
  } catch (error) {
    throw new LaunchdActivationError(
      LAUNCHD_ACTIVATION_REFUSE.STATEMENT_UNREADABLE,
      String(/** @type {NodeJS.ErrnoException} */ (error)?.code ?? error),
    )
  }
  try {
    if (!fstatSync(descriptor).isFile()) {
      throw new LaunchdActivationError(LAUNCHD_ACTIVATION_REFUSE.STATEMENT_UNREADABLE, `${path} is not a regular file`)
    }
    return readFileSync(descriptor, 'utf8')
  } finally {
    closeSync(descriptor)
  }
}

/**
 * Resolve one manifest member name to the absolute path holding its bytes.
 *
 * Names are resolved by this module rather than carried in the statement, so a
 * statement cannot redirect a measurement at a path of its own choosing.
 *
 * @param {string} name manifest member name
 * @param {{implementationRoot: string}} anchors resolution anchor
 * @returns {string} absolute path to measure
 */
function resolveMember(name, anchors) {
  if (name === INTERPRETER_MEMBER) return anchors.interpreter
  if (normalize(name) !== name) {
    throw new LaunchdActivationError(
      LAUNCHD_ACTIVATION_REFUSE.CLOSURE_NAME_UNRESOLVED,
      `member ${name} is not one normalized relative name`,
    )
  }
  const candidate = join(anchors.implementationRoot, name)
  // Lexical containment, so a member name can never walk out of the root it is
  // measured against. Compared through `relative` because a root may or may not
  // carry a trailing separator.
  const inside = relative(resolve(anchors.implementationRoot), candidate)
  if (inside === '' || inside.startsWith('..') || isAbsolute(inside)) {
    throw new LaunchdActivationError(
      LAUNCHD_ACTIVATION_REFUSE.CLOSURE_NAME_UNRESOLVED,
      `member ${name} resolves outside the implementation root`,
    )
  }
  return candidate
}

/** Require one manifest to name every member the installed closure depends on. */
function requireMembers(manifest, required, label) {
  const absent = required.filter(name => !Object.hasOwn(manifest, name))
  if (absent.length > 0) {
    throw new LaunchdActivationError(
      LAUNCHD_ACTIVATION_REFUSE.CLOSURE_INCOMPLETE,
      `${label} does not name ${absent.join(', ')}`,
    )
  }
}

/** Re-measure one name-to-digest manifest against the bytes on disk. */
function remeasure(manifest, anchors) {
  return measureVerifiedDigestManifest(
    Object.entries(manifest).map(([name, sha256]) => ({ name, path: resolveMember(name, anchors), sha256 })),
    { allowAncestorLinks: true },
  )
}

/**
 * Verify the retained activation statement and return the digest to bind.
 *
 * Refuses unless the statement parses, every member it names still holds the
 * bytes it recorded, and the resulting digest is exactly the expected one.
 * The measurement is what makes the returned digest evidence rather than an
 * assertion the job's environment happened to carry.
 *
 * @param {{statementPath: string, implementationRoot: string, interpreter: string, expectedDigest: unknown}} options retained statement, its root, the interpreter being asked about, and the digest the job carries
 * @returns {string} the verified activation digest
 * @throws {LaunchdActivationError} on an unreadable statement or an unresolvable member
 * @throws {import('../aukora/activation/statement.d.mts').ActivationError} on a malformed statement or a digest that is not the expected one
 * @throws {import('../aukora/activation/measure.d.mts').ActivationMeasureError} when measured bytes differ from the statement
 */
export function verifyInstalledActivation({ statementPath, implementationRoot, interpreter, expectedDigest }) {
  for (const [name, value] of Object.entries({ implementationRoot, statementPath, interpreter })) {
    if (typeof value !== 'string' || !isAbsolute(value) || normalize(value) !== value) {
      throw new LaunchdActivationError(LAUNCHD_ACTIVATION_REFUSE.ROOT_INVALID, `${name} must be one normalized absolute path`)
    }
  }
  const statement = parseActivationStatementFrame(readExactText(statementPath))
  const anchors = { implementationRoot, interpreter }
  // Named before measured: a statement that omits the code it protects would
  // otherwise satisfy every manifest by committing to one innocuous file.
  requireMembers(statement.coreManifest, REQUIRED_MEMBERS.coreManifest, 'coreManifest')
  requireMembers(statement.closure.executable, REQUIRED_MEMBERS.executable, 'closure.executable')
  requireMembers(statement.closure.resolver, REQUIRED_MEMBERS.resolver, 'closure.resolver')
  remeasure(statement.coreManifest, anchors)
  remeasure(statement.closure.executable, anchors)
  remeasure(statement.closure.resolver, anchors)
  return assertActivationDigest(statement, expectedDigest)
}

/**
 * The executable members an installed broker job actually runs, and the
 * resolver members that decide whether its activation is acceptable. Fixed
 * here rather than supplied, so a statement cannot narrow what gets measured.
 */
/**
 * Build one activation statement over an installed implementation root.
 *
 * Every digest is measured from the bytes staged in that root; the remaining
 * selections are supplied by the caller and are declarations, not
 * measurements. The composition in particular is declared: an installed broker
 * governs effects for a composition that is not itself installed, so nothing
 * here can measure it. The caller owns that claim.
 *
 * @param {{implementationRoot: string, interpreter: string, coreMembers: readonly string[], selections: Readonly<Record<string, unknown>>}} options root to measure, the interpreter the job will launch, extra core member names, and the declared selections
 * @returns {{statement: Readonly<import('../aukora/activation/statement.d.mts').ActivationStatementV1>, frame: string, digest: string}} the statement, its canonical frame, and its digest
 * @throws {import('../aukora/activation/measure.d.mts').ActivationMeasureError} when a named member cannot be measured
 * @throws {import('../aukora/activation/statement.d.mts').ActivationError} when the selections do not form a closed statement
 */
export function buildInstalledActivationStatement({ implementationRoot, interpreter, coreMembers, selections }) {
  const anchors = { implementationRoot, interpreter }
  const measure = names => measureDigestManifest(
    names.map(name => ({ name, path: resolveMember(name, anchors) })),
    { allowAncestorLinks: true },
  )
  const statement = parseActivationStatement({
    ...selections,
    domain: ACTIVATION_STATEMENT_DOMAIN,
    coreManifest: measure([...new Set([...REQUIRED_MEMBERS.coreManifest, ...coreMembers])]),
    closure: {
      executable: measure(REQUIRED_MEMBERS.executable),
      resolver: measure(REQUIRED_MEMBERS.resolver),
    },
  })
  return { statement, frame: encodeActivationStatement(statement), digest: activationDigest(statement) }
}
