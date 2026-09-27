// ── VENDORED, AND PINNED BY CONTENT ──────────────────────────────────────────────────────────────────
// This is `plugins/aukora-organism/lib/organism.mjs` — Aura's reader — carried here because a face cannot
// import out of its own package tree at build time: the overlay `scripts/build-face.py` compiles in holds
// `packages/`, not `plugins/`, so a relative path to the original resolves in the source tree and nowhere
// else. It sits under `src/` because the bundler's entry for the host half is the COMPILED tree
// (`lib/types/**`), so every import it has to resolve must be a source file inside this package.
//
// THE COPY IS NOT TRUSTED. `tests/aukora-auma-live-organism-lens.test.mjs` compares every byte BELOW the
// marker line with Aura's file AND checks the digest declared here against that file, so a change there
// turns this red and the fix is one `cp` plus one digest.
//
// source: plugins/aukora-organism/lib/organism.mjs
// sha256: be5406a2139094e1835aacd16462df65a4dadd3c5884871769430ed0937a23ab
//
// @ts-nocheck — AURA'S FILE, NOT OURS. It is JavaScript with JSDoc; checking it under this package's strict
// settings would mean maintaining a file this repository does not own, and the pin below is what keeps it
// honest instead.
// ──── vendored-copy-of: plugins/aukora-organism/lib/organism.mjs ────
/**
 * organism.mjs — Auma Live's read-only status reader.
 *
 * WHAT IT IS. One function that answers "what is the organism doing right now" from a FIXED LIST of
 * sources, and a render for injection. It writes nothing: every source is opened read-only, and the only
 * process it starts is `zstd -dc` on a transcript it was pointed at.
 *
 * THE SECURITY RULE IS THE DESIGN. This output is injected into a companion's context, so anything that
 * reaches it has left its original boundary. The reader therefore copies WHITELISTED LEAVES ONLY — never
 * a whole `rows` object, never a config file, never an environment dump — and every string still passes
 * through `redact()` on the way out. That is belt and braces on purpose: a whitelist keeps a field from
 * being added by accident, and the redactor keeps a secret from riding out inside a field that was
 * legitimately selected, such as a session title or a report line. Both are courted.
 *
 * LANES ARE FOUND BY TITLE, NEVER BY RECENCY. "The newest sessions" returns subagents, which is the bug
 * this reader exists to fix: a lane is a conversation someone named, and its name is the only thing that
 * says so.
 */
import { readFileSync, readdirSync, existsSync } from 'node:fs'
import { join } from 'node:path'

/** The lanes, by the names people gave them. */
export const LANE_PATTERN = /^(AUMA|AURA|AK-UI|AUMLOK|BETA|KIRA|ALPHA)\b/

/**
 * THE ONE SELECTOR. Both this reader and the board ask this function, so the two cannot drift into
 * disagreeing about which conversations are lanes — which is how the board came to list subagents while
 * this reader listed lanes.
 *
 * A subagent INHERITS its parent's title, so a matching name is necessary and NOT sufficient: measured
 * on the live store, 19 sessions are titled `AUMLOK…` and one of them is the lane. The caller passes what
 * it knows; `subagent` is true when the session is a subagent of another.
 */
export function laneNameOf({ title, subagent = false } = {}) {
  if (typeof title !== 'string' || subagent) return null
  const match = LANE_PATTERN.exec(title.trim())
  return match ? match[1] : null
}

/** Bali is UTC+8 all year; there is no DST to get wrong. */
export const WITA_OFFSET_MINUTES = 8 * 60

