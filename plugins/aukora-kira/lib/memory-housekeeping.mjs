/**
 * NIGHTLY HOUSEKEEPING, PLANNED — §5.1's steps 2 to 5, with no model anywhere in it.
 *
 * **FABLE'S kira-123 ITEM 2:** *"exact-duplicate merge, expiry of short-lived kinds per a JSON retention policy with a `--dry-run`,
 * and topic grouping. Every change is recorded in the Aura chain, and a SIGNED record is NEVER rewritten, only proposed. It runs only
 * when the machine is idle and memory is at 50 or above. Courts: a signed record is never touched; the dry run writes nothing; every
 * change has its chain entry."*
 *
 * *** THIS MODULE IS PURE, AND THAT IS THE DRY RUN. *** `planHousekeeping` reads notes and returns a plan; it opens no file, writes
 * nothing and appends nothing. `--dry-run` prints that plan; the real run prints it AND applies it. One code path, two exits — so a
 * dry run cannot disagree with the run it is predicting, which is the only property that makes a dry run worth having.
 *
 * *** NOTHING HERE REWRITES A NOTE. *** The design says a merged record gets a `merged-into` LINK and an expired one is "journaled,
 * restorable"; both are expressed as CHANGES IN THE CHAIN rather than as edits to the record. That is what keeps a signed record
 * untouched even if a later step were to be wrong, and it is why `retentionDecision` — which refuses to touch `signed` at all — is
 * called here rather than re-implemented.
 *
 * *** AND THE LINK THE DESIGN ASKS FOR IS NOT A THING THIS MODULE CAN WRITE, MEASURED RATHER THAN ASSUMED. *** Adding `links` to a stored record
 * makes it answer **CHANGED** with `id-recomputes` as the named failure — `links` is INSIDE the hashed bytes (§3.6's id is taken over the stored
 * envelope, links included), so writing a `merged-into` link onto a merged record would change that record's id. It would not be a derived layer
 * move; it would be a rewrite, exactly what this comment refuses and what the design forbids for a signed record. So the merge lives in the chain,
 * where §3.6 puts it, and the design's LINK needs a decision this lane cannot make alone: either links move outside the hashed bytes, or the merged
 * record is reissued as a new record carrying the link. Both are design changes; both are reported. The `restore` op the design pairs with it is in
 * the journal's twelve and implemented by nothing, which is the same gap from the other side.
 *
 * NO MODEL, NO SCORES, NO PROBABILITY: exact duplicate means the statement bytes are equal, expiry means a rule in the JSON policy
 * named a date that has arrived, and grouping is label propagation over shared rare terms. Every one of those is deterministic, so
 * two runs on the same store produce the same plan and a reviewer can re-derive it.
 *
 * @module @aukora/dsh-plugin-kira/memory-housekeeping
 */
import { retentionDecision } from './memory-forget.mjs'

/** A named refusal, so a caller can act on which precondition failed rather than on a stack. */
export class KiraHousekeepingError extends Error {
  constructor(code, message) {
    super(`kira.housekeeping: ${message}`)
    this.name = 'KiraHousekeepingError'
    this.code = `kira.housekeeping:${code}`
  }
}

/** @param {string} code @param {string} message @returns {never} */
function refuse(code, message) {
  throw new KiraHousekeepingError(code, message)
}

/** Words that carry no topic: short, or so common that sharing one means nothing. Kept short and boring on purpose. */
const STOP = new Set([
  'that', 'this', 'with', 'from', 'have', 'has', 'had', 'were', 'was', 'will', 'would', 'should', 'could', 'your', 'yours',
  'they', 'them', 'their', 'there', 'here', 'when', 'what', 'which', 'while', 'about', 'into', 'over', 'under', 'than', 'then',
  'also', 'just', 'like', 'make', 'made', 'much', 'more', 'most', 'some', 'such', 'only', 'other', 'because', 'been', 'being',
])

/** The terms of a statement: lowercased words of four or more letters, stop words removed, sorted and deduplicated. */
export function termsOf(statement) {
  const words = String(statement ?? '').toLowerCase().match(/[a-z][a-z0-9-]{3,}/gu) ?? []
  return Object.freeze([...new Set(words.filter(one => !STOP.has(one)))].sort())
}

