/**
 * THE `core` PRESET'S READ DENY, AS A PURE DECISION.
 *
 * CORE is the conductor inside Auma and it does NOT hold Peter's authority. It has no shell and no
 * network (`presets/core/agent.cordis.yml` disables both), and until this module it could still READ
 * the files that stand in for that authority: the launch state, the lane door, the eye, the gate
 * state, the Kira keys, every socket, and the two binaries that approve and present.
 *
 * **THIS MODULE DECIDES; IT DOES NOT REACH THE FILESYSTEM.** It takes a preset name and an
 * already-resolved target and answers with `null` or a named refusal, so the decision can be measured
 * against fixtures without mounting a service, and so the thing that decides is not the thing that
 * reads.
 *
 * @module @aukora/dsh-plugin-core-read-deny/policy
 */

/** The preset this module exists for, and the name a session projection carries for it. */
export const CORE_PRESET = 'core'

/** Why a read was refused. A caller that gets this can say which door it met, not merely that it failed. */
export const CORE_READ_REFUSE = Object.freeze({
  /** CORE asked to read a path that states or carries the owner's authority. */
  READ_DENIED: 'aukora-core:read-denied',
  /** A session is reading and its preset could not be established, so the read cannot be cleared. */
  READER_UNKNOWN: 'aukora-core:reader-unknown',
})

/**
 * THE PATHS, EACH WITH THE MATCH THAT IS ACTUALLY TRUE OF IT.
 *
 * `dir` matches the directory and everything beneath it; `file` matches exactly one path; `basename`
 * matches that name in any directory; `suffix` matches by ending. **THEY ARE SEPARATE KINDS BECAUSE A
 * SINGLE PREFIX TEST WOULD BE WRONG FOR ALL OF THEM**: `state/eye` must not match `state/eyeful`, and
 * `*.sock` has no directory of its own to sit in.
 */
export const CORE_PROTECTED = Object.freeze([
  Object.freeze({ id: 'launch-state', kind: 'file', path: 'state/launch.json', why: 'the launch state names what is running with whose authority' }),
  Object.freeze({ id: 'lane-door', kind: 'dir', path: 'state/lane-door', why: 'the lane door carries messages between lanes' }),
  Object.freeze({ id: 'eye', kind: 'dir', path: 'state/eye', why: 'the eye is the owner\'s screen' }),
  Object.freeze({ id: 'gate-state', kind: 'dir', path: 'gate-state', why: 'the gate state decides what may pass' }),
  Object.freeze({ id: 'kira-keys', kind: 'dir', path: 'kira-memory/keys', why: 'the Kira keys sign as the owner' }),
  Object.freeze({ id: 'socket', kind: 'suffix', suffix: '.sock', why: 'a socket is a live door into a privileged process' }),
  Object.freeze({ id: 'kira-approve-queue', kind: 'basename', basename: 'kira-approve-queue', why: 'the approve queue is where the owner\'s yes is spent' }),
  Object.freeze({ id: 'owner-console', kind: 'basename', basename: 'owner-console', why: 'the owner console is the owner\'s own instrument' }),
])

/**
 * Whether a preset value is the UNKNOWN-READER sentinel.
 *
 * **A SHAPE TEST RATHER THAN AN IMPORT, SO THE DECISION DOES NOT DEPEND ON THE MODULE THAT PRODUCES THE
 * SENTINEL.** The policy must be usable by a caller that supplies its own reader lookup — a court, a test, a
 * later provider — and a decision that could only recognise one object identity would be a decision those
 * callers could not satisfy. The marker is frozen and documented in `preset.mjs`.
 *
 * @param {unknown} preset - the value the reader lookup returned.
 * @returns {boolean} true when the reader is present but could not be named.
 */
export function isUnknownReader(preset) {
  return preset !== null && typeof preset === 'object' && preset.reader === 'unknown'
}

/** The separators a target may use, so a match does not depend on which one a caller wrote. */
const SEPARATORS = /\\/gu

