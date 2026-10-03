/** One deterministic floor for vector indexing. No model or clock.
 * Short facts and corrections survive; byte length alone says nothing about quality.
 * Existing objects/chains are never edited when a record falls below this floor. */
import { sha256Hex } from './memory-tiers.mjs'

export const QUALITY_VERSION = 'kira-quality/v1'
// Tune semantic eligibility here, not independently in either store. Length is
// necessary, never sufficient. These are UTF-8 bytes and Unicode word tokens.
export const QUALITY_FLOOR = Object.freeze({ minBytes: 12, minWords: 2 })
export const contentHash = text => sha256Hex(String(text))
// Instruction-shaped turns are orders to whoever reads them, not claims about the world. Recalled
// beside a later question they act as a prompt injection, so they never enter the vector index;
// the chain keeps them and exact-word recall still finds them. A short turn that opens by dictating
// the exact reply (a colon, a quote or "the … characters/word" after exactly/only/verbatim) is one; a turn of any length that tells the reader to drop its instructions is one.
const DICTATED_REPLY = [
  /^(?:(?:please|now|just|ok(?:ay)?|so)[\s,]+)*(?:reply|respond|answer|say|output|print|return|write|type|repeat|echo)\b(?:[\s:,]+[^\s:,]+){0,8}?[\s:,]+(?:(?:exactly|only|verbatim)\s*(?::|["“'‘]|the\s+(?:[^\s]+\s+){0,2}(?:words?|letters?|characters?|numbers?|strings?|tokens?|phrases?)\b)|nothing\s+(?:but|else|more)\s*:?\s*["“'‘])/iu,
  /^(?:(?:please|now|just)[\s,]+)*(?:reply|respond|answer)\s+(?:with|using)\s+(?:a\s+single|one|the\s+(?:single\s+)?(?:word|letter|number|character|string|token))\b/iu,
  /^(?:(?:please|now|just)[\s,]+)*repeat\s+after\s+me\b/iu,
  /^(?:you\s+are\s+now|pretend\s+(?:to\s+be|you\s+are))\b/iu,
]
const OVERRIDE = /\b(?:ignore|disregard|forget|override)\s+(?:(?:all|any|every|your|the|of)\s+)*(?:previous|prior|above|earlier|preceding|system|original)\s+(?:instructions?|prompts?|messages?|rules?|directions?)\b/iu
export const DICTATED_REPLY_MAX_WORDS = 40
export const CLAIMLESS_MAX_BYTES = 60
export const instructionShaped = (normalized, words) => OVERRIDE.test(normalized)
  || (words.length <= DICTATED_REPLY_MAX_WORDS && DICTATED_REPLY.some(pattern => pattern.test(normalized)))

export function memoryQuality(text) {
  const normalized = typeof text === 'string' ? text.normalize('NFKC').replace(/^From: [^\n]+\nWhen: [^\n]+\n\n/u, '').trim() : ''
  let reason = null
  const words = normalized.match(/[\p{L}\p{N}]+(?:['’][\p{L}]+)?/gu) ?? []
  const assertion = /\b(?:am|is|are|was|were|have|has|had|want|wants|prefer|prefers|need|needs|must|should|shall|will|won't|cannot|can't|decided|agreed|preserve|requires?|uses?|lives?|means|contains?|works?|failed|succeeded|stands?|finished)\b/iu.test(normalized)
  const entity = (normalized !== normalized.toUpperCase() && /\b[A-Z][A-Z0-9_-]{1,}\b/u.test(normalized))
    || words.some(word => /^\p{Lu}\p{Ll}{2,}/u.test(word)
      && !/^(?:I|The|This|That|It|We|You|My|Our|Your|Please|Thanks|Yes|Okay|Stay|Keep|Continue|Go|Do|What|How|When|Where|Why|Can|Could|Would|Should|Just|Now|All|And|But|From|When)$/u.test(word))
    || /(?:https?:\/\/\S+|\b[\w-]+\.(?:mjs|js|py|json|md)\b|["“][^"”]{2,80}["”])/u.test(normalized)
  // A standing rule ("never …", "only …", "no tests") is a claim about how to work, even without a verb above.
  const directive = /\b(?:never|always|only|exactly|don['’]?t|not|no|stop|must)\b/iu.test(normalized)
  if (!normalized) reason = 'empty'
  else if (!/[\p{L}\p{N}]/u.test(normalized)) reason = 'no-content'
  else if (!/\s/u.test(normalized) || words.length < QUALITY_FLOOR.minWords || Buffer.byteLength(normalized, 'utf8') < QUALITY_FLOOR.minBytes) reason = 'too-short'
  else if (/^(?:(?:ok(?:ay)?|yes|yeah|yep|yup|sure|thanks?|thank you|got it|understood|cool|great|awesome|done|continue|go ahead|please continue|stay vigilant|keep going|carry on)[\s,.!;:\-]*)+$/iu.test(normalized)) reason = 'acknowledgement'
  else if (/^(?:([\p{L}\p{N}])\1{7,})$/iu.test(normalized)) reason = 'repeated-character'
  else if (instructionShaped(normalized, words)) reason = 'instruction'
  // Only SHORT turns can be judged claimless: a long note without these verbs is still a real note.
  else if (!assertion && !entity && !directive && Buffer.byteLength(normalized, 'utf8') <= CLAIMLESS_MAX_BYTES) reason = 'no-assertion-or-entity'
  return Object.freeze({ keep: reason === null, reason, version: QUALITY_VERSION })
}

/** Callers with legacy envelopes must verify that envelope first, then supply its
 * independently verified hash explicitly. Never silently manufacture a commitment. */
export function verifyContentHash(text, expected) {
  if (typeof expected !== 'string' || !/^[0-9a-f]{64}$/u.test(expected)) return { ok: false, reason: 'content-hash-missing' }
  if (typeof text !== 'string' || contentHash(text) !== expected) return { ok: false, reason: 'content-hash-mismatch' }
  return { ok: true, contentHash: expected }
}
