/** One declarative assertion. The predicate is selected from `kind`; no operand is ever evaluated as source. */
export type OpenFindingAssertion =
  | { kind: 'fileContains', path: string, needle: string }
  | { kind: 'fileLacks', path: string, needle: string }
  | { kind: 'pathExists', path: string }

/** Recorded row state. `accepted` is the only state that keeps a row whose assertion does not hold. */
export type OpenFindingStatus = 'open' | 'accepted'

/** Row state after evaluation. `resolved` is derived from the assertion, never recorded. */
export type OpenFindingState = OpenFindingStatus | 'resolved'

/** One manifest row, as validated by {@link loadOpenFindings}. */
export interface OpenFinding {
  id: string
  subject: string
  what: string
  assertion: OpenFindingAssertion
  assertionCeiling: string
  status: OpenFindingStatus
  opened: string
  auditsSeen: number
  sources: string[]
  acceptedBy?: string
  acceptedReason?: string
}

/** One evaluated row. `detail` explains a state of `open` or `accepted`, and is null when the assertion holds. */
export interface OpenFindingRow {
  id: string
  subject: string
  what: string
  opened: string
  auditsSeen: number
  sources: string[]
  state: OpenFindingState
  detail: string | null
}

/** Manifest revision this module accepts. */
export declare const OPEN_FINDINGS_SCHEMA_VERSION: number

/** Repository-relative location of the manifest. */
export declare const OPEN_FINDINGS_PATH: string

/** The closed set of assertion kinds. */
export declare const ASSERTION_KINDS: readonly OpenFindingAssertion['kind'][]

/** The closed set of recorded row states. */
export declare const FINDING_STATUSES: readonly OpenFindingStatus[]

export declare function loadOpenFindings(root: string): {
  ok: boolean
  faults: string[]
  findings: OpenFinding[]
}

export declare function evaluateAssertion(
  root: string,
  assertion: OpenFindingAssertion,
): { held: boolean, detail: string | null }

export declare function evaluateOpenFindings(root: string): {
  ok: boolean
  faults: string[]
  rows: OpenFindingRow[]
}

export declare function formatOpenFindingsAdvisory(
  evaluation: { ok: boolean, faults: string[], rows: OpenFindingRow[] },
): string[]
