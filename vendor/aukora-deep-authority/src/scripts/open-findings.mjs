/**
 * Loader and evaluator for courts/open-findings.json, the standing open-finding
 * row set.
 *
 * The polarity is inverted from courts/known-breaches.json: a row's assertion
 * describes the REPAIR, so it fails while the finding is open and passes once
 * the repair has landed. A row that passes is reported RESOLVED and retires
 * itself; no reader marks a row done.
 *
 * Assertions are declarative records, never source. Each names a `kind` from
 * ASSERTION_KINDS and its operands; the predicate is selected here and an
 * unrecognized kind is refused by name. Nothing read from the manifest is
 * compiled, evaluated, or used as a command, glob, or regular expression.
 *
 * Every export is total: none throws, none writes, none exits. run-gate.mjs
 * calls into this module at module scope on every run, so a missing or
 * malformed manifest must degrade to a named fault rather than a thrown error.
 */

import { existsSync, readFileSync, realpathSync, statSync } from 'node:fs'
import { isAbsolute, resolve, sep } from 'node:path'

/** Manifest revision this module accepts. A different value is refused, never defaulted. */
export const OPEN_FINDINGS_SCHEMA_VERSION = 1

/** Repository-relative location of the manifest. */
export const OPEN_FINDINGS_PATH = 'courts/open-findings.json'

/** The closed set of assertion kinds. A manifest kind outside this set is a fault. */
export const ASSERTION_KINDS = Object.freeze(['fileContains', 'fileLacks', 'pathExists'])

/** The closed set of row states. `accepted` requires acceptedBy and acceptedReason. */
export const FINDING_STATUSES = Object.freeze(['open', 'accepted'])

/** Row identifier: lowercase kebab-case, so ids sort and print predictably. */
const FINDING_ID = /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/

/** ISO calendar date, without a time component. */
const OPENED_DATE = /^\d{4}-\d{2}-\d{2}$/

/** Operand names each assertion kind requires beyond `kind`, in validation order. */
const ASSERTION_OPERANDS = Object.freeze({
  fileContains: Object.freeze(['path', 'needle']),
  fileLacks: Object.freeze(['path', 'needle']),
  pathExists: Object.freeze(['path']),
})

/** Keys a finding may carry. Any other key is a fault, so a misspelling cannot be ignored. */
const FINDING_KEYS = Object.freeze([
  'id', 'subject', 'what', 'assertion', 'assertionCeiling',
  'status', 'opened', 'auditsSeen', 'sources', 'acceptedBy', 'acceptedReason',
])

/** Keys the manifest may carry at top level. */
const MANIFEST_KEYS = Object.freeze([
  'schemaVersion', 'title', 'whyThisLaneExists', 'theDoneCondition', 'whyThisFileIsData',
  'assertionKinds', 'howToAddARow', 'findings',
])

/** Refuse a value that the closed union above should have made unreachable. */
const assertNever = (value, at) => [`${at}: unsupported kind ${JSON.stringify(String(value))}`]

/**
 * Test whether a value is a non-empty string carrying no leading or trailing space.
 *
 * @param value - the candidate.
 * @returns true when the value is a trimmed non-empty string.
 */
const isTrimmedText = (value) => typeof value === 'string' && value.trim() === value && value !== ''

/**
 * Test whether a value is a plain object rather than null or an array.
 *
 * @param value - the candidate.
 * @returns true when the value is a non-null, non-array object.
 */
const isRecord = (value) => typeof value === 'object' && value !== null && !Array.isArray(value)

/**
 * Resolve a manifest-declared repository-relative path and refuse escape.
 *
 * The manifest names subjects to read. A path that is absolute, that resolves
 * outside the repository root, or that reaches its subject through a symbolic
 * link is refused rather than read, so the manifest can never direct a read at
 * the wider filesystem. A lexical check alone is insufficient: a link committed
 * inside the repository resolves lexically inside it while reading outside it,
 * which would let a row's state be set by bytes the repository does not own.
 * `aukora/activation/measure.mjs` refuses links for the same reason.
 *
 * @param root - absolute repository root.
 * @param candidate - the manifest-declared repository-relative path.
 * @returns the absolute path, or null when the path is absolute, escapes the root, or traverses a link.
 */
const resolveInsideRoot = (root, candidate) => {
  if (isAbsolute(candidate)) return null
  const absolute = resolve(root, candidate)
  if (absolute !== root && !absolute.startsWith(root + sep)) return null
  let real
  try {
    real = realpathSync(absolute)
  } catch {
    // An absent subject has no real path; absence is reported by the caller as
    // an unmet assertion, never as a resolved finding.
    return absolute
  }
  if (real !== absolute) return null
  return absolute
}

/**
 * Collect every schema fault in one assertion record.
 *
 * @param at - the row label used to prefix each fault sentence.
 * @param assertion - the candidate assertion record.
 * @returns fault sentences; empty when the assertion conforms.
 */
