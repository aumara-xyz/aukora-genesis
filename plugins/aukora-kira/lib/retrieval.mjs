/**
 * The measured lexical retrieval method: BM25 over the visible record text plus
 * one fixed ordered-bigram term.
 *
 * This is the method the pinned research measured as `v1`/`v2` lexical and
 * recommended for adoption. It is the *only* method this plugin runs. The
 * semantic/static-embedding and INT8/ternary options the same research froze
 * are inventoried in {@link RETRIEVAL_OPTIONS} as replaceable derived
 * retrieval options and are refused, not silently substituted.
 *
 * Scoring constants and limit values are ported unchanged from the pinned
 * `research/associative-memory/2026-09-08/explorer/core.mjs`; see
 * `PROVENANCE.md`. {@link lexicalMethodDigest} makes those constants an
 * asserted invariant rather than a comment.
 *
 * `match` means lexical overlap, not an answer and not a true statement. No
 * score here is evidence that a retrieved record answers the question.
 *
 * @module @aukora/dsh-plugin-kira/retrieval
 */
import { createHash } from 'node:crypto'
import { canonicalJSON } from './record.mjs'

/**
 * Frozen scoring constants.
 *
 * `bigramWeight` is the `0.1 * phrase` term of the pinned `rank()`. The pinned
 * file's `lexicalWeight`, `semanticWeight`, `ternaryRms` and `expansion` belong
 * to the encoder and quantization options that are NOT replaced here; they are
 * recorded in {@link RETRIEVAL_OPTIONS} and do not participate in this method.
 */
export const LEXICAL_METHOD = Object.freeze({
  name: 'lexical-bm25-bigram',
  version: 1,
  k1: 1.2,
  b: 0.75,
  bigramWeight: 0.1,
  /** Minimum score for a record to be an eligible candidate. */
  minScore: 0.12,
  /** Score gap below which two eligible candidates are treated as ambiguous. */
  ambiguousGap: 0.035,
})

/** Fixed whole-result and working-state bounds. */
export const RETRIEVAL_LIMITS = Object.freeze({
  /** Snippets published in one turn. */
  snippets: 3,
  /** Active references (displayed + selected + excluded) held in working state. */
  references: 5,
  /** Working-state byte ceiling. */
  stateBytes: 8 * 1024,
  /** Question character ceiling. */
  queryChars: 512,
  /** Snippet character ceiling, counted in Unicode characters. */
  snippetChars: 480,
  /** Records accepted from one read-owner snapshot. */
  records: 4096,
  /** Snapshot byte ceiling. */
  corpusBytes: 4 * 1024 * 1024,
  /** Rejected candidates tolerated before the caller must refine or restart. */
  rejections: 5,
  /** Link relations this method understands; every other relation is inert text. */
  linkRelations: Object.freeze(['supersedes', 'contradicts']),
})

/**
 * The migration inventory of retrieval options. Only `lexical` is implemented
 * in this increment; every other row names what it is and that it is not
 * deployed. A configuration naming one of them is refused with this table in
 * the message, so the inventory cannot be omitted from a migration as long as
 * the option is selectable.
 */
export const RETRIEVAL_OPTIONS = Object.freeze([
  Object.freeze({
    id: 'lexical',
    status: 'implemented',
    derived: false,
    vectors: 0,
    note: 'BM25 plus one ordered-bigram term over verified record text; no model, no weights, no download.',
  }),
  Object.freeze({
    id: 'static-embedding',
    status: 'not-implemented',
    derived: true,
    vectors: 'f32',
    note: 'Frozen external encoder from research/associative-memory/2026-09-08/explorer (acquire_model.py, model-lock.json). Requires a model artifact; NOT deployed and NOT downloaded by this increment.',
  }),
  Object.freeze({
    id: 'int8',
    status: 'not-implemented',
    derived: true,
    vectors: 'i8+scale',
    note: 'Int8 quantization of the same derived vectors (explorer/vectors.mjs encodeVector mode=int8). NOT deployed.',
  }),
  Object.freeze({
    id: 'ternary',
    status: 'not-implemented',
    derived: true,
    vectors: '2-bit packed',
    note: 'Ternary packing of the same derived vectors (explorer/vectors.mjs encodeVector mode=ternary). NOT deployed.',
  }),
])

/** Retrieval status vocabulary, separate from store availability. */
export const RETRIEVAL_STATUSES = Object.freeze(['match', 'ambiguous', 'insufficient', 'exhausted'])

/** Store availability vocabulary; `undetermined` never collapses into `empty`. */
export const STORE_AVAILABILITY = Object.freeze(['found', 'empty', 'undetermined'])

/**
 * Named limits that travel with every reply, so a consumer never has to look
 * them up elsewhere. Mirrors the artifact verifier's ceiling posture.
 */
