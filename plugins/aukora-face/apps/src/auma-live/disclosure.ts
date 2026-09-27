// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * **WHAT LEAVES THIS MACHINE IS A TYPED EFFECT, AND IT PASSES THROUGH ONE CHECKPOINT.**
 *
 * Before this file, Auma Live sent each turn — with her spoken history and whatever screen, repository or organism context
 * had been attached — to a provider with **no grant**, bounded only by a daily cost cap, and logged the full request bodies
 * under `auma-live/` outside KIRA's memory semantics. *That is review finding P0-F, and this is the smallest real answer
 * to it.*
 *
 * ## The shape, and why a CHECKPOINT rather than a rule spread through the sender
 *
 * **EVERY PROVIDER CALL CONSTRUCTS A `Disclosure` AND HANDS IT TO `admitDisclosure` BEFORE THE REQUEST EXISTS.** *One
 * function, one decision, one place to look.* **A rule copied into each call site is a rule that will be right in four
 * places and wrong in the fifth** — *and the fifth is the one that sends the screen.*
 *
 * ## Three properties, each of which is a way this could have been written and was not
 *
 * 1. **A DISCLOSURE OUTSIDE THE POLICY IS REFUSED BY NAME.** *Never dropped silently, never trimmed down to something
 *    admissible, never sent anyway.* **The refusal says WHICH CLASS and WHICH RECIPIENT**, *so the answer to "why did that
 *    not go?" is a sentence rather than an absence.*
 * 2. **THE POLICY IS THE OWNER'S FILE.** *This module cannot widen it.* *There is no function here that adds a class, no
 *    merge with a default, no environment override* — **and a court asserts that by mutation: the only way to allow
 *    `screen` is to edit the file he owns.**
 * 3. **AN UNKNOWN CLASS IS NOT AN ALLOWED ONE.** *`dataClass` is a closed union and the policy is read as data* — *so a
 *    class this build has never heard of, arriving from a newer face or a hand-edited policy, **refuses** rather than
 *    falling through a `switch`'s default arm into the permissive branch.*
 *
 * ## What is NOT here, stated so it is not assumed
 *
 * *This module does not send, does not log, and does not read the policy file.* **It decides.** *Reading the owner's file
 * and putting the checkpoint in front of the transport are the caller's, and `WHAT-LEAVES-THIS-MACHINE.md` names them by
 * file and line* — *because a gate nobody calls is the failure this repository keeps recording.*
 */

/** **THE CLOSED SET OF THINGS THAT CAN LEAVE.** *A class that is not in this union is not disclosed.* */
export type DataClass =
  /** What he said this turn. */
  | 'turn-text'
  /** Earlier turns, as she recalls them. */
  | 'history'
  /** Anything visible on his screen. */
  | 'screen'
  /** Files or excerpts from a repository. */
  | 'repo'
  /** The organism's own state document. */
  | 'organism-state'
  /** Records from her memory store. */
  | 'memory'

/** Every class, in one place, **so a policy can be checked for completeness rather than trusted.** */
export const DATA_CLASSES: readonly DataClass[] = Object.freeze([
  'turn-text', 'history', 'screen', 'repo', 'organism-state', 'memory',
])

/** How the bytes travel. *A closed set: a new transport is a decision, not a default.* */
export type Transport = 'https'

/**
 * **A DISCLOSURE, CONSTRUCTED BY THE CALL THAT IS ABOUT TO MAKE IT.**
 *
 * *Every field is required, and that is deliberate:* **a field with a default is a field the sender did not have to think
 * about** — *and the two a sender would most like to omit are `purpose` and `retention`, which are exactly the two a
 * reviewer needs.*
 */