/**
 * Normalize a path for matching: forward slashes, no trailing separator, no `./` segments.
 *
 * **THIS IS NOT A SECURITY BOUNDARY AND MUST NOT BE TREATED AS ONE.** It removes the spellings that
 * would let two names for one file disagree; **the caller is still responsible for having resolved
 * symlinks before it asks**, because `..` and a symlink can only be settled against the real
 * filesystem. {@link coreReadRefusal} says so in its own contract.
 *
 * @param {string} path - the path to normalize.
 * @returns {string} the normalized path.
 */
export function normalizeForMatch(path) {
  const slashed = String(path).replace(SEPARATORS, '/')
  const segments = []
  for (const segment of slashed.split('/')) {
    if (segment === '' || segment === '.') continue
    if (segment === '..' && segments.length > 0 && segments[segments.length - 1] !== '..') {
      segments.pop()
      continue
    }
    segments.push(segment)
  }
  return `${slashed.startsWith('/') ? '/' : ''}${segments.join('/')}`
}

/**
 * Whether `target` is `path` itself or something beneath it, **COMPARED BY SEGMENT**.
 *
 * **A STRING PREFIX IS NOT CONTAINMENT.** `state/eye` is a prefix of `state/eyeful`, and a check that
 * used `startsWith` would protect a directory nobody named while leaving the real one's siblings open.
 *
 * **AND THE TWO ARGUMENTS ARE NOT THE SAME KIND OF PATH, WHICH IS WHAT AN EARLIER VERSION GOT WRONG.**
 * MEASURED, by this court's own mutation run: the caller passes an ABSOLUTE target and a rule passes a
 * RELATIVE path, so `target.startsWith(path)` compared `/opt/aukora/state/eye/x` against `state/eye`,
 * **was false for every input, and never once decided anything.** The `dir` rules appeared to work
 * because two other clauses in `matches` happened to cover them — which is to say **the containment
 * test was dead code standing beside a live accident.** A mutation aimed at it reported, correctly,
 * that removing it changed nothing this court could see.
 *
 * So the comparison is made on the SEGMENTS the target ends with, which is well defined whichever
 * kind of path the rule carries.
 *
 * @param {string} target - a normalized target path.
 * @param {string} path - a normalized container path, absolute or relative.
 * @returns {boolean} true when target is the container or inside it.
 */
export function isUnder(target, path) {
  if (target === path) return true
  if (target.endsWith(`/${path}`)) return true
  return target.includes(`/${path}/`)
}

/**
 * The refusal for one read, or `null` when the read is allowed.
 *
 * **DENY TAKES PRECEDENCE: THIS FUNCTION HAS NO ALLOW LIST.** A target that matches any protected row
 * is refused, and there is no path by which a later rule reinstates it. The only way to be allowed is
 * to match nothing.
 *
 * **THE TARGET MUST ALREADY BE RESOLVED.** Pass the real path — `realpathSync`, not `resolve` — because
 * a symlink whose link text is innocent and whose referent is `kira-memory/keys` is a read of the
 * keys. This function cannot check that for you and does not pretend to: it compares the string it is
 * given, and {@link coreReadRefusal} names the caller's obligation in its own refusal when it denies.
 *
 * @param {object} input - the read being considered.
 * @param {string|undefined} input.preset - the reading session's preset, from its `agentPreset` projection.
 * @param {string} input.target - the absolute, symlink-resolved path being read.
 * @param {readonly object[]} [input.rules] - the protected rows; defaults to {@link CORE_PROTECTED}.
 * @returns {{code: string, rule: string, target: string, why: string}|null} the refusal, or null.
 */