const assertionFaults = (at, assertion) => {
  if (!isRecord(assertion)) return [`${at}: "assertion" must be an object`]
  const { kind } = assertion
  if (!ASSERTION_KINDS.includes(kind)) {
    return [`${at}: unknown assertion kind ${JSON.stringify(String(kind))}; known kinds are ${ASSERTION_KINDS.join(', ')}`]
  }
  const operands = ASSERTION_OPERANDS[kind]
  const faults = []
  const allowed = ['kind', ...operands]
  for (const key of Object.keys(assertion)) {
    if (!allowed.includes(key)) faults.push(`${at}: assertion carries unknown key ${JSON.stringify(key)}`)
  }
  for (const operand of operands) {
    if (!isTrimmedText(assertion[operand])) faults.push(`${at}: assertion.${operand} must be a non-empty trimmed string`)
  }
  return faults
}

/**
 * Collect every schema fault in one finding row.
 *
 * @param finding - the candidate row.
 * @param index - the row's position, used to label a row whose id is unusable.
 * @returns fault sentences; empty when the row conforms.
 */
const findingFaults = (finding, index) => {
  if (!isRecord(finding)) return [`findings[${index}]: must be an object`]
  const at = isTrimmedText(finding.id) ? `finding ${JSON.stringify(finding.id)}` : `findings[${index}]`
  const faults = []
  for (const key of Object.keys(finding)) {
    if (!FINDING_KEYS.includes(key)) faults.push(`${at}: unknown key ${JSON.stringify(key)}`)
  }
  if (!isTrimmedText(finding.id) || !FINDING_ID.test(finding.id)) {
    faults.push(`${at}: "id" must be lowercase kebab-case`)
  }
  for (const field of ['subject', 'what', 'assertionCeiling']) {
    if (!isTrimmedText(finding[field])) faults.push(`${at}: ${JSON.stringify(field)} must be a non-empty trimmed string`)
  }
  if (isTrimmedText(finding.what) && finding.what.includes('\n')) faults.push(`${at}: "what" must be one line`)
  if (!OPENED_DATE.test(String(finding.opened))) faults.push(`${at}: "opened" must be an ISO calendar date`)
  if (!Number.isInteger(finding.auditsSeen) || finding.auditsSeen < 1) {
    faults.push(`${at}: "auditsSeen" must be an integer of at least 1`)
  }
  if (!Array.isArray(finding.sources) || finding.sources.length === 0 || !finding.sources.every(isTrimmedText)) {
    faults.push(`${at}: "sources" must name at least one audit`)
  }
  if (!FINDING_STATUSES.includes(finding.status)) {
    faults.push(`${at}: "status" must be one of ${FINDING_STATUSES.join(', ')}`)
  }
  // Acceptance is the only way a row stays without its assertion holding, so it
  // carries an accountable name and a reason. Neither may be supplied alone,
  // and neither may appear on a row that was never accepted.
  if (finding.status === 'accepted') {
    if (!isTrimmedText(finding.acceptedBy)) {
      faults.push(`${at}: status "accepted" requires a non-empty "acceptedBy"; a finding cannot be accepted anonymously`)
    }
    if (!isTrimmedText(finding.acceptedReason)) {
      faults.push(`${at}: status "accepted" requires a non-empty "acceptedReason"; acceptance without a stated reason is indistinguishable from neglect`)
    }
  } else {
    for (const field of ['acceptedBy', 'acceptedReason']) {
      if (finding[field] !== undefined) faults.push(`${at}: ${JSON.stringify(field)} is set on a row whose status is not "accepted"`)
    }
  }
  faults.push(...assertionFaults(at, finding.assertion))
  return faults
}

/**
 * Read and validate the manifest without throwing.
 *
 * @param root - absolute repository root.
 * @returns the parsed manifest with its faults; `findings` is empty when any fault was found.
 */
export function loadOpenFindings(root) {
  const path = resolve(root, OPEN_FINDINGS_PATH)
  if (!existsSync(path)) return { ok: false, faults: [`${OPEN_FINDINGS_PATH} is missing`], findings: [] }
  let text
  try {
    text = readFileSync(path, 'utf8')
  } catch (error) {
    return { ok: false, faults: [`${OPEN_FINDINGS_PATH} could not be read: ${String(error?.message ?? error)}`], findings: [] }
  }
  let manifest
  try {
    manifest = JSON.parse(text)
  } catch (error) {
    return { ok: false, faults: [`${OPEN_FINDINGS_PATH} is not valid JSON: ${String(error?.message ?? error)}`], findings: [] }
  }
  if (!isRecord(manifest)) return { ok: false, faults: [`${OPEN_FINDINGS_PATH} must contain a JSON object`], findings: [] }
  const faults = []
  for (const key of Object.keys(manifest)) {
    if (!MANIFEST_KEYS.includes(key)) faults.push(`unknown top-level key ${JSON.stringify(key)}`)
  }
  if (manifest.schemaVersion !== OPEN_FINDINGS_SCHEMA_VERSION) {
    faults.push(`schemaVersion must be ${OPEN_FINDINGS_SCHEMA_VERSION}`)
  }
  for (const field of ['title', 'whyThisLaneExists', 'theDoneCondition']) {
    if (!isTrimmedText(manifest[field])) faults.push(`${JSON.stringify(field)} must be a non-empty trimmed string`)
  }
  if (!Array.isArray(manifest.findings)) {
    faults.push('"findings" must be an array')
    return { ok: false, faults, findings: [] }
  }
  const seen = new Set()
  for (const [index, finding] of manifest.findings.entries()) {
    faults.push(...findingFaults(finding, index))
    const id = isRecord(finding) ? finding.id : undefined
    if (isTrimmedText(id)) {
      if (seen.has(id)) faults.push(`finding ${JSON.stringify(id)}: enrolled twice`)
      seen.add(id)
    }
  }
  if (faults.length > 0) return { ok: false, faults, findings: [] }
  return { ok: true, faults: [], findings: manifest.findings }
}

