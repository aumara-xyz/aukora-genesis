/**
 * THE DETERMINISTIC HARNESS AROUND A MODEL'S EXTRACTION. (Design §3.5, `memory-design-2026-09-26.md`.)
 *
 * WHY THIS FILE EXISTS. §3.5 lets a model propose at most twelve items per run, and then applies rules that do not
 * involve the model at all. That division is the whole safety argument: the model is good at reading a conversation and
 * bad at being trusted, so everything that decides whether a proposal becomes MEMORY is deterministic, reviewable, and
 * refuses rather than guesses. A statement the model invented, a quote that does not appear in what the owner actually
 * said, a quote that quietly drops the "not" from a sentence — each is dropped here, by a rule a person can read.
 *
 * THE FOUR-CONDITION QUOTE CHECK IS THE CENTRE OF IT (§3.5 rule 1): the quote must appear verbatim (whitespace
 * normalized) in an OWNER turn; it must be at least five words; it must share at least one content word with the
 * statement it is offered as evidence for; and the full owner sentence around it must contain no negation word the
 * quote leaves out. All four are required. The explicit "remember" path is exempt because it stores the span itself.
 *
 * WHAT IT DOES NOT DO: no model call, no clock, no store, no I/O. It takes the items, the turns they cite, and what the
 * store already holds, and returns what may be kept, what was dropped AND WHY, and the links the surviving items carry.
 *
 * @module @aukora/dsh-plugin-kira/memory-harness
 */
import { sha256Hex } from './memory-tiers.mjs'
import { carriesForbiddenPhrase } from './compaction-export.mjs'

/** The most items one extraction run may contribute (§3.5: "Output: at most 12 items"). */
export const MAX_ITEMS_PER_RUN = 12

/** A quote must be at least this many words (§3.5 rule 1). */
export const MIN_QUOTE_WORDS = 5

/** Channels whose text is the owner's own, and therefore quotable (§3.5 rule 2). */
export const OWNER_CHANNELS = Object.freeze(['owner', 'owner-voice'])

/** How §3.5 rule 5 treats a note the owner Kept or that recall has used this many times or more. */
export const POSSIBLE_CHANGE_RECALLS = 3

/** Words that carry no topical weight, used only for the "shares a content word" condition. */
const STOP_WORDS = new Set(['a', 'an', 'and', 'are', 'as', 'at', 'be', 'but', 'by', 'do', 'does', 'for', 'from', 'had', 'has', 'have', 'he', 'her', 'his', 'i', 'if', 'in', 'is', 'it', 'its', 'me', 'my', 'no', 'not', 'of', 'on', 'or', 'our', 'she', 'so', 'than', 'that', 'the', 'their', 'them', 'then', 'there', 'these', 'they', 'this', 'to', 'was', 'we', 'were', 'what', 'when', 'which', 'who', 'will', 'with', 'you', 'your'])

