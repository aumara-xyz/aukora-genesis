/**
 * Friend-facing prototype status. One surface, so a narrow reading cannot turn a missing
 * fact into "security is on" or a refused owner operation into a silent success.
 *
 * WHAT THIS MODULE DOES NOT DO: it does not sign, it does not open a window, and it does
 * not set a security flag. Every flag below is false. A caller that passes `true` is ignored.
 * Consequential owner operations fail closed: `signed` is false on every return.
 *
 * NOT ENFORCED, and this object says so: same-UID agents, a software approval key, no
 * server-side check on GitHub main, a click recorded but not bound to a person.
 *
 * @module prototype-status
 */

/** Wire atom. Spaces are illegal on the approval refusal field, so the sentence lives beside it. */
export const OWNER_ONLY_CODE = 'aumlok:owner-only'

/**
 * What a person is told when Airlock or the owner's second account is not on this Mac.
 * UID 602 is that account on the owner's Mac. A friend's Mac does not have it.
 */
export const OWNER_ONLY_MESSAGE = 'Owner-only. This Mac has no Airlock and no second account (UID 602 on the owner\'s Mac). Nothing was signed.'

/** First-run posture. The words PROTOTYPE and "analyst preview" are the copy, not a claim of readiness. */
export const POSTURE = 'PROTOTYPE'
export const PREVIEW = 'analyst preview'

export const LAB_LINE = 'PROTOTYPE — analyst preview. This Mac build says what works and what does not, and it will not pretend owner security is on.'

/**
 * Security flags. They stay false. Reporting Airlock as present is an observation,
 * not a reason to flip one of these.
 */
export const SECURITY_FLAGS = Object.freeze({
  airlockBoundaryEnforced: false,
  secondUidEnforced: false,
  serverSideMainCheck: false,
  personBoundClick: false,
  seatbeltOnDangerFullAccessSessions: false,
})

/** Limits this preview does not pretend to close. */
export const NOT_ENFORCED = Object.freeze([
  'Same-UID agents are not an isolation boundary.',
  'The approval key is software on this Mac.',
  'GitHub does not check main.',
  'A click is recorded. It is not proof of who clicked.',
])

/**
 * Opening the unsigned Mac app. These steps do not disable Gatekeeper.
 * Turning Gatekeeper off is not a step this preview offers.
 */
export const GATEKEEPER_STEPS = Object.freeze([
  'This build is unsigned. macOS Gatekeeper blocks the first open.',
  'In Finder, Control-click AUKORA and choose Open, then Open.',
  'If macOS still blocks it: System Settings, Privacy & Security, Open Anyway.',
  'Do not turn Gatekeeper off. This prototype does not ask for that.',
])

/**
 * Paths that raise an approval window, named from the code that actually raises one.
 * A path that only prepares text and prints it is not in this list.
 */
export const RAISE_PATHS = Object.freeze([
  Object.freeze({
    file: 'apps/aukora-desktop/main.mjs',
    raises: 'passes ask: request => aumlok.ask(request) into the shell signer',
  }),
  Object.freeze({
    file: 'apps/aukora-desktop/aumlok-signer.mjs',
    raises: 'reviewFromAsk calls that ask before any signature',
  }),
  Object.freeze({
    file: 'apps/aukora-desktop/aumlok-bridge.mjs',
    raises: 'openApprovalWindow is the only window this bridge opens; it loads aumlok-approval.html',
  }),
  Object.freeze({
    file: 'plugins/aukora-aumlok/lib/signer-channel.mjs',
    raises: 'approve() dials the signer socket; that dial is what reaches the ask',
  }),
  Object.freeze({
    file: 'scripts/aukora/self-change.mjs',
    raises: 'asks the approval window for a code change; --preview does not raise',
  }),
  Object.freeze({
    file: 'scripts/aukora/advance.mjs',
    raises: 'asks the same window to move main',
  }),
  Object.freeze({
    file: 'scripts/aukora/plugin-set.mjs',
    raises: 'approve asks the same window for one plugin-set; prepare raises nothing',
  }),
])

/** One observation: present, missing, or unknown. Anything else is unknown, never present. */
function observedOf(value) {
  if (value === 'present' || value === 'missing') return value
  return 'unknown'
}

/**
 * The status a friend-facing screen and a refusal can share.
 *
 * @param {{airlock?: string, secondUid?: string}} [observed] - what this process could see.
 *   `present` is the only positive value. Unknown is not present.
 * @returns {Readonly<Record<string, unknown>>} frozen status. Security flags are the frozen false set.
 */
export function prototypeStatus(observed = {}) {
  const airlock = observedOf(observed?.airlock)
  const secondUid = observedOf(observed?.secondUid)
  const ownerOnly = airlock !== 'present' || secondUid !== 'present'
  return Object.freeze({
    posture: POSTURE,
    preview: PREVIEW,
    platform: 'macOS',
    lab: LAB_LINE,
    securityFlags: SECURITY_FLAGS,
    observed: Object.freeze({ airlock, secondUid }),
    ownerOps: 'fail-closed',
    ownerOnly,
    ownerOnlyCode: OWNER_ONLY_CODE,
    ownerOnlyMessage: OWNER_ONLY_MESSAGE,
    notEnforced: NOT_ENFORCED,
    gatekeeperSteps: GATEKEEPER_STEPS,
    raisePaths: RAISE_PATHS,
  })
}

/**
 * Consequential owner operations. This function never signs and never returns proceed.
 * A caller-supplied flag is not read. Missing or unknown Airlock, or a missing or unknown
 * second account, is the owner-only refusal. Both present is still not an authorization:
 * the signer and the popup decide, and this surface does not stand in for them.
 *
 * @param {object} [observed]
 * @returns {Readonly<{action: 'refuse', signed: false, reason: string, message: string}>}
 */
export function consequentialOwnerDecision(observed) {
  const status = prototypeStatus(observed)
  if (status.ownerOnly) {
    return Object.freeze({
      action: 'refuse',
      signed: false,
      reason: OWNER_ONLY_CODE,
      message: OWNER_ONLY_MESSAGE,
    })
  }
  return Object.freeze({
    action: 'refuse',
    signed: false,
    reason: 'aumlok:not-authorized-here',
    message: 'Airlock and UID 602 were reported present. This preview does not sign owner operations.',
  })
}

/**
 * The detail to show for an owner-only wire refusal, or null when the refusal is some other name.
 * Binding this Mac is not the remedy, so this is not a "not ready" refusal.
 *
 * @param {unknown} refusal
 * @returns {string|null}
 */
export function ownerOnlyDetail(refusal) {
  return refusal === OWNER_ONLY_CODE ? OWNER_ONLY_MESSAGE : null
}

/**
 * Whether an Airlock error means the daemon or the second account is not there.
 * A bad signature, a challenge mismatch, or an oversized reply is a different fact
 * and stays a refusal under its own name.
 *
 * @param {unknown} error
 * @returns {boolean}
 */
export function airlockFailureIsOwnerOnly(error) {
  const code = error !== null && typeof error === 'object' && 'code' in error ? String(error.code) : ''
  const message = error !== null && typeof error === 'object' && 'message' in error
    ? String(error.message)
    : String(error ?? '')
  return /peer-uid|peer-unavailable|ECONNREFUSED|ENOENT|ECONNRESET|ETIMEDOUT|EACCES|airlock:timeout|airlock:closed|airlock:peer/u.test(`${code} ${message}`)
}
