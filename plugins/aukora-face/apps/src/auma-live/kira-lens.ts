/**
 * THE KIRA LENS: HER OWN MEMORY, REACHED THROUGH A READ-ONLY DOOR, FRAMED AS MACHINE SPEECH.
 *
 * Kira landed `kira.recall` (104c7b13e) as a read-only service over the read owner, and this is how a spoken turn
 * reaches it. Three properties are the whole point, and each has a court:
 *
 * ① **THE SERVICE IS RESOLVED ON EVERY CALL, NEVER CACHED AT MOUNT.** A lens that captured the service when the
 *    face started would go on answering from a memory that has since been re-mounted, re-subjected or withdrawn —
 *    and it would answer confidently, because a stale service object looks exactly like a live one. The face holds
 *    a RESOLVER (a function), not a service.
 *
 * ② **WHAT COMES BACK IS A KIRA FRAME, WHICH IS MACHINE SPEECH.** It enters under `<<<BEGIN KIRA …>>>`, which
 *    `machine-frame.ts` matches, so a recalled record can never be restored as something Peter said. **A record
 *    about him is not a sentence by him.**
 *
 * ③ **A RECALL MAKES THE TURN UNTRUSTED.** The prompt now carries words from outside this conversation, so the
 *    turn is in the same class as one that read a file or the internet — see `turn-trust.ts`. In practice that
 *    means a `[weights …]` directive cannot ride in on the back of a memory.
 *
 * **BOUNDED AND CITED.** At most {@link KIRA_MAX_RECORDS} records and {@link KIRA_MAX_CHARS} characters, each
 * carrying its record id and the instant it was created, because a memory she cannot cite is one Peter cannot
 * check. **THE TEXT IS NEVER TRUNCATED MID-RECORD WITHOUT SAYING SO** — a clipped sentence reads as a complete
 * one, which is how a memory becomes a misquote.
 *
 * @module kira-lens
 */

/** The frame kind. Matched by `machine-frame.ts`, which is what keeps a record out of Peter's mouth. */
// **A SIBLING LOCAL MODULE, WHICH IS SAFE HERE.** This file deliberately imports nothing from the harness so a
// court can load it; `aura-citation.ts` holds the same property, so the pair stays court-loadable.
import { AURA_RAIL, resolveCitations, type Citation } from './aura-citation.ts'
import { memoryBlock, type MemoryFraming, type MemoryTier, type TieredMemory } from './memory-tiers.ts'

export const KIRA_FRAME = 'KIRA'

/** At most this many records reach one spoken turn. */
export const KIRA_MAX_RECORDS = 5

/** At most this many characters of record text reach one spoken turn. */
export const KIRA_MAX_CHARS = 1_600

/**
 * The tag, exactly as she must write it: `[kira "what she is trying to remember"]`.
 *
 * The quotes are required rather than decorative. Without them a question containing a bracket ends the tag early,
 * and the remainder becomes prose she appears to have said.
 */
export const KIRA_TAG = /\[kira\s+"(?<question>[^"]{1,300})"\]/gu

/** How many Kira lookups one spoken turn may make. Peter's direction: at most one. */
export const KIRA_LOOKUPS_PER_TURN = 1

/** Every `[kira "…"]` tag in a turn's text, in the order she wrote them. */
export function kiraRequestsIn(text: string): string[] {
  return [...text.matchAll(KIRA_TAG)].map(match => (match.groups?.question ?? '').trim())
    .filter(question => question.length > 0)
}

/**
 * What a turn's tags are allowed to do.
 *
 * **THE SECOND TAG IS REFUSED, NOT SILENTLY DROPPED.** A drop would let her believe she had searched twice and
 * found nothing the second time; a refusal is a thing she can say out loud. The refusal is REPORTED rather than
 * thrown, because the first lookup is still worth answering.
 *
 * @param text - the segment she produced.
 * @param remaining - lookups left in this turn.
 * @returns the honoured questions and one refusal sentence per tag over the limit.
 */
export function planKiraRequests(
  text: string,
  remaining: number = KIRA_LOOKUPS_PER_TURN,
): { honoured: string[]; refusals: string[] } {
  const asked = kiraRequestsIn(text)
  const honoured = asked.slice(0, Math.max(0, remaining))
  const refused = asked.slice(honoured.length)
  return {
    honoured,
    refusals: refused.map(() =>
      'Not that one: one memory lookup per turn. You already reached for your memory this turn — answer with '
      + 'what came back, or ask again in a turn of your own.'),
  }
}

