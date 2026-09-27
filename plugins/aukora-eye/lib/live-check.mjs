/**
 * The live check: one command that answers "is the face that is running still the face we shipped".
 *
 *   snapshot → checkFaceInvariants → push the previous bundle back on failure
 *
 * WHY IT IS A MODULE AND NOT A SCRIPT. Every decision here is one a court has to be able to make without
 * a browser, an app or a release: whether a refusal from the door is a broken face or a shut door (they
 * are different answers and only one of them justifies a rollback), whether a digest really is a function
 * of the tree, and whether a push-back that failed is reported as a failed restore rather than a
 * successful one. `scripts/eye/live-check.mjs` is the thin wrapper that reads the environment and prints.
 *
 * WHAT IT NEVER DOES. It does not treat a refusal as evidence about the face: a door answering
 * `eye.bind-surface-open` has told us nothing about whether the face lost a control, so nothing is pushed
 * back on a refusal. And it does not call a failed restore a restore.
 */
import { spawn } from 'node:child_process'
import { createHash } from 'node:crypto'
import { checkFaceInvariants, describeInvariantFailure } from './invariants.mjs'
import { isLoopbackUrl } from './capture.mjs'

/** A refusal that is not about the face: the check could not run, or the door would not answer. */
export class LiveCheckRefusal extends Error {
  constructor(code, message) {
    super(message)
    this.name = 'LiveCheckRefusal'
    this.code = code
  }
}

/**
 * A digest of the snapshot, so "the same screen" is a checkable claim rather than a recollection.
 *
 * The canonical form is role, name and ref per node, in the order the door returned them, NUL-separated
 * and newline-joined: refs are already derived from role + name + ordinal, so this digest changes when a
 * control is added, removed, renamed or re-roled, and stays put when nothing about the face changed.
 * @param snapshot - the door's answer.
 * @returns the digest, hex.
 */
export function snapshotSha(snapshot) {
  const nodes = Array.isArray(snapshot?.nodes) ? snapshot.nodes : []
  const canonical = nodes.map(node => `${node.role}\u0000${node.name}\u0000${node.ref}`).join('\n')
  return createHash('sha256').update(canonical, 'utf8').digest('hex')
}

/** Run a push-back command, resolving with its exit status rather than throwing. */
function runCommand(command, args, { timeoutMs = 120_000 } = {}) {
  return new Promise(resolve => {
    let settled = false
    const done = (value) => { if (!settled) { settled = true; resolve(value) } }
    let child
    try {
      child = spawn(command, args, { stdio: ['ignore', 'pipe', 'pipe'] })
    } catch (error) {
      done({ ok: false, status: null, output: String(error?.message ?? error) })
      return
    }
    let output = ''
    child.stdout?.on('data', chunk => { output += chunk })
    child.stderr?.on('data', chunk => { output += chunk })
    const timer = setTimeout(() => { child.kill('SIGTERM'); done({ ok: false, status: null, output: `${output}\n(timed out after ${timeoutMs} ms)` }) }, timeoutMs)
    child.on('error', error => { clearTimeout(timer); done({ ok: false, status: null, output: String(error?.message ?? error) }) })
    child.on('close', status => { clearTimeout(timer); done({ ok: status === 0, status, output }) })
  })
}

/**
 * Take a snapshot, judge it, and put the previous bundle back if the face lost something.
 *
 * @param options - `{url, token, required, previousBundle, pushBack, fetchImpl, timeoutMs}`.
 *   `pushBack` is an argv array whose first element is the command; `--release <previousBundle>` is
 *   appended, which is how `scripts/face-dev-push.py` is invoked.
 * @returns `{ok, snapshotSha, missing, present, restored, refused, report}`.
 */
export async function runLiveCheck({
  url, token, required = [], previousBundle, pushBack, fetchImpl,
  timeoutMs = 30_000,
} = {}) {
  if (typeof url !== 'string' || url === '') throw new LiveCheckRefusal('eye.not-configured', 'no eye url was given')
  if (!isLoopbackUrl(url)) {
    throw new LiveCheckRefusal('eye.not-loopback', `${url} is not loopback; this check talks to this machine's eye and nowhere else`)
  }
  if (typeof token !== 'string' || token === '') {
    throw new LiveCheckRefusal('eye.token-absent', 'no eye token was given; the door refuses every request without one')
  }
  if (!Array.isArray(pushBack) || pushBack.length === 0) {
    throw new LiveCheckRefusal('eye.no-push-back', 'no push-back command was given, so a failure could not be undone')
  }
  if (typeof previousBundle !== 'string' || previousBundle === '') {
    throw new LiveCheckRefusal('eye.no-previous-bundle', 'no previous bundle was named, so there is nothing to restore')
  }

  const doFetch = fetchImpl ?? fetch
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  let response
  try {
    response = await doFetch(`${url.replace(/\/+$/u, '')}/eye/snapshot`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
      body: JSON.stringify({}),
      signal: controller.signal,
    })
  } catch (error) {
    clearTimeout(timer)
    throw new LiveCheckRefusal('eye.unreachable', `the eye door could not be reached: ${error?.message ?? error}`)
  }
  clearTimeout(timer)

  if (response.ok !== true) {
    let code = `eye.http-${response.status}`
    try {
      const body = await response.json()
      if (typeof body?.code === 'string') code = body.code
    } catch { /* a refusal with no JSON body still names itself by status */ }
    // A REFUSAL IS NOT A BROKEN FACE. Nothing is pushed back on a refusal: the door has said it will not
    // show this surface, which says nothing about whether the face still carries its controls.
    // AND A 404 IS NOT A CODE PROBLEM, IT IS A RELEASE PROBLEM. Measured on the live app before the routes
    // shipped: /eye/capture answered 401 (the door is up) while /eye/snapshot answered 404, which means the
    // running release predates self-sight. Saying that out loud saves the reader from debugging a route
    // that is not there.
    const diagnosis = (code === 'eye.not-found' || code === 'eye.http-404')
      ? 'the door is live but this release does not serve /eye/snapshot — the running release predates the self-sight routes; relaunch onto a release cut from main'
      : null
    return {
      ok: false, refused: code, snapshotSha: null, missing: [], present: [],
      restored: false, diagnosis,
      report: `LIVE CHECK refused by the door: ${code} — nothing pushed back, because a shut door is not evidence about the face`
        + (diagnosis === null ? '' : ` (${diagnosis})`),
    }
  }

  const snapshot = await response.json()
  const digest = snapshotSha(snapshot)
  const verdict = checkFaceInvariants(snapshot, { required })
  if (verdict.ok !== false) {
    return {
      ok: true, refused: null, snapshotSha: digest, missing: [], present: verdict.present,
      restored: false,
      report: `LIVE CHECK PASSED: snapshot ${digest.slice(0, 16)}…, ${verdict.present.length} required control(s) present`,
    }
  }

  const failure = describeInvariantFailure(verdict, previousBundle)
  const restored = await runCommand(pushBack[0], [...pushBack.slice(1), '--release', previousBundle])
  if (restored.ok === false) {
    return {
      ok: false, refused: null, snapshotSha: digest, missing: verdict.missing, present: verdict.present,
      restored: false,
      report: `${failure} — AND THE RESTORE FAILED (exit ${restored.status}): ${restored.output.trim().slice(0, 200)}`,
    }
  }
  return {
    ok: false, refused: null, snapshotSha: digest, missing: verdict.missing, present: verdict.present,
    restored: true,
    report: `${failure} — restored`,
  }
}
