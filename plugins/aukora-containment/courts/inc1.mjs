/**
 * Increment 1 qualification cases.
 *
 * Each row is UNRUN. This module does not start OpenShell, Docker, or the
 * desktop app, and it does not count a row as a pass. CI can import the list.
 * It cannot execute the metal.
 *
 * @module @aukora/containment/courts/inc1
 */

/**
 * @param {string} id
 * @param {string} observation
 * @returns {Readonly<{id: string, observation: string, status: 'UNRUN', executableInCi: false}>}
 */
function unrun(id, observation) {
  return Object.freeze({ id, observation, status: 'UNRUN', executableInCi: false })
}

/** B01, B02, and O01–O08. Later OpenShell cases stay out of this increment. */
export const INC1_CASES = Object.freeze([
  unrun('B01', 'A valid bounded workspace.patch with valid independent authority changes exactly the selected resource to the approved bytes, and the result is recorded.'),
  unrun('B02', 'The same proposal without a grant leaves the protected resource unchanged and admits no execution.'),
  unrun('O01', 'The pinned backend starts only after boundary confirmation, and the driver and runtime identities are retained.'),
  unrun('O02', 'A missing required filesystem policy or kernel feature does not launch a protected workload and does not graduate best-effort.'),
  unrun('O03', 'Scratch inside the workload succeeds, and the protected target stays inaccessible without broker authorization.'),
  unrun('O04', 'Workload mounts, environment, handles, and image show no host home, control store, signer key, engine socket, or gateway-admin credential.'),
  unrun('O05', 'A child of a permitted tool keeps the same or a narrower envelope and gains no host-side alternative.'),
  unrun('O06', 'Cordis service lookup or plugin removal adds no effect path, and a stale bridge generation admits nothing.'),
  unrun('O07', 'An unavailable supervisor channel stops protected admissions, and control recovery stays reachable.'),
  unrun('O08', 'A gateway or control request authenticated only as an ordinary worker is denied, and a separately authorized positive control succeeds.'),
])

/**
 * @param {unknown} id
 * @returns {Readonly<{id: string, observation: string, status: 'UNRUN', executableInCi: false}>}
 */
export function qualificationCase(id) {
  if (typeof id !== 'string' || id.length === 0) throw new TypeError('containment: case id must be a string')
  const found = INC1_CASES.find(item => item.id === id)
  if (found === undefined) throw new TypeError(`containment: unknown case ${id}`)
  if (found.status !== 'UNRUN' || found.executableInCi !== false) {
    throw new Error(`containment: ${id} left the UNRUN label`)
  }
  return found
}