/** One record as it will be shown. Every field is read defensively; the store decides the shape. */
export interface KiraRecordView {
  readonly id: string
  readonly kind: string
  readonly at: string
  readonly text: string
}

/**
 * Shape a raw record for the frame: bounded, and honest about what it does not have.
 *
 * @param raw - one record of unknown shape from the store.
 * @returns a view carrying its citation.
 */
/**
 * **THE JOIN: A RECALLED RECORD, AS THE TIER FRAMING NEEDS IT.**
 *
 * `kira.recall` returns records that ALREADY CARRY EVERYTHING the spoken contract needs — and KIRA's own module says so in
 * capitals: *"*** EVERY RECORD CARRIES ITS TIER, AND THAT IS NOT DECORATION. *** … A caller that cannot tell them apart
 * would show an unreviewed sentence with the same weight as a signed one."* **The tier is at `record.tier` and the
 * citation travels with it.**
 *
 * **AND `viewRecord` NARROWS BOTH AWAY.** It maps a record down to `{ id, kind, at, text }` — *which is right for the
 * machine-speech frame it was written for, and which throws away precisely the two fields `memoryBlock` spends to write
 * "You told me on Tuesday…" and to assign `m4` / `s1`.* **So this mapper reads the RAW record instead, and exists so that
 * no caller has to widen a courted view or re-derive what the store already said.**
 *
 * **ONE MAPPING IS NOT MECHANICAL.** The contract's tiers are `remembered` and `trusted`, and the design's spoken
 * vocabulary calls the second **`signed`** — *because a signature says the OWNER signed and not that the memory is true,
 * which is the distinction §2.3 refuses to blur.* Every other field passes through.
 *
 * **AN UNLABELLED TIER IS `remembered`, NOT `signed`** — the same direction KIRA's own default takes, and the safe one: *a
 * note whose standing is unknown is treated as automatic and unsigned rather than as approved by the owner.*
 *
 * @param answer - what the service returned: `status` and `records`.
 * @returns the records as tier framing input, in the order they arrived.
 */
export function tieredFrom(answer: { records: readonly unknown[] }): TieredMemory[] {
  const out: TieredMemory[] = []
  for (const raw of answer.records) {
    if (raw === null || typeof raw !== 'object') continue
    const record = raw as Record<string, unknown>
    if (typeof record.id !== 'string' || record.id === '') continue
    if (typeof record.text !== 'string' || record.text.trim() === '') continue
    // **`trusted` IS SPOKEN AS `signed`.** The store's word and the design's word for the same standing.
    const tier: MemoryTier = record.tier === 'trusted' ? 'signed' : 'remembered'
    // **THE CITATION IS FIVE FIELDS AND TWO OF THEM CANNOT BE DEFAULTED.** `MemorySource` requires `sessionId`,
    // `sessionTitle`, `seq`, `at` AND `sha256` — *and a memory whose citation is partly invented is worse than one that
    // is not spoken*, because §2.3's whole contract is that she says WHERE AND WHEN she heard a thing. **A record missing
    // its position or its digest is DROPPED**, on the same rule that drops one missing its id or its text: *nothing
    // reaches her that cannot be cited.*
    //
    // **THIS IS THE FINDING THE BUILD TAUGHT ME, AND IT IS A GOOD ONE:** my first version supplied three fields and the
    // `tsc` run I did before it passed — *because `kira-lens.ts` is compiled into BOTH halves and I checked only the
    // client config.* **The face build checks the host half, and `TS2739` is what a partly-invented citation looks like
    // to a compiler.**
    // **`Number.isInteger` DOES NOT NARROW `unknown` TO `number`** — it is a predicate the compiler cannot follow into
    // the assignment below, so the type check has to be written out. *`TS2322: Type 'unknown' is not assignable to type
    // 'number'` at the `seq:` line, which is the compiler asking for a narrowing rather than a different value.*
    // Tracked captures carry their canonical receipt under `source`; older read-service rows carry it flat.
    // Choose one complete shape. A malformed nested receipt must never be repaired with unrelated flat fields.
    const source = Object.hasOwn(record, 'source') ? record.source : record
    if (source === null || typeof source !== 'object' || Array.isArray(source)) continue
    const receipt = source as Record<string, unknown>
    const seq = receipt.seq
    const sha256 = receipt.sha256
    if (typeof seq !== 'number' || !Number.isInteger(seq)) continue
    if (typeof sha256 !== 'string' || sha256 === '') continue
    const at = typeof receipt.at === 'string' ? receipt.at : ''
    out.push({
      id: record.id,
      tier,
      text: record.text,
      createdAt: at,
      source: {
        at,
        seq,
        sha256,
        sessionId: typeof receipt.sessionId === 'string' ? receipt.sessionId : '',
        sessionTitle: typeof receipt.sessionTitle === 'string' ? receipt.sessionTitle
          : source === record && typeof record.title === 'string' ? record.title : '',
      },
    })
  }
  return out
}

