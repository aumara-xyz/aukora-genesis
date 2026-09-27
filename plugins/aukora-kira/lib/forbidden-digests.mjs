/**
 * THE FORBIDDEN-PHRASE DIGESTS, ON DISK — the contract between the tool a person runs and the export that reads it.
 *
 * WHY THIS FILE EXISTS (Fable's boot-risk review of HEAD, 2026-09-25). After the Codex sweep, an EMPTY digest list
 * makes `compactionCandidate` refuse every candidate as `not-configured` — right by doctrine, because an empty
 * list used to allow everything while reading as enforced. But `index.js` registered the export with the module's
 * shipped EMPTY list, so the live app would have stopped staging Kira summaries the moment the next release went
 * live: memory stops growing, silently, and in the safe direction. The prohibition has to be CONFIGURABLE, by the
 * person who owns the phrases, without putting a phrase in this repository.
 *
 * WHAT IS STORED. sha256 digests of the THREE-WORD WINDOWS of each phrase — the same `windowDigests` the export
 * uses, imported rather than re-implemented, so the tool cannot drift from the check. No phrase, and no word of a
 * phrase, is ever written here.
 *
 * THE STATES, ALL NAMED, BECAUSE "NOT CONFIGURED" AND "BROKEN" ARE DIFFERENT FACTS:
 *   · `configured` — the file is there, parses, and carries digests. The export runs with them.
 *   · `missing`    — no file yet. The export REFUSES every candidate as `not-configured`, and the mount says so
 *                    out loud with the command to fix it. This is the pre-Peter state and it is not a defect.
 *   · `empty`      — a file that carries no digests. Treated as unconfigured rather than as "nothing is
 *                    forbidden", because that reading is exactly the defect finding 1 closed.
 *   · `malformed`  — unreadable, wrong shape, or an entry that is not a sha256. REFUSED, never trusted.
 *
 * @module @aukora/dsh-plugin-kira/forbidden-digests
 */
import { windowDigests } from './compaction-export.mjs'
import { durableWrite, readJsonStrict } from './strict-read.mjs'

/** The file's own name, in the Kira state directory. One file, one meaning. */
export const FORBIDDEN_DIGESTS_FILE = 'forbidden-window-digests.json'

/** The file says what it is, so a reader can refuse a file that is something else. */
export const FORBIDDEN_DIGESTS_KIND = 'aukora:kira-forbidden-window-digests:v1'

/** A sha256, in lower-case hex: the only shape an entry may have. */
const SHA256_HEX = /^[0-9a-f]{64}$/u

/** @param {string} stateDir @returns {string} the digests file inside one store's state directory. */
export const forbiddenDigestsPathOf = stateDir => `${stateDir}/${FORBIDDEN_DIGESTS_FILE}`

/**
 * The digests for a set of phrases, as the export computes them. THE ONE PLACE THIS CONVERSION LIVES.
 * @param {readonly string[]} phrases
 * @returns {string[]} sorted, de-duplicated, lower-case hex.
 */
export function digestsOfPhrases(phrases) {
  const out = new Set()
  for (const phrase of phrases) {
    for (const digest of windowDigests(String(phrase))) out.add(digest)
  }
  return [...out].sort()
}

/**
 * READ THE DIGESTS, OR SAY BY NAME WHY THERE ARE NONE. Never throws: a caller on a hot path cannot use a function
 * that does, and every failure here has a safe answer — refuse.
 * @param {string} stateDir
 * @returns {{state: 'configured'|'missing'|'empty'|'malformed', digests?: readonly string[], detail?: string}}
 */
export function readForbiddenDigests(stateDir) {
  const path = forbiddenDigestsPathOf(String(stateDir ?? ''))
  let parsed
  try {
    parsed = readJsonStrict(path, { label: 'the forbidden-phrase digests' })
  } catch (error) {
    // ENOENT PASSES THROUGH THE STRICT READER UNTOUCHED, on purpose, so a missing file is distinguishable here
    // from one that failed every other check.
    if (error?.code === 'ENOENT') return { state: 'missing' }
    return { state: 'malformed', detail: `${String(error?.code ?? error?.name ?? 'unknown')}: ${String(error?.message ?? error).slice(0, 160)}` }
  }
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return { state: 'malformed', detail: 'the digests file is not one JSON object' }
  }
  if (parsed.kind !== FORBIDDEN_DIGESTS_KIND) {
    return { state: 'malformed', detail: `the digests file names itself ${String(parsed.kind ?? 'nothing')}` }
  }
  if (!Array.isArray(parsed.digests)) return { state: 'malformed', detail: 'the digests field is not a list' }
  const bad = parsed.digests.find(one => typeof one !== 'string' || !SHA256_HEX.test(one))
  if (bad !== undefined) return { state: 'malformed', detail: `an entry is not a sha256: ${String(bad).slice(0, 24)}` }
  if (parsed.digests.length === 0) return { state: 'empty' }
  return { state: 'configured', digests: Object.freeze([...parsed.digests]) }
}

/**
 * WRITE THE DIGESTS, 0600, DURABLY. Used by the tool a person runs; the app only ever reads.
 * @param {string} stateDir @param {readonly string[]} digests @returns {string} the path written.
 */
export function writeForbiddenDigests(stateDir, digests) {
  const path = forbiddenDigestsPathOf(String(stateDir ?? ''))
  const body = `${JSON.stringify({ kind: FORBIDDEN_DIGESTS_KIND, digests: [...digests].sort() }, null, 2)}\n`
  durableWrite(path, body, { dir: String(stateDir), mode: 0o600 })
  return path
}
