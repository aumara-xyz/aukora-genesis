/**
 * THE MEMORY APP'S VIEW MODEL — one list Peter can read, with receipts he can check.
 *
 * PETER'S WORDS: *"a memory app on the right, and you click it, and then it shows memories in the middle that are
 * approved or unapproved"*. THE CONTRACT: `.agents/live/MEMORY-CONTRACT-v0.md` — memories are TRACKED, NOT APPROVED;
 * capture is automatic and usable at once; a human click happens only for self-modification and for marking a memory
 * trusted. The record this renders is the contract's:
 *
 *   {id, tier, kind (fact|preference|decision|commitment|person|project|observation), text, createdAt,
 *    source:{sessionId, sessionTitle, seq, at, sha256}, aura:{index, entryHash},
 *    trusted?:{signer, at, approvalDigest}, forgotten?:{at, reason, tombstoneHash}}
 *
 * **THE TAB IS CALLED SIGNED.** Contract v0 (14:37) calls this tier `trusted`; the design that landed at 14:52
 * renames it, because "a signature today proves only that some same-user process had the key" — so the label Peter
 * reads says **Signed** and the tier key stays `trusted` as the routes and records spell it. Both facts matter: the
 * screen must not claim an authority the system cannot back, and the wire format must not drift to match a rename.
 *
 * **NO JARGON ON THE SCREEN** (the goal's words). Every kind, tier and state below carries a plain sentence for Peter
 * and the technical name only where a developer needs it. A receipt badge is the clearest case: `VERIFIED`,
 * `CHANGED` and `MISSING` are the route's vocabulary, and the screen says "matches the original", "changed since it
 * was recorded" and "the original is gone" instead.
 *
 * PURE, SO THE CLAIMS ARE MEASURED. Nothing here fetches, writes or reads a clock: the source's answer arrives as
 * data, `now` is passed in, and every rule the goal names — the tiers, the exact ids a Sign sends, the confirm
 * Forget needs, and the badge that must never be green without a verify response — is checked by a court.
 *
 * @module memory-model
 */

/** The contract's closed kind list, in the order the filter offers them. */
export const KINDS = ['fact', 'preference', 'decision', 'commitment', 'person', 'project', 'observation'] as const
export type Kind = (typeof KINDS)[number]

/**
 * THE OWNER'S SPOKEN CONTROLS, AS STATE (§6.1).
 *
 * Three of the design's controls are STANDING STATES rather than one-off actions — Pause ("stop remembering"), Off the
 * record, and Someone's here — and the goal for this round asks for them to be "visible in the app as current state".
 * **THE IDS ARE AUMA'S**, because AUMA is the lane that matches the phrases: `plugins/aukora-face/apps/src/auma-live/
 * memory-control.ts` returns exactly `stop-remembering`, `off-record` and `someone-here`, and a screen that invented
 * its own vocabulary would be showing state for controls nobody can trigger. (KIRA's policy object spells the middle
 * one `off-the-record`; that divergence is reported rather than smoothed over here.) The words a person reads come from
 * the dictionaries, like every other sentence on this screen.
 */
export const MEMORY_CONTROLS = ['stop-remembering', 'off-record', 'someone-here'] as const
export type MemoryControl = (typeof MEMORY_CONTROLS)[number]

/** What is known about a control. `unknown` is a state, not a failure: nobody has told this app yet. */
export type ControlState = 'on' | 'off' | 'unknown'

/**
 * The state to show for a control.
 *
 * **`unknown` IS THE HONEST ANSWER TODAY AND WILL STAY A VALID ONE.** No route reports these states — KIRA's four are
 * list, verify, forget and trust — so the app must not render "Memory is on" as a default, which would be a claim
 * about his own settings that nothing supports. When a status source lands, this becomes the one place it is read.
 */
export function controlStateOf(known: boolean | null | undefined): ControlState {
  return known === true ? 'on' : known === false ? 'off' : 'unknown'
}