/**
 * Exact duplicates: THE SAME STATEMENT BYTES, grouped, with the OLDEST kept and the rest merged into it.
 * "Exact" is meant literally — no normalisation, no near-match, no fuzzy score. Two notes that differ by a comma are two notes,
 * and deciding they are one is a judgement this job is not allowed to make.
 *
 * @param {ReadonlyArray<Record<string, unknown>>} notes
 * @returns {ReadonlyArray<{keep: string, merged: ReadonlyArray<string>, statement: string}>}
 */
export function exactDuplicates(notes) {
  const byStatement = new Map()
  for (const note of notes) {
    const key = String(note?.statement ?? '')
    if (key === '') continue
    // *** A SIGNED RECORD IS NOT IN A DUPLICATE GROUP AT ALL. *** Retention refuses the signed tier explicitly, and this loop did not:
    // sorting a group by `createdAt` and keeping the oldest can put a SIGNED note in the `merged` list, which is exactly the
    // rewriting Fable's first court forbids. Excluding it here costs nothing — a signed note is never dropped, and an unsigned twin
    // with the same words is still merged among its own kind. The court caught this on its first run.
    if (note?.tier === 'signed') continue
    if (!byStatement.has(key)) byStatement.set(key, [])
    byStatement.get(key).push(note)
  }
  const groups = []
  for (const [statement, group] of byStatement) {
    if (group.length < 2) continue
    // THE OLDEST IS KEPT, and ties break on the id so the choice is stable across runs and machines.
    const ordered = [...group].sort((a, b) => String(a.createdAt ?? '').localeCompare(String(b.createdAt ?? '')) || String(a.id).localeCompare(String(b.id)))
    groups.push(Object.freeze({
      keep: String(ordered[0].id),
      merged: Object.freeze(ordered.slice(1).map(one => String(one.id))),
      statement,
    }))
  }
  return Object.freeze(groups.sort((a, b) => a.keep.localeCompare(b.keep)))
}

/**
 * STEP 4 OF §5.1: THE USAGE COUNTS, FROM THE DESIGN'S OWN SOURCE.
 *
 * §4 names two sources of usage — *"An identical normalized statement counts as 'seen again' (a usage entry)"*, and the recall path — and
 * only the first is derivable from the store: a recall is a READ, and the journal's twelve ops record writes, so nothing in this tree has
 * ever recorded one. This function therefore counts what the store can actually prove, and says so rather than inventing the other half.
 *
 * `seenAgain` is the number of ADDITIONAL sightings (a statement seen twice is one usage entry, not two), which is the quantity §4's
 * multiplier consumes as its `recalls` input: *"Three recalls reaches the top of the band"*.
 *
 * *** A SIGNED NOTE'S USAGE IS COUNTED AND NEVER WRITTEN INTO IT. *** Usage counts are a DECLARED DERIVED LAYER (§4: *"Derived layers can be
 * rebuilt and sit outside the hashed bytes: enrichment keywords, usage counts and topics"*), so this returns ids and numbers ONLY — no note
 * objects, nothing that could be mistaken for a rewritten record. A signed note keeps its bytes; its count travels beside them.
 *
 * @param {ReadonlyArray<Record<string, unknown>>} notes
 * @returns {ReadonlyArray<{id: string, seenAgain: number, statement: string}>} sorted by id, so the plan is reproducible.
 */
export function usageCounts(notes) {
  const byStatement = new Map()
  for (const note of notes) {
    const key = String(note?.statement ?? '')
    if (key === '') continue
    if (!byStatement.has(key)) byStatement.set(key, [])
    byStatement.get(key).push(note)
  }
  const counts = []
  for (const [statement, group] of byStatement) {
    // EVERY TIER IS COUNTED, including signed: the multiplier applies to all of them (§4's score is BM25 × tier weight × multiplier), and
    // counting is not rewriting. The duplicate MERGE excludes signed notes because a merge rewrites; this does not.
    for (const note of group) counts.push(Object.freeze({ id: String(note.id), seenAgain: group.length - 1, statement }))
  }
  return Object.freeze(counts.sort((a, b) => a.id.localeCompare(b.id)))
}

