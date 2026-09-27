/**
 * The subject grammar, READABLE. `aukora:1:<64 hex>` in, a verdict out.
 *
 * WHY THIS FILE EXISTS, AND IT IS NOT A REFACTOR. This lane has always PRODUCED the subject —
 * `owner-record.mjs` `ownerRecordSubject()` emits `aukora:1:<rootId>` and its own comment calls
 * that "the grammar the Kira overlay pins" — but nothing here ever READ one back. The cost was
 * paid in a release: the composition shipped `memoryOwner.subject = aumlok:subject:owner`, a
 * value outside the grammar, and because no reader existed the mismatch surfaced only later, as
 * a memory that could be staged and never minted, with recall empty for the honest reason that
 * nothing had been written. A producer with no reader is a contract with one end.
 *
 * WHAT THIS IS NOT. It does not authorize anything, it is not a grant, and it does not decide
 * whether a subject EXISTS — only whether its SPELLING is the one both lanes agreed on. A caller
 * that needs identity must still resolve the root; this says the sentence is grammatical, never
 * that the thing it names is real.
 *
 * THE VOCABULARY IS CLOSED AND EVERY REFUSAL IS NAMED, because the whole defect was a value that
 * failed silently at a distance. A caller must be able to print WHY a subject was rejected.
 *
 * @module plugins/aukora-aumlok/lib/subject
 */
import { AUKORA_ID_PREFIX } from './genesis.mjs'

/** Lowercase 64-hex, the one spelling of a root id. `/u` because this is deliberately strict. */
const LOWER_HEX_64 = /^[0-9a-f]{64}$/u

/** Every way a subject can fail to be a subject. Closed, and each one says what it saw. */
export const SUBJECT_REFUSE = Object.freeze({
  NOT_A_STRING: 'aumlok:subject-not-a-string',
  MISSING_PREFIX: 'aumlok:subject-missing-prefix',
  ROOT_NOT_HEX64: 'aumlok:subject-root-not-hex64',
})

/**
 * Read one subject.
 *
 * @param {unknown} value - the candidate, of any type: callers are configuration files.
 * @returns {{ok: true, subject: string, rootId: string} | {ok: false, reason: string, detail: string}} -
 *   the parsed subject, or a NAMED refusal. Never throws: a bad subject in a configuration file is
 *   a value to report, not an exception to catch somewhere else.
 */
export function parseSubject(value) {
  if (typeof value !== 'string') {
    return { ok: false, reason: SUBJECT_REFUSE.NOT_A_STRING, detail: `a subject is a string, got ${typeof value}` }
  }
  if (!value.startsWith(AUKORA_ID_PREFIX)) {
    return {
      ok: false,
      reason: SUBJECT_REFUSE.MISSING_PREFIX,
      detail: `a subject begins with ${AUKORA_ID_PREFIX}, got ${JSON.stringify(value.slice(0, 32))}`,
    }
  }
  const rootId = value.slice(AUKORA_ID_PREFIX.length)
  if (!LOWER_HEX_64.test(rootId)) {
    return {
      ok: false,
      reason: SUBJECT_REFUSE.ROOT_NOT_HEX64,
      detail: `the root id is 64 lowercase hex characters, got ${rootId.length} character(s) `
        + `${JSON.stringify(rootId.slice(0, 16))}${rootId.length > 16 ? '…' : ''}`,
    }
  }
  return { ok: true, subject: value, rootId }
}

/**
 * Whether one subject is readable. The predicate form, for callers that only need the boolean and
 * would otherwise write `parseSubject(x).ok` and lose the reason.
 *
 * @param {unknown} value - the candidate subject.
 * @returns {boolean} true only for a grammatical subject.
 */
export function isSubject(value) {
  return parseSubject(value).ok === true
}