/** The whole point of this module: these never reach the render. */
const SECRET_PATTERNS = [
  [/-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g, '[redacted:key]'],
  [/\b(?:sk|pk|ghp|gho|github_pat|xox[baprs])[-_][A-Za-z0-9_-]{12,}\b/g, '[redacted:token]'],
  [/\b(?:token|secret|password|passwd|api[-_]?key|cookie|bearer)\b\s*[:=]\s*\S+/gi, '[redacted:secret]'],
  [/\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{5,}\b/g, '[redacted:jwt]'],
  // THE APP'S OWN AUTH COOKIE. Measured by AK-UI's lens court: `dsh-auth-<name>=<value>` reached
  // `renderOrganism`'s output INTACT, because it contains none of the words the generic pattern looks
  // for — no "cookie", no "token", just a name that happens to be the credential. This reader is the
  // first line; a downstream lens scrubbing it is a second chance, not a substitute.
  [/\bdsh-auth-[A-Za-z0-9_-]+=\S+/g, '[redacted:cookie]'],
  // A SEED ASSIGNMENT. Also measured by AK-UI: `SEED="…"` and `seed=…` passed every existing pattern —
  // `seed` was simply not one of the words being matched. Named directly, with the quoted form handled
  // so the whole value goes and not just up to the first space.
  [/\bseed\s*[:=]\s*(?:"[^"]*"|'[^']*'|\S+)/gi, '[redacted:seed]'],
  [/\b[0-9a-f]{64,}\b/gi, '[redacted:hex]'],
  [/(?:\/Users\/[^\s"']*|\/home\/[^\s"']*)\/(?:\.ssh|keys?|secrets?|\.aws|\.config\/[a-z-]*key)[^\s"']*/gi, '[redacted:path]'],
  [/https?:\/\/[^\s"']*(?:token|key|secret|auth)=[^\s"'&]*/gi, '[redacted:url]'],
]

/** Everything that leaves this module passes through here. */
export function redact(value) {
  if (typeof value !== 'string') return value
  let out = value
  for (const [pattern, replacement] of SECRET_PATTERNS) out = out.replace(pattern, replacement)
  return out
}

/** HH:MM in WITA, from an epoch-ms instant. */
export function wita(ms) {
  if (typeof ms !== 'number' || !Number.isFinite(ms)) return null
  const shifted = new Date(ms + WITA_OFFSET_MINUTES * 60_000)
  const hh = String(shifted.getUTCHours()).padStart(2, '0')
  const mm = String(shifted.getUTCMinutes()).padStart(2, '0')
  return `${hh}:${mm}`
}

/**
 * The OBJECTIVE out of a goal projection.
 *
 * **`String()` ON THE GOAL PROJECTION IS THE LITERAL STRING "[object Object]".** `goal.current` is not text: it
 * is `{ goal: { id, revision, objective, phase }, seenGoalIds, failure }`. Passing it to `oneLine` therefore put
 * the words `goal: [object Object]` into the organism block of **every lane that had a goal** — so the single
 * fact the block exists to carry, what each lane is actually doing, was the one fact it never carried. Nothing
 * failed, because a string is a string and the render printed it happily.
 *
 * @param current - the `goal.current` projection, or a plain string from an older shape.
 * @returns the objective, or an empty string when the projection carries none.
 */
export const goalTextOf = (current) => {
  if (typeof current === 'string') return current
  const objective = current?.goal?.objective ?? current?.objective
  return typeof objective === 'string' ? objective : ''
}

const oneLine = (text, limit = 110) => {
  const flat = String(text).replace(/\s+/g, ' ').trim()
  return flat.length > limit ? `${flat.slice(0, limit - 1)}…` : flat
}

/**
 * THE APPROVAL A LANE IS SITTING ON, FROM THE SESSION'S OWN EVENTS.
 *
 * **A LANE BLOCKED ON THE OWNER LOOKS EXACTLY LIKE A WORKING LANE.** AK-UI sat from 19:34 on an unanswered
 * sandbox escalation while its projection said `RUNNING` with three turns queued — so the organism block told her
 * the lane was busy, and the one fact that mattered was that it was **waiting for Peter to wake up**. She cannot
 * tell him what he has to answer unless the block carries it.
 *
 * The rule is the event stream's own: an approval is open when its `data.id` was ASKED and never DECIDED. Nothing
 * here is inferred from a timestamp, a tool name or a projection field — **"asked without a decision" is the
 * definition the session log itself uses**, and guessing from anything else would eventually announce a decision
 * that was never made, or hide one that was.
 *
 * @param events - the session's events, as `ctx.sessions.get(id).snapshotEvents()` yields them.
 * @returns the oldest unanswered approval's one-line reason, or null when nothing is open.
 */
export function unansweredApprovalOf(events) {
  if (!Array.isArray(events)) return null
  const decided = new Set()
  for (const event of events) {
    if (event?.type !== 'approval/decided') continue
    const id = event?.data?.id
    if (typeof id === 'string') decided.add(id)
  }
  const open = []
  for (const event of events) {
    if (event?.type !== 'approval/asked') continue
    const id = event?.data?.id
    if (typeof id !== 'string' || decided.has(id)) continue
    const reason = event?.data?.reason
    open.push({
      id,
      at: typeof event?.time === 'number' ? event.time : null,
      tool: typeof event?.data?.toolName === 'string' ? event.data.toolName : null,
      // The approval's OWN words. A summary this module composed could describe something the owner never saw.
      summary: typeof reason === 'string' && reason.trim() !== '' ? oneLine(reason, 160) : 'no reason was given',
    })
  }
  if (open.length === 0) return null
  // **THE COUNT AND THE OLDEST, BECAUSE NEITHER ALONE IS THE TRUTH.** Four pending approvals is a different state
  // from one, and the one that has waited longest is the one to answer first — a lane sitting since yesterday
  // reads as "1 waiting" the same as one asked a minute ago. Measured on the live home: AK-UI held FOUR, the
  // oldest 16.4 hours, while its projection said `RUNNING` with turns queued.
  const oldest = open.reduce((a, b) => ((a.at ?? 0) <= (b.at ?? 0) ? a : b))
  return { count: open.length, ...oldest }
}

/**
 * The seven lanes, from the per-session projections.
 *
 * THE PATH IS `storages/session_projcache/sessions/<id>.json` AND THE TITLE IS `record.rows.title.val`.
 * A first attempt of mine read `session[id].title` from the single-file cache and found `None` twelve
 * times over: the container was right and the leaf was wrong, and the failure was SILENT — zero lanes,
 * reported as a quiet day rather than as a bug. The court below therefore asserts a lane IS found.
 */
/**
 * The lanes, as the session projections describe them — plus what each lane CONCLUDED, when a memory view is
 * passed in.
 *
 * `memory` IS DATA, NOT A SERVICE. This reader is carried into the face byte for byte and may import nothing, so
 * the view is assembled outside it (`lane-memory.mjs`, where Kira's own digest functions are importable) and
 * handed in. The JSDoc shape is explicit because the carried TypeScript copy infers parameter types from it, and
 * an inferred `null` made every real view a type error at the call site.
 *
 * @param {{dshHome: string, readFile?: Function, listDir?: Function, memory?: unknown}} input
 * @returns {{lanes: object[], missing: string|null}}
 */
export function readLanes({ dshHome, readFile = readFileSync, listDir = readdirSync, memory }) {
  const dir = join(dshHome, 'storages', 'session_projcache', 'sessions')
  if (!existsSync(dir)) return { lanes: [], missing: `the session projections at ${dir}` }
  const lanes = []
  for (const file of listDir(dir)) {
    if (!file.endsWith('.json')) continue
    let record
    try {
      record = JSON.parse(readFile(join(dir, file), 'utf8'))?.record
    } catch { continue }
    const rows = record?.rows ?? {}
    const title = rows?.title?.val
    if (typeof title !== 'string') continue
    const lane = laneNameOf({ title, subagent: Boolean(rows?.subagent?.val?.identity) })
    if (lane === null) continue                // not a lane: subagents, ad-hoc chats, anything unnamed
    const pressure = rows?.contextPressure?.val ?? {}
    const goal = rows?.goal?.val ?? {}
    const inbox = rows?.inbox?.val ?? {}
    lanes.push({
      lane,
      sessionId: file.replace(/\.json$/, ''),
      // **WHETHER A TURN IS OPEN, WHICH THE PROJECTION HAS CARRIED ALL ALONG AND NOTHING READ.**
      // `turnBoundary.openTurnStartSeq` is the sequence at which the current turn began, and it is null between
      // turns — so the difference between a lane mid-turn and a lane that finished an hour ago is ONE FIELD that
      // was already in hand. `state` stayed null from the first version, and the render said nothing about it, so
      // every reader of this block was told a lane's goal and context and never whether it was working.
      //
      // **THE CEILING, NAMED.** This is "a turn was started and not closed", which is not the same claim as
      // "working right now": a session killed mid-turn leaves the field set and would read as running until it is
      // resumed or closed. It is evidence, not proof — and it is strictly more than the nothing available before.
      running: typeof rows?.turnBoundary?.val?.openTurnStartSeq === 'number',
      lastPromptAt: rows?.sessionListMetadata?.val?.lastPromptAt ?? null,
      title: redact(oneLine(title)),
      // **AN EMPTY OBJECTIVE IS NULL, NOT "[object Object]".** A lane whose goal has no objective has no goal to
      // report, and saying so is different from reporting a placeholder as a fact.
      goal: goalTextOf(goal.current) === '' ? null : redact(oneLine(goalTextOf(goal.current))),
      goalFailed: Boolean(goal.failure),
      contextTokens: typeof pressure.pressureTokens === 'number' ? pressure.pressureTokens : null,
      contextWindow: typeof pressure.contextWindow === 'number' ? pressure.contextWindow : null,
      waitingTurns: Array.isArray(inbox['next-turn']) ? inbox['next-turn'].length : 0,
      waitingSteps: Array.isArray(inbox['next-step']) ? inbox['next-step'].length : 0,
      summary: null,
    })
  }
  // ONE LINE PER LANE. A lane is a NAME, and several sessions can carry it — the live store holds
  // nineteen `AUMLOK…` sessions, and a restarted lane leaves its old session behind. Several sessions
  // per name are therefore reported once, as the most recently prompted one, because that is the live
  // conversation; the older ones are history, not a second lane.
  const byName = new Map()
  for (const lane of lanes) {
    const held = byName.get(lane.lane)
    if (!held || (lane.lastPromptAt ?? 0) > (held.lastPromptAt ?? 0)) byName.set(lane.lane, lane)
  }
  const one = [...byName.values()]
  for (const lane of one) lane.lastPromptAtWita = wita(lane.lastPromptAt)
  // ── WHAT EACH LANE CONCLUDED, FROM THE MEMORY VIEW ────────────────────────────────────────────────
  //
  // **THE VIEW IS ASSEMBLED OUTSIDE THIS FILE AND THAT IS NOT AN ACCIDENT.** This reader is CARRIED into the
  // face byte for byte (`apps/src/vendor/organism.ts`), so it may not import Kira's modules: the assembly lives
  // in `lane-memory.mjs`, which may. What arrives here is data: one SETTLED summary per lane (Kira's own
  // `newestPerLane` chose it), the PENDING ones kept in their own list, the core digest, and a cite verdict per
  // settled summary.
  //
  // A LANE WITH NO SETTLED SUMMARY KEEPS `summary: null`. It does not borrow the newest thing in the store and
  // it does not fall back to a pending record: `null` is the honest answer, and the render simply says nothing.
  const settledByLane = new Map()
  for (const row of memory?.settled ?? []) settledByLane.set(row.lane, row)
  const pendingByLane = memory?.pendingByLane ?? {}
  const pendingRows = memory?.pending ?? []
  for (const lane of one) {
    const held = settledByLane.get(lane.lane) ?? null
    lane.summary = held === null ? null : held.headline
    lane.summaryId = held === null ? null : held.recordId
    lane.summaryAt = held === null ? null : held.settledAt
    // THE VERDICT IS CARRIED AS IT CAME. `NOT CHECKED` and `UNVERIFIED` are both non-verified, and neither is
    // ever widened here: this line copies the verdict, it does not decide one.
    lane.summaryCite = held === null ? null : { verdict: held.verdict, reason: held.reason ?? null }
    lane.pendingCount = pendingByLane[lane.lane] ?? 0
    lane.pending = pendingRows
      .filter(row => row.lane === lane.lane)
      .map(row => ({ recordId: row.recordId, at: row.at, headline: row.headline }))
  }
  // Ordered by name so the render is stable between readings; NOT by recency, which is the bug.
  one.sort((a, b) => a.lane.localeCompare(b.lane))
  return { lanes: one, missing: null }
}

/**
 * WHICH SESSIONS ARE SUBAGENTS, keyed by session id — THE ONE DEFINITION.
 *
 * The board's runtime observations carry NO subagent signal: `plugins/aukora-board/lib/index.js` builds
 * `{ id, title, surfaceEvents, rawEvents, … }` from `listSessions` and a title map, and nothing in it says
 * whether a session is a subagent. Rather than invent a second definition from whatever the runtime
 * happens to expose, the board asks THIS function, which reads the same
 * `rows.subagent.val.identity` that `readLanes` uses.
 *
 * Measured live, and it is the whole reason the title filter is not enough: session
 * `006b96e1-8294-4dfb-a0df-9f80c47d2709` is titled **`You are the AUMLOK v3`** — a lane name — and is a
 * subagent (`{mode: 'continuable', label: 'Y1 root seed custody'}`).
 */
export function subagentSessionIds({ dshHome, readFile = readFileSync, listDir = readdirSync }) {
  const dir = join(dshHome, 'storages', 'session_projcache', 'sessions')
  const ids = new Set()
  if (!existsSync(dir)) return ids
  for (const file of listDir(dir)) {
    if (!file.endsWith('.json')) continue
    try {
      const rows = JSON.parse(readFile(join(dir, file), 'utf8'))?.record?.rows
      if (rows?.subagent?.val?.identity) ids.add(file.replace(/\.json$/, ''))
    } catch { /* an unreadable projection is not a subagent */ }
  }
  return ids
}

/** The last three lines of a lane's own report, if it has one. */
export function readReportTail({ repo, lane, readFile = readFileSync }) {
  const path = join(repo, '.agents', 'live', 'reports', `${lane}.md`)
  if (!existsSync(path)) return { lines: [], missing: `the report at .agents/live/reports/${lane}.md` }
  const lines = readFile(path, 'utf8').split('\n').filter(l => l.trim().length > 0).slice(-3)
  return { lines: lines.map(l => redact(oneLine(l, 150))), missing: null }
}

/**
 * `git log -8` and status counts, through the injected executor.
 *
 * `--no-optional-locks` because this runs WHILE the repository is in use: without it git may take the
 * index lock, and a read-only status reader that blocks a lane's commit is not read-only in the way that
 * matters.
 */
export async function readGit({ repo, exec }) {
  // **AWAITED, BECAUSE A SYNCHRONOUS SPAWN TAKES THE EVENT LOOP.** These two calls used to block the single
  // process that hosts every lane and every voice stream; see `plugins/aukora-face/apps/src/auma-live/lens-exec.ts`
  // for why that is the defect. The two reads are SEQUENTIAL rather than concurrent on purpose: they are two
  // `git` invocations against the same repository, and `--no-optional-locks` is what makes them safe to run
  // while the repository is in use — not concurrency.
  const log = await exec('git', ['--no-optional-locks', 'log', '-8', '--pretty=%h %s'], { cwd: repo, timeoutMs: 10_000 })
  const status = await exec('git', ['--no-optional-locks', 'status', '--porcelain'], { cwd: repo, timeoutMs: 10_000 })
  if (log.error || status.error) return { commits: [], counts: null, missing: `git (${log.error ?? status.error})` }
  const counts = { modified: 0, untracked: 0, other: 0 }
  for (const line of status.stdout.split('\n')) {
    if (!line.trim()) continue
    if (line.startsWith('??')) counts.untracked += 1
    else if (/^ ?M|^M/.test(line)) counts.modified += 1
    else counts.other += 1
  }
  return { commits: log.stdout.split('\n').filter(Boolean).slice(0, 8).map(l => redact(oneLine(l, 90))), counts, missing: null }
}

/** `gh run list`, whitelisted fields only, with a hard timeout. */
export async function readCi({ repo, exec }) {
  const r = await exec('gh', ['run', 'list', '--limit', '5', '--json', 'status,conclusion,headBranch,workflowName,createdAt'],
    { cwd: repo, timeoutMs: 10_000 })
  if (r.error) return { runs: [], missing: `gh run list (${r.error})` }
  try {
    const runs = JSON.parse(r.stdout).map(run => ({
      workflow: redact(String(run.workflowName ?? '')),
      branch: redact(String(run.headBranch ?? '')),
      status: String(run.status ?? ''),
      conclusion: String(run.conclusion ?? ''),
      at: wita(Date.parse(run.createdAt)),
    }))
    return { runs, missing: null }
  } catch (error) {
    return { runs: [], missing: `gh run list (unparsable: ${error.message})` }
  }
}

/** The Kira queue, as a count. The reader never settles anything. */
export function readKiraQueue({ dshHome, readFile = readFileSync }) {
  const path = join(dshHome, 'kira-memory', 'queue')
  if (!existsSync(path)) return { count: null, missing: `the Kira queue at ${path}` }
  try {
    return { count: readdirSync(path).length, missing: null }
  } catch (error) {
    return { count: null, missing: `the Kira queue (${error.message})` }
  }
}

/**
 * Everything, with the missing sources NAMED.
 *
 * A source that cannot be read is reported as a name, never dropped: a status reader that silently shows
 * four of seven lanes is worse than one that shows none, because it reads as good news.
 *
 * @param {{dshHome: string, repo: string, now?: () => number, exec?: Function, memory?: unknown}} input
 * @returns {Promise<object>} the status, with `memory` carried through for the rendering layer.
 */
export async function readOrganism({
  dshHome, repo, now = () => Date.now(), exec, memory, eventsOf, approvalSource,
}: {
  dshHome: string
  repo: string
  // **`| undefined` ON EVERY OPTIONAL, BECAUSE `exactOptionalPropertyTypes` IS ON.** The caller passes
  // `now: options.now` — a possibly-undefined value — and under that flag `now?: () => number` does NOT accept an
  // explicit `undefined`. This was always true; it was invisible while this parameter was implicitly `any`, and
  // typing it is what surfaced it. The compiler's own message named the remedy.
  now?: (() => number) | undefined
  exec?: ((command: string, args: string[], options?: { cwd?: string; timeoutMs?: number }) =>
    Promise<{ stdout: string; error: string | null }>) | undefined
  memory?: unknown
  /** The lane's own session events. Typed HERE so both sides of the seam agree — an untyped parameter made the
   *  lens refuse the bundle while the courts, which call this function directly, stayed green. */
  eventsOf?: ((sessionId: string) => readonly unknown[]) | undefined
  approvalSource?: string | undefined
}) {
  // **ASYNC BECAUSE TWO OF ITS SOURCES ARE COMMANDS.** `readLanes`, `readReportTail` and `readKiraQueue` read
  // files and stay synchronous; the git and `gh` reads are the ones that used to block the whole backend.
  const lanes = readLanes({ dshHome, memory })
  const missing = []
  if (lanes.missing) missing.push(lanes.missing)
  for (const lane of lanes.lanes) {
    const report = readReportTail({ repo, lane: lane.lane })
    lane.report = report.lines
    if (report.missing) missing.push(report.missing)
    // **THE APPROVAL, FROM THE LANE'S OWN EVENTS.** `eventsOf` is supplied by the host from the session store —
    // the same route CORE's report already takes — so nothing here is guessed from a projection field. When no
    // reader was supplied the fact is NOT silently absent: `approvalSource` names why, and the render prints it,
    // because "no lane is waiting on the owner" and "nobody could tell" must not look alike.
    lane.waitingOn = typeof eventsOf === 'function'
      ? unansweredApprovalOf(eventsOf(lane.sessionId))
      : null
  }
  const git = await readGit({ repo, exec })
  const ci = await readCi({ repo, exec })
  const kira = readKiraQueue({ dshHome })
  for (const [name, src] of [['git', git], ['gh run list', ci], ['the Kira queue', kira]]) {
    if (src.missing) missing.push(src.missing)
  }
  // THE MEMORY VIEW'S OWN UNREAD SOURCES ARE NAMED TOO. A memory that could not be read must not look like a
  // set of lanes that concluded nothing: "undetermined" and "empty" are different answers.
  for (const named of memory?.missing ?? []) missing.push(named)
  return {
    at: wita(now()),
    lanes: lanes.lanes,
    approvalSource: typeof eventsOf === 'function'
      ? 'the lane session events, via the host session store'
      : (approvalSource ?? 'no session-event reader was supplied, so no lane could be checked'),
    git,
    ci,
    kira,
    // THE WHOLE VIEW TRAVELS WITH THE STATUS, so a rendering layer can show the core digest without reading
    // anything again — and so a court can assert what the digest says without re-assembling it.
    memory,
    waitingOnOwner: waitingOnOwner({ lanes: lanes.lanes }),
    missing,
  }
}

/**
 * What is waiting on Peter: lanes whose inbox holds a turn or a step, lanes whose goal failed, and any
 * report line that asks him to approve, sign or click. Matched on the report text because that is where
 * the ask is actually written.
 */
export function waitingOnOwner({ lanes }) {
  const waiting = []
  // **A HEURISTIC, AND IT IS LABELLED AS ONE.** This regex reads the lane's REPORT for words like "approve" or
  // "your call". It fires on a lane merely DISCUSSING approval and misses one that is blocked without saying so —
  // which is how AK-UI sat for hours with nobody told. Its hits are `mentioned`, never `approval`, so a reader can
  // tell a lane that MENTIONS the owner from one that is measurably waiting on him.
  const ASK = /\b(approve|approval|sign|signature|click|consent|authorise|authorize|your call|waiting on peter)\b/i
  for (const lane of lanes) {
    // MEASURED: an approval asked in the lane's own event stream and never decided.
    if (lane.waitingOn) {
      waiting.push({
        lane: lane.lane,
        kind: 'approval',
        count: lane.waitingOn.count,
        at: lane.waitingOn.at,
        // **"the owner", NOT A NAME.** See the note on the render's labels below.
        what: `waiting on the owner: ${lane.waitingOn.summary}`
          + (lane.waitingOn.count > 1 ? ` (and ${String(lane.waitingOn.count - 1)} more unanswered)` : ''),
      })
    }
    if (lane.waitingTurns > 0 || lane.waitingSteps > 0) {
      waiting.push({ lane: lane.lane, kind: 'queued',
        what: `${lane.waitingTurns} turn(s), ${lane.waitingSteps} step(s) queued` })
    }
    if (lane.goalFailed) waiting.push({ lane: lane.lane, kind: 'failure', what: 'its goal reports a failure' })
    for (const line of lane.report ?? []) {
      if (ASK.test(line)) waiting.push({ lane: lane.lane, kind: 'mentioned', what: redact(oneLine(line, 120)) })
    }
  }
  // **MEASURED FIRST, AND THE OLDEST FIRST AMONG THEM.** A lane that has waited 16 hours outranks one that
  // mentioned the word "approve" in a status line, and the order is what a reader acts on.
  const rank = { approval: 0, queued: 1, failure: 2, mentioned: 3 }
  return waiting.sort((a, b) => (rank[a.kind] - rank[b.kind]) || ((a.at ?? 0) - (b.at ?? 0)))
}

/** The injection. Plain text, no markup a model would have to parse, ceilings last. */
export function renderOrganism(status) {
  const out = []
  out.push(`ORGANISM at ${status.at} WITA — read-only; nothing here was written and nothing is settled`)
  if (status.lanes.length === 0) out.push('  no lanes found by name')
  for (const lane of status.lanes) {
    // **A LANE THAT IS WORKING IS THE FIRST THING A READER WANTS AND IT WAS NEVER SAID.** `running` is the open
    // turn; `idle` is everything else, including a lane that has never run.
    const bits = [lane.running === true ? 'RUNNING' : 'idle',
      lane.lastPromptAtWita ? `last ${lane.lastPromptAtWita}` : 'no prompt time']
    if (lane.contextTokens !== null && lane.contextWindow) {
      bits.push(`${Math.round((lane.contextTokens / lane.contextWindow) * 100)}% ctx`)
    }
    out.push(`  ${lane.lane.padEnd(7)} ${bits.join(' · ')}`)
    if (lane.goal) out.push(`    goal: ${lane.goal}`)
    // WHAT THE LANE CONCLUDED, AND WHAT THE CHAIN SAYS ABOUT IT. The verdict is printed as it arrived: a reader
    // that showed `UNVERIFIED` and `NOT CHECKED` as nothing would be reporting an unchecked citation as a
    // verified one by omission, which is the same defect as printing VERIFIED.
    if (lane.summary) {
      const cite = lane.summaryCite
      const suffix = cite === null || cite === undefined
        ? ''
        : cite.verdict === 'VERIFIED'
          ? ' [cite VERIFIED]'
          : ` [cite ${cite.verdict}${cite.reason ? `: ${cite.reason}` : ''}]`
      out.push(`    summary: ${lane.summary}${suffix}`)
    }
    // A PENDING SUMMARY IS NEVER THE LANE'S SUMMARY, and it is never hidden either: it is named as what it is,
    // under its own marker, with the count the memory view reported.
    if (lane.pendingCount > 0) out.push(`    pending: ${String(lane.pendingCount)} awaiting review (NOT settled)`)
    for (const pending of lane.pending ?? []) out.push(`      queued: ${pending.headline}`)
    // **THE ONE FACT THAT TELLS HER TO WAKE HIM.** Printed per lane, beside whether it is running — because
    // "RUNNING with three turns queued" and "has been waiting on Peter since yesterday" are the two readings a
    // person must be able to tell apart, and until now this block could only say the first.
    if (lane.waitingOn) {
      const hours = lane.waitingOn.at === null ? null : Math.floor((Date.now() - lane.waitingOn.at) / 3_600_000)
      // **THE OWNER'S NAME IS NOT THIS REPOSITORY'S TO SPELL.** This label is part of the organism block, so it
      // is SENT TO THE PROVIDER on every turn that carries one — a person's first name, hard-coded into a
      // request body. **It is also simply wrong for any owner not named Peter**, which makes it a privacy defect
      // and a correctness one at the same time.
      out.push(`    WAITING ON THE OWNER: ${lane.waitingOn.summary}`
        + (lane.waitingOn.count > 1 ? ` (+${String(lane.waitingOn.count - 1)} more)` : '')
        + (hours === null ? '' : ` — asked ${String(hours)}h ago`))
    }
    for (const line of lane.report.slice(-2)) out.push(`    | ${line}`)
  }
  // ── THE CORE DIGEST, ONCE PER CLAIM ──────────────────────────────────────────────────────────────
  //
  // **A CHORUS IS NOT EVIDENCE.** Two lanes whose summaries trace to the same recorded observation are ONE
  // observation, and a screen that printed the claim once per lane would manufacture agreement out of repetition.
  // The grouping is Kira's own (`buildCoreDigest`, by ancestry overlap, via the memory view), and this section
  // keeps its shape: the claim ONCE, the lanes that restated it named beside it, and a claim whose ancestry is
  // unknown listed APART and counted for nothing — "I cannot show where this came from" must not earn a vote.
  const core = status.memory?.digest?.core
  const observations = core?.observations ?? []
  const unsourced = core?.unknownAncestry ?? []
  if (observations.length + unsourced.length > 0) {
    out.push('  CORE DIGEST (one line per claim; the lanes that restated it are named beside it):')
    for (const observation of observations) {
      const restaters = Array.isArray(observation.restaters) ? observation.restaters : []
      const ancestry = Array.isArray(observation.sharedAncestry)
        ? observation.sharedAncestry.join(', ')
        : String(observation.sharedAncestry ?? '')
      const count = Number(observation.restatementCount ?? restaters.length)
      out.push(`    "${String(observation.headline)}" — restated by ${restaters.join(', ')} `
        + `(${String(count)} restatement${count === 1 ? '' : 's'}; shared ancestry ${ancestry})`)
    }
    for (const one of unsourced) {
      out.push(`    ancestry unknown, not counted: ${String(one.lane)} — "${String(one.headline)}"`)
    }
  }
  if (status.git.commits.length > 0) {
    const c = status.git.counts
    out.push(`  git    ${status.git.commits.length} recent · ${c.modified} modified, ${c.untracked} untracked`)
  }
  for (const run of status.ci.runs.slice(0, 3)) {
    out.push(`  ci     ${run.workflow} ${run.status}${run.conclusion ? `/${run.conclusion}` : ''} ${run.branch}`)
  }
  if (status.kira.count !== null) out.push(`  kira   ${status.kira.count} waiting in the queue`)
  if (status.waitingOnOwner.length > 0) {
    out.push('  WAITING ON THE OWNER:')
    for (const w of status.waitingOnOwner) out.push(`    ${w.lane}: ${w.what}`)
  }
  if (status.missing.length > 0) {
    out.push('  SOURCES NOT READ (named, not dropped):')
    for (const m of status.missing) out.push(`    ${m}`)
  }
  out.push('  CEILING: this reader reports what files said. It cannot see a running process, it does not')
  out.push('           read transcripts unless given one, and a lane quiet here may still be working.')
  return out.join('\n')
}