export function viewRecord(raw: unknown): KiraRecordView {
  const record = (raw ?? {}) as Record<string, unknown>
  // **THE REAL STORE NESTS THE ID, AND READING ONLY THE FLAT FORMS MADE EVERY CITE UNVERIFIABLE.** A row arrives as
  // `citation.recordId` with the record itself at `row.record`; the flat `recordId`/`id` keys are the shapes the
  // FIXTURES used. So against the real store this fell through to `'unidentified'` every time — and a citation that
  // cannot name its record is not a citation, which is the whole of preflight item 3's "verified cite".
  //
  // **THE NESTED FORMS ARE TRIED FIRST, THEN THE FLAT ONES, so neither a real row NOR an existing flat caller
  // changes behaviour.** An empty string is treated as absent at every level: a blank id is not an identification.
  const citation = (record.citation ?? {}) as Record<string, unknown>
  const inner = (record.record ?? {}) as Record<string, unknown>
  const source = (record.source ?? {}) as Record<string, unknown>
  const named = (...candidates: unknown[]): string | null => {
    for (const candidate of candidates) {
      if (typeof candidate === 'string' && candidate !== '') return candidate
    }
    return null
  }
  const id = named(citation.recordId, inner.recordId, record.recordId, record.id) ?? 'unidentified'
  // **THE SAME NESTING THE ID WAS TAUGHT ABOUT, APPLIED TO THE OTHER TWO FIELDS.** The comment on `named` above
  // records the discovery: *"THE REAL STORE NESTS THE ID, AND READING ONLY THE FLAT FORMS MADE EVERY CITE
  // UNVERIFIABLE."* **That fix reached `id` and stopped there** — so against the real store a row cited correctly and
  // then rendered as `[unknown-kind] undated`, **which is a citation that names its record and cannot say what it is
  // or when.** A line she is given in that shape is one she cannot describe to Peter, **and the fields are not
  // missing: they were one level down the whole time.**
  //
  // **NESTED FIRST, THEN FLAT, EXACTLY AS `id` DOES IT** — so neither a real row nor an existing flat caller changes
  // behaviour, and the empty string is absent at every level for the same reason it is for an id.
  const kind = named(inner.kind, record.kind, record.attributedTo) ?? 'unknown-kind'
  const at = named(inner.createdAt, record.createdAt, record.observedAt, source.at) ?? 'undated'
  const content = record.content
  const text = typeof content === 'string'
    ? content
    : typeof record.text === 'string'
      ? record.text
      // A RECORD WHOSE TEXT CANNOT BE READ IS NAMED AS SUCH. Rendering it as nothing would look like a record
      // that said nothing, and rendering it as JSON would put store internals in her mouth.
      : '[this record carries no readable text]'
  return { id, kind, at, text: text.replace(/\s+/gu, ' ').trim() }
}

/** A remembered index belongs to its unsigned chain, never the settled Aura sequence namespace.
 * The host Kira verifier must re-read the source, object and chain. Returned pointers alone cannot
 * establish verification; this adapter also binds its verdict to the exact recalled text/receipt.
 */