/**
 * Expiries: the policy's own decision, applied only where the date has arrived. A `signed` note is never here because
 * `retentionDecision` returns no rule for it — the guard lives in the engine rather than being restated in this loop.
 *
 * @param {ReadonlyArray<Record<string, unknown>>} notes @param {{rules: ReadonlyArray<Record<string, unknown>>}} policy
 * @param {string} now - today, as `YYYY-MM-DD`.
 */
export function expiries(notes, policy, now, usage, kept) {
  const out = []
  for (const note of notes) {
    // `usage` AND `kept` ARE PASSED THROUGH TO THE RULE, because `neverRecalled` is a question about use and `kept` is a question about the owner's own
    // decision — and both answers live in a DERIVED LAYER rebuilt from the journal rather than in a field on the record (§5.1's usage counts, and `keptIds`
    // in `memory-forget.mjs`, which replays §3.6's `keep` op). Without this argument §2.1's "a Kept note is never silently replaced" would be enforced against
    // nothing, because §2.2 has no `→ Kept` move and §3.6's record shape has no `kept` key to carry it.
    const decision = retentionDecision(note, policy, { now, usage, keptIds: kept })
    if (decision.expiresAt === null) continue
    if (String(decision.expiresAt) > now) continue
    out.push(Object.freeze({ id: String(note.id), rule: decision.rule, expiresAt: decision.expiresAt, category: String(note.category ?? '') }))
  }
  return Object.freeze(out.sort((a, b) => a.id.localeCompare(b.id)))
}

/**
 * TOPIC GROUPING BY LABEL PROPAGATION over shared rare terms — deterministic, and small on purpose.
 *
 * A term is RARE when at most `maxTermNotes` notes carry it: a word in half the store says nothing about a topic. Notes sharing a
 * rare term are neighbours; every note starts with its own id as its label; each round every note takes the label most common among
 * its neighbours, ties broken by the smallest label; after `rounds` rounds the labels are the groups. No model, no embeddings, and
 * two runs on the same store give the same answer.
 *
 * @param {ReadonlyArray<Record<string, unknown>>} notes
 * @param {{maxTermNotes?: number, rounds?: number, minGroup?: number}} [options]
 */
export function topicGroups(notes, options = {}) {
  const { maxTermNotes = 12, rounds = 8, minGroup = 2 } = options
  const usable = notes.filter(note => String(note?.statement ?? '') !== '')
  const byTerm = new Map()
  for (const note of usable) {
    for (const term of termsOf(note.statement)) {
      if (!byTerm.has(term)) byTerm.set(term, new Set())
      byTerm.get(term).add(String(note.id))
    }
  }
  const rare = new Map([...byTerm].filter(([, ids]) => ids.size >= 2 && ids.size <= maxTermNotes))
  const neighbours = new Map(usable.map(note => [String(note.id), new Set()]))
  for (const [, ids] of rare) {
    for (const id of ids) for (const other of ids) if (other !== id) neighbours.get(id).add(other)
  }
  let label = new Map(usable.map(note => [String(note.id), String(note.id)]))
  for (let round = 0; round < rounds; round += 1) {
    const next = new Map(label)
    for (const [id, peers] of neighbours) {
      if (peers.size === 0) continue
      // *** A NODE COUNTS ITS OWN LABEL TOO, AND WITHOUT THAT THIS OSCILLATES. *** Measured 2026-09-26 by the topic-grouping arm
      // this court just gained: two notes sharing ONE rare term each took the other's label, then took it back, forever — and after
      // the round limit each ended holding its OWN id, so the simplest possible topic in the world came back as two singletons and
      // `topicGroups` returned nothing. With the node's own label in the tally the two agree on the smallest one and the group forms.
      // (This is ordinary label propagation; the version above was one candidate short.)
      const tally = new Map([[String(label.get(id)), 1]])
      for (const peer of peers) {
        const one = label.get(peer)
        tally.set(one, (tally.get(one) ?? 0) + 1)
      }
      const winner = [...tally].sort((a, b) => b[1] - a[1] || String(a[0]).localeCompare(String(b[0])))[0][0]
      next.set(id, winner)
    }
    if ([...next].every(([id, one]) => label.get(id) === one)) { label = next; break }
    label = next
  }
  const groups = new Map()
  for (const [id, one] of label) {
    if (!groups.has(one)) groups.set(one, [])
    groups.get(one).push(id)
  }
  const out = []
  for (const ids of groups.values()) {
    if (ids.length < minGroup) continue
    const shared = [...rare].filter(([, members]) => ids.every(id => members.has(id))).map(([term]) => term).sort()
    // *** A GROUP WITH NO SHARED TERM IS NOT A TOPIC. *** Measured against Peter's real store the first time this ran: label propagation
    // put 122 of the 139 migrated notes in ONE group, because statements sharing ordinary words are neighbours and the graph is dense.
    // "One blob" is not a topic, and reporting it as one would be a number that looks like a result. The group's NAME must therefore
    // come from a term every member shares — the rarest one — and a group without one is dropped rather than named after an id.
    if (shared.length === 0) continue
    out.push(Object.freeze({
      name: shared[0],
      terms: Object.freeze(shared.slice(0, 5)),
      ids: Object.freeze(ids.slice().sort()),
    }))
  }
  return Object.freeze(out.sort((a, b) => a.name.localeCompare(b.name)))
}

