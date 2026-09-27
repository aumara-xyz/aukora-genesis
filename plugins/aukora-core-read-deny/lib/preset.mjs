/**
 * WHO IS READING: the `presetOf` the guard needs, wired to the real services.
 *
 * The guard refuses a read when the reader's preset is `core`. This module answers *"which preset is
 * reading right now?"* from three services, each verified by reading its declaration:
 *
 *   1. `ctx.agents.currentInitiator()` — `core/agent/src/index.ts:292`. Returns the Agent whose turn is
 *      running, or `undefined` outside an initiator boundary.
 *   2. `agent.session` — the Agent's Session, the opaque identity the fs events already key observed
 *      state by (`fs-observation-policy/lib/types/types.d.ts:19`).
 *   3. `ctx.sessionProjections.snapshot(session, ['agentPreset']).values.agentPreset` —
 *      `session/session-projection/src/index.ts:338`. **FULLY SYNCHRONOUS**, which is what makes it
 *      usable per read.
 *
 * **WHY THIS IS RECOVERABLE AT ALL.** A read reaches the provider as `readText(target, signal)` — no
 * actor. MEASURED: `tool-fs`'s `sessionResolveOptions` returns only `{ cwd, signal }`
 * (`fs/tool-fs/src/session-cwd.ts:27-36`). **But the agent loop wraps the whole turn**
 * (`core/agent-loop/src/agent.ts:208`, `withInitiator(this, () => this.kick())`), so the reading Agent is
 * ambient at the moment the provider is called.
 *
 * @module @aukora/dsh-plugin-core-read-deny/preset
 */

/** The projection key the preset lives under; see `agent-presets/src/session.ts:35`. */
export const PRESET_PROJECTION_KEY = 'agentPreset'

/**
 * THE TWO ABSENCES, AND THEY ARE NOT THE SAME ABSENCE. (CODEX SWEEP, FINDING 2.)
 *
 * **MEASURED: EVERY FAILURE TO IDENTIFY THE READER USED TO ARRIVE AS `undefined`, AND THE POLICY READ
 * `undefined` AS "NOT CORE" — WHICH IS A GRANT.** A missing projection, a malformed value and a snapshot
 * that throws all became permission, and the reader they granted was the one nobody could name. **Absence of
 * evidence was read as evidence of absence.**
 *
 * So the two cases are now distinct values, because they are distinct facts:
 *
 *   * {@link READER_NONE} — **there is no reader.** No initiator boundary is open, so this is a host-plane
 *     read: a cold transcript read, an export, a court. It is explicitly authorised and must keep working.
 *   * {@link READER_UNKNOWN} — **there is a reader and it could not be named.** Something IS reading and this
 *     daemon cannot say which preset it belongs to. That is refused by name.
 */
export const READER_NONE = Object.freeze({ reader: 'none' })

/** There is a reader and its preset could not be established. Refused by name; see {@link READER_NONE}. */
export const READER_UNKNOWN = Object.freeze({ reader: 'unknown' })

/**
 * Build the reader-identifying function the guard takes.
 *
 * **IT NEVER THROWS.** It runs inside every read, and a service that is missing or a projection that has
 * not folded yet must not turn a normal read into a failure. Each such case returns `undefined`, which
 * the policy treats as "not CORE" — see the ceiling below.
 *
 * @param {object} ctx - a Cordis context carrying `agents` and `sessionProjections`.
 * @returns {() => (string|null|undefined)} the preset of the reading session, or a nullish value.
 */