/** The contract's four tiers: what she remembers, what he signed, what dreaming suggests, what was forgotten. */
/**
 * The four tiers, **in KIRA's own names**.
 *
 * The middle one is `signed`, not `trusted`: `plugins/aukora-kira/lib/memory-tiers.mjs:35` declares
 * `MEMORY_TIERS = ['remembered', 'signed', 'proposal', 'forgotten']` and line 38 keeps the retirement in writing —
 * `RENAMED_TIER = { trusted: 'signed' }`. KIRA refuses the old name, so this face must not use it either.
 *
 * **WHY THESE ARE DECLARED HERE RATHER THAN IMPORTED FROM THAT FILE**: `memory-tiers.mjs` imports `node:crypto`, and
 * this module is bundled for the browser — an import would pull Node's crypto into the client bundle. The names are
 * therefore declared here and **held equal to KIRA's by a court**, which is the same arrangement the routes use and
 * the only one that survives a browser build.
 */
export const TIERS = ['remembered', 'signed', 'proposal', 'forgotten'] as const
export type Tier = (typeof TIERS)[number]

/**
 * What the tab says. `trusted` reads **Signed** — see the module note — and every tier is a sentence rather than a
 * state machine's name.
 */
export const TIER_TABS: readonly { readonly tier: Tier; readonly label: string; readonly blurb: string }[] = Object.freeze([
  { tier: 'remembered', label: 'Remembered', blurb: 'Auma picked these up as you talked. They are hers to use, and they carry no authority.' },
  { tier: 'signed', label: 'Signed', blurb: 'These are the ones you signed yourself. Only these can act as a rule.' },
  { tier: 'proposal', label: 'Proposals', blurb: 'Things Auma thinks are worth making into rules. Nothing here is in effect.' },
  { tier: 'forgotten', label: 'Forgotten', blurb: 'Erased. What remains is the record that you erased it.' },
])


/**
 * The badge for a receipt.
 *
 * **A GREEN TICK NEEDS A VERIFY RESPONSE.** This is the rule the goal names, and it is why the input is the route's
 * `VERIFIED`/`CHANGED`/`MISSING` string and nothing else: a record whose `source.sha256` merely EXISTS has not been
 * checked against anything, and rendering that as verified would tell Peter the original was re-read when nobody
 * re-read it. An unknown answer is `unchecked` rather than a tick, because a badge nobody filled must not look like
 * one that passed.
 */
/**
 * **THE RECEIPT BADGE, WHICH WAS USED AT THREE SITES BEFORE IT WAS EVER WRITTEN.**
 *
 * `receiptBadgeOf` returned it, `MemoryRow.receipt` held one and `MemoryView.receipts` mapped them — **and no
 * declaration existed anywhere in this package, so all three were `TS2304: Cannot find name 'ReceiptBadge'`.**
 *
 * **THE SHAPE IS DERIVED FROM THE FUNCTION'S OWN SIX RETURNS, NOT INVENTED:** every branch returns `state`, `glyph`
 * and `label`, and the `state` values are the six literals below. **Writing it from the returns rather than from a
 * guess is the difference between completing a contract and inventing one** — the same distinction as
 * `rowsOfAnswer` in `layout`, where the missing name could NOT be recovered this way and had to be left for its owner.
 *
 * **NOTE THE WORD "verified" IS A UI LABEL, NOT HER SPEECH.** `memory-design §2.3` forbids her saying *"verified"* or
 * *"confirmed"* about a memory — **this badge reports what the RECEIPT CHECK found about bytes, which is a different
 * claim than a memory being true**, and §7.2 asks for exactly this row. The distinction is the same one
 * `memory-tiers.ts` draws: a signature says the owner signed, not that the thing is so.
 */