/**
 * The whole plan: step 2, step 3 and step 5 of §5.1, in that order. NOTHING IS WRITTEN AND NOTHING IS DECIDED BY A MODEL.
 *
 * @param {{notes: ReadonlyArray<Record<string, unknown>>, policy: {rules: ReadonlyArray<Record<string, unknown>>}, now: string}} input
 */
/**
 * *** "A SIGNED RECORD IS NEVER REWRITTEN, ONLY PROPOSED" — AND ONLY THE FIRST HALF WAS IMPLEMENTED. *** Fable's item 2 asks for both.
 * `exactDuplicates` excludes the signed tier and `retentionDecision` refuses it, so a signed note is never touched — courted, and right —
 * and NOTHING WAS EVER PROPOSED: a signed note a rule WOULD have taken was skipped in silence and the owner never learned a decision was
 * waiting. Effect without report is the same defect as report without effect, from the other side.
 *
 * PURE, so a court can drive it without a store; the job's report is where the proposal surfaces.
 *
 * @param {ReadonlyArray<object>} notes @param {object} policy @param {string} now
 * @returns {ReadonlyArray<{id: string, rule: string, why: string}>}
 */
export function signedProposals(notes, policy, now, usage, kept) {
  const list = Array.isArray(notes) ? notes : []
  const signed = list.filter(note => note?.tier === 'signed')
  if (signed.length === 0) return Object.freeze([])
  const statements = new Map()
  for (const note of list) {
    const key = String(note?.statement ?? '').trim().toLowerCase()
    if (key === '') continue
    statements.set(key, (statements.get(key) ?? 0) + 1)
  }
  const proposals = []
  for (const note of signed) {
    const key = String(note.statement ?? '').trim().toLowerCase()
    // WOULD THE DUPLICATE RULE HAVE TAKEN IT? The signed note is itself in `statements`, so only a count above one says a merge was possible.
    if ((statements.get(key) ?? 0) > 1) {
      proposals.push({ id: String(note.id), rule: 'duplicate', why: 'another record carries this statement, and a merge would rewrite a signed record, so it is proposed and not performed' })
      continue
    }
    // *** ASK THE RULE WHAT IT WOULD DO, ON A COPY: `retentionDecision` REFUSES THE SIGNED TIER ENTIRELY, so asking it about the signed
    // note answers `expiresAt: null` for every category and this branch could never fire. Measured the hard way: the first version passed
    // the note ITSELF and made the neighbouring signed arm fail ("a signed note must not appear in the expiries"); with the copy, the whole
    // court stays green. ***
    // A SIGNED NOTE'S PROPOSAL OBEYS THE SAME RULES AS ANY OTHER NOTE'S DECISION, so it is handed the same usage layer: a signed record the
    // owner keeps using must not be PROPOSED for expiry either, which is the whole point of the `neverRecalled` guard.
    const decision = retentionDecision({ ...note, tier: 'remembered' }, policy, { now, usage, keptIds: kept })
    if (decision.expiresAt !== null && String(decision.expiresAt) <= String(now)) {
      proposals.push({ id: String(note.id), rule: 'expiry', why: `the rule for ${String(note.category)} expires it on ${String(decision.expiresAt)}, and expiring a signed record would rewrite it, so it is proposed and not performed` })
    }
  }
  return Object.freeze(proposals)
}


