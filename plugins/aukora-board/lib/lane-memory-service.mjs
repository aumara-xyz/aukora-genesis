/**
 * `organism.memory` — WHAT THE LANES CONCLUDED, READ THROUGH THE READ-ONLY DOORS AND PROVIDED AS DATA.
 *
 * WHY A SERVICE AND NOT A DIRECT CALL. The organism reader is CARRIED into the face byte for byte, so it may
 * import nothing; the assembly needs Kira's own `newestPerLane`/`buildCoreDigest`; and the face's own package
 * tree cannot reach `plugins/`. So the reading happens HERE, in a host plugin that may import both, and what
 * crosses the boundary is a plain frozen view of strings and booleans — no service objects, no store handles,
 * nothing a renderer could use to write.
 *
 * WHAT IT READS:
 *   · `kira.recall` — the read-only door onto settled memory. Resolved on EVERY call through the non-throwing
 *     accessor, because a composition may provide it after this plugin loads and a captured `undefined` would
 *     leave every lane looking like a lane that concluded nothing forever.
 *   · the review QUEUE — read through Kira's own parser (`readPendingSummaries`), which reports an unreadable
 *     file by name rather than dropping it.
 *   · `aura.cite` — asked once per settled summary. A service that is absent, throws, or refuses an unknown
 *     record yields `NOT CHECKED`, and a returned non-VERIFIED verdict yields `UNVERIFIED`: neither is ever
 *     widened to VERIFIED, because "I did not check" and "the chain checked out" are different sentences.
 *
 * IT WRITES NOTHING AND HOLDS NOTHING. No cache: the view is rebuilt per call from what the doors answer, so a
 * summary settled a minute ago is visible now rather than after a restart. A slow or failing read degrades to a
 * view whose `missing` names what could not be read — never to a silent empty one.
 *
 * @module @aukora/dsh-plugin-board/lane-memory-service
 */
import { laneMemoryOf, readPendingSummaries } from '../../aukora-organism/lib/lane-memory.mjs'

/** The service name the organism view reads the lanes' memory through. */
export const LANE_MEMORY_SERVICE = 'organism.memory'

/**
 * The whole view, from resolvers rather than from a context, so a court can drive it without Cordis.
 *
 * @param {{dshHome?: string, resolveRecall?: () => unknown, resolveCite?: () => unknown,
 *          readFile?: Function, listDir?: Function}} input
 * @returns {Promise<Readonly<Record<string, unknown>>>}
 */
export async function readLaneMemoryView({ dshHome, resolveRecall = () => undefined, resolveCite = () => undefined, readFile, listDir } = {}) {
  const missing = []
  const recall = resolveRecall()
  let recalled = { status: 'undetermined', records: [] }
  if (typeof recall?.recall !== 'function') {
    missing.push('kira.recall is not mounted on this Host, so no settled summary was read')
  } else {
    try {
      recalled = await recall.recall('')
    } catch (error) {
      // A THROWING DOOR IS NAMED, NOT SWALLOWED: the view then carries `undetermined` from the read owner's own
      // vocabulary rather than an empty corpus that would read as "these lanes concluded nothing".
      missing.push(`kira.recall (${String(error?.message ?? error)})`)
    }
  }
  const queue = typeof dshHome === 'string' && dshHome !== ''
    ? readPendingSummaries({ dshHome, readFile, listDir })
    : { entries: [], missing: ['the Kira queue (no dshHome was passed, so nothing was read)'] }
  const view = await laneMemoryOf({ recalled, pending: queue.entries, cite: resolveCite() })
  return Object.freeze({ ...view, missing: Object.freeze([...view.missing, ...queue.missing, ...missing]) })
}
