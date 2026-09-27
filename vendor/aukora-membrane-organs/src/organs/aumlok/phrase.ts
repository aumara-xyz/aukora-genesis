// φ · ceremony/phrase.ts — the AUMLOK acrostic phrase. GENERATION ONLY.
//
// ══ TRANSPLANTED FROM aukora-one/ui/ceremony/phrase.mjs, WHICH WAS ITSELF A MECHANICAL PORT ══
//
// The lineage is three deep and worth stating, because each hop is a place fidelity could have been
// lost: the owner's `core/src/aumlokPhrase.ts` → aukora-one's `.mjs` (TypeScript annotations stripped)
// → here (the annotations restored). Every word, every anchor, every branch is still his.
//
// The donor's header records why it exists: a from-scratch version got the phrase structurally wrong,
// treating the anchor as a heading above six words. The owner had already corrected that once:
//
//     Owner correction (#284 follow-up): the anchor is WORD ZERO of the phrase — it is SHOWN,
//     TYPED, and fingerprinted, followed by the six themed acrostic words.
//
// SEVEN tokens. `[anchor, ...words]`, dash-joined. The fingerprint is over that, and typing only the
// six-word tail does not match. The reason it is word zero is a SHAPE, not a convention: on the
// ceremony page the anchor is a vertical spine of six single-character tiles read DOWNWARD, each with
// its themed word growing sideways. Draw the anchor as a title and it stops being typeable, stops
// being word zero, and the fingerprint silently drops to six.
//
// ══ WHY THE WORD TABLES ARE BYTE-FAITHFUL AND A TEST PROVES IT ══
//
// `evidence/ceremony-phrase.donor.json` came across with this file. It is a content-free pin — digests
// of the anchor block and the word set, recorded on a machine where the owner's own source was present.
// `test/ceremony-phrase.test.ts` recomputes them here. So the transplant is not asserted, it is
// checked: if a single word in these tables drifts, the pin no longer matches and the test demands
// re-verification against the donor rather than a re-recorded digest.
//
// That is also why the annotations below are shaped the way they are. The types are added at the point
// of ACCESS, never onto the table literals, because two tests read this file as text — the pin over the
// word set, and the exhaustive keyspace enumeration in `test/ceremony-recovery.test.ts`, which extracts
// the themed tables from the source and walks every reachable completion. An annotation between a table's
// name and its `=` would have quietly broken both, and both would have failed loudly, which is the design
// working.
//
// It did fail loudly, once, on this very paragraph: an earlier draft spelled the declaration out verbatim
// here as an example, the enumerator's non-greedy match found the PROSE before the code, and it tried to
// evaluate a sentence. The extraction is line-anchored now so a comment can never shadow a table again —
// but the first fix was to stop writing the declaration in a comment, because a test that reads source as
// text will always be one careless sentence away from reading the wrong thing.
//
// ══ THIS MODULE GENERATES ONLY ══
//
// It writes nothing, verifies nothing, and grants nothing. Verification lives in `verify.ts` because
// the donor keeps that separation and says why: a from-scratch version folded the two together, and a
// later reviewer could not tell which half they were reading. `test/ceremony-phrase.test.ts` asserts
// the separation structurally — one export, and no scrypt, no constant-time compare, no file write.

// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Aukora
/**
 * The AUMLOK acrostic phrase — core-owned generation (canonical-ceremony round, #242).
 *
 * The phrase is a TRUE ACROSTIC (owner's design): a 6-letter ANCHOR word and six words whose first
 * letters spell the anchor — the anchor as the vertical spine. e.g. HARBOR → hazel amber raven birch
 * ochre rowan.
 *
 * Owner's meaning layer (2026-07-08, ROOT · UNITE · RISE / tri hita karana): the words carry the hue of
 * their row. Rows 1-2 (green) are of the earth — ROOT. Rows 3-4 (blue) are of each other — UNITE. Rows
 * 5-6 (purple) are of what lifts — RISE. Entropy note: themed buckets are 2-4 words per letter (median
 * 3-4), so phrase entropy is essentially unchanged versus a single pool — and the phrase never
 * authenticates alone. What it is worth is measured exactly in `recovery.ts`, and the number is small.
 */
