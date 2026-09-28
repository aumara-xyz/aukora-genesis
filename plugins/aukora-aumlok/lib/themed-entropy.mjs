/**
 * AUMLOK v3 — themed word pools, and the entropy the acrostic actually carries.
 *
 * WHAT THIS FILE IS. The seven words are the identity and the recovery (plan §1-§2). Word 0 is the
 * ANCHOR, a six-letter word drawn uniformly from the shipped anchor list. Words 1-6 are an acrostic:
 * each word's initial is the anchor's letter at that position, and each position draws from ONE theme:
 * NATURE, NATURE, PEOPLE, PEOPLE, SPIRIT, SPIRIT. The theme is memorability and pool structure. It is
 * not extra entropy. The root is scrypt of the seven words and the public handle. scrypt's output
 * length is not the phrase's entropy. This module does not claim 128 bits or 256 bits.
 *
 * THE ARITHMETIC, STATED SO NOBODY HAS TO INFER IT:
 *
 *     bits = log2(A) + MIN over anchors w in A of  Σ  log2( |P(theme(i), w[i])| − used(theme(i), w[i]) )
 *                                              i=0..5
 *
 *   A                 = anchors whose letters all clear the gate.
 *   theme(i)          = NATURE, NATURE, PEOPLE, PEOPLE, SPIRIT, SPIRIT.
 *   P(theme, letter)  = that theme's approved words for the letter.
 *   used             = earlier positions of the SAME theme and letter. A repeat is without replacement.
 *   MIN over A        = the weakest anchor the generator can emit.
 *   MAX over A        = the strongest anchor. Neither figure is 256 bits.
 *
 * THE 64-BIT FLOOR STAYS RETIRED. `measure()` returns `floorBits: null, meetsFloor: null`. Nothing
 * here gates a phrase on a bit target. The pools are the maximal theme lexicons after the safety
 * filter. `measure()` is the figure. The screen copy is pinned to it by
 * `tests/aukora-aumlok-drop-theme.test.mjs`.
 *
 * THE LETTER RULE. A letter is ADMISSIBLE when EVERY theme has at least MIN_WORDS_PER_BUCKET words
 * for it. The search may still drop a letter when that raises the guaranteed bits and leaves at
 * least MIN_ANCHOR_POOL anchors. Nothing is padded.
 *
 * NO NUMBER HERE IS HARDCODED AS THE ANSWER. Counts are read from `data/aumlok-themes.json`, the
 * anchor pool from `data/aumlok-anchors.json`.
 *
 * @module @aukora/dsh-plugin-aumlok/themed-entropy
 */
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const DATA_DIR = join(HERE, '..', 'data')

/** The shipped themed buckets (three themes, keyed by letter). */
export const THEMES_PATH = join(DATA_DIR, 'aumlok-themes.json')
/** The shipped six-letter anchor list; owned by another lane, read here when it exists. */
export const ANCHORS_PATH = join(DATA_DIR, 'aumlok-anchors.json')
/** Apple's dictionary — the reference for "is this a real word" and the anchor pool's fallback source. */
export const DICTIONARY_PATH = '/usr/share/dict/words'

/** The three tables the approved words are still stored under. Selection does not read this. */
export const THEMES = Object.freeze(['NATURE', 'PEOPLE', 'SPIRIT'])
/**
 * The live row map. Words 1-2 are NATURE, words 3-4 are PEOPLE, words 5-6 are SPIRIT.
 * The draw indexes this. A flat letter pool is a different generator.
 */
