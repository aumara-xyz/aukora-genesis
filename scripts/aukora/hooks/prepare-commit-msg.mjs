#!/usr/bin/env node
/**
 * hooks/prepare-commit-msg.mjs — plan section 5 row 11: PROVENANCE ON EVERY COMMIT.
 *
 * Git calls this with `<message-file> <source> [<commit-sha>]`. It does exactly two things and refuses one:
 *
 *   APPENDS `Lane: <the author name>` and `Goal: <AUKORA_GOAL_ID, or none>`, as git trailers at the end of the
 *   message. The author's text is never rewritten — not reflowed, not reordered, not trimmed: the trailers are
 *   appended after the message as it stands, which is what makes this safe to put in front of every commit.
 *
 *   REFUSES BY NAME a message whose own `Lane:` trailer DISAGREES with the author. A lane that can be typed by
 *   hand and disagree with the identity git recorded makes the trailer worse than absent: `bisect-red.mjs` reads
 *   `Lane:` to decide whose fix to wait for, and it would wait for the wrong lane. The refusal is
 *   `lane-disagrees-with-author` and the commit does not happen.
 *
 * IT IS IDEMPOTENT. Re-running on a message that already carries both trailers (an `--amend`, or a hook installed
 * twice) changes nothing rather than appending a second pair.
 *
 * IT NEVER FAILS OPEN. If the identity cannot be read, the message cannot be read, or anything else goes wrong, it
 * refuses rather than letting a commit through without provenance — with one deliberate exception: `--source
 * message` with a commit sha given means git is recreating an existing message, and the trailers are still applied.
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { isMainModule } from '../../lib/is-main.mjs'

export const HOOK_VERSION = 'aukora-hook-v1'
export const LANE_TRAILER = 'Lane'
export const GOAL_TRAILER = 'Goal'

/** The trailers a message already carries, as a list of [key, value] in order. */
export function readTrailers(message) {
  const found = []
  for (const raw of String(message).split('\n')) {
    const match = /^(Lane|Goal):[ \t]*(.*)$/u.exec(raw)
    if (match !== null) found.push([match[1], match[2].trim()])
  }
  return found
}

/**
 * The new message text. Pure, so the court can exercise it without a repository.
 * `author` is the name git recorded; `goal` is AUKORA_GOAL_ID or ''. Throws a named refusal on disagreement.
 */
export function withTrailers(message, { author, goal }) {
  if (typeof author !== 'string' || author.trim() === '') {
    throw new HookRefusal('author-unreadable', 'the committing identity could not be read, so no honest Lane trailer can be written')
  }
  const lane = author.trim()
  const trailers = readTrailers(message)
  const declared = trailers.find(([key]) => key === LANE_TRAILER)
  if (declared !== undefined && declared[1] !== lane) {
    throw new HookRefusal('lane-disagrees-with-author', `the message says Lane: ${declared[1]} and git records the author as ${lane}: a lane trailer that disagrees with the identity is worse than no trailer, because bisect-red.mjs decides whose fix to wait for from it`)
  }
  const goalValue = typeof goal === 'string' && goal.trim() !== '' ? goal.trim() : 'none'
  const text = String(message)
  const endsWithNewline = text.endsWith('\n')
  const body = endsWithNewline ? text.slice(0, -1) : text
  const kept = body.split('\n').filter((line) => !/^(Lane|Goal):[ \t]/u.test(line))
  while (kept.length > 0 && kept[kept.length - 1].trim() === '') kept.pop()
  // JOIN AN EXISTING TRAILER BLOCK rather than starting a new paragraph (2026-09-27): a separate paragraph made git read ONLY
  // Lane/Goal as trailers, so the Approved-by / Approval-digest / Operation-digest lines self-change writes were invisible.
  const last = kept[kept.length - 1] ?? ''
  const endsInTrailer = /^[A-Za-z][A-Za-z0-9-]*:[ \t]/u.test(last) && kept.lastIndexOf('') !== -1 && kept.lastIndexOf('') < kept.length - 1
  const next = [...kept, ...(endsInTrailer ? [] : ['']), `${LANE_TRAILER}: ${lane}`, `${GOAL_TRAILER}: ${goalValue}`].join('\n')
  return `${next}\n`
}

export class HookRefusal extends Error {
  constructor(name, message) { super(message); this.name = name }
}

function git(args) {
  const r = spawnSync('git', args, { encoding: 'utf8' })
  return { rc: r.status, out: String(r.stdout ?? '').trim(), err: String(r.stderr ?? '').trim() }
}

/** The main entry: returns an exit code, and never throws. */
export function runHook(argv, env = process.env) {
  const messageFile = argv[0]
  if (messageFile === undefined || messageFile === '') {
    process.stderr.write('REFUSED: message-file-unstated: prepare-commit-msg was called without a message file\n')
    return 2
  }
  try {
    const author = env.GIT_AUTHOR_NAME !== undefined && env.GIT_AUTHOR_NAME !== ''
      ? env.GIT_AUTHOR_NAME
      : (() => {
        const name = git(['config', 'user.name'])
        if (name.rc !== 0 || name.out === '') {
          throw new HookRefusal('author-unreadable', 'git config user.name is unset and GIT_AUTHOR_NAME is empty, so the committing lane is unknown')
        }
        return name.out
      })()
    const message = readFileSync(messageFile, 'utf8')
    const next = withTrailers(message, { author, goal: env.AUKORA_GOAL_ID ?? '' })
    if (next !== message) writeFileSync(messageFile, next)
    return 0
  } catch (error) {
    if (error instanceof HookRefusal) {
      process.stderr.write(`REFUSED: ${error.name}: ${error.message}\n`)
      return 1
    }
    process.stderr.write(`REFUSED: hook-failed: ${String(error?.message ?? error)}\n`)
    return 1
  }
}

// **THE GUARD IS NOT A NAME TEST.** MEASURED, and it cost this court two false failures: the hook was gated on
// `argv[1].endsWith('prepare-commit-msg.mjs')`, so ANY copy under another name — a mutation copy in a court's
// scratch, or a symlink — exited 0 having done NOTHING, and the message it was handed came back untouched. That is
// the exact failure `scripts/lib/is-main.mjs` documents ("a guard whose failure mode is 'silently does nothing' is
// worse than no guard, because a caller reads the exit code as a verdict"), and this file now uses that guard, which
// canonicalises both sides so a symlinked or renamed hook still runs.
if (isMainModule(import.meta.url)) {
  process.exit(runHook(process.argv.slice(2)))
}
