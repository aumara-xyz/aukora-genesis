/**
 * cite-service.mjs — READ-ONLY citation of one settled record, with its Aura position CHECKED.
 *
 * WHY THIS EXISTS. AUMA is wiring a Kira lens so the organism can say *"that is Aura sequence N"* when
 * it remembers something. **A citation that has not been checked is a sentence she cannot honestly
 * say.** The store already returns a citation carrying `auraSequence` and `verifiedHead` on every read
 * — but a value the store hands you is a POINTER, and pointing is not verifying. This module answers
 * one question: *is the chain actually intact up to the position this record claims?*
 *
 * WHAT IT REUSES, AND WHAT IT REFUSES TO REUSE. It uses `createMemoryOwner`'s read owner for the
 * snapshot and its `verifyChain()` for the re-derivation — the chain's own check, in the chain's own
 * module (`memory-owner.mjs`), never restated here. **It imports no stage and no settle code**: citing
 * must be impossible to turn into writing, and the cheapest way to guarantee that is for the writing
 * modules never to be in scope.
 *
 * INVARIANT 4 — UNVERIFIED IS NOT EMPTY. Three outcomes, kept apart on purpose:
 *   VERIFIED    the chain re-derived, the record sits at the position it cites, and the head returned
 *               is the head the WALK produced.
 *   UNVERIFIED  a named reason, and NO HEAD. A reader told "unverified" and handed a head anyway has
 *               been handed the thing the verdict was withholding.
 *   (refusal)   an unknown record id is refused BY NAME rather than reported as UNVERIFIED, because
 *               "this store has no such record" and "this store cannot vouch for it" are different
 *               facts and collapsing them would hide a typo behind a doubt.
 */

/** The only outcome strings this module emits. Named once so a consumer cannot match on a typo. */
export const CITE_VERIFIED = 'VERIFIED'
export const CITE_UNVERIFIED = 'UNVERIFIED'
/**
 * THE NAME THE CONSUMERS ALREADY ASK FOR. Measured 2026-09-25: `plugins/aukora-board/lib/index.js` resolves
 * `ctx.reflect.get('aura.cite', false)` on every call, `plugins/aukora-face/apps/lib/index.js` builds its
 * `KiraLens(() => ctx.get('kira.recall'), () => ctx.get('aura.cite'))`, and
 * `plugins/aukora-organism/lib/lane-memory.mjs` reports `CITE_NOT_CHECKED` when the door is missing. Three
 * readers, and nothing provided it — a citation could be shown with the chain never re-derived.
 */
export const AURA_CITE_SERVICE = 'aura.cite'
/**
 * A READING DOOR MUST NOT CARRY A WRITING VERB. The same rule `provideKiraRecall` applies to `kira.recall`:
 * checked by NAME against the service object rather than left to the module's own restraint, so a member
 * added later cannot quietly turn a citation into a write.
 */
export const FORBIDDEN_CITE_MEMBER = /(stage|settle|mint|approve|enqueue|decline|grant|write)/iu

/**
 * Build the cite service over one store.
 *
 * @param {{ stateDir: string, subject: string, permittedPrivacy?: readonly string[],
 *           createMemoryOwner: (options: {stateDir: string}) => any }} options
 *   `createMemoryOwner` is INJECTED rather than imported so this module carries no dependency on the
 *   owner's own import graph, and so a court can drive it without a store on disk.
 */