export interface ReceiptBadge {
  /**
   * What the check found. **EIGHT ANSWERS NOW, AND THE TWO ADDED ONES ARE NOT VARIANTS OF THE OLD SIX.**
   *
   * `unlinked` is a state the RECORD DECLARES (contract §4): the 139 records migrated out of the queue cannot be
   * linked, their source is CITED, and they *"can NEVER answer VERIFIED"*. Before this they fell to the `default`
   * and were shown as *"not checked yet"* — which says a person has not looked, when the truth is that nobody can.
   *
   * `malformed` is a receipt that was **SUPPLIED AND CANNOT BE READ**. `aukora-fail-open-pin` states the rule this
   * exists for: *"absent is a ceiling; present-and-unusable is a fault."* A caller who sends an unrecognised receipt
   * state must not receive the same badge as a caller who sent none — and the contract is sharper still, because a
   * record that *"merely lacks a digest without declaring this state is still a forgery"*.
   */
  readonly state: 'verified' | 'changed' | 'missing' | 'erased' | 'unverifiable' | 'unchecked' | 'unlinked' | 'malformed'
  /** The mark shown beside the row. */
  readonly glyph: string
  /** What the mark means, in the owner's language rather than a status code. */
  readonly label: string
}

export function receiptBadgeOf(answer: unknown): ReceiptBadge {
  const supplied = answer !== null && typeof answer === 'object' && 'source' in answer
  const source = supplied ? (answer as { source?: unknown }).source : undefined
  // ── THE DECLARED UNLINKED STATE, CHECKED BEFORE THE SWITCH BECAUSE IT IS NOT A STRING ────────────────────────
  // Contract §4: "`source` carries `state:'UNLINKED'`, `cited: true|false`, `because:'…'`" — an OBJECT. It is a
  // declared state and not a missing field, so it gets its own badge rather than the default's "not checked yet".
  if (source !== null && typeof source === 'object'
    && (source as { state?: unknown }).state === 'UNLINKED') {
    return { state: 'unlinked', glyph: '·', label: 'the original cannot be checked: the session is not in this store' }
  }
  // ── AND A SUPPLIED RECEIPT THAT IS NOT A SHAPE THIS KNOWS IS A FAULT, NOT AN ABSENCE ─────────────────────────
  // Reached only when `source` was PRESENT and is neither a recognised state nor the declared UNLINKED object.
  // `undefined` (no `source` key at all) and a `null` source fall through to `unchecked`, which is the honest badge
  // for a record nobody has checked yet.
  if (supplied && source !== undefined && source !== null && typeof source !== 'string') {
    return { state: 'malformed', glyph: '?', label: 'this receipt is not in a shape that can be read' }
  }
  switch (source) {
    case 'VERIFIED': return { state: 'verified', glyph: '✓', label: 'matches the original' }
    case 'CHANGED': return { state: 'changed', glyph: '!', label: 'changed since it was recorded' }
    case 'MISSING': return { state: 'missing', glyph: '?', label: 'the original is gone' }
    // AN ERASED NOTE HAS NOTHING TO CHECK, which is not the same as unchecked: there is no original to compare
    // against any more, and "not checked yet" would suggest somebody still could.
    case 'ERASED': return { state: 'erased', glyph: '·', label: 'erased' }
    // **A CHECK THAT COULD NOT RUN IS NOT A CHECK THAT PASSED.** `memory-deps.mjs` answers UNVERIFIABLE with the
    // refusal that caused it — an unreachable source, a store that will not open — and the honest badge for that is
    // neither green nor "changed": nothing was compared, so nothing is known.
    case 'UNVERIFIABLE': return { state: 'unverifiable', glyph: '?', label: 'could not check' }
    // A STRING THAT IS NOT ONE OF THE SIX IS STILL A SUPPLIED VALUE: it is a fault rather than an absence, for the
    // same reason as the object case above, and it must not borrow the badge of a record nobody has looked at.
    default: return typeof source === 'string'
      ? { state: 'malformed', glyph: '?', label: 'this receipt names a state that cannot be read' }
      : { state: 'unchecked', glyph: '–', label: 'not checked yet' }
  }
}

