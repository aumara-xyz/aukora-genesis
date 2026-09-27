/**
 * **THE PRODUCER FOR THE PER-REPLY MANIFEST — THE HALF THAT WAS MISSING.**
 *
 * `plugins/aukora-face/layout/src/why-store.ts` reads `logs/reply-manifests.jsonl`, the WHY route serves one reply's
 * manifest (`layout/src/index.ts:195-202`), and AK-UI's view renders it. **Nothing wrote the file.** Its own reader
 * called the path *"A PROPOSAL UNTIL AUMA NAMES THEIRS"*, and this module names it: **`logs/reply-manifests.jsonl`,
 * relative to the state root the deployment already sets.**
 *
 * **THE KEY IS `${sessionId}:${turn}`, AND IT IS DELIBERATELY THE ONE THAT ALREADY EXISTS.** `turn` is the
 * model-request line's one-based position in the store — monotonic, **stable across restarts because it is a property
 * of the file rather than of any process**, and the same value `auma/turn-finished` carries and KIRA's consumer
 * dedupes on. **One turn therefore has one identity across memory and across attention**, and there is no second
 * counter to keep in step.
 *
 * **AND A LINK THAT GUESSES WOULD ATTRIBUTE ONE REPLY'S PROMPT TO ANOTHER** — AK-UI's words, and the reason the id
 * must be produced by the side that writes the manifest. `why-store.ts:50` matches it by exact string and answers
 * *"no reply was chosen to explain"* rather than somebody else's attention when it does not match.
 *
 * @module reply-manifest
 */
import { appendFileSync, mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'

/** Where the manifests live, relative to the state root. **The name AK-UI's reader proposed, confirmed here.** */
export const MANIFEST_LOG_RELATIVE = 'logs/reply-manifests.jsonl'

/**
 * One thing the turn looked at, as the attention view shows it.
 *
 * **`sha256` IS OVER THE BYTES THAT WERE ACTUALLY HELD, AND AK-UI SAID THEY WILL NOT INVENT IT.** A manifest whose
 * digests are over the wrong bytes would make the attention view answer confidently and wrongly — **which is the
 * failure this whole view exists to prevent.**
 */
export interface ManifestItem {
  /** The handle or identifier the reply may cite. */
  readonly id: string
  /** The digest of what was held, hex. */
  readonly sha256: string
  /** Where it came from, in the turn's own vocabulary. */
  readonly source: string
  /** When it was read, seconds-precision UTC, when the turn knows. */
  readonly at?: string
  /** **Whether this block counts as an outside word** — the second field AK-UI will not invent. */
  readonly outsideWords: boolean
}

/** One block of attention, grouped the way the view renders it. */
export interface ManifestGroup {
  readonly block: string
  readonly items: readonly ManifestItem[]
}

/**
 * A speech finding, as item (3) produces them — **a MARK on the reply, which is what the design says a finding is.**
 *
 * `memory-speech.ts`'s header quotes `memory-design §2.3`: *"the check **MARKS A REPLY**"*. **Not blocks, not
 * rewrites** — and a rewrite would edit her words after she said them and hide the very occasion the check exists to
 * catch. **So a finding has to be CARRIED, and this is the carrier.**
 */
export interface ManifestFinding {
  /** `overclaimed-tier` or `fabricated-handle`, as `memory-speech.ts` names them. */
  readonly kind: string
  /** The words or the handle that provoked it. */
  readonly detail: string
}

/** One reply's manifest, as the file holds it. */
export interface ReplyManifestLine {
  readonly replyId: string
  /** Seconds-precision UTC. */
  readonly at: string
  readonly groups: readonly ManifestGroup[]
  /** The prompt budget the turn was given, when the turn knows it. */
  readonly budget?: number
  /** Findings about her own speech, when there are any. **Absent rather than empty**, so a clean reply adds no bytes. */
  readonly findings?: readonly ManifestFinding[]
  /** What the turn rebuilt, when it rebuilt anything. */
  readonly rebuild?: string
}

/**
 * The identity one turn's manifest is filed under.
 *
 * @param sessionId - the session the turn belongs to.
 * @param turn - the model-request line's one-based position, as `auma/turn-finished` carries it.
 * @returns the id the WHY link must pass.
 */
export function replyIdOf(sessionId: string, turn: number): string {
  return `${sessionId}:${String(turn)}`
}

/**
 * Append one reply's manifest, or refuse when there is nowhere to write it.
 *
 * **AN APPEND RATHER THAN A REWRITE**, because the WHY route reads the newest matching line and a whole-file rewrite
 * of a growing log is the shape that loses every earlier receipt to one bad write. **And one line per reply, so a
 * damaged line costs exactly one reply** — the reader's own decision, which skips a broken line rather than throwing.
 *
 * @param options - the state root, the manifest, and an optional sink for tests.
 * @returns the path written, or null when no root was configured.
 */
export function appendReplyManifest({ dshHome, manifest, write }: {
  dshHome: string
  manifest: ReplyManifestLine
  /** Overridden by a court so the bytes can be inspected without a filesystem. */
  write?: (path: string, line: string) => void
}): string | null {
  // **NO HOME MEANS NO MANIFEST, RATHER THAN A DEFAULT ONE.** A deployment that has not said where its state lives
  // must not have records scattered into a working directory — the rule `recordOrRefuse` already follows.
  if (typeof dshHome !== 'string' || dshHome === '') return null
  const path = join(dshHome, MANIFEST_LOG_RELATIVE)
  const line = `${JSON.stringify(manifest)}\n`
  if (write !== undefined) { write(path, line); return path }
  try {
    mkdirSync(dirname(path), { recursive: true })
    appendFileSync(path, line, 'utf8')
  } catch {
    // **A MANIFEST THAT CANNOT BE WRITTEN MUST NOT FAIL THE TURN.** This is the attention view, not memory: the reply
    // has already been spoken, and losing its receipt costs a reader an explanation rather than costing her a memory.
    return null
  }
  return path
}
