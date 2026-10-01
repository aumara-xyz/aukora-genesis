// SPDX-License-Identifier: AGPL-3.0-or-later
import { readFileSync } from 'node:fs'
/** Release-shipped disclosure policy. No environment or owner-file override is accepted. */

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
  | 'web'
  | 'identity'
  /** The organism's own state document. */
  | 'organism-state'
  /** Records from her memory store. */
  | 'memory'

/** Every class, in one place, **so a policy can be checked for completeness rather than trusted.** */
export const DATA_CLASSES: readonly DataClass[] = Object.freeze([
  'turn-text', 'history', 'screen', 'repo', 'web', 'identity', 'organism-state', 'memory',
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
 * Release policy, parsed as data. The shipped default permits only turn-text and history to openrouter.ai;
 * providerSendConsent must independently be true before any presence request leaves. Widening requires a release change.
 */
export interface OwnerPolicy {
  /** **THE ONE HOST THE POLICY SPEAKS ABOUT.** *A disclosure to any other recipient is refused, whatever the class.* */
  readonly recipient: string
  /** **THE CLASSES HE HAS PRE-AUTHORISED**, so ordinary turns need no popup. */
  readonly allowed: readonly DataClass[]
}

/** Read-only setup facts, never an admission or configuration write. */
export function providerSetupOf(consent: unknown, policy?: OwnerPolicy) {
  const recipient = typeof policy?.recipient === 'string' && policy.recipient.length <= 253
    && /^[a-z0-9][a-z0-9.-]*$/iu.test(policy.recipient) ? policy.recipient : null
  const classes = policy?.allowed
  const allowed = recipient !== null && Array.isArray(classes)
    ? DATA_CLASSES.filter(value => classes.includes(value)) : []
  return {
    consentEnabled: consent === true,
    recipient,
    allowed,
    // Exact pinned SDK startup refusals, independent of CLI PATH presence.
    nativeSdkProviders: [
      { id: 'codex', available: false, reason: 'AUKORA_NATIVE_CONFINEMENT_UNWIRED: subagent-codex child startup refused until its SDK launch closure enforces native confinement' },
      { id: 'claude-code', available: false, reason: 'AUKORA_NATIVE_CONFINEMENT_UNWIRED: subagent-claude-code child startup refused until its SDK launch closure enforces native confinement' },
    ],
  }
}

/** The intended release default, for comparison only; NEVER an unreadable-file fallback. */
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
 * @param policy - **the release policy, read from its shipped file.** *Not merged with a default and not widened here.*
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
 * **PARSE THE RELEASE POLICY FILE. UNREADABLE OR MALFORMED MEANS NOTHING IS AUTHORISED.**
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
  // An invalid entry invalidates the whole file; never salvage authorisations from a malformed release policy.
  if (recipient === '' || recipient.trim() !== recipient || !Array.isArray(document.allowed)
    || !document.allowed.every(one => DATA_CLASSES.includes(one as DataClass))) return empty
  return { recipient, allowed: Object.freeze([...document.allowed] as DataClass[]) }
}

/** Where the owner's policy bytes came from, and the bytes (`undefined` = unreadable = nothing authorised). */
export interface PolicyText {
  /** The file's text, or `undefined` when no candidate could be read. */
  readonly text: string | undefined
  /** The path that decided the answer, or `''` when none did. Named so a log line can say which file spoke. */
  readonly source: string
  /** Why `text` is `undefined`, when it is. */
  readonly problem?: string
}

/** Read only the release-shipped file. Missing/unreadable bytes authorise nothing; no fallback or override. */
export function readOwnerPolicyText(options: {
  readonly release: string
  readonly read?: (path: string) => string
}): PolicyText {
  const read = options.read ?? ((file: string) => readFileSync(file, 'utf8'))
  try {
    return { text: read(options.release), source: options.release }
  } catch (error: unknown) {
    // Details are for the local log, never for spoken output.
    return { text: undefined, source: options.release, problem: String((error as { message?: unknown })?.message ?? error) }
  }
}

/** What a disclosure's byte cost is, **measured from the text rather than estimated**, so the ceiling means something. */
export function bytesOf(text: string): number {
  return typeof text === 'string' ? new TextEncoder().encode(text).length : 0
}