/**
 * THE IDS A REPLY CITED, READ OUT OF THE MANIFEST THE `why` ROUTE SERVES — AND `null` IS NOT `[]`.
 *
 * The manifest is what AUMA's log carries for one reply: `{replyId, groups: [{block, items: [{id, …}]}]}`. The ids a
 * person would want the Memory app filtered to are the **item ids across every group**, and nothing else on the
 * manifest is a memory id — `sha256` is the evidence a rebuild is checked against and the manifest's own doc says it
 * is *"Never rendered"*, so it is not read here either.
 *
 * **THE TWO EMPTY ANSWERS MEAN DIFFERENT THINGS, WHICH IS WHY THIS IS NULLABLE**:
 *   · **`null` — there is no manifest to read.** The route answered `manifest: null` (no store, or no manifest for
 *     that reply). Nothing was cited, so **no id filter is in force** and the app opens as it always does.
 *   · **`[]` — a manifest EXISTS and cites no records.** A reply that used no memory is a real reply, and the honest
 *     screen for it is **no records**, not the whole list. Returning `null` here would show every memory she has
 *     under a link that claims to show what one reply used.
 *
 * A malformed answer is `null` as well rather than a throw: this runs during a render, and a link that cannot read
 * its manifest must not take the whole app down. The distinction it loses is recorded by the caller, which knows
 * whether it asked at all.
 *
 * @param answer - the route's decoded JSON, or anything at all.
 * @returns the cited ids, `[]` for a manifest that cites none, or `null` when there is no manifest to read.
 */
export function citedIdsOf(answer: unknown): readonly string[] | null {
  if (answer === null || typeof answer !== 'object') return null
  const manifest = (answer as { manifest?: unknown }).manifest
  if (manifest === null || typeof manifest !== 'object') return null
  const groups = (manifest as { groups?: unknown }).groups
  if (!Array.isArray(groups)) return []
  const ids: string[] = []
  for (const group of groups) {
    if (group === null || typeof group !== 'object') continue
    const items = (group as { items?: unknown }).items
    if (!Array.isArray(items)) continue
    for (const item of items) {
      if (item === null || typeof item !== 'object') continue
      const id = (item as { id?: unknown }).id
      if (typeof id === 'string' && id !== '' && !ids.includes(id)) ids.push(id)
    }
  }
  return ids
}

/** How a note got here, as the design's signer sheet names it (§7.3). */
export const PROVENANCE_KINDS = ['you-said', 'heard', 'edited', 'dream', 'backfill'] as const
export type ProvenanceKind = (typeof PROVENANCE_KINDS)[number]

/** One row as the list renders it. */
export interface MemoryItem {
  readonly id: string
  readonly tier: Tier
  readonly backend: 'kira' | 'openviking'
  readonly author: 'Peter' | 'agent' | null
  readonly dateKind: 'created' | 'modified'
  readonly kind: Kind
  /** The words Peter reads. */
  readonly text: string
  /** When it was recorded, in a form the list can show; null when the record carried no readable time. */
  readonly createdAt: number | null
  /**
   * Where it came from: the conversation's title and when that happened (the contract's `source`).
   *
   * `titleKnown` SEPARATES "A CONVERSATION WITH NO NAME" FROM "A NAME I DID NOT GET", because the screen has to say
   * the second one in the reader's own language and this module only speaks English.
   */
  readonly source: {
    readonly sessionTitle: string
    readonly titleKnown: boolean
    readonly at: number | null
    /** The conversation this came from, so a row can open it. Null when the record did not carry one. */
    readonly sessionId: string | null
  }
  /** The receipt this row carries, before and after a check. */
  readonly receipt: ReceiptBadge
  /** Where the words came from, and his own words when the record kept them (the design's §7.2 row). */
  readonly provenance: { readonly kind: ProvenanceKind; readonly quote: string | null }
  /**
   * A rule proposal that is stored as a note MARKED "not in effect" until signing needs him in person (§2.4).
   * It is visible and it does nothing, and the screen has to say so rather than let a person believe it is live.
   */
  readonly notInEffect: boolean
  /** True when the record could not be read: it is LISTED, never dropped. */
  readonly unreadable: boolean
  /**
   * True when this row is a TOMBSTONE: he forgot it, and `text` is EMPTY because the words are gone.
   *
   * **THE WORDS DO NOT TRAVEL INTO THE ITEM**, which is stronger than not rendering them: the contract's forget is
   * "a tombstone plus exclusion from recall and every future burn", and a discarded value cannot be leaked by a later
   * rendering mistake. What remains is when he forgot it and why.
   */
  readonly erased: boolean
  /** When he signed it, if he did. */
  readonly signedAt: number | null
  /** When he forgot it, and why — the only two facts a tombstone keeps. */
  readonly forgottenAt: number | null
  readonly forgottenReason: string | null
}