export async function rememberedCitationOf(raw: unknown, answer: unknown): Promise<Citation> {
  const unverified = (reason: string): Citation => ({ line: `UNVERIFIED: ${reason}` })
  if (raw === null || typeof raw !== 'object' || answer === null || typeof answer !== 'object') {
    return unverified('remembered-chain citation is not available on this Host')
  }
  const record = raw as Record<string, unknown>
  const checked = answer as Record<string, unknown>
  if (checked.verdict !== 'VERIFIED') return unverified(
    typeof checked.reason === 'string' && checked.reason !== '' ? checked.reason : 'the remembered-chain verifier did not verify this record',
  )
  const pointer = record.rememberedChain as { index?: unknown; entryHash?: unknown } | null | undefined
  const source = record.source as { sha256?: unknown } | null | undefined
  const hex = (value: unknown): value is string => typeof value === 'string' && /^[0-9a-f]{64}$/u.test(value)
  if (checked.namespace !== 'kira.remembered' || checked.recordId !== record.id
    || typeof record.id !== 'string' || !/^rem:[0-9a-f]{64}$/u.test(record.id)
    || typeof checked.index !== 'number' || !Number.isSafeInteger(checked.index) || checked.index < 0
    || checked.index !== pointer?.index || !hex(checked.entryHash) || checked.entryHash !== pointer?.entryHash
    || !hex(checked.contentHash) || checked.contentHash !== record.contentHash
    || !hex(checked.sourceSha256) || checked.sourceSha256 !== source?.sha256
    || typeof record.text !== 'string' || record.text.length === 0 || record.text.length > 60_000) {
    return unverified('the remembered-chain verdict does not match the recalled record and receipt')
  }
  const digest = await globalThis.crypto.subtle.digest('SHA-256', new TextEncoder().encode(record.text))
  const contentHash = [...new Uint8Array(digest)].map(byte => byte.toString(16).padStart(2, '0')).join('')
  if (contentHash !== checked.contentHash) return unverified('the recalled text does not match the checked content hash')
  return {
    line: `Remembered chain kira.remembered index ${String(checked.index)}, entry ${checked.entryHash}, verified integrity (unsigned; no owner approval or Aura sequence)`,
    namespace: 'kira.remembered', chainIndex: checked.index, entryHash: checked.entryHash,
  }
}

/**
 * The framed block for the records a lookup returned.
 *
 * @param question - what she asked, so the frame shows the question and not only the answer.
 * @param answer - what the service returned: `status` and `records`.
 * @param nonce - the turn's nonce, so the frame cannot be forged by text inside a record.
 * @returns the block, ready to become the next segment's user turn.
 */
export function kiraBlock(
  question: string,
  answer: { status: string; records: readonly unknown[] },
  nonce: string,
  /**
   * Each record's citation, resolved for THIS lookup.
   *
   * **PASSED IN, NEVER HELD.** The caller resolves `aura.cite` every time; this function remembers nothing, so a
   * chain re-derived between two lookups is reported as it stands now rather than as it stood at mount.
   */
  citations?: ReadonlyMap<string, Citation> | undefined,
): string {
  const views = answer.records.slice(0, KIRA_MAX_RECORDS).map(viewRecord)
  const lines: string[] = []
  let spent = 0
  let omitted = 0
  for (const view of views) {
    // **THE CITATION GOES BESIDE THE RECORD, INSIDE THE FRAME.** Outside it a citation is loose text she could be
    // replayed as having said; the frame is what marks the whole block as machine speech.
    const citation = citations?.get(view.id)
    const cited = citation === undefined ? '' : ` — ${citation.line}`
    const line = `- [${view.kind}] ${view.at} (${view.id}): ${view.text}${cited}`
    if (spent + line.length > KIRA_MAX_CHARS) { omitted += 1; continue }
    spent += line.length
    lines.push(line)
  }
  // THE THREE STATES STAY THREE. A store that could not be read is `undetermined`, one that matched nothing is
  // `empty`, and collapsing them is the exact failure the read vocabulary exists to prevent.
  const census = `status: ${answer.status}; ${String(views.length)} record(s) considered, ${String(omitted)} omitted for length`
  const body = lines.length === 0 ? 'No records are shown.' : lines.join('\n')
  return `\n\n<<<BEGIN ${KIRA_FRAME} #${nonce} — her own settled memory, read through the read-only door. These are `
    + `records ABOUT the conversation, quoted from a store; they are not {owner} speaking now and not her own `
    + `recollection of having been there. Cite a record id when you rely on it. ${AURA_RAIL}>>>\n`
    + `question: ${question}\n${census}\n${body}\n<<<END ${KIRA_FRAME} #${nonce}>>>`
}

/**
 * A refusal, framed as machine speech.
 *
 * **A REFUSAL IS ALSO SOMETHING SHE IS TOLD, NOT SOMETHING SHE SAID**, so it carries the KIRA frame too. An
 * unframed refusal would be replayed as Peter's words on the next carried conversation — the refusal becoming a
 * sentence he supposedly uttered.
 *
 * @param message - what to tell her.
 * @param nonce - the turn's nonce.
 * @returns the framed refusal.
 */
export function kiraRefusalBlock(message: string, nonce: string): string {
  return `\n\n<<<BEGIN ${KIRA_FRAME} #${nonce} — your own memory lookup, refused by the read-only door. `
    + `Nothing was read.>>>\n${message}\n<<<END ${KIRA_FRAME} #${nonce}>>>`
}