import { randomBytes } from 'node:crypto';

const THEME_BY_ROW = ['root', 'root', 'unite', 'unite', 'rise', 'rise'];
const WORDS_THEMED = {
  root: { // green — nature, of the earth
    a: ['amber', 'aspen', 'alder', 'acorn'], b: ['birch', 'brook', 'bramble', 'basin'],
    c: ['cedar', 'coral', 'clover', 'cliff'], d: ['delta', 'dune', 'drift', 'dawn'],
    e: ['elm', 'ember', 'estuary', 'eddy'], f: ['fern', 'flint', 'fjord', 'frost'],
    g: ['grove', 'glade', 'granite', 'garnet'], h: ['hazel', 'heath', 'hollow', 'harbor'],
    i: ['iris', 'ivy', 'island', 'inlet'], j: ['juniper', 'jasper', 'jade'],
    k: ['kelp', 'kestrel', 'knoll'], l: ['larch', 'lagoon', 'lichen', 'loam'],
    m: ['maple', 'marsh', 'meadow', 'moss'], n: ['nettle', 'nimbus', 'north', 'nectar'],
    o: ['ochre', 'otter', 'oasis', 'oak'], p: ['pebble', 'pine', 'petal', 'prairie'],
    q: ['quartz', 'quince', 'quarry'], r: ['rowan', 'reef', 'river', 'reed'],
    s: ['sage', 'slate', 'storm', 'spruce'], t: ['thorn', 'timber', 'tide', 'tundra'],
    u: ['umber', 'upland', 'ursa'], v: ['vale', 'verdant', 'vine', 'violet'],
    w: ['willow', 'wren', 'walnut', 'winter'], y: ['yarrow', 'yew', 'yonder'], z: ['zephyr', 'zinnia', 'zinc'],
  },
  unite: { // blue — people, of each other
    a: ['ally', 'accord', 'amity', 'anthem'], b: ['banter', 'bond', 'bridge', 'brother'],
    c: ['circle', 'chorus', 'comrade', 'cradle'], d: ['dance', 'duet', 'dwell', 'dinner'],
    e: ['embrace', 'ensemble', 'elder', 'emissary'], f: ['friend', 'family', 'fellow', 'feast'],
    g: ['gather', 'guest', 'guide', 'gift'], h: ['hearth', 'harmony', 'hello', 'haven'],
    i: ['invite', 'inn', 'icon'], j: ['jest', 'join', 'jubilee'],
    k: ['kin', 'kindred', 'keepsake'], l: ['laughter', 'link', 'lodge', 'lullaby'],
    m: ['mingle', 'mirth', 'mentor', 'market'], n: ['neighbor', 'nest', 'nomad'],
    o: ['offer', 'oath', 'opus'], p: ['partner', 'parley', 'pact', 'plaza'],
    q: ['quorum', 'quilt', 'quip'], r: ['rally', 'rapport', 'refuge', 'ring'],
    s: ['supper', 'salon', 'smile', 'shelter'], t: ['tribe', 'trust', 'toast', 'tavern'],
    u: ['unity', 'union', 'usher'], v: ['vow', 'voice', 'visit', 'village'],
    w: ['welcome', 'waltz', 'weave'], y: ['yarn', 'youth'], z: ['zeal', 'zest'],
  },
  rise: { // purple — higher purpose, of what lifts
    a: ['ascend', 'aura', 'altar', 'arrow'], b: ['beacon', 'bless', 'beyond'],
    c: ['calling', 'cosmos', 'crown', 'compass'], d: ['destiny', 'devotion', 'dharma'],
    e: ['eternal', 'exalt', 'essence'], f: ['faith', 'flame', 'favor'],
    g: ['grace', 'glory', 'gleam'], h: ['halo', 'heaven', 'horizon', 'hymn'],
    i: ['ideal', 'infinite', 'inspire'], j: ['journey', 'justice', 'jewel'],
    k: ['karma', 'keystone', 'kindle'], l: ['light', 'lumen', 'lodestar', 'legacy'],
    m: ['mercy', 'miracle', 'muse', 'myth'], n: ['noble', 'nirvana', 'nova'],
    o: ['oracle', 'omen', 'onward'], p: ['prayer', 'pilgrim', 'pinnacle', 'psalm'],
    q: ['quest', 'quasar'], r: ['radiant', 'rise', 'reverie', 'realm'],
    s: ['sacred', 'spirit', 'soul', 'summit'], t: ['temple', 'truth', 'totem'],
    u: ['uplift', 'upward', 'ultra'], v: ['vision', 'virtue', 'vessel'],
    w: ['wisdom', 'wonder', 'worship'], y: ['yearn', 'yonder'], z: ['zenith', 'zen'],
  },
};
// 6-letter anchor words — every letter must have a bucket in EVERY theme (letters can land on any row).
const ANCHOR_WORDS = ['harbor', 'cinder', 'garnet', 'meadow', 'willow', 'timber', 'sorrel', 'frosty',
  'velvet', 'silver', 'copper', 'walnut', 'embers', 'thorns', 'ravens', 'pewter', 'corals', 'winter'];