export interface Disclosure {
  /** **WHO RECEIVES IT.** A hostname, not a URL: *the path is the endpoint's business, the host is the owner's.* */
  readonly recipient: string
  readonly dataClass: DataClass
  /** **WHY THIS TURN NEEDS IT**, in the caller's words. *Empty is refused: an unexplained disclosure is an unexamined one.* */
  readonly purpose: string
  /** **HOW MANY BYTES MAY LEAVE UNDER THIS CLASS.** *A ceiling the sender states, so a prompt that grows is visible.* */
  readonly maxScope: number
  /** **WHAT THE RECIPIENT IS EXPECTED TO DO WITH IT**, in the caller's words. */
  readonly retention: string
  readonly transport: Transport
}

/**
 * **THE OWNER'S FILE, PARSED — NOT THIS MODULE'S OPINION.**
 *
 * *Plain JSON, owner-editable, and read as data.* **The default policy this repository commits allows only `turn-text` and
 * `history`, to the configured provider; screen, repo and organism-state are OFF.** *The default lives in the file, which
 * is the point: widening is an edit he makes, not a build we ship.*
 */
export interface OwnerPolicy {
  /** **THE ONE HOST THE POLICY SPEAKS ABOUT.** *A disclosure to any other recipient is refused, whatever the class.* */
  readonly recipient: string
  /** **THE CLASSES HE HAS PRE-AUTHORISED**, so ordinary turns need no popup. */
  readonly allowed: readonly DataClass[]
}

/** The committed default, **as a value a court can compare against the shipped file.** */
export const DEFAULT_POLICY: OwnerPolicy = Object.freeze({
  recipient: 'openrouter.ai',
  allowed: Object.freeze(['turn-text', 'history'] as DataClass[]),
})

/** What the checkpoint decided. **A refusal carries the class and the recipient by name.** */
export type Admission =
  | { readonly allowed: true; readonly disclosure: Disclosure }
  | {
    readonly allowed: false
    readonly why: string
    /** *What she should say about it* — **a refusal the owner never hears is indistinguishable from a silent drop.** */
    readonly soSay: string
  }

/** **THE ONE SENTENCE A REFUSAL SAYS OUT LOUD**, so every refusal path sounds the same to him. */
export const REFUSED_SO_SAY = 'I can\'t send that.'

/**
 * **THE CHECKPOINT. EVERY PROVIDER CALL PASSES HERE BEFORE THE REQUEST EXISTS.**
 *
 * @param disclosure - what the caller is about to send.
 * @param policy - **the owner's policy, read from his file.** *Not merged with a default and not widened here.*
 * @returns whether it may go, **and on a refusal the class and recipient by name.**
 */