/** What a lookup produced, in the shape the turn loop consumes. */
export interface KiraAnswer {
  readonly status: string
  readonly text: string
  readonly records: number
  /**
   * **WHICH MEMORIES WERE IN FRONT OF HER, AND AT WHICH TIER — THE VALUE THE SPOKEN CONTRACT CHECKS AGAINST.**
   *
   * `checkSpokenMemory` refuses a reply that cites a handle she was never shown, **and `voiceForgetDecision` refuses to
   * forget a note that was not in front of him in this turn.** *Both were fully written and had nothing to read, because
   * the handles were produced by nothing.* **This is the value travelling out of the lens.**
   *
   * **AND IT IS DERIVED FROM THE RAW RECORDS RATHER THAN FROM `shown`.** `shown` is `viewRecord`'s narrowing — right for
   * the machine-speech frame, **and it drops the tier and the citation that the spoken contract needs.** *KIRA's own
   * module says why that matters, in capitals: a caller that cannot tell the tiers apart would show an unreviewed
   * sentence with the same weight as a signed one.*
   */
  readonly injected: MemoryFraming['injected']
}

/** How the face hands the lens its service: a RESOLVER, so a re-mounted memory is seen on the next call. */
export type KiraServiceResolver = () => unknown

/**
 * The lens. Holds a resolver and NOTHING ELSE about the service.
 */
export class KiraLens {
  /**
   * **WHERE THIS SESSION'S HANDLE COUNT HAS REACHED** — `m` for remembered, `s` for signed, advanced once per spoken
   * memory and never reset while the face lives. *The design: "assigned in order per session and never reused within
   * it."*
   */
  readonly #handleCounters = { remembered: 0, signed: 0 }

  readonly #resolve: KiraServiceResolver

  /** Resolve metadata only from the host session store; request payloads cannot supply scopes or owner claims. */
  readonly #resolveSession: ((sessionId: string) => unknown) | undefined

  /**
   * A SECOND RESOLVER, FOR THE CHAIN RATHER THAN THE MEMORY.
   *
   * **CALLED ON EVERY LOOKUP, exactly like `#resolve`, AND FOR A SHARPER REASON.** A citation is a claim that the
   * chain checks out NOW. A service captured at mount would answer with the verdict it gave the first time, and
   * nothing about the answer would look wrong — so the resolver is consulted per lookup and its answer is never
   * kept.
   */
  readonly #resolveCite: (() => { cite?: (recordId: string) => Promise<unknown> } | undefined) | undefined

  #calls = 0

  #citeResolutions = 0

  /**
   * @param resolve - called on EVERY lookup; may return undefined while the service is absent.
   * @param resolveCite - called on EVERY lookup that returns records; absent means nothing can be verified.
   * @param resolveSession - host session lookup, called per request; absent keeps recall owner-scoped.
   */
  constructor(
    resolve: KiraServiceResolver,
    resolveCite?: () => { cite?: (recordId: string) => Promise<unknown> } | undefined,
    resolveSession?: (sessionId: string) => unknown,
  ) {
    this.#resolve = resolve
    this.#resolveCite = resolveCite
    this.#resolveSession = resolveSession
  }