export const RETRIEVAL_CEILING = Object.freeze([
  'a match is lexical overlap between the question and the owner-supplied text projection of a verified record, not an answer, a truth claim, or a correctness measure; the RECORD is re-verified here, the projection is only type-checked, so what matched is the owner\'s rendering of a record rather than the record itself',
  'absence of a match is absence within the verified snapshot, not evidence that the memory does not exist',
  'recorded attribution is not truth: a record states what its author recorded',
  'an interpretation of original/current is a reading of explicit recorded links, not a determination of what is correct',
  'citations are consistent with the read owner\'s state snapshot; they are not an external checkpoint or proof of off-host latestness',
])

/** Stop-word set, ported unchanged from the pinned scorer. */
const STOP_WORDS = new Set(
  ('a an the to of in on for is are was were be been being do does did what which where when how who why can could would should will '
    + 'with from it that this those these me my we our you your i and or as at by about more please find tell show one').split(' '),
)

/**
 * Tokenize one text into lowercase word tokens, dropping stop words.
 * @param {string} text - text to tokenize.
 * @returns {string[]} tokens in source order.
 */
export function tokens(text) {
  return (text.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? []).filter(word => !STOP_WORDS.has(word))
}

/**
 * Clip one string to a ceiling counted in Unicode characters.
 * @param {string} text - source text.
 * @param {number} size - maximum character count.
 * @returns {string} the clipped text.
 */
export function clip(text, size) {
  return [...text].slice(0, size).join('')
}

/**
 * Compile the visible record text into a finite lexical index.
 *
 * This is the only derived structure the lexical method builds. It holds no
 * vectors, no weights, and no permission metadata.
 *
 * @param {readonly {recordId: string, text: string}[]} records - verified snapshot records.
 * @returns {{documents: string[][], df: Map<string, number>, average: number, count: number}} the index.
 */
export function compileIndex(records) {
  const documents = records.map(record => tokens(record.text))
  const df = new Map()
  for (const words of documents) for (const word of new Set(words)) df.set(word, (df.get(word) ?? 0) + 1)
  return {
    documents,
    df,
    average: documents.reduce((sum, words) => sum + words.length, 0) / (records.length || 1),
    count: records.length,
  }
}

/**
 * Score every record against one question.
 * @param {{documents: string[][], df: Map<string, number>, average: number, count: number}} index - compiled index.
 * @param {readonly {recordId: string}[]} records - records the index was compiled over, in order.
 * @param {string} query - question text.
 * @returns {{recordId: string, score: number}[]} rows ordered by descending score then record id.
 */
export function rankRecords(index, records, query) {
  const words = tokens(query)
  const bigrams = words.slice(1).map((word, i) => `${words[i]} ${word}`)
  return records.map((record, i) => {
    const doc = index.documents[i]
    let bm25 = 0
    for (const word of new Set(words)) {
      const frequency = doc.filter(item => item === word).length
      const idf = Math.log(1 + (index.count - (index.df.get(word) ?? 0) + 0.5) / ((index.df.get(word) ?? 0) + 0.5))
      bm25 += idf * frequency * (LEXICAL_METHOD.k1 + 1)
        / (frequency + LEXICAL_METHOD.k1 * (1 - LEXICAL_METHOD.b + LEXICAL_METHOD.b * doc.length / (index.average || 1)))
    }
    const phrase = bigrams.filter(pair => doc.join(' ').includes(pair)).length / Math.max(1, bigrams.length)
    const lexical = bm25 / (bm25 + 2) + LEXICAL_METHOD.bigramWeight * phrase
    return { recordId: record.recordId, score: lexical }
  }).sort((a, b) => b.score - a.score || a.recordId.localeCompare(b.recordId))
}

/**
 * Digest of the exact method and bounds this build runs. A derived view staged
 * from this retrieval carries it as its transform parameter digest, and a test
 * pins it so a silent constant change fails rather than ships.
 * @returns {string} lowercase SHA-256 hex digest.
 */
export function lexicalMethodDigest() {
  return createHash('sha256')
    .update(canonicalJSON({ method: LEXICAL_METHOD, limits: RETRIEVAL_LIMITS }), 'utf8')
    .digest('hex')
}

/**
 * Declared vector bytes for one retrieval option. Lexical stores none; the
 * derived options store the listed representation, which is why a footprint
 * report must count them separately.
 * @param {string} id - option id from {@link RETRIEVAL_OPTIONS}.
 * @returns {{id: string, status: string, vectorBytes: number}} the option row.
 */
export function retrievalOption(id) {
  const row = RETRIEVAL_OPTIONS.find(option => option.id === id)
  return row === undefined
    ? { id, status: 'unknown', vectorBytes: 0 }
    : { id: row.id, status: row.status, vectorBytes: 0 }
}

/**
 * Named refusals this module can raise through the plugin's tool errors.
 * @param {string} id - requested retrieval option id.
 * @returns {string} the refusal message naming the inventory.
 */
export function retrievalOptionRefusal(id) {
  return `retrieval option ${JSON.stringify(id)} is not implemented; the migration inventory is `
    + RETRIEVAL_OPTIONS.map(option => `${option.id}=${option.status}`).join(', ')
}