export function admitDisclosure(disclosure: Disclosure, policy: OwnerPolicy): Admission {
  // **A MALFORMED DISCLOSURE IS REFUSED, NOT REPAIRED.** *Every field is checked before the policy is consulted*, because
  // a `maxScope` of `NaN` or a missing `transport` would otherwise reach a comparison and pass it.
  if (disclosure === null || typeof disclosure !== 'object') {
    return refuse('the disclosure is not an object', 'malformed-disclosure')
  }
  if (!DATA_CLASSES.includes(disclosure.dataClass)) {
    // **THE DEFAULT ARM OF A `switch` IS THE USUAL HOME OF THIS BUG.** *An unrecognised class refuses here rather than
    // falling through*, which is the same rule the policy itself is read under.
    return refuse(`the data class ${JSON.stringify(disclosure.dataClass)} is not one this build discloses`, 'unknown-data-class')
  }
  if (typeof disclosure.recipient !== 'string' || disclosure.recipient === '') {
    return refuse('the disclosure names no recipient', 'no-recipient')
  }
  if (typeof disclosure.purpose !== 'string' || disclosure.purpose.trim() === '') {
    return refuse(`a ${disclosure.dataClass} disclosure was attempted with no purpose`, 'no-purpose')
  }
  if (typeof disclosure.retention !== 'string' || disclosure.retention.trim() === '') {
    return refuse(`a ${disclosure.dataClass} disclosure was attempted with no retention expectation`, 'no-retention')
  }
  if (disclosure.transport !== 'https') {
    return refuse(`the transport ${JSON.stringify(disclosure.transport)} is not one this build uses`, 'bad-transport')
  }
  if (typeof disclosure.maxScope !== 'number' || !Number.isFinite(disclosure.maxScope) || disclosure.maxScope <= 0) {
    // **THE SCOPE IS A CEILING, SO A NON-POSITIVE ONE IS NOT "NO LIMIT".** *It is a field the sender did not fill in* —
    // *and treating `0` as unlimited is the fail-open shape this repository has a skill about.*
    return refuse(`the ${disclosure.dataClass} disclosure states no positive byte scope`, 'no-scope')
  }

  // **THE POLICY IS CONSULTED ONLY AFTER THE SHAPE IS SOUND**, *so a malformed disclosure cannot be excused by a policy
  // that happens to allow its class.*
  const policyRecipient = typeof policy?.recipient === 'string' ? policy.recipient : ''
  const allowed = Array.isArray(policy?.allowed) ? policy.allowed : []
  if (policyRecipient === '' || allowed.length === 0) {
    return refuse('no owner policy is loaded, so nothing is pre-authorised', 'no-policy')
  }
  if (disclosure.recipient !== policyRecipient) {
    // **A DIFFERENT RECIPIENT IS A DIFFERENT DISCLOSURE, WHATEVER THE CLASS.** *The policy pre-authorises classes TO ONE
    // PLACE; sending turn-text somewhere else is not "allowed because turn-text is allowed".*
    return refuse(
      `the ${disclosure.dataClass} disclosure is addressed to ${disclosure.recipient}, and the owner's policy names ${policyRecipient}`,
      'recipient-not-in-policy',
    )
  }
  if (!allowed.includes(disclosure.dataClass)) {
    // **THE REFUSAL THE OBJECTIVE ASKS FOR BY NAME.** *The class is off; it is not trimmed, not summarised, and not sent
    // with the class label changed.*
    return refuse(
      `${disclosure.dataClass} is not pre-authorised for ${disclosure.recipient}; the owner's policy allows ${allowed.join(', ')}`,
      'class-not-in-policy',
    )
  }

  return { allowed: true, disclosure }
}

/** **THE ONE PLACE A REFUSAL IS BUILT**, *so every path carries a machine name and a human sentence.* */
function refuse(why: string, code: string): Admission {
  return { allowed: false, why: `${code}: ${why}`, soSay: REFUSED_SO_SAY }
}

/**
 * **READ THE OWNER'S POLICY FILE. UNREADABLE OR MALFORMED MEANS NOTHING IS AUTHORISED.**
 *
 * *A policy that cannot be read is not an empty policy and it is not the default policy* — **it is a state in which this
 * process does not know what the owner permits, and the only safe reading of that is "send nothing".** *Returning
 * {@link DEFAULT_POLICY} here would be the fail-open pin: a deleted file would silently restore classes he may have removed.*
 *
 * @param raw - the file's bytes, or `undefined` when it is not there.
 */
export function readOwnerPolicy(raw: string | undefined): OwnerPolicy {
  const empty: OwnerPolicy = { recipient: '', allowed: Object.freeze([] as DataClass[]) }
  if (raw === undefined || raw.trim() === '') return empty
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    return empty
  }
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) return empty
  const document = parsed as Record<string, unknown>
  const recipient = typeof document.recipient === 'string' ? document.recipient : ''
  // **AN UNKNOWN CLASS IN THE FILE IS DROPPED, NOT CARRIED.** *The file is owner-editable, so it can contain anything* —
  // *and a class this build does not know must not become one it does.* **Dropping is the safe direction here** *because
  // the surviving list is still a list of authorisations; adding would not be.*
  const allowed = Array.isArray(document.allowed)
    ? document.allowed.filter((one): one is DataClass => DATA_CLASSES.includes(one as DataClass))
    : []
  return { recipient, allowed: Object.freeze(allowed) }
}

/** What a disclosure's byte cost is, **measured from the text rather than estimated**, so the ceiling means something. */
export function bytesOf(text: string): number {
  return typeof text === 'string' ? new TextEncoder().encode(text).length : 0
}