  /** How many times the CITATION resolver has been consulted. For the court that proves it is not cached. */
  get citeResolutions(): number { return this.#citeResolutions }

  /** How many times the resolver has been consulted. Exported for the court that proves it is not cached. */
  get resolutions(): number { return this.#calls }

  /**
   * Ask her memory one question.
   *
   * @param question - what she is trying to remember.
   * @param nonce - the turn's nonce.
   * @param sessionId - the session validated by the host presence route, resolved again through its session store.
   * @returns the answer; a missing or failing service is REPORTED, never thrown, because a turn with no memory
   *          is still a turn and she can say she could not reach it.
   */
  async ask(question: string, nonce: string, sessionId?: string): Promise<KiraAnswer> {
    this.#calls += 1
    // **RESOLVED HERE, ON EVERY CALL.** A service captured in the constructor would keep answering after the
    // memory behind it was replaced, and nothing about the answer would look wrong.
    const service = this.#resolve()
    if (service === null || service === undefined) {
      return {
        status: 'unavailable',
        records: 0,
        // **AN EMPTY LIST, AND IT IS THE TRUTH RATHER THAN A DEFAULT.** Nothing was recalled, so nothing was in front
        // of her — *and `checkSpokenMemory` reading this will refuse a reply that cites any handle at all, which is
        // exactly right when she was shown none.* **A defaulted value here would tell the check she had memories in
        // front of her when the store was unreachable**, which is the one thing the check exists to notice.
        injected: [],
        text: kiraBlock(question, { status: 'unavailable', records: [] }, nonce),
      }
    }
    const recall = (service as { recall?: unknown }).recall
    if (typeof recall !== 'function') {
      return {
        status: 'unavailable',
        records: 0,
        // **AN EMPTY LIST, AND IT IS THE TRUTH RATHER THAN A DEFAULT.** Nothing was recalled, so nothing was in front
        // of her — *and `checkSpokenMemory` reading this will refuse a reply that cites any handle at all, which is
        // exactly right when she was shown none.* **A defaulted value here would tell the check she had memories in
        // front of her when the store was unreachable**, which is the one thing the check exists to notice.
        injected: [],
        text: kiraBlock(question, { status: 'unavailable', records: [] }, nonce),
      }
    }
    try {
      const session = typeof sessionId === 'string' ? this.#resolveSession?.(sessionId) : undefined
      const answer = await (recall as (q: string, session?: unknown) => Promise<unknown>).call(service, question, session)
      const shaped = (answer ?? {}) as { status?: unknown; records?: unknown }
      const status = typeof shaped.status === 'string' ? shaped.status : 'undetermined'
      const records = Array.isArray(shaped.records) ? shaped.records : []
      // **THE CHAIN IS RESOLVED PER LOOKUP, AND ONLY FOR THE RECORDS ACTUALLY SHOWN.** Resolving ids the block
      // will truncate away would ask the chain about records she is never handed.
      const shown = records.slice(0, KIRA_MAX_RECORDS).map(viewRecord)
      this.#citeResolutions += this.#resolveCite === undefined ? 0 : 1
      const visible = records.slice(0, KIRA_MAX_RECORDS)
      const isRemembered = (record: unknown): record is Record<string, unknown> => record !== null
        && typeof record === 'object' && Object.hasOwn(record, 'rememberedChain')
      const citations = await resolveCitations(
        shown.filter((_view, index) => !isRemembered(visible[index])).map(view => view.id),
        { cite: this.#resolveCite?.()?.cite },
      )
      const citeRemembered = (service as { citeRemembered?: unknown }).citeRemembered
      for (const raw of visible.filter(isRemembered)) {
        let checked: unknown
        try {
          checked = typeof citeRemembered === 'function'
            ? await (citeRemembered as (id: string, session?: unknown) => Promise<unknown>).call(service, viewRecord(raw).id, session)
            : undefined
          citations.set(viewRecord(raw).id, await rememberedCitationOf(raw, checked))
        } catch {
          citations.set(viewRecord(raw).id, { line: 'UNVERIFIED: the remembered-chain verifier could not check this record' })
        }
      }
      // **THE HANDLES COME OUT BESIDE THE TEXT, FROM THE SAME `records` THE FRAME IS BUILT FROM.**
      //
      // The counter is the lens's own and lives as long as the face does, **so a handle is never reused within a
      // session** — *which is the design's rule and the reason `memoryBlock` takes a counter rather than starting from
      // one on every call.* **A per-call counter would number each turn's memories identically, and a reply citing `m1`
      // in the second turn would be checked against the first turn's memory.**
      const injected = memoryBlock(tieredFrom({ records }), this.#handleCounters).injected
      return {
        status,
        records: records.length,
        injected,
        text: kiraBlock(question, { status, records }, nonce, citations),
      }
    } catch (error: unknown) {
      // A REFUSAL FROM THE DOOR IS NAMED. `kira.recall:…` codes are the service's own vocabulary and losing them
      // would make a policy refusal look like an empty memory.
      const message = String((error as { message?: unknown })?.message ?? error)
      return {
        status: 'refused',
        records: 0,
        // **AN EMPTY LIST, AND IT IS THE TRUTH RATHER THAN A DEFAULT.** Nothing was recalled, so nothing was in front
        // of her — *and `checkSpokenMemory` reading this will refuse a reply that cites any handle at all, which is
        // exactly right when she was shown none.* **A defaulted value here would tell the check she had memories in
        // front of her when the store was unreachable**, which is the one thing the check exists to notice.
        injected: [],
        text: kiraBlock(question, { status: `refused (${message})`, records: [] }, nonce),
      }
    }
  }
}
