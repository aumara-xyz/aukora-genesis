// aukora · core/witness/phrase.mjs — the seven-token Aumlok phrase
//
// Ported from the owner's own tree (aukora-one `ui/ceremony/phrase.mjs`, itself
// a port of `core/src/aumlokPhrase.ts`). Simplified for this repository; the
// structure, the word buckets and the anchor list are unchanged, because the
// structure is the part that is easy to get subtly wrong.
//
// ── SEVEN TOKENS, AND THE ANCHOR IS WORD ZERO ──
//
// A six-letter ANCHOR plus six themed words whose initials spell the anchor.
// The anchor is SHOWN, TYPED and fingerprinted — it is not a heading above the
// six. `[anchor, ...words]`, dash-joined. Typing only the six-word tail does
// not match, and that is a deliberate property, not an accident of hashing.
//
// The reason the anchor is word zero is a SHAPE: on screen the anchor is a
// vertical spine of six single-character tiles read downward, each with its
// word growing sideways from it. The geometry IS the seven-token string. Drawn
// as a title instead, it stops being typeable and the fingerprint silently
// drops to six tokens.
//
// ── THE ROWS CARRY MEANING ──
//
// Rows 1–2 are of the earth (ROOT, green). Rows 3–4 are of each other (UNITE,
// blue). Rows 5–6 are of what lifts (RISE, purple). The buckets are 2–4 words
// per letter, so phrase entropy is essentially unchanged against a single pool
// (~15–16 bits) — and the phrase never authenticates alone. The Ed25519 key
// signs; the phrase only unwraps, and only a salted fingerprint is ever stored.
//
// This module GENERATES ONLY. It writes nothing, verifies nothing, unwraps
// nothing, and grants nothing.

import { randomInt } from 'node:crypto';

const THEME_BY_ROW = ['root', 'root', 'unite', 'unite', 'rise', 'rise'];

const WORDS_THEMED = {
  root: { // green — of the earth
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
    w: ['willow', 'wren', 'walnut', 'winter'], y: ['yarrow', 'yew', 'yonder'],
    z: ['zephyr', 'zinnia', 'zinc'],
  },
  unite: { // blue — of each other
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
  rise: { // purple — of what lifts
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

/** Six-letter anchors. Every letter has a bucket in every theme. */
const ANCHOR_WORDS = ['harbor', 'cinder', 'garnet', 'meadow', 'willow', 'timber', 'sorrel',
  'frosty', 'velvet', 'silver', 'copper', 'walnut', 'embers', 'thorns', 'ravens', 'pewter',
  'corals', 'winter'];

/** Uniform, rejection-sampled. `randomBytes(1)[0] % n` is not uniform for n∤256. */
function pick(arr) { return arr[randomInt(arr.length)]; }

export const THEME_ROWS = Object.freeze(THEME_BY_ROW.slice());

/**
 * Build an acrostic: a six-letter anchor (word zero) plus one themed word per
 * anchor letter, initials spelling the anchor, each drawn from its row's theme.
 * No repeated words AMONG THE SIX. The anchor is not compared against them — the filter checks only
 * `!words.includes(w)` — so an anchor that also sits in its own row-0 bucket can recur as word one.
 * Stated rather than fixed here: changing the filter changes generated output and the shape the
 * ceremony pins, which belongs in its own change with its own test.
 *
 * @returns {{anchor: string, words: string[], themes: string[], tokens: string[], phrase: string}}
 */
export function generatePhrase() {
  const build = (anchor, words) => {
    const tokens = [anchor, ...words];
    return { anchor, words, themes: THEME_BY_ROW.slice(), tokens, phrase: tokens.join('-') };
  };

  outer: for (let tries = 0; tries < 60; tries += 1) {
    const anchor = pick(ANCHOR_WORDS);
    const words = [];
    for (const [i, letter] of anchor.split('').entries()) {
      const pool = (WORDS_THEMED[THEME_BY_ROW[i]][letter] ?? []).filter((w) => !words.includes(w));
      if (pool.length === 0) continue outer;
      words.push(pick(pool));
    }
    return build(anchor, words);
  }

  const anchor = 'harbor';
  return build(anchor, anchor.split('').map((c, i) => WORDS_THEMED[THEME_BY_ROW[i]][c][0]));
}

/**
 * lowercase, trim, any run of spaces/underscores/dashes → one dash, so
 * "Harbor Hazel Amber" matches "harbor-hazel-amber". One canonicaliser, applied
 * to both sides, is why the ceremony can accept a phrase typed with spaces.
 */
export function normalizePhrase(s) {
  return String(s ?? '').toLowerCase().trim().replace(/[\s_-]+/gu, '-');
}

export const PHRASE_TOKENS = 7;

/** Shape check only. Recognising a phrase is `aumlok.mjs`'s job, not this one. */
export function looksLikePhrase(s) {
  return normalizePhrase(s).split('-').filter(Boolean).length === PHRASE_TOKENS;
}