export function presetOfFromContext(ctx) {
  return () => {
    // **`ctx.get`, NOT `ctx.agents`.** The property proxy is topology-sensitive and throws for an
    // undeclared service; a read must not fail because this plugin was mounted beside a different shape.
    const agents = ctx.get('agents')
    // **A MISSING AGENTS SERVICE IS AN UNKNOWN READER, NOT AN ABSENT ONE (CODEX SWEEP, FINDING 2).** MEASURED:
    // this returned `undefined`, so mounting the guard beside a context that has no `agents` service — or a
    // differently shaped one — allowed EVERY protected read while the guard looked correctly installed.
    // **A guard that cannot ask who is reading has not established that nobody is.**
    if (agents === undefined || typeof agents.currentInitiator !== 'function') return READER_UNKNOWN
    let agent
    try {
      agent = agents.currentInitiator()
    } catch {
      // **A SERVICE THAT THROWS IS NOT A READ WITH NO READER.** MEASURED: this returned `undefined`, which the
      // policy read as "not CORE" — so a read attempted while the agents service was disposed, or while it
      // threw for any other reason, was ALLOWED. **This daemon cannot say whether a session is reading, and
      // "cannot say" is the definition of an unknown reader.** A genuinely sessionless host read never
      // reaches here: it gets a clean `undefined` back from a working service.
      return READER_UNKNOWN
    }
    // **NO INITIATOR IS THE ONE ABSENCE THAT IS AUTHORISED.** Nothing is reading, so there is no session to
    // name and no preset to deny — this is the host plane, and refusing here would break every cold read.
    if (agent === undefined || agent === null) return READER_NONE
    // **PAST THIS POINT SOMETHING IS READING, SO EVERY FAILURE TO NAME IT IS A REFUSAL.** The agent exists;
    // from here on, `undefined` would be a grant to a reader nobody can vouch for.
    const session = agent.session
    if (session === undefined || session === null) return READER_UNKNOWN
    const projections = ctx.get('sessionProjections')
    if (projections === undefined || typeof projections.snapshot !== 'function') return READER_UNKNOWN
    let snapshot
    try {
      snapshot = projections.snapshot(session, [PRESET_PROJECTION_KEY])
    } catch {
      // **A SNAPSHOT THAT THROWS IS AN UNKNOWN READER, NOT AN ABSENT ONE.** The cell may not have folded yet;
      // either way this daemon cannot say which preset is reading, and "cannot say" is not "not CORE".
      return READER_UNKNOWN
    }
    const values = snapshot?.values
    // **A MISSING KEY AND A `null` VALUE ARE DIFFERENT FACTS**, and MEASURED they were being collapsed: my
    // first version read both as `null`, so a snapshot that simply did not carry the projection — the exact
    // "missing projection" this finding is about — was reported as a session with no preset, which is
    // ALLOWED. **The key being absent means the projection is not registered, so nothing knows this reader's
    // preset; the key being present and `null` means the projection ran and the session has none.**
    if (values === null || typeof values !== 'object' || !Object.hasOwn(values, PRESET_PROJECTION_KEY)) {
      return READER_UNKNOWN
    }
    const value = values[PRESET_PROJECTION_KEY]
    // **AN ABSENT PRESET AND AN UNKNOWN READER ARE NOT THE SAME FACT, AND `undefined` IS THE FORMER.**
    //
    // MEASURED ON A SCRATCH BOOT (aumlok-94 blocker, `tests/aukora-core-read-deny-boot.test.mjs`): the real
    // `SessionProjectionRegistry` puts this key in `values` for every REGISTERED unit, and the real
    // `agentPresetProjectionDefinition` initialises it with `header.agentPreset ?? null` against a schema of
    // `z.union([z.string(), z.null()])` — **so a session with no preset arrives as `null`, and `undefined` is
    // REJECTED by the definition's own schema rather than emitted.**
    //
    // **BUT THE SESSION CONTROLLER READS THE SAME CELL WITH `?? undefined`** —
    // `api/session-controller/src/agent.ts:508`, `skill-catalog.ts:47` — **so `undefined` is a value the real
    // read path visibly tolerates, and a snapshot that carried it would have been read as an UNKNOWN READER
    // and refused.** The CORE rows put this guard on the HOST plane for EVERY agent, so that refusal is not a
    // missing feature: **it is every read, in every lane, refusing the sessions this guard exists not to
    // address.**
    //
    // **A KEY THAT IS PRESENT MEANS THE PROJECTION RAN.** It reported no preset, and a projected cell whose
    // value is `undefined` is an unset preset — exactly what `null` means, arriving in the other form. Only
    // the KEY BEING ABSENT is genuinely unknown, and that is refused above.
    if (value === null || value === undefined) return null
    return typeof value === 'string' ? value : READER_UNKNOWN
  }
}

/**
 * THE CEILING, STATED WHERE THE NEXT READER WILL MEET IT.
 *
 * **THIS FUNCTION CANNOT TELL "NO SESSION" FROM "A SESSION THAT CLEARED ITS INITIATOR BOUNDARY".** Both
 * arrive as `undefined`, and the policy allows anything that is not `core` — because a cold host read (a
 * transcript reader, an export, a court) has no initiator and must keep working. **So an agent that runs
 * inside a clearing boundary reads as a host reader and is allowed.**
 *
 * `currentInitiator`'s own contract names the case: *"`undefined` outside an initiator boundary and
 * inside an explicit clearing boundary"* (`core/agent/src/index.ts:289`), and the clearing boundary is a
 * real API (`:619`). **Nothing in this tree creates one today** — the two `withInitiator` call sites are
 * the agent loop and a browser-use stage — so the gap is unreachable at present. **It becomes reachable
 * the moment anything clears the boundary, and this note is the only thing that will say so.**
 *
 * @returns {string} the ceiling, for a caller that wants to print it.
 */
export const CLEARING_BOUNDARY_CEILING =
  'a session that clears its initiator boundary is indistinguishable from a sessionless host read, so it '
  + 'is not refused; nothing creates a clearing boundary today'
