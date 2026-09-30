/**
 * A READ OWNER OVER THE REMEMBERED STORE — so `kira.recall` answers from the notes that were actually written.
 *
 * **FABLE'S ITEM (3), SECOND HALF: "make recall read `remembered/` with its tier label."** Today `kira.recall` reads through
 * the deployment's read owner, which answers from the SETTLED store — the three records Peter has and the hundred and
 * twenty-five he does not. The remembered tier writes somewhere else entirely (`remembered/`), so without this the notes the
 * capture hook produces are invisible to the one service the face reads. A memory nobody can recall is not a memory.
 *
 * IT PRESENTS THE SHAPE `readOnlySurface` ACCEPTS, deliberately: `createReadOwner` first, because that is what the service
 * tries before it inspects members, and a read door that carries anything else would be refused by name.
 *
 * *** EVERY RECORD CARRIES ITS TIER, AND THAT IS NOT DECORATION. *** The contract has two tiers with different standing:
 * `remembered` is automatic and unsigned, `trusted` is signed and needs an approval. A caller that cannot tell them apart
 * would show an unreviewed sentence with the same weight as a signed one — which is precisely the confusion `outsideWords` and
 * the frame's labels exist to prevent. The tier travels on the record, and `citation` travels with it so a reader can ask what
 * a note rests on.
 *
 * UNAVAILABLE IS NOT EMPTY, in the store's own words: a store that cannot be read answers `undetermined` with a reason, and
 * only a store that is genuinely absent answers `empty`. `buildRouteDeps` already draws that distinction — this module
 * forwards it rather than flattening it into a list.
 *
 * @module @aukora/dsh-plugin-kira/memory-recall-owner
 */
import { readOnlySurface, recordsOf } from './recall-service.mjs'

/**
 * Build a read owner over the remembered store.
 *
 * @param {{listNotes: (query?: Record<string, unknown>) => Promise<Record<string, unknown>> | Record<string, unknown>,
 *          logger?: {warn?: Function}}} deps - `listNotes` comes from `buildRouteDeps`, so there is one reader of the store
 * @returns {{createReadOwner: (policy?: Record<string, unknown>) => {read: () => Promise<Record<string, unknown>>}}}
 */
export function rememberedReadOwner(deps) {
  const listNotes = deps?.listNotes
  if (typeof listNotes !== 'function') {
    throw new Error('kira.recall: a remembered read owner needs the store reader, and refusing here beats answering empty')
  }
  const surface = {
    async read() {
      let answer
      try {
        answer = await listNotes({ tiers: ['remembered'] })
      } catch (error) {
        // A REFUSAL IS NOT AN EMPTY MEMORY. The routes draw this line for the API; the service must draw it for the model.
        return { status: 'undetermined', records: [], reason: `the remembered store could not be read (${String(error?.code ?? error?.message ?? 'unknown')})` }
      }
      const notes = Array.isArray(answer?.items) ? answer.items : (Array.isArray(answer) ? answer : [])
      const records = notes.map(note => ({
        ...note,
        // THE LABEL, PRESENT ON EVERY RECORD rather than inferred by a reader from which endpoint it came from.
        tier: String(note?.tier ?? 'remembered'),
        citation: note?.citation ?? { sessionId: note?.source?.sessionId ?? null, seq: note?.source?.seq ?? null, sha256: note?.source?.sha256 ?? null, at: note?.source?.at ?? null },
      }))
      // `empty` ONLY WHEN THE STORE ANSWERED AND HAD NOTHING. Its own availability word, forwarded.
      return { status: records.length === 0 ? 'empty' : 'match', records }
    },
  }
  return {
    // THE NARROWING THE SERVICE TRIES FIRST. It may be handed a policy; this surface does not widen or narrow anything with it,
    // because the store's own listing is already the read owner's decision about subject and privacy.
    createReadOwner: policy => ({ async read() {
      const answer = await surface.read()
      const records = (answer.records ?? []).filter(note => (!policy?.subject || note.subject === policy.subject)
        && (!policy?.permittedPrivacy || policy.permittedPrivacy.includes(note.privacy)))
      return { ...answer, records, ...(answer.status === 'undetermined' ? {} : { status: records.length ? 'match' : 'empty' }) }
    } }),
  }
}

/**
 * BOTH TIERS, ONE READ — the remembered store and the deployment's own read owner, merged.
 *
 * The contract's recall returns "remembered plus trusted": the notes the capture hook writes automatically, and the records
 * that were signed through the approval route. They live in different places — `remembered/` and the settled store — so a
 * recall that reads only one of them is a recall that hides half the memory, in whichever direction the reader is not looking.
 *
 * THE ORDER IS DELIBERATE: remembered first, because they are the ones nobody has seen yet, and a signed record has already
 * had its turn in front of a person. The ranker still decides the final order by the question; this is only the pool it
 * ranks, and putting the unreviewed notes in it is the point of the tier.
 *
 * A failure on either side withholds the combined answer. An unreadable or unverified store must not look empty or healthy.
 *
 * @param {{storeDeps: Record<string, unknown>, owner: Record<string, unknown>, logger?: {warn?: Function}}} input
 * @returns {{createReadOwner: (policy?: Record<string, unknown>) => {read: () => Promise<Record<string, unknown>>}}}
 */
export function mergedReadOwner(input) {
  const remembered = rememberedReadOwner(input?.storeDeps ?? {})
  const owner = input?.owner
  return {
    createReadOwner: policy => {
      const rememberedSurface = remembered.createReadOwner(policy)
      return {
        async read() {
          const first = await rememberedSurface.read()
          let second = { status: 'undetermined', records: [], reason: 'the deployment read owner could not be narrowed' }
          try {
            // The plugin already narrowed its owner to { describe, read }.
            second = recordsOf(await readOnlySurface(owner, policy).read())
          } catch (error) {
            second.reason = `the settled store could not be read (${String(error?.message ?? 'unknown')})`
            input?.logger?.warn?.(`aukora-kira: ${second.reason}`)
          }
          const firstOk = first?.status === 'match' || first?.status === 'empty'
          const secondOk = second?.status === 'match' || second?.status === 'empty'
          if (!firstOk || !secondOk) return { status: 'undetermined', records: [], reason: (!firstOk ? first?.reason : second?.reason) ?? 'a memory store could not be verified' }
          const records = [...(first?.records ?? []), ...(second?.records ?? []).map(entry => ({ ...entry.record, ...entry, tier: 'signed' }))]
          return { status: records.length === 0 ? 'empty' : 'match', records }
        },
      }
    },
  }
}
