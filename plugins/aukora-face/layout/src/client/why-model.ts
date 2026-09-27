/**
 * "WHY DID SHE SAY THAT?" — one reply's attention, decided in one place so a court can hold it.
 *
 * AUMA is adding a per-reply manifest: for each reply, the ids and hashes of every block and memory that was in her
 * prompt, whether each counts as **outside words**, and each one's source. This module turns that into what a person
 * reads. Three rules come from the design itself, and each is a rule a court holds:
 *
 *  1. **INTEGRITY, AUTHORITY AND OPINION NEVER SHARE A BADGE.** The research pass is explicit: "the two never share a
 *     badge", and its section 2 says verification means the **id, the source and the chain together**. So a check mark
 *     here means one thing only — a rebuild really matched — and the module has no way to express "probably fine".
 *  2. **OUTSIDE WORDS ARE LABELLED EVERY TIME.** She can hold words from outside the conversation — the repo lens, the
 *     organism view, lane notes, a recall — and `kira-lens.ts` states why it matters: "a recalled record can never be
 *     restored as something Peter said". An item the manifest marks as outside words is labelled, without exception,
 *     and the label says what it means: these words could not authorise anything.
 *  3. **AN ABSENT RECEIPT IS SAID IN WORDS.** A reply made before receipts existed has no manifest, and an empty list
 *     would read as "she was holding nothing in mind" — a different and false statement about her attention.
 *
 * **THE BLOCK NAMES ARE AUMA'S, NOT MINE.** `OUTSIDE_WORD_BLOCKS` in
 * `plugins/aukora-face/apps/src/auma-live/turn-trust.ts` is `['organism', 'claims', 'crossLane', 'lanes', 'screen',
 * 'repo']`, and the lesson beside it is that the repo lens was missing once — "two doors into the prompt, one of them
 * unwatched". This module groups by whatever block the manifest names, so a block added there becomes its own group
 * rather than disappearing inside another.
 *
 * @module why-model
 */


/** The surface's name, in one place: the menu opens it, the shell registers it, a court can name it without a literal. */
export const WHY_SURFACE = 'why'

/** One thing that was in her prompt. */
export interface ManifestItem {
  readonly id: string
  /** The hash of the bytes as they were sent. **Never rendered** — it is the evidence a rebuild is checked against. */
  readonly sha256?: string
  /** Where it came from, in words a person can follow. */
  readonly source: string
  /** When it was made, when the manifest knows. */
  readonly at?: string | null
  /** Whether this counts as words from outside the conversation. **Auma's own list decides, not a guess about a source.** */
  readonly outsideWords?: boolean
}

/** One block of her prompt, with what it held. */
export interface ManifestGroup {
  readonly block: string
  readonly items: readonly ManifestItem[]
}

/** What a rebuild of the prompt reported. */
export interface ManifestRebuild {
  readonly attempted?: boolean
  readonly matches?: boolean
  readonly idChecked?: boolean
  readonly sourceChecked?: boolean
  readonly chainChecked?: boolean
}

/** One reply's manifest, as AUMA's log carries it. */
export interface ReplyManifest {
  readonly replyId: string
  readonly at?: string
  readonly groups?: readonly ManifestGroup[]
  readonly budget?: Readonly<Record<string, number>>
  readonly rebuild?: ManifestRebuild | null
}

/** The honest states of a receipt: it exists, or it does not and we say why. */
export type ManifestFact =
  | { readonly known: true; readonly manifest: ReplyManifest }
  | { readonly known: false; readonly why: string }

/** What the check mark means, and when there is no check to show. */
export type RebuildCheck =
  | { readonly known: true; readonly matches: true }
  | { readonly known: true; readonly matches: false }
  | { readonly known: false; readonly why: string }

/** One row of the view: what she was holding, where it came from, and whether it is outside words. */
export interface WhyRow {
  readonly block: string
  readonly source: string
  readonly at: string | null
  readonly outsideWords: boolean
  /** **THE ID IS NOT ON THE ROW.** It identifies the item in the manifest; a person reading "why" wants the source. */
}

/** One group, in the order the manifest gave them. */
export interface WhyGroup {
  readonly block: string
  readonly rows: readonly WhyRow[]
  /** True when every item in the group is outside words, which is worth noticing about a whole block. */
  readonly allOutsideWords: boolean
}

/**
 * Whether the bytes rebuild — **and a check only from a real rebuild.**
 *
 * Five conditions, all required: the rebuild was attempted, it matched, and the **id, the source and the chain** were
 * each checked. Anything else is `known: false` with the reason, because a check mark that means "a field said true"
 * is the badge this design forbids.
 */
export function rebuildCheckOf(manifest: ReplyManifest | null | undefined): RebuildCheck {
  const rebuild = manifest?.rebuild
  if (rebuild === null || rebuild === undefined) return { known: false, why: 'no rebuild was recorded for this reply' }
  if (rebuild.attempted !== true) return { known: false, why: 'the prompt was not rebuilt, so the bytes were not checked' }
  if (rebuild.idChecked !== true) return { known: false, why: 'the rebuild did not check the id' }
  if (rebuild.sourceChecked !== true) return { known: false, why: 'the rebuild did not check the source' }
  if (rebuild.chainChecked !== true) return { known: false, why: 'the rebuild did not check the chain' }
  return rebuild.matches === true
    ? { known: true, matches: true }
    : { known: true, matches: false }
}

/** The rows of one group, with outside words labelled from the manifest rather than inferred. */
export function whyGroupOf(group: ManifestGroup): WhyGroup {
  const rows = group.items.map(item => ({
    block: group.block,
    source: typeof item.source === 'string' && item.source !== '' ? item.source : 'the manifest does not say where this came from',
    at: typeof item.at === 'string' && item.at !== '' ? item.at : null,
    // **THE MANIFEST DECIDES.** An item is outside words when the manifest says so; a source name is not evidence
    // either way, and inferring it would be this module inventing an authority judgement it was not given.
    outsideWords: item.outsideWords === true,
  }))
  return { block: group.block, rows, allOutsideWords: rows.length > 0 && rows.every(row => row.outsideWords) }
}

/** Every group, in the order the manifest gave them, skipping none. */
export function whyGroupsOf(manifest: ReplyManifest | null | undefined): readonly WhyGroup[] {
  const groups = manifest?.groups
  if (!Array.isArray(groups)) return []
  return groups.map(whyGroupOf)
}

/**
 * The fact a reply is owed, from whatever the log had.
 *
 * @param manifest - the manifest for this reply, or null when there is none.
 * @returns the receipt, or the absent state **with the reason in the view's own words**.
 */
export function manifestFactOf(manifest: ReplyManifest | null | undefined): ManifestFact {
  if (manifest === null || manifest === undefined) {
    return { known: false, why: 'this reply has no receipt; it was made before receipts existed' }
  }
  if (typeof manifest.replyId !== 'string' || manifest.replyId === '') {
    // A manifest with no reply id is not a receipt for anything, and treating it as one would attribute somebody
    // else's prompt to this reply.
    return { known: false, why: 'the receipt does not say which reply it belongs to' }
  }
  return { known: true, manifest }
}

/** How many items were outside words, and how many were hers to say. */
export function outsideWordCounts(groups: readonly WhyGroup[]): { readonly outside: number; readonly inside: number } {
  let outside = 0
  let inside = 0
  for (const group of groups) {
    for (const row of group.rows) {
      if (row.outsideWords) outside += 1
      else inside += 1
    }
  }
  return { outside, inside }
}