export const THEME_BY_POSITION = Object.freeze(['NATURE', 'NATURE', 'PEOPLE', 'PEOPLE', 'SPIRIT', 'SPIRIT'])
/** The selection this module measures: one theme pool per acrostic position. */
export const PHRASE_SELECTION = 'themed-maximal-pool'
/** Every anchor is exactly six letters, and its letters spell words 1-6. */
export const ANCHOR_LENGTH = 6
/** RETIRED, 2026-09-23, item X2 — THERE IS NO BIT FLOOR ANY MORE. The 60/64-bit target is what
 *  forced ~500 words per letter per theme, which walked the harvest into the obscure tail of a 1934
 *  dictionary and shipped an ethnic slur. X2 replaces it with a rule about WHERE WORDS COME FROM
 *  (common everyday English: the EFF list plus zipf >= 3.5) and says in terms that the bit floor
 *  "is now wrong". So the constant is deleted rather than lowered: a smaller floor is still a floor,
 *  and any code that can gate on a number will eventually be asked to lower it again.
 *
 *  What replaces it: `measure()` still reports the honest figure, and nothing compares it to
 *  anything. The safety property the floor was reaching for is now carried by the vocabulary itself
 *  (tests/aukora-aumlok-common-words.test.mjs) rather than by an entropy target. */
/** The letter rule: fewer than this in ANY theme excludes the letter from anchors.
 *
 *  12, NOT 30. The gate is drawability. A phrase draws at most two words from one theme for one
 *  letter, so 12 is several phrases of headroom. The court on the shipped pools is a higher floor
 *  than this gate: this constant only decides which letters the search may consider. */
export const MIN_WORDS_PER_BUCKET = 12
/** THE ANCHOR POOL IS AN INTERFACE, SO THE LETTER SEARCH MAY NOT SPEND IT. A letter is dropped only when
 *  the resulting anchor pool is still at least this large. Without the guard the search MAXIMISES BITS and
 *  will happily trade the whole anchor list for a fraction of one: dropping a letter costs its share of
 *  log2(A) but can raise the worst bucket, so on a small pool the greedy walk strips letters until only a
 *  handful of anchors can be spelled. MEASURED, item X2's rebuild: a 2,468-word pool let the unguarded
 *  search fall from 153 drawable anchors to 13 in exchange for 3.05 bits, and a thirteen-anchor identity
 *  list is not an anchor list — a person would meet the same anchor again and again. 128 is 7 bits of
 *  anchor choice, below which the anchor stops being a choice and becomes a fixture.
 *
 *  THIS IS NOT THE RETIRED FLOOR COMING BACK. The 60/64-bit floor gated a PHRASE and refused it by name;
 *  nothing here gates or refuses anything, and `measure()` still compares its figure to nothing. This is a
 *  floor on the SIZE OF THE ANCHOR POOL, which is a product asset, and it exists because a measurement
 *  must not be allowed to consume the thing it measures. */
export const MIN_ANCHOR_POOL = 128
/** RETIRED. Kept only so that a caller matching on the old name gets a clear error rather than a
 *  silent pass; nothing in this module throws it any more. */
export const REFUSAL_ENTROPY_BELOW_FLOOR = 'aumlok:entropy-below-floor-retired'
/** A shipped themed word: lowercase, 4 to 9 letters. */
export const WORD_PATTERN = /^[a-z]{4,9}$/u

/** Reads and parses a JSON file, returning null when it does not exist (a missing file is not a crash). */
function readJsonOrNull(path) {
  let text
  try {
    text = readFileSync(path, 'utf8')
  } catch {
    return null
  }
  return JSON.parse(text)
}

/** The shipped buckets, or null when the data file is not in the tree yet. */
export function loadThemes(path = THEMES_PATH) {
  return readJsonOrNull(path)
}

/** The three theme tables out of a data document. Accepts the shipped envelope or a bare mapping.
 *  A missing document, a missing theme or a missing letter is an EMPTY table, never a crash: the
 *  measurement then reads zero words and the floor refusal is what says so. */
export function themeTables(data) {
  const raw = data && typeof data === 'object' && data.themes && typeof data.themes === 'object' ? data.themes : data
  const out = {}
  for (const theme of THEMES) {
    const table = raw && typeof raw === 'object' ? raw[theme] : undefined
    out[theme] = table && typeof table === 'object' && !Array.isArray(table) ? table : {}
  }
  return out
}

/** The measured count per theme per letter — measured from the arrays, never trusted from a summary. */
export function bucketCounts(data) {
  const tables = themeTables(data)
  const out = {}
  for (const theme of THEMES) {
    out[theme] = {}
    for (const [letter, words] of Object.entries(tables[theme])) {
      if (Array.isArray(words)) out[theme][letter] = words.length
    }
  }
  return out
}