/** The list's controls, as one piece of state. */
/**
 * Whether the answer says there are more notes than this page.
 *
 * **THE TRAP THIS EXISTS FOR**: the wire sends `next: null` when the page is the last one, but the STUB's answer omits
 * the field entirely — so `answer.next !== null` is TRUE for `undefined` and the fixture would claim there are more
 * memories behind it. KIRA's route sends a string or `null` and nothing else, so a cursor that is a non-empty string is
 * the only thing that means "more", and everything else means "this is all of it".
 */
export function hasMoreOf(answer: { readonly next?: string | null } | null | undefined): boolean {
  return typeof answer?.next === 'string' && answer.next !== ''
}

export interface MemoryView {
  readonly tier: Tier
  readonly query: string
  readonly kind: Kind | 'all'
  /** The ids he has ticked, in the order he ticked them — the order the manifest carries. */
  readonly selected: readonly string[]
  /** Which row is waiting for a confirm, if any. Forget never runs without one. */
  readonly confirmingForget: string | null
  /** The receipts the Verify button has filled, by id. */
  readonly receipts: Readonly<Record<string, ReceiptBadge>>
  /**
   * THE IDS A REPLY CITED, WHEN THE PERSON ARRIVED FROM A `why?` LINK — AND `null` IS NOT `[]`.
   *
   * `null` means NO id filter is in force, which is how the app opens normally. `[]` means **a reply that cited
   * nothing**, which must show nothing — and that is the whole reason this field is nullable rather than defaulting
   * to an empty array. A text query can express neither: a query that matched the right rows today would match a
   * twelfth row tomorrow, and *"exactly the records that reply cited"* is a claim about a set, not about words.
   */
  readonly citedIds: readonly string[] | null
}

/** The view a person starts with: what she remembers, nothing ticked, nothing being confirmed. */
export const INITIAL_VIEW: MemoryView = Object.freeze({
  tier: 'remembered', query: '', kind: 'all', selected: [], confirmingForget: null, receipts: {}, citedIds: null,
})

function textOf(value: unknown): string | null {
  return typeof value === 'string' && value.trim() !== '' ? value.trim() : null
}