/**
 * THE UNDO OF A HOUSEKEEPING BATCH — §2.2's "undo for 7 days", which had no producer.
 *
 * The design requires reversibility five times over (§2.1 "with undo" and "journaled and undoable", §2.2 "journaled, UNDO FOR 7 DAYS", §5.1 step 2 "a `merged-into` link,
 * WITH UNDO", §5.4 "a 7-day undo"), and reversibility is what makes an automatic merge acceptable at all. Measured before this function existed: `restore`, one of
 * §3.6's twelve ops, appeared in this tree EXACTLY ONCE — in the op list itself — and the word "undo" appeared nowhere in the lane's code.
 *
 * PURE, AND THAT IS THE POINT: it reads chain LINES and answers what the undo would be. It writes nothing, opens nothing, and therefore cannot be the thing that makes a
 * plan wrong. The caller appends the `restore` entries through `nextEntry`, which is the same path every other change takes.
 *
 * A BATCH IS IDENTIFIED FROM THE CHAIN ALONE — no run id, no side file: the entries housekeeping writes share one actor and one `at`, so the latest such batch is the
 * latest undoable run. Only the four ops §2.1 calls undoable are collected; a `turn`, an `add` or a `forget` is not something an undo should reverse.
 *
 * @param {Iterable<string>} journalLines
 * @param {string} now - an instant or a day; the window is measured from the batch's own `at` in the chain, never from a file's mtime.
 * @param {{windowDays?: number}} [options]
 */
export function undoPlan(journalLines, now, options = {}) {
  const windowDays = Number.isFinite(options?.windowDays) ? Number(options.windowDays) : 7
  const undoable = ['supersede', 'expire', 'hide', 'archive']
  const batches = new Map()
  for (const line of journalLines ?? []) {
    if (line === '') continue
    let entry
    try { entry = JSON.parse(line) } catch { continue }
    if (entry?.actor !== 'kira.housekeeping/v1') continue
    if (!undoable.includes(String(entry?.op))) continue
    const at = String(entry?.at ?? '')
    if (at === '') continue
    if (!batches.has(at)) batches.set(at, [])
    if (typeof entry.id === 'string') batches.get(at).push(String(entry.id))
  }
  if (batches.size === 0) return Object.freeze({ ok: false, why: 'nothing-to-undo', at: null, restores: Object.freeze([]) })
  const at = [...batches.keys()].sort().at(-1)
  const ageDays = (Date.parse(String(now)) - Date.parse(at)) / 86400000
  if (!Number.isFinite(ageDays)) return Object.freeze({ ok: false, why: 'undo-clock-unreadable', at, restores: Object.freeze([]) })
  if (ageDays > windowDays) {
    return Object.freeze({ ok: false, why: 'undo-window-closed', at, windowDays, ageDays: Math.floor(ageDays), restores: Object.freeze([]) })
  }
  return Object.freeze({ ok: true, why: null, at, windowDays, ageDays: Math.floor(ageDays), restores: Object.freeze([...new Set(batches.get(at))].sort()) })
}