/** The number of words in one theme bucket: 0 when the theme or letter has no bucket at all. */
export function bucketSize(counts, theme, letter) {
  const n = counts && counts[theme] ? counts[theme][letter] : undefined
  return Number.isFinite(n) ? n : 0
}

/**
 * The approved pool for each letter: every shipped word in any table, once.
 * A word listed under two themes is one word. An empty letter is omitted.
 */
export function approvedPoolCounts(data) {
  const tables = themeTables(data)
  const sets = {}
  for (const theme of THEMES) {
    for (const [letter, words] of Object.entries(tables[theme])) {
      if (!/^[a-z]$/u.test(letter) || !Array.isArray(words)) continue
      if (!sets[letter]) sets[letter] = new Set()
      for (const word of words) {
        if (typeof word === 'string' && WORD_PATTERN.test(word)) sets[letter].add(word)
      }
    }
  }
  const counts = {}
  for (const [letter, set] of Object.entries(sets)) {
    if (set.size > 0) counts[letter] = set.size
  }
  return counts
}

/** The merged pool size for one letter. 0 when the letter has no approved word. */
export function letterPoolSize(poolCounts, letter) {
  const n = poolCounts ? poolCounts[letter] : undefined
  return Number.isFinite(n) ? n : 0
}

/** The thinnest theme bucket for one letter. A letter is only as drawable as that theme. */
export function letterFloor(counts, letter) {
  return Math.min(...THEMES.map((theme) => bucketSize(counts, theme, letter)))
}

/** Letters with at least `min` words in every theme. That is the admission gate for anchors. */
export function admissibleLetters(counts, min = MIN_WORDS_PER_BUCKET) {
  const letters = new Set()
  for (const theme of THEMES) {
    const table = counts && counts[theme]
    if (!table || typeof table !== 'object') continue
    for (const letter of Object.keys(table)) {
      if (/^[a-z]$/u.test(letter)) letters.add(letter)
    }
  }
  return [...letters].filter((letter) => letterFloor(counts, letter) >= min).sort()
}

/** Letters that fail the per-theme gate — the honest exclusion list. */
export function excludedLetters(counts, min = MIN_WORDS_PER_BUCKET) {
  const letters = new Set()
  for (const theme of THEMES) {
    const table = counts && counts[theme]
    if (!table || typeof table !== 'object') continue
    for (const letter of Object.keys(table)) {
      if (/^[a-z]$/u.test(letter)) letters.add(letter)
    }
  }
  return [...letters]
    .filter((letter) => letterFloor(counts, letter) < min)
    .sort()
    .map((letter) => ({
      letter,
      count: letterFloor(counts, letter),
      reason: `a theme bucket is below ${min}`,
    }))
}

/** The whole-words of a six-letter anchor candidate list; anything malformed is dropped, never coerced. */
function normaliseAnchors(words) {
  if (!Array.isArray(words)) return []
  const out = []
  for (const word of words) {
    if (typeof word !== 'string') continue
    const w = word.trim().toLowerCase()
    if (w.length === ANCHOR_LENGTH && /^[a-z]+$/.test(w) && !out.includes(w)) out.push(w)
  }
  return out
}

/** The dictionary's six-letter lowercase words — the same source the anchor list is drawn from. */
export function dictionaryAnchors(path = DICTIONARY_PATH) {
  let text
  try {
    text = readFileSync(path, 'utf8')
  } catch {
    return []
  }
  const seen = new Set()
  for (const line of text.split('\n')) {
    const w = line.trim()
    if (w.length === ANCHOR_LENGTH && /^[a-z]+$/.test(w)) seen.add(w)
  }
  return [...seen].sort()
}

/**
 * Where the anchor pool comes from: the shipped anchor list when it exists, otherwise the reference
 * dictionary. The source is reported, never assumed — the two give different figures.
 */