function timeOf(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

/** One record as a row, or null when it has no identity at all (a row with no id cannot be acted on). */
export function itemOf(record: unknown, receipts: Readonly<Record<string, ReceiptBadge>> = {}): MemoryItem | null {
  if (record === null || typeof record !== 'object') return null
  const raw = record as Record<string, unknown>
  const id = textOf(raw.id)
  if (id === null) return null
  const tier: Tier = TIERS.includes(raw.tier as Tier) ? raw.tier as Tier : 'remembered'
  const kind: Kind = KINDS.includes(raw.kind as Kind) ? raw.kind as Kind : 'observation'
  const erased = tier === 'forgotten'
  const text = erased ? null : textOf(raw.text)
  const source = (raw.source ?? {}) as Record<string, unknown>
  const trusted = (raw.trusted ?? null) as Record<string, unknown> | null
  const forgotten = (raw.forgotten ?? null) as Record<string, unknown> | null
  return {
    id,
    tier,
    backend: raw.backend === 'openviking' ? 'openviking' : 'kira',
    author: raw.author === 'Peter' || raw.author === 'agent' ? raw.author : null,
    dateKind: raw.dateKind === 'modified' ? 'modified' : 'created',
    kind,
    // AN ERASED ROW CARRIES NO WORDS; an unreadable one carries a sentence saying so.
    text: erased ? '' : text ?? '(this one could not be read)',
    createdAt: timeOf(raw.createdAt),
    source: {
      sessionTitle: textOf(source.sessionTitle) ?? 'an unnamed conversation',
      titleKnown: textOf(source.sessionTitle) !== null,
      at: timeOf(source.at),
      sessionId: textOf(source.sessionId),
    },
    // THE BADGE COMES FROM A VERIFY ANSWER AND NOWHERE ELSE: a record with a receipt field but no check is unchecked.
    receipt: erased ? receiptBadgeOf({ source: 'ERASED' }) : receipts[id] ?? receiptBadgeOf(null),
    provenance: {
      // A RECORD THAT CANNOT BE READ CLAIMS NO PROVENANCE, even when it carries a `source`: the claim would be about
      // a note nobody could read.
      kind: text === null ? 'you-said' : (PROVENANCE_KINDS.includes(source.kind as ProvenanceKind) ? source.kind as ProvenanceKind : source.dream === true ? 'dream' : 'you-said'),
      // **A RECORD THAT CANNOT BE READ CLAIMS NO QUOTE.** This copied whatever `source.quote` held even when no text
      // could be read, so the row carried his words for a note nobody could read — the model's own comment promised
      // the opposite, and the court this round repointed to the field caught it.
      quote: text === null ? null : textOf(source.quote),
    },
    // ── WHICH NOTES ARE RULES THAT ARE NOT IN EFFECT YET ─────────────────────────────────────────────────────
    // **THIS READ `raw.kind === 'instruction' || raw.kind === 'action-preference'` — NEITHER OF WHICH IS A KIND THE
    // CONTRACT DEFINES** (its closed list is fact|preference|decision|commitment|person|project|observation), so on a
    // real record the marker could only ever fire through a field the record shape does not carry: Fable's rule that
    // "until signing requires the owner in person, a rule is stored as a note marked 'not in effect'" was unreachable,
    // while this app's own Proposals tab promised "Nothing here is in effect". **A PROPOSAL IS THE RULE PROPOSAL** —
    // the contract's tier for "from dreaming", which the design says is what Auma suggests making into rules — so it
    // is the tier that is not in effect, `trusted` is in effect because he signed it, and a remembered note is not a
    // rule at all (it carries no authority, which is a different fact). An explicit engine flag still wins, so the
    // day the store marks one directly this follows rather than argues.
    notInEffect: tier === 'signed' ? false : tier === 'proposal' ? true : raw.notInEffect === true,
    unreadable: !erased && text === null,
    erased,
    signedAt: trusted === null ? null : timeOf(trusted.at),
    forgottenAt: forgotten === null ? null : timeOf(forgotten.at),
    forgottenReason: forgotten === null ? null : textOf(forgotten.reason),
  }
}

/**
 * The rows for the open tab: newest first, filtered by the search and the kind, with unreadable records kept.
 *
 * @param answer - the list route's answer, as untrusted JSON: `{items: [...]}` or a bare array.
 * @param view - the current controls, so the filter and the receipts agree with what is on screen.
 * @returns the rows, and how many entries could not be turned into rows at all.
 */
export function itemsOf(
  answer: unknown,
  view: Pick<MemoryView, 'tier' | 'query' | 'kind' | 'citedIds'> & { readonly receipts?: Readonly<Record<string, ReceiptBadge>>; readonly ranked?: boolean },
): { readonly items: readonly MemoryItem[]; readonly skipped: number } {
  const list = Array.isArray(answer)
    ? answer
    : (answer !== null && typeof answer === 'object' && Array.isArray((answer as { items?: unknown }).items)
      ? (answer as { items: unknown[] }).items
      : [])
  const query = view.query.trim().toLowerCase()
  const items: MemoryItem[] = []
  let skipped = 0
  for (const record of list) {
    const item = itemOf(record, view.receipts ?? {})
    if (item === null) { skipped += 1; continue }
    if (item.tier !== view.tier) continue
    if (view.kind !== 'all' && item.kind !== view.kind) continue
    // ── THE WHY-LINK'S FILTER, WHICH IS SET MEMBERSHIP RATHER THAN A SEARCH ─────────────────────────────────────
    // `null` filters nothing; `[]` filters EVERYTHING, because a reply that cited no records must open a list with no
    // records in it. That is why the field is nullable, and why this is not expressed as a query string.
    if (view.citedIds !== null && !view.citedIds.includes(item.id)) continue
    if (query !== '' && !item.text.toLowerCase().includes(query)) continue
    items.push(item)
  }
  // NEWEST FIRST, AND A RECORD WITH NO READABLE TIME SORTS LAST: an unreadable date is not "the newest thing she
  // remembers", and putting it on top would let a parse failure look like a fresh memory.
  if (!view.ranked) items.sort((a, b) => {
    if (a.createdAt === null && b.createdAt === null) return a.id < b.id ? -1 : 1
    if (a.createdAt === null) return 1
    if (b.createdAt === null) return -1
    return b.createdAt - a.createdAt
  })
  return { items, skipped }
}

/** Ticking a row. The order he ticked them is the order the manifest carries. */
export function toggledSelection(selected: readonly string[], id: string): readonly string[] {
  return selected.includes(id) ? selected.filter(each => each !== id) : [...selected, id]
}

/**
 * What the Sign button sends: EXACTLY the ticked ids, in the order they were ticked, and nothing else.
 *
 * The route takes `{ids: [...]}` and the app builds one Aumlok approval over a manifest from them. A body that
 * carried anything else — the texts, the receipts, the tier — would be this app deciding what the manifest says,
 * and the manifest is built from store bytes by the engine that owns them.
 */
export function signRequestBody(selected: readonly string[]): { readonly ids: readonly string[] } {
  return { ids: [...selected] }
}

/**
 * The sentence the signing action carries while signing is off.
 *
 * **A DROP PATTERN TOO LOOSE DELETED THIS WHILE `signActionState` STILL RETURNED IT** — a dangling reference that the
 * type-stripping parse cannot see and the court found immediately. It is prose for the BUTTON'S TOOLTIP rather than
 * for a sentence on the page, so it lives beside the action that shows it.
 */
export const SIGNING_OFF_LINE =
  'Signing is off for now. It will be switched on when it asks for your fingerprint or password — until then, '
  + 'nothing here can become a rule.'

/**
 * Whether the Sign action can run at all.
 *
 * **IT CANNOT, YET, AND THE SCREEN SAYS SO.** The design's §2.4 keeps batch signing off until a signature requires
 * Peter in person; the goal asks for the action, the design forbids shipping it live, and both are satisfied by an
 * action that is present, explains itself and sends nothing.
 */
export function signActionState(selected: readonly string[]): {
  readonly enabled: boolean
  readonly reason: string | null
  readonly label: string
} {
  if (selected.length === 0) return { enabled: false, reason: 'Tick the ones you want to sign.', label: 'Sign selected' }
  return { enabled: false, reason: SIGNING_OFF_LINE, label: `Sign ${String(selected.length)} selected` }
}

/** What Forget does when he presses it: it asks first, and it says what will happen. */
export function forgetState(view: Pick<MemoryView, 'confirmingForget'>, id: string): {
  readonly confirming: boolean
  readonly question: string
} {
  return {
    confirming: view.confirmingForget === id,
    question: 'Forget this one? The words are erased, and a note stays behind saying you erased it.',
  }
}