/**
 * The bucket for a themed row and an anchor letter, or empty.
 *
 * The lookup is widened here rather than by annotating the table, for the reason in the header: two
 * tests read the table out of this file as text. The donor wrote `WORDS_THEMED[THEME_BY_ROW[i]][c]`
 * directly, which under `noUncheckedIndexedAccess` is two possibly-undefined indexings; the `?? []`
 * fallback is the donor's own, kept where he put it.
 */
function bucket(theme: string | undefined, letter: string | undefined): string[] {
  const table = WORDS_THEMED as unknown as Record<string, Record<string, string[] | undefined> | undefined>;
  return table[theme ?? '']?.[letter ?? ''] ?? [];
}

/** `randomBytes(1)[0]` is always a byte. The assertion states that rather than inventing a fallback. */
function pick<T>(arr: readonly T[]): T {
  return arr[randomBytes(1)[0]! % arr.length]!;
}

/**
 * An AcrosticPhrase, restored from the donor's interface — aukora-one carried it as a comment because
 * the port had stripped the types.
 */
export interface AcrosticPhrase {
  /**
   * The 6-letter anchor. Owner correction (#284 follow-up): the anchor is WORD ZERO of the phrase — it
   * is SHOWN, TYPED, and fingerprinted, followed by the six themed acrostic words.
   */
  anchor: string;
  /** The six themed words, first letters spelling the anchor, one per themed row. */
  words: string[];
  /** The full seven tokens as typed/shown: `[anchor, ...words]`. */
  tokens: string[];
  /**
   * The canonical typed-back form: SEVEN words dash-joined — anchor first, then the six themed words.
   * The fingerprint is over THIS. Typing only the six-word tail (no anchor) does not match.
   */
  phrase: string;
}

/**
 * Build an acrostic: a 6-letter anchor (word zero) + one themed word per anchor letter, whose initials
 * spell the anchor, each drawn from its ROW's theme (root/root/unite/unite/rise/rise). No repeated
 * words. The canonical phrase is the SEVEN tokens `[anchor, ...words]`.
 */
export function generateAcrosticPhrase(): AcrosticPhrase {
  const build = (anchor: string, words: string[]): AcrosticPhrase => {
    const tokens = [anchor, ...words];
    return { anchor, words, tokens, phrase: tokens.join('-') };
  };
  outer: for (let tries = 0; tries < 60; tries++) {
    const anchor = pick(ANCHOR_WORDS);
    const letters = anchor.split('');
    const words: string[] = [];
    for (let i = 0; i < letters.length; i++) {
      const pool = bucket(THEME_BY_ROW[i], letters[i]).filter((w) => !words.includes(w));
      if (!pool.length) continue outer;
      words.push(pick(pool));
    }
    return build(anchor, words);
  }
  const anchor = 'harbor';
  const words = anchor.split('').map((c, i) => bucket(THEME_BY_ROW[i], c)[0]!);
  return build(anchor, words);
}