export function anchorSource(path = ANCHORS_PATH) {
  const doc = readJsonOrNull(path)
  if (doc !== null) {
    const words = normaliseAnchors(Array.isArray(doc) ? doc : doc.anchors ?? doc.words ?? doc.usableAnchors)
    return { source: path, kind: 'shipped-anchor-list', words }
  }
  const words = dictionaryAnchors()
  return { source: DICTIONARY_PATH, kind: 'dictionary-fallback', words }
}

/**
 * One evaluation of a candidate letter set: how many anchors it leaves, which anchor is weakest, and
 * the guaranteed bits. An anchor with a letter outside the set, or with an empty theme bucket at
 * any position, is not drawable and is therefore not in the pool. It is counted in
 * `droppedForLetters` rather than measured as if it could be drawn.
 */
export function evaluateLetters(letters, counts, words) {
  const set = new Set(letters)
  let anchorCount = 0
  let droppedForLetters = 0
  let minAnchorBits = Infinity
  let maxAnchorBits = 0
  let limitingAnchor = null
  let strongestAnchor = null
  let minBucket = Infinity
  for (const word of words) {
    let sum = 0
    let drawable = true
    const used = {}
    for (let i = 0; i < ANCHOR_LENGTH; i++) {
      const letter = word[i]
      const theme = THEME_BY_POSITION[i]
      if (!set.has(letter)) {
        drawable = false
        break
      }
      const key = `${theme}:${letter}`
      const already = used[key] ?? 0
      const size = bucketSize(counts, theme, letter) - already
      if (size <= 0) {
        drawable = false
        break
      }
      used[key] = already + 1
      if (size < minBucket) minBucket = size
      sum += Math.log2(size)
    }
    if (!drawable) {
      droppedForLetters += 1
      continue
    }
    anchorCount += 1
    if (sum < minAnchorBits) {
      minAnchorBits = sum
      limitingAnchor = word
    }
    if (sum >= maxAnchorBits) {
      maxAnchorBits = sum
      strongestAnchor = word
    }
  }
  const anchorBits = anchorCount > 0 ? Math.log2(anchorCount) : 0
  const bits = anchorCount > 0 ? anchorBits + minAnchorBits : 0
  const strongestBits = anchorCount > 0 ? anchorBits + maxAnchorBits : 0
  return {
    letters: [...letters].sort(),
    anchorCount,
    droppedForLetters,
    minAnchorBits: anchorCount > 0 ? minAnchorBits : 0,
    maxAnchorBits: anchorCount > 0 ? maxAnchorBits : 0,
    limitingAnchor,
    strongestAnchor,
    minBucket: Number.isFinite(minBucket) ? minBucket : 0,
    bits,
    strongestBits,
  }
}

/**
 * The floor-maximising subset of the admissible letters. The MIN_WORDS_PER_BUCKET gate admits; this
 * search only ever REMOVES an admissible letter, and only when removing it raises the guaranteed bits
 * (its share of log2(A) is worth less than the worst bucket it forces) AND leaves an anchor pool of at
 * least MIN_ANCHOR_POOL words. Nothing is added that failed the gate. The pool guard is what keeps a
 * bits-maximising search from spending the anchor list itself — see MIN_ANCHOR_POOL.
 */
export function chooseAnchorLetters(admissible, counts, words) {
  const dropped = []
  let current = evaluateLetters(admissible, counts, words)
  let improving = true
  while (improving) {
    improving = false
    let best = null
    for (const letter of current.letters) {
      const trial = evaluateLetters(current.letters.filter((l) => l !== letter), counts, words)
      if (!best || trial.bits > best.bits) best = trial
    }
    if (best && best.bits > current.bits + 1e-9 && best.anchorCount >= MIN_ANCHOR_POOL) {
      const removed = current.letters.filter((l) => !best.letters.includes(l))
      for (const letter of removed) {
        dropped.push({
          letter,
          bitsWithout: best.bits,
          bitsWith: current.bits,
          gain: best.bits - current.bits,
          reason: 'admissible but kept out of anchors: its presence lowers the guaranteed floor',
        })
      }
      current = best
      improving = true
    }
  }
  return { evaluation: current, dropped }
}

