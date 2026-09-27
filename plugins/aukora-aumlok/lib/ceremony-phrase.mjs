/**
 * The AUMLOK acrostic phrase — generation ONLY. Ported from phi `ceremony/phrase.ts`.
 *
 * BYTE-FAITHFUL PORT. Source: `~/aukora-phi/ceremony/phrase.ts` @ `a099901ad5a2d623c5343263de6ae5f9994d3159`,
 * sha256 `0198b1cb1cc94702a63a4d7b29e693773e3260518d8f42aa7817b80d6f01c1f6`. Every word of every
 * table, the row themes, the anchor list and the generator's control flow are the donor's. Only the
 * TypeScript annotations are gone. See `PROVENANCE-CEREMONY.md`.
 *
 * THE PHRASE IS A TRUE ACROSTIC, AND THE ANCHOR IS WORD ZERO. The donor's header records the owner's
 * own correction (#284 follow-up): *the anchor is WORD ZERO of the phrase — it is SHOWN, TYPED, and
 * fingerprinted, followed by the six themed acrostic words.* Seven tokens, dash-joined. Draw the
 * anchor as a heading above six words and it stops being typeable, the fingerprint silently drops to
 * six, and typing the six-word tail starts to match. `ceremony-verify.mjs` is the half that refuses
 * that; this half only builds.
 *
 * THE TABLES ARE READ AS TEXT BY TWO COURTS. The donor's header (`:29-40`) records a real failure
 * caused by a comment spelling out a table declaration: a non-greedy extraction matched the PROSE
 * before the code and tried to evaluate a sentence. So the literals below are line-anchored, carry no
 * annotation between the name and the `=`, and no comment in this file restates a table declaration.
 *
 * ENTROPY, STATED HERE SO NOBODY HAS TO INFER IT. Themed buckets hold 2–4 words per letter, so the
 * phrase is worth ~14.3 bits of min-entropy — about twice a 4-digit PIN. It is PRESENCE, not a vault
 * password, and `ceremony-recovery.ts` is where that number is measured rather than asserted.
 *
 * @module @aukora/dsh-plugin-aumlok/ceremony-phrase
 */
import { randomBytes } from 'node:crypto'

const THEME_BY_ROW = ['root', 'root', 'unite', 'unite', 'rise', 'rise']
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
}
// 6-letter anchor words — every letter must have a bucket in EVERY theme (letters can land on any row).
const ANCHOR_WORDS = ['harbor', 'cinder', 'garnet', 'meadow', 'willow', 'timber', 'sorrel', 'frosty',
  'velvet', 'silver', 'copper', 'walnut', 'embers', 'thorns', 'ravens', 'pewter', 'corals', 'winter']

/** The bucket for a themed row and an anchor letter, or empty. The donor's `?? []` fallback, kept. */
function bucket(theme, letter) {
  const table = WORDS_THEMED
  return table[theme ?? '']?.[letter ?? ''] ?? []
}

/** `randomBytes(1)[0]` is always a byte; the donor states that rather than inventing a fallback. */
function pick(arr) {
  return arr[randomBytes(1)[0] % arr.length]
}

/**
 * Build an acrostic: a 6-letter anchor (word zero) + one themed word per anchor letter, whose
 * initials spell the anchor, each drawn from its ROW's theme (root/root/unite/unite/rise/rise). No
 * repeated words. The canonical phrase is the SEVEN tokens `[anchor, ...words]`.
 * @returns {{anchor: string, words: string[], tokens: string[], phrase: string}} the phrase.
 */
export function generateAcrosticPhrase() {
  const build = (anchor, words) => {
    const tokens = [anchor, ...words]
    return { anchor, words, tokens, phrase: tokens.join('-') }
  }
  outer: for (let tries = 0; tries < 60; tries++) {
    const anchor = pick(ANCHOR_WORDS)
    const letters = anchor.split('')
    const words = []
    for (let i = 0; i < letters.length; i++) {
      const pool = bucket(THEME_BY_ROW[i], letters[i]).filter((w) => !words.includes(w))
      if (!pool.length) continue outer
      words.push(pick(pool))
    }
    return build(anchor, words)
  }
  const anchor = 'harbor'
  const words = anchor.split('').map((c, i) => bucket(THEME_BY_ROW[i], c)[0])
  return build(anchor, words)
}

/** The themed tables, exposed for the donor-pin court and the UI's band colours. Frozen. */
export const PHRASE_TABLES = Object.freeze({
  THEME_BY_ROW: Object.freeze([...THEME_BY_ROW]),
  WORDS_THEMED,
  ANCHOR_WORDS: Object.freeze([...ANCHOR_WORDS]),
})

/** The three band names, in row order, as the face draws them. */
export const PHRASE_BANDS = Object.freeze(['root', 'unite', 'rise'])