/** Negations a quote may not silently drop (§3.5 rule 1: "not", "don't", "never" and similar). */
const NEGATIONS = /\b(?:not|no|never|none|nothing|nobody|nowhere|neither|nor|don'?t|doesn'?t|didn'?t|won'?t|wouldn'?t|can'?t|cannot|isn'?t|aren'?t|wasn'?t|weren'?t|shouldn'?t|couldn'?t|mustn'?t|without|except|unless)\b/giu

/** Whitespace-normalized, lowercased, punctuation-stripped — the form both sides of the quote check are compared in. */
export function normalize(text) {
  return String(text ?? '').replace(/\s+/gu, ' ').trim()
}

/** The words of a string, lowercased, punctuation stripped. */
export function words(text) {
  return normalize(text).toLowerCase().replace(/[^\p{L}\p{N}\s']/gu, ' ').split(/\s+/u).filter(Boolean)
}

/** The content words: what is left when the stop words go. */
export function contentWords(text) {
  return words(text).filter(word => !STOP_WORDS.has(word) && word.length > 1)
}

/** The negations a string carries. */
export function negationsOf(text) {
  return new Set((normalize(text).toLowerCase().match(NEGATIONS) ?? []).map(one => one.replace(/’/gu, "'")))
}

/** Whether a canonical `YYYY-MM-DD` date appears verbatim in a string (§3.5 rule 7: the parser must FIND it). */
export function dateAppearsIn(text, isoDate) {
  if (typeof isoDate !== 'string' || !/^\d{4}-\d{2}-\d{2}$/u.test(isoDate)) return false
  return normalize(text).includes(isoDate)
}

/**
 * The four conditions of §3.5 rule 1, as one function so a court can drive each of them.
 * @param {{statement: string, quote: {turn: number, text: string}, explicit?: boolean, verbatim?: boolean}} item
 * @param {ReadonlyArray<{turn: number, channel: string, text: string}>} turns
 * @returns {{ok: true} | {ok: false, rule: string, why: string}}
 */
export function quoteCheck(item, turns) {
  const quote = item?.quote
  if (quote === null || typeof quote !== 'object' || typeof quote.text !== 'string') {
    return { ok: false, rule: 'quote-missing', why: 'the item cites no quote, so there is nothing to check it against' }
  }
  if (item.explicit === true) return { ok: true }  // the explicit "remember" path stores the span itself

  const cited = turns.find(one => one.turn === quote.turn)
  if (cited === undefined) return { ok: false, rule: 'quote-turn-unknown', why: `the item cites turn ${String(quote.turn)}, which is not among the turns supplied` }
  if (!OWNER_CHANNELS.includes(cited.channel) && !(cited.channel === 'agent' && item.attributedTo === 'agent' && item.verbatim === true)) {
    return { ok: false, rule: 'quote-not-owner', why: `the cited turn's channel is ${JSON.stringify(cited.channel)}, and only the owner's own words are quotable` }
  }
  // A VERBATIM ITEM IS THE OWNER'S OWN TURN (the whole-turn note, `memory-capture.mjs`). The paraphrase rules below — five words,
  // a shared content word, no dropped negation — guard a SUMMARY against misquoting; a verbatim item is not a summary, so the one
  // rule that matters is that its statement really is in his turn.
  if (item.verbatim === true) {
    const said = normalize(cited.text).toLowerCase()
    const statement = normalize(item.statement).toLowerCase()
    if (statement === '' || !said.includes(statement)) {
      return { ok: false, rule: 'verbatim-not-in-turn', why: 'the item claims to be the owner\'s own words and they do not appear in his turn' }
    }
    return { ok: true }
  }

  const quoteText = normalize(quote.text)
  const ownerText = normalize(cited.text)
  if (quoteText === '' || !ownerText.toLowerCase().includes(quoteText.toLowerCase())) {
    return { ok: false, rule: 'quote-not-verbatim', why: 'the quote does not appear in the owner\'s turn, so the model supplied words the owner did not say' }
  }
  if (words(quoteText).length < MIN_QUOTE_WORDS) {
    return { ok: false, rule: 'quote-too-short', why: `the quote is ${String(words(quoteText).length)} words, and four or fewer cannot carry a statement` }
  }
  const shared = contentWords(item.statement).filter(word => contentWords(quoteText).includes(word))
  if (shared.length === 0) {
    return { ok: false, rule: 'quote-unrelated', why: 'the quote shares no content word with the statement it is evidence for' }
  }
  // THE NEGATION CONDITION. The sentence around the quote must not carry a negation the quote leaves out: "I don't
  // want mornings short" quoted as "want mornings short" is the exact failure this refuses.
  const sentence = ownerText.split(/(?<=[.!?])\s+/u).find(one => one.toLowerCase().includes(quoteText.toLowerCase())) ?? ownerText
  const dropped = [...negationsOf(sentence)].filter(one => !negationsOf(quoteText).has(one))
  if (dropped.length > 0) {
    return { ok: false, rule: 'quote-drops-negation', why: `the owner's sentence carries ${dropped.join(', ')} and the quote leaves it out, which reverses what was said` }
  }
  return { ok: true }
}

/**
 * Apply §3.5's rules to one extraction run.
 *
 * @param {{items: ReadonlyArray<Record<string, unknown>>, turns: ReadonlyArray<{turn: number, channel: string, text: string}>, observationDate: string, known?: Readonly<Record<string, {kept?: boolean, recalls?: number, tier?: string}>>}} input
 * @param {{forbidden?: ReadonlyArray<string>, secretPatterns?: ReadonlyArray<RegExp>}} [policy]
 * @returns {{accepted: ReadonlyArray<Record<string, unknown>>, dropped: ReadonlyArray<{statement: string, rule: string, why: string}>, usage: ReadonlyArray<string>}}
 */
export function applyHarness(input, policy = {}) {
  const { items = [], turns = [], observationDate, known = {} } = input ?? {}
  // Preserve the legacy plaintext API, but a digest is never a plaintext phrase.
  const forbidden = (policy.forbidden ?? []).filter(value => !/^[0-9a-f]{64}$/iu.test(value))
  const digests = [...(policy.forbiddenDigests ?? []), ...(policy.forbidden ?? []).filter(value => /^[0-9a-f]{64}$/iu.test(value))].map(value => value.toLowerCase())
  const sensitivePatterns = policy.secretPatterns ?? []
  const accepted = []
  const dropped = []
  let usage = []

  for (const item of items) {
    const statement = normalize(item?.statement)
    const drop = (rule, why) => dropped.push({ statement, rule, why })
    if (statement === '') { drop('statement-empty', 'an item with no statement is not a memory'); continue }

    const check = quoteCheck({ statement, quote: item.quote, explicit: item.explicit === true, verbatim: item.verbatim === true, attributedTo: item.attributedTo }, turns)
    if (check.ok !== true) { drop(check.rule, check.why); continue }

    // §3.5 rule 3: filters. A secret or a forbidden phrase is dropped whether or not the quote checked out.
    const haystack = `${statement} ${normalize(item?.quote?.text)}`
    const sensitive = sensitivePatterns.find(pattern => { pattern.lastIndex = 0; return pattern.test(haystack) })
    if (sensitive !== undefined) { drop('filter-secret', `the text matches a secret pattern (${String(sensitive)})`); continue }
    const banned = forbidden.find(phrase => haystack.toLowerCase().includes(normalize(phrase).toLowerCase()))
    if (banned !== undefined) { drop('filter-forbidden', `the text contains the forbidden phrase ${JSON.stringify(banned)}`); continue }
    if (digests.length && carriesForbiddenPhrase(haystack, digests)) { drop('filter-forbidden', 'the text matches a forbidden window digest'); continue }

    // §3.5 rule 7: TIME. validFrom is the observation date unless a deterministic parser FINDS the model's date in the
    // quote itself; otherwise the model's date is thrown away. There is no trust in a model-supplied date.
    const quotedDate = item?.date_in_quote
    const validFrom = dateAppearsIn(item?.quote?.text ?? '', quotedDate) ? quotedDate : observationDate

    const relation = item?.relation ?? { op: 'add' }
    const op = String(relation.op ?? 'add')
    const target = Number.isInteger(relation.n) ? String(relation.n) : null

    // §3.5 rules 4-6: dedupe, supersede/possible-change against Remembered, conflicts-with against Signed.
    if (op === 'same' && target !== null) { usage = [...new Set([...usage, target])]; continue }
    const fingerprint = sha256Hex(statement.toLowerCase())
    if (accepted.some(one => one.fingerprint === fingerprint) || usage.includes(`statement:${fingerprint}`)) {
      usage = [...new Set([...usage, `statement:${fingerprint}`])]
      continue
    }

    const links = []
    if ((op === 'update' || op === 'contradicts') && target !== null) {
      const prior = known[target]
      if (prior === undefined) {
        if (prior === undefined) drop('relation-unknown-target', `the item relates to ${target}, which the store does not hold`)
        continue
      }
      else if (prior.tier === 'signed') links.push({ relation: 'conflicts-with', id: target })
      else if (prior.kept === true || (prior.recalls ?? 0) >= POSSIBLE_CHANGE_RECALLS) links.push({ relation: 'possible-change', id: target })
      else links.push({ relation: 'supersedes', id: target })
    }

    accepted.push(Object.freeze({
      fingerprint, category: item.category, statement, quote: Object.freeze({ turn: item.quote.turn, text: normalize(item.quote.text) }),
      validFrom, confidence: typeof item.confidence === 'number' ? item.confidence : null,
      sensitivity: item.sensitivity ?? 'none', relation: op, links: Object.freeze(links),
      possibleChange: item.possibleChange === true,
    }))
    if (accepted.length === MAX_ITEMS_PER_RUN) break
  }

  return { accepted: Object.freeze(accepted), dropped: Object.freeze(dropped), usage: Object.freeze(usage) }
}

/**
 * The attribution a surviving item carries, from the quote's channel (§3.5 rule 2).
 * @param {{quote: {turn: number}}} item @param {ReadonlyArray<{turn: number, channel: string}>} turns @returns {string}
 */
export function attributionOf(item, turns) {
  const cited = turns.find(one => one.turn === item?.quote?.turn)
  if (cited === undefined) return 'unknown'
  return OWNER_CHANNELS.includes(cited.channel) ? cited.channel : 'unknown'
}