/**
 * THE MEASUREMENT. Everything the figure depends on, measured from the shipped data and the shipped
 * anchor source, with the arithmetic of the module header applied literally.
 *
 * @param {object|null} data the shipped themes document (default: read `data/aumlok-themes.json`).
 * @param {object} [options] `anchorWords` (explicit pool) and `letters` (explicit letter set) for courts.
 * @returns {object} the measured figure and every input it was measured from.
 */
export function measure(data = loadThemes(), options = {}) {
  const present = data !== null && data !== undefined
  const counts = bucketCounts(data)
  const admissible = admissibleLetters(counts)
  const anchors = options.anchorWords
    ? { source: 'explicit (court-supplied)', kind: 'explicit', words: normaliseAnchors(options.anchorWords) }
    : anchorSource()
  const chosen = options.letters
    ? { evaluation: evaluateLetters(options.letters, counts, anchors.words), dropped: [] }
    : chooseAnchorLetters(admissible, counts, anchors.words)
  const evaluation = chosen.evaluation
  return {
    selection: PHRASE_SELECTION,
    themeRestriction: true,
    bits: evaluation.bits,
    strongestBits: evaluation.strongestBits,
    floorBits: null,      // RETIRED: no floor exists, so no floor verdict is reported
    meetsFloor: null,     // null, not false: "not gated" is not the same claim as "below the gate"
    not128: true,
    minWordsPerBucket: MIN_WORDS_PER_BUCKET,
    dataPath: THEMES_PATH,
    dataPresent: present,
    counts,
    poolCounts: counts,
    admittedLetters: admissible,
    excludedLetters: excludedLetters(counts),
    anchorLetters: evaluation.letters,
    anchorLettersDropped: chosen.dropped,
    anchorSource: anchors.kind,
    anchorSourcePath: anchors.source,
    anchorCount: evaluation.anchorCount,
    anchorsDroppedForLetters: evaluation.droppedForLetters,
    minBucket: evaluation.minBucket,
    minAnchorBits: evaluation.minAnchorBits,
    maxAnchorBits: evaluation.maxAnchorBits,
    limitingAnchor: evaluation.limitingAnchor,
    strongestAnchor: evaluation.strongestAnchor,
  }
}

/** The measured figure, by the name the plan uses. */
export function generatorMinEntropy(data = loadThemes(), options = {}) {
  return measure(data, options).bits
}

/** How many anchors a letter set needs before the floor is met, given its weakest bucket. */
export function requiredAnchorCount(minBucket, floorBits) {
  if (!(Number.isFinite(floorBits))) return null   // no floor to reach: the question is retired
  const perWord = Math.log2(Math.max(1, minBucket))
  return Math.ceil(2 ** (floorBits - ANCHOR_LENGTH * perWord))
}

/**
 * THE HONEST CEILING. The best guaranteed figure these buckets can carry at ANY per-letter gate, and the
 * gate that reaches it. This is the measurement that answers "can the floor be met at all?" without
 * touching the floor: every gate is tried, the letter set each gate admits is measured exactly, and the
 * best result is returned. It is a measurement of the data, never a relaxation of the rule — the plan's
 * own gate (MIN_WORDS_PER_BUCKET) is one row of the same table, and `measure()` is what the generator uses.
 */
export function entropyCeiling(data = loadThemes(), options = {}) {
  const counts = bucketCounts(data)
  const present = admissibleLetters(counts, 1)
  const gates = options.gates ?? [...new Set(present.map((letter) => letterFloor(counts, letter)))].sort((a, b) => a - b)
  let best = null
  const table = []
  for (const gate of gates) {
    const letters = present.filter((letter) => letterFloor(counts, letter) >= gate).sort()
    if (!letters.length) continue
    const m = measure(data, { ...options, letters })
    if (m.anchorCount < MIN_ANCHOR_POOL) continue
    table.push({ gate, letters: letters.join(''), bits: Number(m.bits.toFixed(4)), anchors: m.anchorCount, minBucket: m.minBucket })
    if (!best || m.bits > best.bits) best = { ...m, gate }
  }
  return { best, table, floorBits: null, meetsFloor: null }
}

