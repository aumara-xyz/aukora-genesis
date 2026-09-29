/**
 * OpenShell containment adapter, Increment 1, STAGE.
 *
 * The only closed effect this stage will carry toward is workspace.patch:
 * one preimage-bound UTF-8 replacement, executed by the existing broker
 * outside the workload. This file does not call that broker, does not spawn
 * OpenShell, and does not forward the Aumlok signer socket.
 *
 * A string tripwire on mount paths has the same limit as the action gate's
 * shell reading: a renamed path can hide a target. Mount inspection that
 * would catch that is court O04, which stays UNRUN.
 *
 * @module @aukora/containment/adapter
 */
import {
  PLACEMENT,
  REFUSAL,
  REQUIRED_FILESYSTEM_COMPATIBILITY,
  STAGE,
} from './placement.mjs'

/** Closed effect name. Must stay equal to the carried broker definition. */
export const CLOSED_EFFECT = 'workspace.patch'

const SHELL_EFFECTS = new Set(['shell', 'bash', 'sh', 'exec', 'compute.job'])
const MAX_MOUNT = 1024

/**
 * @param {string} code
 * @param {string} message
 * @returns {Error}
 */
function refuse(code, message) {
  const error = new Error(message)
  error.code = code
  return error
}

/**
 * @param {unknown} value
 * @returns {value is Record<string, unknown>}
 */
function isRecord(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

/**
 * Home, support, signer, engine-socket, and push-credential shapes.
 * @param {unknown} value
 * @returns {boolean}
 */
export function isProtectedMountShape(value) {
  if (typeof value !== 'string' || value.length === 0 || value.length > MAX_MOUNT) return false
  const text = value.replaceAll('\\', '/')
  if (text === '~' || text.startsWith('~/')) return true
  if (text === '/Users' || text.startsWith('/Users/')) return true
  if (text === '/home' || text.startsWith('/home/')) return true
  if (text.includes('Application Support/AUKORA')) return true
  if (text.includes('aumlok-signer.sock')) return true
  if (text === '/var/run/docker.sock' || text.endsWith('/docker.sock')) return true
  if (text.includes('/.ssh') || text.endsWith('/.ssh')) return true
  if (text.includes('.git-credentials')) return true
  if (text.includes('/.config/gh')) return true
  return false
}

/**
 * @param {Record<string, unknown>} request
 * @returns {string[]}
 */
function mountTexts(request) {
  const mounts = request.mounts
  if (mounts === undefined) return []
  if (!Array.isArray(mounts)) throw refuse(REFUSAL.requestShape, 'containment: mounts must be a list of strings')
  return mounts.map(item => {
    if (typeof item !== 'string') throw refuse(REFUSAL.requestShape, 'containment: each mount must be a string')
    return item
  })
}

/**
 * Judge one workload request. Forbidden placements throw. A closed
 * workspace.patch proposal returns NOT_WIRED and executes nothing.
 *
 * @param {unknown} request
 * @returns {Readonly<{status: 'NOT_WIRED', executed: false, effect: string, placement: 'outside', owner: string}>}
 */
export function admitWorkloadRequest(request) {
  if (!isRecord(request)) throw refuse(REFUSAL.requestShape, 'containment: request must be an object')
  if (request.forwardSignerSocket === true) {
    throw refuse(REFUSAL.signerSocketForward, 'containment: the signer socket stays outside the workload')
  }
  if (request.mountHome === true) {
    throw refuse(REFUSAL.homeMount, 'containment: the owner home is not a workload mount')
  }
  if (request.universalShell === true) {
    throw refuse(REFUSAL.universalShell, 'containment: OpenShell policy is a reachability ceiling, not a shell effect')
  }
  if (request.workerPolicyChange === true) {
    throw refuse(REFUSAL.workerPolicy, 'containment: the worker cannot change its own containment')
  }
  const mounts = mountTexts(request)
  if (mounts.some(isProtectedMountShape)) {
    const signer = mounts.some(item => item.includes('aumlok-signer.sock'))
    throw refuse(
      signer ? REFUSAL.signerSocketForward : REFUSAL.homeMount,
      signer
        ? 'containment: a mount names the signer socket'
        : 'containment: a mount names a home, key, or engine socket',
    )
  }
  const effect = request.effect
  if (typeof effect !== 'string' || effect.length === 0 || effect.length > 128) {
    throw refuse(REFUSAL.requestShape, 'containment: effect must be a short string')
  }
  if (SHELL_EFFECTS.has(effect)) {
    throw refuse(REFUSAL.universalShell, `containment: ${effect} is not the Increment 1 effect`)
  }
  if (effect !== CLOSED_EFFECT) {
    throw refuse(REFUSAL.universalShell, `containment: ${effect} is outside the closed Increment 1 effect`)
  }
  return Object.freeze({
    status: 'NOT_WIRED',
    executed: false,
    effect: CLOSED_EFFECT,
    placement: 'outside',
    owner: 'plugins/aukora-box/aukora/broker/workspace-patch.mjs',
  })
}

/**
 * A profile keyword is not a launch. hard_requirement is the only compatibility
 * this stage will accept, and acceptance still leaves the backend unwired.
 *
 * @param {unknown} profile
 * @returns {Readonly<{status: 'NOT_WIRED', accepted: false, compatibility: string, insideWorkload: readonly string[], outsideWorkload: readonly string[]}>}
 */
export function admitProfile(profile) {
  if (!isRecord(profile)) throw refuse(REFUSAL.requestShape, 'containment: profile must be an object')
  if (profile.compatibility !== REQUIRED_FILESYSTEM_COMPATIBILITY) {
    throw refuse(REFUSAL.bestEffort, 'containment: a required filesystem policy must be hard_requirement')
  }
  if (profile.mountHome === true || profile.forwardSignerSocket === true) {
    throw refuse(
      profile.forwardSignerSocket === true ? REFUSAL.signerSocketForward : REFUSAL.homeMount,
      'containment: profile names a forbidden mount',
    )
  }
  return Object.freeze({
    status: 'NOT_WIRED',
    accepted: false,
    compatibility: REQUIRED_FILESYSTEM_COMPATIBILITY,
    insideWorkload: PLACEMENT.insideWorkload,
    outsideWorkload: PLACEMENT.outsideWorkload,
  })
}

/**
 * Stage banner. Callers that need a running worker stop here.
 *
 * @returns {Readonly<typeof STAGE>}
 */
export function stageBanner() {
  return STAGE
}