export function createCiteService(options) {
  const stateDir = options?.stateDir
  const subject = options?.subject
  const createMemoryOwner = options?.createMemoryOwner
  if (typeof stateDir !== 'string' || stateDir === '') {
    throw new Error('cite: stateDir must be a non-empty string')
  }
  if (typeof subject !== 'string' || !/^aukora:1:[0-9a-f]{64}$/.test(subject)) {
    throw new Error('cite: subject must be an aukora:1:<64 hex> identifier')
  }
  if (typeof createMemoryOwner !== 'function') {
    throw new Error('cite: createMemoryOwner must be injected')
  }
  const permittedPrivacy = options?.permittedPrivacy ?? ['local']

  /**
   * Cite one record.
   *
   * @param {string} recordId
   * @returns {Promise<{recordId: string, auraSequence: number, verifiedHead: string,
   *                    verdict: 'VERIFIED'} |
   *                   {recordId: string, verdict: 'UNVERIFIED', reason: string}>}
   */
  async function cite(recordId) {
    if (typeof recordId !== 'string' || recordId === '') {
      throw new Error('cite: recordId must be a non-empty string')
    }
    const owner = createMemoryOwner({ stateDir })
    const snapshot = await owner.createReadOwner({ subject, permittedPrivacy }).read()

    // AN UNREADABLE STORE IS NOT AN UNKNOWN RECORD. `undetermined` means the read could not be made at
    // all, and reporting that as "no such record" would tell a reader the record is absent when the
    // truth is that nothing was read.
    if (snapshot?.availability !== 'found') {
      return { recordId, verdict: CITE_UNVERIFIED,
        reason: `the store returned availability=${String(snapshot?.availability)}`
          + (snapshot?.reason ? ` (${snapshot.reason})` : '') }
    }

    const rows = Array.isArray(snapshot.records) ? snapshot.records : []
    const row = rows.find(candidate => candidate?.citation?.recordId === recordId)
    if (row === undefined) {
      // REFUSED BY NAME. Not UNVERIFIED: this is not a doubt about the chain, it is the absence of the
      // record, and a caller that confuses the two will chase a corruption that is a typo.
      throw new Error(`cite: UNKNOWN_RECORD — this store holds no record ${recordId}`)
    }
    const citation = row.citation

    // ── THE CHAIN'S OWN CHECK ALREADY RAN, AND THIS IS WHERE IT IS READ ─────────────────────────
    // `createReadOwner().read()` calls `verifyChain()` INSIDE the read path (`memory-owner.mjs:1186`)
    // and returns `undetermined('memory-unverified')` when it fails — so a citation cannot be returned
    // from a broken chain in the first place, and the `availability !== 'found'` branch above IS the
    // truncated-log outcome. Calling `verifyChain()` again here would be a SECOND implementation of a
    // check the owner already owns, and this module deliberately does not restate the chain rule.
    //
    // WHAT IS STILL OURS TO CHECK: that the position the citation NAMES is the position it CLAIMS.
    // The read vouches for the chain; it does not vouch for this record sitting at this sequence.
    const entryHash = citation.auraEntryHash
    const citedHead = citation.verifiedHead
    if (typeof citation.auraSequence !== 'number' || !Number.isFinite(citation.auraSequence)) {
      return { recordId, verdict: CITE_UNVERIFIED,
        reason: 'the citation carries no numeric auraSequence, so there is no position to cite' }
    }
    if (typeof citedHead !== 'string' || citedHead === '') {
      return { recordId, verdict: CITE_UNVERIFIED,
        reason: 'the citation carries no verifiedHead, so there is nothing to cite' }
    }
    // A CITATION WHOSE ENTRY HASH IS ABSENT OR MALFORMED IS NOT A CITATION. Refusing here rather than
    // returning the head is the whole point: the head is only as good as the position it anchors.
    if (typeof entryHash !== 'string' || !/^[0-9a-f]{64}$/.test(entryHash)) {
      return { recordId, verdict: CITE_UNVERIFIED,
        reason: `the citation carries no usable auraEntryHash (${String(entryHash)})` }
    }
    // THE POSITION MUST BE ONE THE VERIFIED CHAIN ACTUALLY HAS. The read walks the log to build this
    // citation, so a sequence beyond what it walked is a contradiction, not a doubt.
    const chainLength = Number(snapshot.auraEntryCount ?? snapshot.entryCount ?? Number.NaN)
    if (Number.isFinite(chainLength) && citation.auraSequence > chainLength) {
      return { recordId, verdict: CITE_UNVERIFIED,
        reason: `the citation names sequence ${citation.auraSequence} but the verified chain has `
          + `${chainLength} entr${chainLength === 1 ? 'y' : 'ies'}` }
    }
    return {
      recordId,
      auraSequence: citation.auraSequence,
      // THE HEAD IS THE ONE THE VERIFIED READ RETURNED. It is not re-derived here and it is never
      // invented: if the chain had not verified, this line is unreachable.
      verifiedHead: citedHead,
      auraEntryHash: entryHash,
      verdict: CITE_VERIFIED,
    }
  }

  return { cite }
}

/**
 * Provide the cite service on a Cordis context, or refuse by name.
 *
 * THE SHAPE IS `provideKiraRecall`'S, DELIBERATELY: a boolean and a reason rather than a throw, because a
 * deployment that cannot mount this door must cost a warning and not the whole plugin. What differs is what
 * it needs: `kira.recall` is provided over the READ OWNER (which decides subject and privacy), and this one
 * needs those too — but it also needs the STORE'S stateDir, which the read owner does not carry, because
 * citing means walking the store's own `aura.jsonl`. A composition with no store therefore gets no cite
 * door, and says so by name instead of mounting one over a directory nobody named.
 *
 * @param {{provide?: Function}} ctx
 * @param {{stateDir: string, subject: string, permittedPrivacy?: readonly string[],
 *          createMemoryOwner: (options: {stateDir: string}) => any,
 *          logger?: {warn?: Function}}} deps
 * @returns {{provided: boolean, reason?: string}}
 */
export function provideKiraCite(ctx, deps) {
  if (typeof ctx?.provide !== 'function') {
    // REFUSED BY NAME. A host context with no `provide` cannot offer this door.
    return { provided: false, reason: 'no-ctx-provide' }
  }
  let service
  try {
    service = createCiteService({
      stateDir: deps?.stateDir,
      subject: deps?.subject,
      permittedPrivacy: deps?.permittedPrivacy,
      createMemoryOwner: deps?.createMemoryOwner,
    })
  } catch (error) {
    // `createCiteService` refuses a missing stateDir, a subject that is not an aukora identifier, and an
    // absent `createMemoryOwner` — each of them a configuration fault, and each named through here.
    deps?.logger?.warn?.(`aura.cite not mounted (${String(error?.message ?? error)})`)
    return { provided: false, reason: `cite-not-constructible: ${String(error?.message ?? error).slice(0, 120)}` }
  }
  const offenders = Object.keys(service).filter(name => FORBIDDEN_CITE_MEMBER.test(name))
  if (offenders.length > 0) {
    return { provided: false, reason: `service-carries-${offenders.join('-')}` }
  }
  ctx.provide(AURA_CITE_SERVICE, service)
  return { provided: true }
}