/** The smallest bucket an anchor letter needs for the floor to hold, given an anchor count. */
export function requiredBucketSize(anchorCount, floorBits) {
  if (!Number.isFinite(floorBits)) return null     // no floor to reach: the question is retired
  if (!(anchorCount > 0)) return Infinity
  return Math.ceil(2 ** ((floorBits - Math.log2(anchorCount)) / ANCHOR_LENGTH))
}

/**
 * RETIRED: the below-floor refusal. X2 removed the floor, so there is nothing to refuse. The class
 * is kept only so that an existing `catch (e) { if (e.code === REFUSAL_ENTROPY_BELOW_FLOOR) }` still
 * compiles and still reads correctly; this module never constructs it.
 */
export class EntropyFloorRefusal extends Error {
  constructor(bits, detail) {
    super(
      `${REFUSAL_ENTROPY_BELOW_FLOOR}: the bit floor was retired by item X2 on 2026-09-23, so nothing ` +
        `refuses a phrase for measuring ${Number(bits).toFixed(2)} bits` + (detail ? ` (${detail})` : ''),
    )
    this.name = 'EntropyFloorRefusal'
    this.code = REFUSAL_ENTROPY_BELOW_FLOOR
    this.bits = bits
    this.floorBits = null
  }
}

/**
 * NO LONGER A GATE. This used to throw when the measured figure was under 64 bits. X2 retired the
 * floor, so it now returns the figure it was given: a phrase is refused for shipping a word the
 * safety block forbids, never for carrying a particular number of bits.
 */
export function assertEntropyFloor(bits = generatorMinEntropy(), detail) {
  void detail
  return bits
}

/**
 * The measured figure as one line.
 *
 * ── **THE DOC USED TO CLAIM CONSUMERS THAT DO NOT EXIST (row 45)** ──────────────────────────────────────
 *
 * It read *"for the surface and for the terminal route."* **MEASURED at HEAD: this function is called from
 * exactly one place, and it is a TEST** — `tests/aukora-aumlok-themed-lists.test.mjs:275`. Two other files
 * mention it in comments; neither calls it. There is no surface call and no route call, so the sentence named a
 * consumer on the strength of an intention rather than a caller.
 *
 * *A docstring that promises a consumer is a docstring a reader will trust instead of grepping*, and the next
 * person to look for "where does the surface print the entropy line" would have found this sentence and stopped.
 *
 * **WHAT IT IS FOR, STATED AS WHAT IT IS:** a single-line rendering of `measure()`, used by the courts to show
 * the live figure beside the shipped one. **IF YOU WANT IT ON THE AUMLOK STATUS ROUTE, THAT IS A CHANGE TO
 * `plugins/aukora-face/aumlok/src/index.ts` AND NOT A CHANGE HERE** — the route exists and calls its control
 * service, so the wiring is possible; it simply has not been done, and this comment no longer implies it has.
 */
export function formatEntropyLine(measured = measure()) {
  const where = measured.dataPresent ? measured.dataPath : `${measured.dataPath} (ABSENT)`
  return (
    `PHRASE_ENTROPY: ${measured.bits.toFixed(2)} bits weakest, ${Number(measured.strongestBits).toFixed(2)} strongest ` +
    `(floor RETIRED — not gated, not 128 bits, not 256 bits) · ${measured.selection} · anchors ` +
    `${measured.anchorCount} from ${measured.anchorSource} · letters ${measured.anchorLetters.join('') || 'none'} · ` +
    `weakest anchor ${measured.limitingAnchor ?? 'none'} · buckets ${where}`
  )
}

/** One clause for the ceilings. The number is measured, and it does not say 128 bits. */
export function honestEntropyClause(measured = measure()) {
  return (
    `about ${measured.bits.toFixed(2)} bits at the weakest anchor and ` +
    `${Number(measured.strongestBits).toFixed(2)} at the strongest, not 128 bits and not 256 bits`
  )
}