export function planHousekeeping(input) {
  const { notes, policy, now } = input ?? {}
  if (!Array.isArray(notes)) refuse('notes-missing', 'housekeeping needs the notes it is planning over')
  if (policy === null || typeof policy !== 'object' || !Array.isArray(policy.rules)) {
    refuse('policy-malformed', 'the retention policy is a JSON document with a `rules` array')
  }
  if (typeof now !== 'string' || !/^\d{4}-\d{2}-\d{2}$/u.test(now)) refuse('now-not-a-day', '`now` is a calendar day, so a plan is reproducible from the notes and the policy alone')
  // *** §8.1's LEGACY ENTRIES ARE READ-ONLY, SO NOTHING IS PLANNED FOR THEM — AND THIS IS THE PATH WHERE THAT WAS MISSING. *** §8.1: the migrated lane notes *"stay under
  // the legacy subject as a read-only list … They are not imported and not re-bound to Peter's subject … They are never injected, never sent to the dream, and never
  // counted toward a proposal."* The READ path got §8.1's rule this session (`migrated-never-pre-turn` in `memory-frame.mjs`). THE PLAN PATH HAD NONE, and the first real
  // plan computed over Peter's store — 143 notes, READ ONLY — reported **51 duplicates to merge**, every one of them a migrated lane note: a chain `supersede` and an Aura
  // entry for 51 records the design calls read-only. The filter is HERE rather than at a caller so that no caller can forget it, which is the shape this lane spent a night
  // finding in fields nobody wrote and in options nobody passed.
  const planned = notes.filter(note => String(note?.origin?.by ?? '') !== 'migration/queue-v1')
  const duplicates = exactDuplicates(planned)
  // §5.1's FIXED ORDER IS 2 duplicates, 3 retention, 4 usage, 5 topics — AND THE USAGE LAYER IS COMPUTED FIRST BECAUSE STEP 3 READS IT. The
  // `neverRecalled` rule asks whether a note has ever been used, and that question is answered by this layer (see `memory-forget.mjs`); the
  // RECORDED step is still step 4, and its chain entry is still the job's derived record. Computing it early costs nothing and is pure.
  const usageLayer = usageCounts(planned)
  const usage = Object.freeze(Object.fromEntries(usageLayer.map(one => [one.id, one.seenAgain])))
  // `input.kept` IS §2.1's KEPT SET, REPLAYED FROM THE JOURNAL BY THE CALLER — the command reads the chain anyway and hands in `keptIds(...)`. It is OPTIONAL
  // so that a caller without a chain (the courts' fixtures) still gets the old own-field behaviour, and it is threaded to BOTH step 3 and the signed proposals
  // because a Kept signed note must not be proposed for expiry any more than a Kept remembered note may be expired.
  const kept = input?.kept instanceof Set ? input.kept : undefined
  // ALL FOUR CONSUMERS SEE THE SAME FILTERED SET — duplicates above, and expiry, usage (above), topics and the signed proposals here. A filter applied to one step and not
  // the others would leave §8.1's entries counted in the topics or proposed on the Signed track, which is the same defect wearing a different step's clothes.
  const expired = expiries(planned, policy, now, usage, kept)
  const topics = topicGroups(planned)
  const proposals = signedProposals(planned, policy, now, usage, kept)
  return Object.freeze({
    duplicates, expiries: expired, usage: usageLayer, topics, proposals,
    counts: Object.freeze({
      notes: notes.length,
      duplicates: duplicates.reduce((sum, one) => sum + one.merged.length, 0),
      expiries: expired.length,
      usage: usageLayer.filter(one => one.seenAgain > 0).length,
      topics: topics.length,
      proposals: proposals.length,
    }),
  })
}

/**
 * EVERY CHANGE AS ONE CHAIN ENTRY, which is what §5.1 and Fable's third court ask for: a merge is `supersede`, an expiry is
 * `expire`, and a topic is `add` (it adds a derived, authority-free note). The ops are the journal's own twelve, so an
 * unknown op is refused by the journal rather than invented here.
 *
 * *** STEP 4 IS NOT IN THIS FUNCTION, ON PURPOSE, AND THE REASON IS THE ONE THING STILL OWED. *** Whether the usage layer CHANGED is a
 * question about what is already stored, and this module is pure: it plans from the notes and the policy alone (`now` is a calendar day for
 * exactly that reason). So it computes the layer — `plan.usage`, from `usageCounts` — and the store-side write that compares it against the
 * stored counts, writes it as a derived authority-free record and journals the ONE `add` belongs to the job that holds the store
 * (`scripts/kira/housekeeping.mjs`). Until that lands, step 4 is COMPUTED and not yet APPLIED, and this comment is where a reader finds out.
 *
 * @param {ReturnType<typeof planHousekeeping>} plan
 * @returns {ReadonlyArray<{op: string, id: string, because: string}>}
 */
export function housekeepingChanges(plan) {
  const changes = []
  for (const group of plan.duplicates) {
    for (const merged of group.merged) {
      changes.push(Object.freeze({ op: 'supersede', id: merged, because: `exact duplicate of ${group.keep}` }))
    }
  }
  for (const one of plan.expiries) {
    changes.push(Object.freeze({ op: 'expire', id: one.id, because: `rule ${one.rule} expired it on ${one.expiresAt}` }))
  }
  for (const topic of plan.topics) {
    changes.push(Object.freeze({ op: 'add', id: topic.ids[0], because: `topic ${topic.name} groups ${String(topic.ids.length)} notes` }))
  }
  return Object.freeze(changes)
}