export function coreReadRefusal({ preset, target, rules = CORE_PROTECTED }) {
  // **A READER NOBODY CAN NAME IS REFUSED BEFORE ANYTHING ELSE IS CONSIDERED (CODEX SWEEP, FINDING 2).**
  // MEASURED: this function returned `null` for anything that was not `core`, INCLUDING `undefined` — so
  // every way of FAILING to identify the reader was a GRANT, and the reader it granted was the one nobody
  // could name. **The refusal is its own name, distinct from `READ_DENIED`, because "this is CORE" and "I do
  // not know who this is" are different complaints and an operator needs to know which one they met.**
  if (isUnknownReader(preset)) {
    return Object.freeze({
      code: CORE_READ_REFUSE.READER_UNKNOWN,
      rule: 'unknown-reader',
      target: typeof target === 'string' ? normalizeForMatch(target) : String(target),
      why: 'a session is reading and this daemon could not establish which preset it belongs to, so the read '
        + 'cannot be cleared. An unknown reader is not a host reader: a host read has NO session, and this '
        + 'one has a session nobody can name',
    })
  }
  // **ONLY THE `core` PRESET IS SUBJECT TO THE TARGET RULES.** Every other preset — and a host reader with
  // no session at all — reads exactly as it did before this module existed. That is the whole of
  // "a Standard agent's read is unchanged": it is not filtered, it is simply not addressed.
  if (preset !== CORE_PRESET) return null
  if (typeof target !== 'string' || target === '') {
    // **A READ WHOSE TARGET CANNOT BE NAMED IS REFUSED RATHER THAN ALLOWED.** This is the one place a
    // malformed input could otherwise become a grant, so it fails closed with the same name.
    return Object.freeze({
      code: CORE_READ_REFUSE.READ_DENIED,
      rule: 'unnameable-target',
      target: String(target),
      why: 'the target was not a path this policy could compare, so it could not be cleared',
    })
  }
  const normalized = normalizeForMatch(target)
  for (const rule of rules) {
    if (matches(rule, normalized)) {
      return Object.freeze({
        code: CORE_READ_REFUSE.READ_DENIED,
        rule: rule.id,
        target: normalized,
        why: rule.why,
      })
    }
  }
  return null
}

/**
 * Whether one protected row matches a normalized target.
 *
 * **A CEILING, STATED RATHER THAN GUESSED AT: A COPY UNDER ANOTHER NAME IS NOT COVERED.** `file` rows
 * match one exact name, so `state/launch.json.bak`, `state/launch.json~` and a copy called
 * `launch-copy.json` are all ALLOWED and all carry the same bytes. **I have not added a list of backup
 * spellings, because that list would be invented rather than measured** — nobody has shown me the
 * backups this deployment keeps, and a rule that catches `.bak` and misses `.orig` is one of two
 * implementations of a protection, which is the shape this lane refuses everywhere else. **What would
 * close it is the same thing that closes the symlink question: resolving the target and comparing
 * against the AUTHORITY'S OWN records of what it wrote, not against a guess about naming.**
 *
 * @param {object} rule - one row of {@link CORE_PROTECTED}.
 * @param {string} target - a normalized target path.
 * @returns {boolean} true when the row protects this target.
 */
function matches(rule, target) {
  if (rule.kind === 'suffix') return target.endsWith(rule.suffix)
  if (rule.kind === 'basename') {
    const last = target.slice(target.lastIndexOf('/') + 1)
    return last === rule.basename
  }
  // A FILE OR DIRECTORY ROW IS MATCHED BY ITS TAIL, SO IT DOES NOT DEPEND ON WHERE THE TREE IS ROOTED.
  // **A PROTECTED NAME IS PROTECTED WHEREVER THE DEPLOYMENT PUTS IT**, and a rule that only matched one
  // absolute prefix would silently stop protecting anything the day the root moved.
  const path = normalizeForMatch(rule.path)
  if (rule.kind === 'file') return target === path || target.endsWith(`/${path}`)
  // **ONE IMPLEMENTATION.** The three clauses that stood here were two live ones and one dead one, and
  // nothing said which was which until a mutation aimed at the dead one and changed nothing.
  return isUnder(target, path)
}
