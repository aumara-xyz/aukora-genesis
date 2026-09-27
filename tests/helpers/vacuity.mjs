/**
 * THE VACUITY GUARD: a negative assertion is only meaningful if the scan SAW something.
 *
 * Peter's rule, from the Guardian patent-survey primer: **every negative arm needs a vacuity guard — assert the scan
 * saw SOMETHING before concluding it saw nothing, and assert the mutation MATCHED a line.** The model is the secrecy
 * court's argv scan, which checks the child's arguments WHILE THE CHILD IS ALIVE rather than reading an empty list
 * afterwards and declaring it clean.
 *
 * WHY IT IS A SHARED MODULE. `assert.doesNotMatch(text, /x/)` and `assert.ok(!text.includes('x'))` pass on an EMPTY
 * string — so an arm whose subject moved, was renamed, or came back empty reports "no leak", "not rendered", "no
 * second surface" while having looked at nothing at all. That is the same shape as a guard over an empty set, and it
 * is worse than a missing arm because it reports success.
 *
 * WHAT IT DOES NOT DO. It does not decide whether the negative claim is right, and it is not a substitute for a
 * positive control: it asserts only that the subject EXISTS and, when a marker is given, that the scan is looking at
 * the text it thinks it is. A caller that passes a marker is asserting "this is the file I mean", which is the
 * cheapest way to catch a scan that silently followed a rename.
 */

/**
 * Assert a scan saw something, then return it unchanged so a call can wrap its subject in place.
 *
 * @param {unknown} text - the text a negative assertion is about to be made over.
 * @param {string} what - what the text is, for the failure message (e.g. "the Chinese dictionary").
 * @param {string} [marker] - a string the text MUST contain, when the caller knows one; this catches a scan looking
 *   at the wrong text rather than at nothing.
 * @returns {string} the same text, so `const zh = sawSomething(slice(locales), 'the Chinese dictionary', 'export const zh')`.
 */
export function sawSomething(text, what, marker) {
  if (typeof text !== 'string' || text.trim() === '') {
    throw new Error(`vacuity: ${what} is EMPTY, so a negative assertion about it would pass on nothing at all`)
  }
  if (marker !== undefined && !text.includes(marker)) {
    throw new Error(`vacuity: ${what} does not contain ${JSON.stringify(marker)}, so the scan is not looking at the text it means to`)
  }
  return text
}

/**
 * The same guard for a LIST — a leak sweep over zero files, or a rendered set with nothing in it.
 *
 * @param {unknown} list - the array a negative assertion is about to be made over.
 * @param {string} what - what the list is, for the failure message.
 * @returns {unknown[]} the same list.
 */
export function sawSome(list, what) {
  if (!Array.isArray(list) || list.length === 0) {
    throw new Error(`vacuity: ${what} is EMPTY, so "none of them" would be true of nothing at all`)
  }
  return list
}
