/**
 * What a face must still show after a push, checked against a snapshot of the accessibility tree.
 *
 * WHY THIS IS A SEPARATE MODULE FROM THE DOOR. The door answers "what is on screen"; this answers "is
 * what is on screen still the thing we shipped". Keeping them apart means the invariants can be reasoned
 * about, tested and mutated without a browser or a debugger: the input is a snapshot object, the output
 * is a verdict naming what is missing. The live half — take a snapshot after a face-dev-push, run this,
 * and push the previous bundle back if it fails — is a caller of both.
 *
 * ROLE **AND** NAME, NEVER EITHER ALONE. A control that kept its name but changed role is not the same
 * control (a `button` that became a `link` no longer submits), and a control that kept its role but lost
 * its name is no longer findable by the model that has to aim at it. Both are required, so a face that
 * silently swapped one for the other cannot pass by satisfying half the check.
 */

/** @typedef {{ ref: string, role: string, name: string }} SnapshotNode */

/**
 * Check a snapshot against the controls a face must still present.
 *
 * @param snapshot - the door's answer: `{ nodes: SnapshotNode[] }`.
 * @param expectations - `{ required: Array<{role: string, name: string}>, mainTarget?: boolean }`.
 * @returns `{ ok, missing, present }` where `missing` names every unmet expectation in plain words.
 */
export function checkFaceInvariants(snapshot, expectations = {}) {
  const nodes = Array.isArray(snapshot?.nodes) ? snapshot.nodes : []
  const required = Array.isArray(expectations.required) ? expectations.required : []
  const missing = []

  // THE MAIN TARGET IS NOT OPTIONAL. A snapshot with no root document is not a face that lost a button;
  // it is a window that is not there, and every other check below would pass vacuously against it.
  const wantsMain = expectations.mainTarget ?? true
  const hasRoot = nodes.some(node => node.role === 'RootWebArea' || node.role === 'WebArea')
  if (wantsMain && !hasRoot) missing.push('the main target (no RootWebArea in the snapshot)')

  const present = []
  for (const want of required) {
    // AN ENTRY WITH NO NAME ASKS A WEAKER QUESTION ON PURPOSE. Some controls have no stable name to pin:
    // the composer's accessible name is its PLACEHOLDER, which changes with what the app is asking for —
    // measured live, where the same textbox read "Message or run a task, / commands, @ files or sessions"
    // in one snapshot and "Type your answer" in the next, because the app had moved on to asking a
    // question. Pinning that string would fail a healthy face, and dropping the control entirely would
    // stop noticing when the input is gone. So `{role: 'textbox'}` means "an input still exists", and any
    // entry that DOES name a control keeps the strict role-and-name rule.
    const byName = want.name !== undefined && want.name !== null && want.name !== ''
    const found = nodes.find(node => node.role === want.role && (byName !== true || node.name === want.name))
    if (found === undefined) {
      const sameName = byName ? nodes.find(node => node.name === want.name) : undefined
      missing.push(byName
        ? (sameName === undefined
            ? `no ${want.role} named "${want.name}"`
            : `"${want.name}" is present as ${sameName.role}, not ${want.role}`)
        : `no ${want.role} at all`)
    } else present.push({ ref: found.ref, role: found.role, name: found.name })
  }
  if (nodes.length === 0) missing.push('the snapshot is empty')
  return { ok: missing.length === 0, missing, present }
}

/**
 * The message a failed push reports, and the bundle it says to restore.
 *
 * A FAILURE THAT NAMES NOTHING IS NOT A FAILURE ANYONE CAN ACT ON, so the report carries the missing
 * controls and the previous bundle's path, and the caller pushes that path back.
 * @param verdict - the result of `checkFaceInvariants`.
 * @param previousBundle - where the bundle from before the push lives.
 * @returns the line to print, or an empty string when there is nothing to report.
 */
export function describeInvariantFailure(verdict, previousBundle) {
  if (verdict?.ok !== false) return ''
  return `face invariants FAILED: ${verdict.missing.join('; ')} — restore ${previousBundle} and re-push`
}