/**
 * Evaluate one declarative assertion against the working tree.
 *
 * A subject that cannot be read is never reported as a held assertion: the
 * absence is returned as a fault so a deleted or renamed subject surfaces
 * instead of silently resolving its finding.
 *
 * @param root - absolute repository root.
 * @param assertion - a validated assertion record.
 * @returns whether the assertion holds, with a detail sentence when it does not.
 */
export function evaluateAssertion(root, assertion) {
  const absolute = resolveInsideRoot(root, assertion.path)
  if (absolute === null) return { held: false, detail: `${assertion.path} resolves outside the repository` }
  switch (assertion.kind) {
    case 'pathExists':
      return existsSync(absolute)
        ? { held: true, detail: null }
        : { held: false, detail: `${assertion.path} does not exist` }
    case 'fileContains':
    case 'fileLacks': {
      if (!existsSync(absolute)) return { held: false, detail: `${assertion.path} does not exist` }
      if (!statSync(absolute).isFile()) return { held: false, detail: `${assertion.path} is not a regular file` }
      let text
      try {
        text = readFileSync(absolute, 'utf8')
      } catch (error) {
        return { held: false, detail: `${assertion.path} could not be read: ${String(error?.message ?? error)}` }
      }
      const present = text.includes(assertion.needle)
      if (assertion.kind === 'fileContains') {
        return present ? { held: true, detail: null } : { held: false, detail: `${assertion.path} does not contain the needle` }
      }
      return present ? { held: false, detail: `${assertion.path} still contains the needle` } : { held: true, detail: null }
    }
    default:
      return { held: false, detail: assertNever(assertion.kind, 'assertion')[0] }
  }
}

/**
 * Load the manifest and evaluate every row against the working tree.
 *
 * @param root - absolute repository root.
 * @returns the manifest faults and one evaluated row per finding, ordered oldest first.
 */
export function evaluateOpenFindings(root) {
  const loaded = loadOpenFindings(root)
  if (!loaded.ok) return { ok: false, faults: loaded.faults, rows: [] }
  const rows = loaded.findings.map((finding) => {
    const outcome = evaluateAssertion(root, finding.assertion)
    return {
      id: finding.id,
      subject: finding.subject,
      what: finding.what,
      opened: finding.opened,
      auditsSeen: finding.auditsSeen,
      sources: finding.sources,
      // A held assertion retires the row regardless of its recorded status, so
      // an accepted finding that was repaired anyway still reports resolved.
      state: outcome.held ? 'resolved' : finding.status,
      detail: outcome.detail,
    }
  })
  // Oldest first by opened date; the most-audited row breaks a tie so the
  // headline names the finding with the longest record of being reported.
  rows.sort((left, right) => left.opened.localeCompare(right.opened)
    || right.auditsSeen - left.auditsSeen
    || left.id.localeCompare(right.id))
  return { ok: true, faults: [], rows }
}

/**
 * Render the advisory block the Court Gate prints above its pass/fail line.
 *
 * @param evaluation - the result of {@link evaluateOpenFindings}.
 * @returns the lines to print, without a trailing newline on any line.
 */
export function formatOpenFindingsAdvisory(evaluation) {
  if (!evaluation.ok) {
    return [
      '',
      `  OPEN FINDINGS UNAVAILABLE — ${OPEN_FINDINGS_PATH} was not read; this does not affect the gate verdict.`,
      ...evaluation.faults.map(fault => `    ${fault}`),
    ]
  }
  const open = evaluation.rows.filter(row => row.state === 'open')
  const accepted = evaluation.rows.filter(row => row.state === 'accepted')
  const resolved = evaluation.rows.filter(row => row.state === 'resolved')
  const lines = ['']
  const oldest = open[0] ?? accepted[0] ?? null
  lines.push(oldest === null
    ? `  ${open.length} OPEN FINDINGS`
    : `  ${open.length} OPEN FINDINGS  (oldest: ${oldest.id}, seen by ${oldest.auditsSeen} audits)`)
  for (const row of open) lines.push(`    ${row.id}  ${row.subject}  ${row.what}`)
  for (const row of accepted) lines.push(`    ACCEPTED  ${row.id}  ${row.subject}  ${row.what}`)
  for (const row of resolved) lines.push(`    RESOLVED  ${row.id}  ${row.subject}  assertion now holds; remove this row`)
  return lines
}
