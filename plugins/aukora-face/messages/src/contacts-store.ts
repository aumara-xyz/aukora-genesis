/**
 * The reader behind the Messages face: this node's contacts, each in ONE of four states.
 *
 * WHAT THIS MODULE MAY DO. It READS TWO THINGS — `<stateDir>/nostr/contacts.json` into a
 * string, and the Aumlok controller record that `resolveContact` consults — and that is the
 * whole of its reach. There is no writer in this file: no `writeFile`, `mkdir`, `rm`,
 * `rename` or `copyFile`, and no request reaches it that could ask for one. Every call
 * re-reads the file, so a listing cannot outlive the contacts it describes.
 *
 * IT IS TOLD WHICH TWO THINGS TO READ, AND FINDS NEITHER FOR ITSELF. The state directory is the
 * harness home the process was started with; the controller record directory is the mounted
 * `aumlokControl` service's own `directory`, read by the host half out of the context and passed in as
 * {@link messagesContactsRoots}'s argument. This module reads no environment name for the controller
 * and composes no default path for it: a directory this file invented would be a guess, and a guess
 * that lands on nothing is what made a performed enrolment read as a missing record on a live machine.
 *
 * THE FOUR STATES ARE THE POINT, AND THE SAS IS THE REASON THEY EXIST.
 * `plugins/aukora-nostr/lib/contact.mjs` is the source of truth and this module does not
 * re-implement a line of it:
 *
 *   VERIFIED  a binding verifies and is not TEST-labelled: the controller key vouched for
 *             this npub and subject, and we accept that controller.
 *   TEST      a binding verifies and IS TEST-labelled. The claim is structurally sound and
 *             means nothing yet, because the only controller record on this machine is
 *             disposable until the owner enrols.
 *   UNBOUND   we hold an npub and no binding at all. We can exchange encrypted bytes; we
 *             cannot say who is on the other end.
 *   FOREIGN   a binding was presented and does NOT verify for this contact — a bad
 *             signature, a wrong domain, a different npub, a different subject. This is the
 *             adversarial state and stays distinct from UNBOUND, because "nobody vouched"
 *             and "somebody vouched for something else" are different facts.
 *
 * A SAS IS RETURNED ONLY WHEN A BINDING VERIFIED. UNBOUND and FOREIGN contacts carry
 * `sas: null` — never a placeholder, never a zero, never an empty string. That is the single
 * most important property in this file: showing a string for an unproven contact invites two
 * people to read it to each other and come away believing they confirmed an identity that
 * was never proven, which is worse than showing nothing. `resolveContact` refuses to
 * synthesise one, this module copies what it returned rather than deriving its own, and the
 * court asserts the null for both states explicitly.
 *
 * WHAT IS RETURNED IS OWNED, SMALL, AND LOSSLESS JSON. One object per contact, carrying
 * seven leaf fields and nothing else — never `resolveContact`'s `verdict`, never the binding
 * document, never a Buffer or a live object, never the controller key. The controller key
 * matters in particular: it is the SAS preimage, and the SAS is the one form of it a person
 * is meant to compare out loud.
 *
 * REFUSALS ARE NAMED AND DISTINCT, one name per condition and never one generic failure,
 * because "you have no contacts file yet" and "your contacts file is not the document this
 * face reads" call for different actions from whoever reads the answer:
 *
 *   messages:contacts-state-missing     no `<stateDir>/nostr/contacts.json` on disk.
 *   messages:contacts-unparseable       the file is there and is not JSON.
 *   messages:contacts-domain-unknown    JSON, but its `domain` is not the v1 domain.
 *   messages:contact-malformed          the document is the right shape, and one entry in
 *                                       it is not: no npub, no name, or a binding that is
 *                                       neither absent nor a binding document.
 *   messages:no-controller-record       no Aumlok controller record to verify against, so
 *                                       NOTHING in this list can be resolved at all.
 *   messages:aumlok-not-linked          this install has not linked an Aumlok phrase yet: the
 *                                       composition names no controller directory. A state to
 *                                       act on (link it), not a fault.
 *   messages:unreadable-state           the file is there and this process cannot read it.
 *   messages:key-missing                this node has no Nostr key yet. READING does not mint
 *                                       one: a person opening the Messages screen must not
 *                                       silently become a new Nostr identity.
 *   messages:key-unreadable             the key file is there and carries no usable secret.
 *
 * ─────────────────────────────────────────────────────────────────────────────────────────────
 * THE MAIL SIDE: WHERE A CONVERSATION COMES FROM, AND WHAT IT DOES NOT CLAIM.
 *
 * A conversation is read back out of the gift wraps this node already received. There is no
 * message store here and none is invented: {@link readMailThread} opens what a relay read
 * returned, keeps the ones whose PROVEN sender is the requested npub, and ignores the rest. A
 * wrap that will not open is dropped rather than reported, because this face cannot say
 * anything true about it.
 *
 * AND THE SAME SELECTION IS WHAT EVIDENCE IS WRITTEN FOR. {@link openedThreadWraps} is the one
 * function that decides which wraps this face read, and {@link readMailThread} hands the route both
 * the conversation and exactly those wraps — so the thread route cannot write a record for a wrap it
 * never opened, nor show a message with no record behind it. Writing itself lives in the nostr
 * tree's own `evidence.mjs`, called from the host half; this file still writes nothing.
 *
 * NIP-17 wraps a copy of every message to its sender as well, so this node's own sent messages
 * arrive in the SAME read and are kept with `from: 'me'`. Sent history is therefore real
 * whenever the relays still hold the sender's own copy — and it is EMPTY when they do not, for
 * instance when a relay was never reached at send time. That is a limit of NIP-17 without a
 * local store, and the thread route reports it by returning the messages it could actually
 * read rather than by inventing the others.
 *
 * {@link mailThread} adds what is known about who is on the other end — one of the four contact
 * states, or UNKNOWN when the npub is not a contact at all — and withholds the SAS exactly as
 * the listing does: present only for a binding that verified.
 * ─────────────────────────────────────────────────────────────────────────────────────────────
 *
 * Malformed entries are omitted individually and named in `skipped`, with controls escaped.
 * One broken or hostile record must not hide the remaining usable contacts.
 *
 * A BINDING THAT IS PRESENT BUT BROKEN IS NOT A REFUSAL. It is FOREIGN, the adversarial
 * state, and it is reported per contact with the underlying refusal kept in `reason` — that
 * is `resolveContact`'s contract and this module preserves it.
 *
 * @module @aukora/face-messages/contacts-store
 */
import { existsSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { contactFieldsAreSafe, parseSafetyNumber, safeContactDiagnostic, skippedContact } from './messages-route.ts'
import type { MessagesSkippedContact } from './messages-route.ts'
import { checkNpub, MAX_ADD_NAME } from './client/add-contact.ts'

/** The `domain` every contacts document must carry. A different one is a different format. */
export const MESSAGES_CONTACTS_DOMAIN = 'aukora:nostr-contacts:v1'

/**
 * The names this module reads from the environment.
 *
 * Enumerated rather than looked up by an arbitrary string: the harness declares `process.env`
 * with only the `DSH_CLIENT_*` build-time keys and `NODE_ENV`, so reading this face's OWN
 * names has to go through a stated list rather than a general index.
 */
const MESSAGES_STATE_DIR_ENV_NAME = 'DSH_HOME'

/**
 * WHERE THE AUMLOK CONTROLLER LIVES IS NOT DECIDED HERE, AND IS NOT READ FROM THE ENVIRONMENT.
 *
 * The directory is the `aukora-aumlok` row's `config.directory` — the same value the organ is mounted
 * with — and the organ publishes it as the `aumlokControl` service's own `directory` field. The host
 * half of this face asks the context for that service on every request and hands the answer to
 * {@link messagesContactsRoots}; this module looks for nothing.
 *
 * AN ENVIRONMENT NAME USED TO LIVE HERE AND HAS BEEN REMOVED RATHER THAN LEFT UNUSED. It could not
 * have worked: `scripts/launch-dsh.py` forwards a fixed whitelist of names to the backend, so a new
 * `AUKORA_*` name never arrives, and {@link environmentValue} serves only the names declared in it, so
 * even a name set in this process could not be read. A constant nobody can honour is worse than no
 * constant, because the next reader believes it works.
 */

/** The resolver module override; declared here so {@link environmentValue} can read it. */
const MESSAGES_CONTACT_MODULE_ENV_NAME = 'AUKORA_NOSTR_CONTACT_MODULE'

/** The relay list override; declared here so {@link environmentValue} can read it. */
const MESSAGES_RELAYS_ENV_NAME = 'AUKORA_NOSTR_RELAYS'

/** The per-relay timeout override; declared here so {@link environmentValue} can read it. */
const MESSAGES_RELAY_TIMEOUT_ENV_NAME = 'AUKORA_NOSTR_TIMEOUT_MS'

/**
 * Read one of this face's environment names.
 * @param name - one of the names this module declares.
 * @returns the configured value, or undefined when unset.
 */
function environmentValue(name: string): string | undefined {
  for (const declared of [
    MESSAGES_STATE_DIR_ENV_NAME,
    MESSAGES_CONTACT_MODULE_ENV_NAME,
    MESSAGES_RELAYS_ENV_NAME,
    MESSAGES_RELAY_TIMEOUT_ENV_NAME,
  ]) {
    if (declared === name) return process.env[declared]
  }
  return undefined
}

/**
 * Environment variable naming the state directory this face reads.
 *
 * This is the project's own harness-home convention, not a new one: `DSH_HOME` is the single
 * root the harness keeps user data under (the release launcher exports
 * `DSH_HOME=<state>/home`, and every storage row in the composition resolves its path from
 * it), so the contacts file sits beside `nostr/identity.json` — the key
 * `loadOrCreateNostrKey(stateDir)` reads and writes at exactly `<stateDir>/nostr/`.
 *
 * Read at CALL time rather than at import time, so one process can be pointed at a
 * disposable state directory, and so a test can move it without reloading a module.
 * Unset or whitespace-only falls back to `~/.dsh`, exactly as `resolveDshHome` does; a blank
 * override never resolves the state directory to the working directory.
 */
export const MESSAGES_STATE_DIR_ENV = MESSAGES_STATE_DIR_ENV_NAME

/** The four contact states, as the strings this face serves. Never prose a caller parses. */
export type MessagesContactState = 'VERIFIED' | 'BOUND' | 'TEST' | 'UNBOUND' | 'FOREIGN'

/** What vouched for a contact: nothing, a binding that verified, or a binding that did not. */
export type MessagesContactBinding = 'absent' | 'verified' | 'refused'

/** The short string two people compare out of band. Two leaf fields, nothing else. */
export interface MessagesContactSas {
  /** This device's own half of the current pair. */
  readonly digits: string
  /** The same digits in groups of five. */
  readonly spoken: string
  readonly comparisonGroupIndex: number
}

/** One contact in the list: seven leaf fields, and no reference to anything live. */
export interface MessagesContactEntry {
  /** The npub we hold, exactly as the contacts document spelled it. */
  readonly npub: string
  /** The person's name for this contact, exactly as the contacts document spelled it. */
  readonly name: string
  /** Which of the four states this contact resolved to. */
  readonly state: MessagesContactState
  /** Why it landed there. For a refusal this is the underlying named reason. */
  readonly reason: string
  /** The subject a VERIFIED or TEST binding names, or null when none was proven. */
  readonly subject: string | null
  /** The string to compare out of band, or NULL when no binding verified. */
  readonly sas: MessagesContactSas | null
  readonly safetyNumber?: MessagesContactSas | null
  /** What was presented: nothing, something that verified, or something that did not. */
  readonly binding: MessagesContactBinding
  /** The peer controller key this contact is verified against, as stored. */
  readonly peerControllerKey: string
}

/** The contacts document's own shape, as it is stored. */
export interface MessagesContactsDocument {
  readonly domain: string
  readonly contacts: readonly MessagesContactDocumentEntry[]
  readonly skipped?: readonly MessagesSkippedContact[]
}

/** One stored contact, before anything is resolved about it. */
export interface MessagesContactDocumentEntry {
  readonly npub: string
  readonly name: string
  /**
   * The PEER's ed25519 controller key, 64 hex characters — the trust anchor a received binding
   * is verified against. A REQUIRED field of a contact record: without it there is nothing to
   * verify the peer's claim with, and a binding could only ever be checked against our own
   * controller, which answers "did I issue this?" instead of "is this my friend?".
   */
  readonly peerControllerKey: string
  /** A binding document as stored, or null when this contact carries none. */
  readonly binding: unknown
  /**
   * THE OWNER'S SIGNED CONFIRMATION, or absent when nobody has compared the digits.
   *
   * OPTIONAL, NOT NULLABLE, AND THE DIFFERENCE IS THE POINT. Absent means nobody has made the claim;
   * a present-but-unreadable value means somebody wrote something here and it must be CHECKED rather
   * than dropped — dropping it would turn a malformed claim into the friendlier "nobody has confirmed
   * this". It is verified against the owner's machine key and the digits of the CURRENT binding, so a
   * confirmation left over from a key that has since moved resolves as stale, not as verified.
   */
  readonly confirmation?: unknown
}

/** Every reason this reader refuses to produce a list. See the module header for each. */
export type MessagesContactsRefusalReason =
  | 'messages:contacts-state-missing'
  | 'messages:contacts-unparseable'
  | 'messages:contacts-domain-unknown'
  | 'messages:contact-malformed'
  | 'messages:no-controller-record'
  | 'messages:aumlok-not-linked'
  | 'messages:unreadable-state'
  | 'messages:key-missing'
  | 'messages:key-unreadable'
  | 'messages:contact-peer-key-malformed'

/** Every reason the reader produces, so a caller can assert the vocabulary is closed. */
export const MESSAGES_CONTACTS_REFUSAL_REASONS: readonly MessagesContactsRefusalReason[] = [
  'messages:contacts-state-missing',
  'messages:contacts-unparseable',
  'messages:contacts-domain-unknown',
  'messages:contact-malformed',
  'messages:no-controller-record',
  'messages:aumlok-not-linked',
  'messages:unreadable-state',
  'messages:key-missing',
  'messages:key-unreadable',
  'messages:contact-peer-key-malformed',
]

/** A refusal: the named reason plus the subject it refused. */
export interface MessagesContactsRefusal {
  readonly status: 'refused'
  readonly reason: MessagesContactsRefusalReason
  /** What was refused: the contacts path, the offending entry's npub or index, the controller dir. */
  readonly subject: string
}

/** A list of contacts, or the named reason there is none to serve. */
export type MessagesContactsAnswer =
  | { readonly status: 'ok'; readonly root: string; readonly contacts: readonly MessagesContactEntry[]; readonly skipped?: readonly MessagesSkippedContact[] }
  | MessagesContactsRefusal

/** Where this face reads from and what it verifies against. */
export interface MessagesContactsRoots {
  /** The directory holding `nostr/contacts.json` and `nostr/identity.json`. */
  readonly stateDir: string
  /**
   * The Aumlok controller record directory the binding is verified against, exactly as the mounted
   * `aumlokControl` service names it, or `undefined` when no service supplied one.
   *
   * UNDEFINED IS A REAL ANSWER AND MUST NOT BE SUBSTITUTED. This directory is a property of the
   * `aukora-aumlok` row, whose `config.directory` the organ is mounted with; the service is the only
   * thing that knows it, and this face does not own it and cannot derive it. It used to guess
   * `join(stateDir, 'aumlok')`, and on a real deployment that guess was WRONG — the harness home
   * (`state/home`) and the controller (`state/aumlok`) are SIBLINGS under the app state root, not
   * nested — so the screen reported `no-controller-record` for a controller that was enrolled and
   * present, sending the owner to look for a missing ceremony that had never been missing. A wrong path
   * that reads as a named refusal is worse than no path, and a directory this face composed for itself
   * is a wrong path waiting for a deployment to move.
   */
  readonly controllerDir: string | undefined
}

/**
 * The resolver this store reads contacts through.
 *
 * Structural on purpose: `aukora-nostr` ships plain JavaScript with no declaration file, and
 * this face does not add one, so the module is loaded through {@link loadContactResolver} and
 * typed by the fields this file actually reads. See that function for the reason the load is
 * not a static import.
 */
export interface MessagesContactResolver {
  (input: {
    readonly npub: string
    readonly binding: unknown
    /**
     * The peer's ed25519 controller key: the anchor a RECEIVED binding verifies against. The
     * normal case for a contact, and the reason a contact record must record it.
     */
    readonly peerControllerKey?: string
    /** Our own controller record directory, for a binding this node issued itself. */
    readonly controllerDir?: string
    readonly expectSubject?: string
    readonly ownerStateDir?: string
    readonly ownerControllerDir?: string
    readonly confirmation?: unknown
  }): unknown
}

/** A refusal body, built in one place so every refusal names its subject. */
function refused(reason: MessagesContactsRefusalReason, subject: string): MessagesContactsRefusal {
  return { status: 'refused', reason, subject }
}

/** A filesystem error's stable code, or undefined when it carries none. */
function errorCode(error: unknown): string | undefined {
  const code = (error as { code?: unknown } | null)?.code
  return typeof code === 'string' ? code : undefined
}

/** Whether a value is a plain JSON object, for the document reader below. */
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/**
 * The state directory this face reads, resolved on every call from {@link MESSAGES_STATE_DIR_ENV}.
 *
 * The same convention `documents-reader.ts` follows for its private root: one fixed,
 * non-configurable location, so no request can name a different one. The difference is that
 * this root is the harness home the process was started with rather than a literal path,
 * because the contacts file lives in the state directory the Nostr key already lives in.
 *
 * @returns the absolute state directory.
 */
export function messagesStateDir(): string {
  const configured = environmentValue(MESSAGES_STATE_DIR_ENV_NAME)
  if (configured?.trim()) return resolve(configured)
  const support = process.env.AUKORA_SUPPORT_ROOT
  return support?.trim() ? resolve(support, 'state', 'home') : join(homedir(), '.dsh')
}

/**
 * The directory holding this node's NOSTR state for a given state directory.
 * @param stateDir - the absolute state directory.
 * @returns `<stateDir>/nostr`.
 */
export function messagesNostrDir(stateDir: string): string {
  return join(stateDir, 'nostr')
}

/**
 * The contacts file this face reads.
 * @param stateDir - the absolute state directory.
 * @returns the absolute path of `contacts.json`.
 */
export function messagesContactsPath(stateDir: string): string {
  return join(messagesNostrDir(stateDir), 'contacts.json')
}

/**
 * Both roots this face reads, composed from the state directory and from the controller directory the
 * host half was given.
 *
 * `controllerDir` IS AN INPUT, NOT SOMETHING THIS FUNCTION FINDS. It is the `directory` field of the
 * mounted `aumlokControl` service — the `aukora-aumlok` row's `config.directory` as the composition
 * actually loaded it — read by the host half through `ctx.get('aumlokControl')` on every request and
 * passed here. This module resolves nothing about it: no environment name, no default, no path
 * composed out of `stateDir`. The value is used exactly as the service gave it, because normalising it
 * would be this face deciding something the composition already decided.
 *
 * @param controllerDir - the controller record directory the service named, or `undefined` when no
 *   mounted service supplied one. `undefined` is a real answer; {@link listContacts} refuses by name.
 * @returns the state directory and the controller record directory.
 */
export function messagesContactsRoots(controllerDir: string | undefined): MessagesContactsRoots {
  return { stateDir: messagesStateDir(), controllerDir }
}

/**
 * Validate one stored contact, at the depth this face actually needs.
 *
 * A binding is deliberately NOT validated here. Whether a presented binding is well-formed is
 * `verifyBinding`'s business, and an answer of "this binding does not verify" must reach the
 * screen as FOREIGN — the adversarial state — rather than as a refusal that would hide it.
 *
 * @param value - one entry of the contacts array.
 * @returns the entry, or undefined when it is not a contact this face can resolve.
 */
export function parseStoredContact(value: unknown): MessagesContactDocumentEntry | undefined {
  if (!isRecord(value) || !contactFieldsAreSafe(value)) return undefined
  const npub = checkNpub(value.npub)
  if (!npub.ok || npub.npub !== value.npub) return undefined
  if (typeof value.name !== 'string' || value.name.trim() === '' || value.name.length > MAX_ADD_NAME) return undefined
  if (typeof value.peerControllerKey !== 'string') return undefined
  if (!/^[0-9a-f]{64}$/iu.test(value.peerControllerKey)
    && !(value.peerControllerKey === '' && value.binding === null)) return undefined
  if (value.binding === undefined) return undefined
  return {
    npub: value.npub,
    name: value.name,
    peerControllerKey: value.peerControllerKey,
    binding: value.binding,
    // THE FIFTH FIELD, AND IT IS WHAT MAKES VERIFIED REACHABLE. Absent is the normal case and means
    // nobody has compared the digits; a malformed one is kept rather than dropped, because dropping it
    // would turn "somebody wrote nonsense here" into the friendlier "nobody has confirmed this".
    ...(value.confirmation === undefined ? {} : { confirmation: value.confirmation }),
  }
}

/**
 * Validate a whole contacts document off disk.
 * @param value - the parsed JSON.
 * @returns the document, or undefined when it is not one this face reads.
 */
export function parseMessagesContactsDocument(value: unknown): MessagesContactsDocument | undefined {
  if (!isRecord(value)) return undefined
  if (value.domain !== MESSAGES_CONTACTS_DOMAIN) return undefined
  if (!Array.isArray(value.contacts)) return undefined
  // The document envelope remains strict; each contact has its own validation boundary.
  if (!Object.entries(value).every(([key, field]) => contactFieldsAreSafe(key)
    && (key === 'contacts' || contactFieldsAreSafe(field)))) return undefined
  const contacts: MessagesContactDocumentEntry[] = []
  const skipped: MessagesSkippedContact[] = []
  for (const [index, raw] of value.contacts.entries()) {
    const entry = parseStoredContact(raw)
    if (entry === undefined) skipped.push(skippedContact(index, raw))
    else contacts.push(entry)
  }
  return { domain: MESSAGES_CONTACTS_DOMAIN, contacts, ...(skipped.length === 0 ? {} : { skipped }) }
}

/**
 * Read the contacts file, naming each way it can fail.
 *
 * The file's absence gets its own name rather than sharing the parse failure's: an operator
 * who has not written a contacts file yet has a different next action from one whose file is
 * corrupt. The two are separately reachable and separately asserted.
 *
 * @param stateDir - the absolute state directory.
 * @returns the stored contacts, or the named refusal.
 */
export async function readContactsFile(stateDir: string): Promise<
  { readonly kind: 'contacts'; readonly contacts: readonly MessagesContactDocumentEntry[]; readonly skipped?: readonly MessagesSkippedContact[] }
  | { readonly kind: 'refused'; readonly refusal: MessagesContactsRefusal }
> {
  const path = messagesContactsPath(stateDir)
  let text: string
  try {
    // 'utf8' read of one path this module resolved itself; there is no request input in it.
    text = await readFile(path, 'utf8')
  } catch (error) {
    // Absence and unreadability are different facts: one says "write your contacts file",
    // the other says "this process cannot read the file you have", and neither is the same
    // condition as a file that is there and is not JSON.
    const reason: MessagesContactsRefusalReason = errorCode(error) === 'ENOENT'
      ? 'messages:contacts-state-missing'
      : 'messages:unreadable-state'
    return { kind: 'refused', refusal: refused(reason, path) }
  }
  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch {
    // The file is there and is not JSON. Named separately from its absence.
    return { kind: 'refused', refusal: refused('messages:contacts-unparseable', path) }
  }
  if (!isRecord(parsed) || parsed.domain !== MESSAGES_CONTACTS_DOMAIN) {
    // A document with the wrong domain is a different format, not a corrupt one: it parses,
    // and this face still cannot read it. The subject names what was found instead.
    const found = isRecord(parsed) ? safeContactDiagnostic(parsed.domain) : 'not-an-object'
    return { kind: 'refused', refusal: refused('messages:contacts-domain-unknown', `${path} (domain ${found})`) }
  }
  const document = parseMessagesContactsDocument(parsed)
  if (document === undefined) {
    return { kind: 'refused', refusal: refused('messages:contact-malformed', `${path} (document envelope is malformed)`) }
  }
  return { kind: 'contacts', contacts: document.contacts,
    ...(document.skipped === undefined ? {} : { skipped: document.skipped }) }
}

/** A reason as a string, whatever the resolver put there. */
function reasonText(value: unknown): string {
  return typeof value === 'string' ? value : ''
}

/** One of the four state strings, or undefined for anything else. */
function asContactState(value: unknown): MessagesContactState | undefined {
  return value === 'VERIFIED' || value === 'BOUND' || value === 'TEST' || value === 'UNBOUND' || value === 'FOREIGN'
    ? value
    : undefined
}

/** What was presented, or undefined for anything else. */
function asBindingStatus(value: unknown): MessagesContactBinding | undefined {
  return value === 'absent' || value === 'verified' || value === 'refused' ? value : undefined
}

/**
 * The SAS to show, or null.
 *
 * NULL IS THE ANSWER FOR EVERYTHING THAT IS NOT A VERIFIED BINDING, and it stays null when
 * the resolver's own SAS is missing, malformed, or carries a non-string in either field. A
 * placeholder here would be compared out loud and "confirmed", so there is deliberately no
 * fallback: an unreadable SAS is no SAS.
 *
 * @param value - the resolver's `sas`.
 * @returns the two leaf fields, or null.
 */
export function contactSas(value: unknown): MessagesContactSas | null {
  if (!isRecord(value) || typeof value.digits !== 'string' || !/^[0-9]{70}$/u.test(value.digits)
    || value.spoken !== value.digits.match(/.{5}/gu)?.join(' ')
    || (value.comparisonGroupIndex !== 0 && value.comparisonGroupIndex !== 7)) return null
  const digits = value.digits.slice(value.comparisonGroupIndex * 5, value.comparisonGroupIndex * 5 + 35)
  return parseSafetyNumber({ digits, spoken: digits.match(/.{5}/gu)?.join(' '), comparisonGroupIndex: value.comparisonGroupIndex }) ?? null
}

/**
 * Resolve one stored contact into the seven leaf fields this face serves.
 *
 * NOTHING IS DERIVED HERE. `state`, `reason`, `subject`, `sas` and the binding status are
 * copied from `resolveContact`'s answer; the one thing this function does on its own is
 * REFUSE to carry anything else — no `verdict`, no binding document, no controller key, no
 * frozen object graph.
 *
 * @param resolveContact - the resolver from `aukora-nostr/lib/contact.mjs`.
 * @param roots - the state and controller directories.
 * @param contact - one stored contact.
 * @returns the contact as this face serves it.
 */
export function resolveStoredContact(
  resolveContact: MessagesContactResolver,
  roots: MessagesContactsRoots,
  contact: MessagesContactDocumentEntry,
): MessagesContactEntry {
  // The subject a binding claims is the subject we hold it to. Passing it as the expectation
  // is what keeps verifications self-consistent per contact, and `resolveContact` then refuses
  // an authentic binding for a DIFFERENT subject or a DIFFERENT npub as FOREIGN — the hole its
  // own header says was measured and closed. It never widens what is accepted.
  const declared = isRecord(contact.binding) && isRecord(contact.binding.statement)
    ? contact.binding.statement.subject
    : undefined

  // THE ANCHOR IS THE CONTACT'S OWN RECORDED PEER KEY. That is what makes the verdict answer
  // "is this my friend's npub?" — verified against the key the contact records — instead of
  // "did I issue this?", which is a question about us and not about them. `controllerDir` is
  // used only when the record carries no peer key, the self-issued case.
  const peer = contact.peerControllerKey
  if (peer === '' && contact.binding === null) {
    return { npub: contact.npub, name: contact.name, state: 'UNBOUND',
      reason: 'contact:no-binding', subject: null, sas: null, safetyNumber: null, binding: 'absent', peerControllerKey: '' }
  }
  if (typeof peer !== 'string' || !/^[0-9a-f]{64}$/iu.test(peer)) {
    // A mistyped or truncated key is a DIFFERENT FACT from a peer whose binding fails: reporting
    // it as FOREIGN would send someone hunting an attacker instead of re-reading a key. So it is
    // refused by its own name, carrying null for everything a proof would produce.
    return {
      npub: contact.npub,
      name: contact.name,
      state: 'FOREIGN',
      reason: 'messages:contact-peer-key-malformed: a contact records the peer controller key as 64 hex characters',
      subject: null,
      sas: null,
      safetyNumber: null,
      binding: 'refused',
      peerControllerKey: typeof peer === 'string' ? peer : '',
    }
  }
  const spec: {
    npub: string
    binding: unknown
    peerControllerKey?: string
    controllerDir?: string
    expectSubject?: string
    confirmation?: unknown
    ownerControllerDir?: string
    ownerStateDir?: string
  } = peer === ''
    ? {
        npub: contact.npub,
        binding: contact.binding ?? null,
        // OMITTED, not set to undefined: `exactOptionalPropertyTypes` distinguishes the two, and an
        // absent key is the honest shape for 'this face was not told where the controller is'.
        ...(roots.controllerDir === undefined ? {} : { controllerDir: roots.controllerDir }),
      }
    : { npub: contact.npub, binding: contact.binding ?? null, peerControllerKey: peer }
  // THE CONFIRMATION AND THE OWNER'S KEY TRAVEL TOGETHER, because neither is any use alone: the
  // confirmation is verified AGAINST the owner's machine key, and a confirmation that cannot be checked
  // is worse than none — it would read as a claim nobody had tested. Both are passed only when the
  // contact actually carries one, so a contact with no confirmation resolves exactly as it did before.
  spec.ownerStateDir = roots.stateDir
  if (roots.controllerDir !== undefined) spec.ownerControllerDir = roots.controllerDir
  if (contact.confirmation !== undefined && roots.controllerDir !== undefined) spec.confirmation = contact.confirmation
  if (typeof declared === 'string' && declared !== '') spec.expectSubject = declared

  let answer: unknown
  try {
    answer = resolveContact(spec)
  } catch (error) {
    // A refused entry is never a fake SAS and never a crash: it keeps its own reason and
    // carries null, which is the same withholding FOREIGN gets.
    return {
      npub: contact.npub,
      name: contact.name,
      state: 'FOREIGN',
      reason: reasonText(error instanceof Error ? error.message : error),
      subject: null,
      sas: null,
      safetyNumber: null,
      binding: 'refused',
      peerControllerKey: peer,
    }
  }
  if (!isRecord(answer)) {
    return {
      npub: contact.npub,
      name: contact.name,
      state: 'FOREIGN',
      reason: 'contact:resolution-returned-no-verdict',
      subject: null,
      sas: null,
      safetyNumber: null,
      binding: 'refused',
      peerControllerKey: peer,
    }
  }
  const state = asContactState(answer.state) ?? 'FOREIGN'
  const binding = asBindingStatus(answer.binding) ?? 'absent'
  // THE WITHHOLDING, RESTATED AT THE ONE POINT IT COULD BE BROKEN. Only a binding that
  // verified may contribute a SAS; every other state gets null even if a resolver handed
  // one over, so no future edit to the resolver can put a string in front of a person for a
  // contact nobody vouched for.
  // THE SAS IS SHOWN WHENEVER THE BINDING VERIFIED — and BOUND is one of those states, deliberately.
  // BOUND means "the key checks out and nobody has confirmed it in person", and the confirmation is
  // raised AFTER the two people compare the digits, so withholding the string at BOUND would make the
  // step that produces a confirmation impossible to perform. This is a widening of the old rule, and
  // it is the reason BOUND is not simply a quieter VERIFIED.
  const verified = binding === 'verified' && (state === 'VERIFIED' || state === 'BOUND' || state === 'TEST')
  return {
    npub: contact.npub,
    name: contact.name,
    state,
    reason: reasonText(answer.reason),
    subject: typeof answer.subject === 'string' && answer.subject !== '' ? answer.subject : null,
    sas: verified ? contactSas(answer.sas) : null,
    safetyNumber: verified ? contactSas(answer.safetyNumber) : null,
    binding,
    peerControllerKey: peer,
  }
}

/**
 * The four contact states plus the one this face can be shown that a contact FILE cannot hold:
 * a conversation with an npub that is not in the contacts file at all. It exists because the
 * thread route is asked for a conversation BY NPUB, and "I have no claim about this key" is a
 * different answer from any of the four.
 */
export type MessagesThreadContactState = MessagesContactState | 'UNKNOWN'

/** One message in a conversation. Four leaf fields, and the time is the REAL one. */
export interface MessagesThreadMessage {
  /** The rumor's own id — the same message received twice de-duplicates to one entry. */
  readonly id: string
  /** `them` for a message the peer sent, `me` for this node's own copy of what it sent. */
  readonly from: 'them' | 'me'
  /** The message text, exactly as the rumor carried it. */
  readonly text: string
  /** The RUMOR's `created_at`, in unix seconds — never a gift wrap's jittered time. */
  readonly at: number
}

/** The conversation with one contact, plus what is known about who is on the other end. */
export interface MessagesThread {
  readonly npub: string
  /** Which of the four contact states this npub holds, or UNKNOWN when it is not a contact. */
  readonly contactState: MessagesThreadContactState
  /** The SAS to compare out of band, or null — the same rule the listing follows. */
  readonly sas: MessagesContactSas | null
  readonly safetyNumber?: MessagesContactSas | null
  /** Oldest first, de-duplicated by the rumor's id. */
  readonly messages: readonly MessagesThreadMessage[]
}

/** What one opened gift wrap must yield for this face to use it. */
export interface MessagesDecodedWrap {
  readonly rumor: { readonly id?: unknown; readonly pubkey?: unknown; readonly content?: unknown; readonly created_at?: unknown }
  readonly sender: unknown
}

/**
 * A gift-wrap decoder: `openGiftWrap` from `aukora-nostr/lib/giftwrap.mjs`.
 *
 * Injected rather than imported for the same reason the contact resolver is loaded through
 * {@link loadContactResolver} — the face build cannot see the nostr tree — and injected here so
 * this filter is a pure function a court can drive without a relay or a signature.
 */
export interface MessagesGiftWrapDecoder {
  (wrap: unknown, spec: { readonly recipientSecretKey: string; readonly expectSender?: string }): unknown
}

/** The relays a send or a read uses when nothing overrides them. */
export type MessagesRelays = readonly string[];

/**
 * The relay list to use, from {@link MESSAGES_RELAYS_ENV} or the module's defaults.
 *
 * A comma- or whitespace-separated list. An entry that is not `ws://` or `wss://` is DROPPED,
 * and a list that ends up empty falls back to the defaults rather than to an empty transport:
 * an unparseable override must not silently mean "no relays", which would read to a person as
 * "nobody answered me".
 *
 * @param defaults - the relay module's own default list.
 * @returns the relays to use.
 */
export function messagesRelays(defaults: readonly string[]): readonly string[] {
  const configured = environmentValue(MESSAGES_RELAYS_ENV_NAME)
  if (configured === undefined || configured.trim() === '') return defaults
  const parsed = configured.split(/[\s,]+/u).filter(relay => /^wss?:\/\//u.test(relay))
  return parsed.length === 0 ? defaults : parsed
}

/**
 * The per-relay timeout to use, from {@link MESSAGES_RELAY_TIMEOUT_ENV} or a default.
 *
 * A court sets this low so a relay that never acknowledges fails in milliseconds instead of
 * seconds; production leaves it at the default.
 *
 * @param fallbackSeconds - the default in seconds.
 * @returns the timeout in milliseconds.
 */
export function messagesRelayTimeoutMs(fallbackSeconds: number): number {
  const configured = environmentValue(MESSAGES_RELAY_TIMEOUT_ENV_NAME)
  if (configured === undefined || configured.trim() === '') return fallbackSeconds * 1000
  const parsed = Number(configured)
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallbackSeconds * 1000
}

/**
 * This node's own Nostr secret key, READ and never created.
 *
 * `loadOrCreateNostrKey` would mint a key when none exists, and this face must not do that as a
 * side effect of a request: a person opening the Messages screen should not silently become a
 * new Nostr identity, and a court that ran the route would leave a key behind. Creation stays
 * with the tool that means it.
 *
 * @param stateDir - the absolute state directory.
 * @returns the secret key in hex, or the named refusal.
 */
export async function readNodeSecretKey(stateDir: string): Promise<
  { readonly kind: 'key'; readonly secretKeyHex: string } | { readonly kind: 'refused'; readonly refusal: MessagesContactsRefusal }
> {
  const path = join(messagesNostrDir(stateDir), 'identity.json')
  let text: string
  try {
    text = await readFile(path, 'utf8')
  } catch (error) {
    const reason: MessagesContactsRefusalReason = errorCode(error) === 'ENOENT'
      ? 'messages:key-missing'
      : 'messages:key-unreadable'
    return { kind: 'refused', refusal: refused(reason, path) }
  }
  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch {
    return { kind: 'refused', refusal: refused('messages:key-unreadable', path) }
  }
  const secret = isRecord(parsed) ? parsed.secretKeyHex : undefined
  if (typeof secret !== 'string' || !/^[0-9a-f]{64}$/u.test(secret)) {
    return { kind: 'refused', refusal: refused('messages:key-unreadable', path) }
  }
  return { kind: 'key', secretKeyHex: secret }
}

/** What one thread read needs to open and attribute the wraps a relay served. */
export interface MessagesThreadReadSpec {
  /** This node's own secret key: the only key that opens a wrap addressed to it. */
  readonly recipientSecretKey: string
  /** The requested sender's 32-byte x-only hex — what `openGiftWrap` compares against. */
  readonly senderPubkeyHex: string
  /** This node's own x-only hex, which is what decides `from: 'me'`. */
  readonly selfPubkey: string
}

/** One gift wrap this read opened and attributed, with the message it carried. */
export interface MessagesOpenedWrap {
  /**
   * The wrap AS IT ARRIVED, byte for byte — the event an evidence record names. Never recomposed:
   * a record over bytes this face had rebuilt would name an event nobody published.
   */
  readonly wrap: unknown
  /** The message it carried: sender proven by the seal, id computed, time taken from the rumor. */
  readonly message: MessagesThreadMessage
}

/**
 * Every wrap in one read that this face OPENED and ATTRIBUTED to the requested sender.
 *
 * THE ONE SELECTION PATH. {@link readMailThread} and the thread route both come through here, so
 * the wraps a conversation is built from and the wraps an evidence record is written for cannot
 * drift apart: a second, similar-looking filter is exactly how a record gets written for a message
 * the thread never showed, or a message gets shown with no record behind it.
 *
 * A WRAP THAT WILL NOT OPEN IS NOT HERE, and a wrap from somebody else is not here either. Both are
 * dropped rather than reported — this face cannot say anything true about either — and neither is
 * evidence of a message, so neither gets a record.
 *
 * MORE THAN ONE WRAP MAY CARRY THE SAME MESSAGE. NIP-17 seals one rumor into a wrap per recipient,
 * so the same message legitimately arrives twice; each wrap is its own published event and appears
 * here once. De-duplication belongs to the conversation rather than to this list, and
 * {@link readMailThread} is where it happens — keyed by the RUMOR's id, which is the mechanism;
 * the `has` guard above it only skips a redundant `set` of a key already present.
 *
 * @param wraps - the gift wraps a relay read returned.
 * @param openGiftWrap - the decoder from `aukora-nostr/lib/giftwrap.mjs`.
 * @param spec - `{recipientSecretKey, senderPubkeyHex, selfPubkey}`.
 * @returns the opened, attributed wraps, oldest first.
 */
const openedCache = new Map<string, { wire: string; decoded: unknown }>()

export function openedThreadWraps(
  wraps: readonly unknown[],
  openGiftWrap: MessagesGiftWrapDecoder,
  spec: MessagesThreadReadSpec,
): readonly MessagesOpenedWrap[] {
  const wanted = spec.senderPubkeyHex.toLowerCase()
  const self = spec.selfPubkey.toLowerCase()
  const opened: MessagesOpenedWrap[] = []
  const seen = new Set<string>()
  const recipient = createHash('sha256').update(spec.recipientSecretKey).digest('hex')
  for (const wrap of wraps) {
    let decoded: unknown
    try {
      // `expectSender` is HEX, because that is what the decoder compares it to: the rumor's own
      // pubkey after the seal's signature has proved it. The filter below repeats the comparison
      // rather than trusting the decoder alone, so a caller that omits the expectation still
      // cannot get another sender's message into this thread.
      if (!isRecord(wrap) || typeof wrap.id !== 'string' || seen.has(wrap.id)) continue
      if (typeof wrap.created_at !== 'number' || !Number.isSafeInteger(wrap.created_at)
        || wrap.created_at < 0 || wrap.created_at > Math.floor(Date.now() / 1000)) continue
      const cacheKey = `${recipient}:${wrap.id}`
      const wire = JSON.stringify(wrap)
      const cached = openedCache.get(cacheKey)
      if (cached?.wire === wire) decoded = cached.decoded
      else {
        decoded = openGiftWrap(wrap, { recipientSecretKey: spec.recipientSecretKey })
        if (openedCache.size >= 2048) openedCache.delete(openedCache.keys().next().value!)
        openedCache.set(cacheKey, { wire, decoded })
      }
      seen.add(wrap.id)
    } catch {
      // Not ours to read, or not from this contact. See the header: dropped, deliberately,
      // rather than reported as a message that could not be described.
      continue
    }
    if (!isRecord(decoded) || !isRecord(decoded.rumor)) continue
    const rumor = decoded.rumor
    const sender = typeof decoded.sender === 'string' ? decoded.sender.toLowerCase() : ''
    // The rumor's own pubkey is what the decoder proved; `from` is decided by comparing it to
    // this node's key, never by anything the sender chose to put in the message.
    const from: 'them' | 'me' = sender === self ? 'me' : 'them'
    if (from === 'them' && sender !== wanted) continue
    if (rumor.kind !== 14 || !Array.isArray(rumor.tags)) continue
    const recipients = rumor.tags.filter((tag: unknown) => Array.isArray(tag) && tag[0] === 'p' && typeof tag[1] === 'string')
      .map((tag: string[]) => tag[1]?.toLowerCase())
    // A group or a different friend's self-copy is not this one-to-one conversation.
    if (!recipients.includes(from === 'me' ? wanted : self)
      || recipients.some(recipient => recipient !== wanted && recipient !== self)) continue
    if (typeof rumor.id !== 'string' || typeof rumor.content !== 'string'
      || typeof rumor.created_at !== 'number' || !Number.isSafeInteger(rumor.created_at)
      || rumor.created_at < 0 || rumor.created_at > Math.floor(Date.now() / 1000) + 900) continue
    const at = typeof rumor.created_at === 'number' && Number.isFinite(rumor.created_at) ? rumor.created_at : 0
    const id = typeof rumor.id === 'string' && rumor.id !== ''
      ? rumor.id
      : `${sender}:${String(at)}:${typeof rumor.content === 'string' ? rumor.content : ''}`
    opened.push({ wrap, message: { id, from, text: typeof rumor.content === 'string' ? rumor.content : '', at } })
  }
  return opened.sort((left, right) => left.message.at - right.message.at || left.message.id.localeCompare(right.message.id))
}


/**
 * The thread for one requested npub, WITH the wraps it was read from.
 *
 * The two travel together on purpose. The route writes one evidence record per opened, attributed
 * wrap, and it must write them for exactly the wraps the thread was built from — so the answer and
 * the list it was built from are one value rather than two calls that a later edit could point at
 * different inputs.
 */
export interface MessagesThreadRead {
  /** The conversation, ready to serve. */
  readonly thread: MessagesThread
  /**
   * The wraps this read opened AND attributed to the requested sender, oldest first. A wrap that
   * failed to open and a wrap from somebody else are both absent, which is what keeps an
   * unopenable wrap from being recorded as a message.
   */
  readonly opened: readonly MessagesOpenedWrap[]
}

/**
 * Read the thread for one requested npub: the conversation, and the wraps it came from.
 *
 * A REQUIRED SENDER WITH NO STATE IS NOT HIDDEN. When the npub is not in the contacts file the
 * conversation is still served, with `contactState: 'UNKNOWN'` — refusing would hide messages
 * that really arrived, and serving them silently would let a screen imply a contact it does not
 * have. And the SAS obeys the same rule as the listing: it is present only for a binding that
 * verified, because a string to compare for an unproven identity is worse than no string.
 *
 * @param wraps - the gift wraps a relay read returned.
 * @param openGiftWrap - the decoder from `aukora-nostr/lib/giftwrap.mjs`.
 * @param spec - `{recipientSecretKey, senderPubkeyHex, selfPubkey, senderNpub, contact}`.
 * @returns the thread and the wraps it was read from.
 */
export function readMailThread(
  wraps: readonly unknown[],
  openGiftWrap: MessagesGiftWrapDecoder,
  spec: MessagesThreadReadSpec & {
    /** The npub to report back, which is what the caller asked with. */
    readonly senderNpub: string
    readonly contact: MessagesContactEntry | undefined
  },
): MessagesThreadRead {
  const opened = openedThreadWraps(wraps, openGiftWrap, spec)
  const byId = new Map<string, MessagesThreadMessage>()
  for (const entry of opened) {
    if (byId.has(entry.message.id)) continue
    byId.set(entry.message.id, entry.message)
  }
  return {
    thread: {
      npub: spec.senderNpub,
      contactState: spec.contact?.state ?? 'UNKNOWN',
      sas: spec.contact?.sas ?? null,
      safetyNumber: spec.contact?.safetyNumber ?? null,
      messages: [...byId.values()],
    },
    opened,
  }
}

/**
 * The thread for one requested npub, with what is known about it appended.
 *
 * The thread alone, for a caller that has no record to write. The route calls
 * {@link readMailThread} instead, so that what it serves and what it records come from one read.
 *
 * @param wraps - the gift wraps a relay read returned.
 * @param openGiftWrap - the decoder from `aukora-nostr/lib/giftwrap.mjs`.
 * @param spec - `{recipientSecretKey, senderPubkeyHex, selfPubkey, senderNpub, contact}`.
 * @returns the thread.
 */
export function mailThread(
  wraps: readonly unknown[],
  openGiftWrap: MessagesGiftWrapDecoder,
  spec: MessagesThreadReadSpec & {
    /** The npub to report back, which is what the caller asked with. */
    readonly senderNpub: string
    readonly contact: MessagesContactEntry | undefined
  },
): MessagesThread {
  return readMailThread(wraps, openGiftWrap, spec).thread
}

/** Resolvers already loaded, by specifier. Loading one reads a file, and the answer cannot change. */
const resolverCache = new Map<string, MessagesContactResolver>()

/**
 * Load `resolveContact` from the `aukora-nostr` module this face defers to.
 *
 * WHY NOT A STATIC IMPORT. The face build compiles each face inside a clone of the pinned
 * harness, where `../../aukora-nostr/...` does not exist: `scripts/build-face.py` carries
 * `src`, `package.json`, the tsconfigs and `tsdown.config.ts`, and nothing outside the face
 * directory. A static import of this module therefore resolves in the source tree and fails
 * to type-check and to bundle in the only build that produces `lib/index.js`. `contact.mjs`
 * is looked up AT RUNTIME through {@link resolveContactModuleSpecifier}, which walks up from
 * this module's own location and honours {@link MESSAGES_CONTACT_MODULE_ENV}, and a
 * deployment that carries the two trees apart states where it put them with that variable.
 *
 * WHAT IT DOES NOT PROVE. The module is imported by path, so the face trusts the bytes at
 * that path to be the resolver it names. Nothing here verifies a digest of them; the pin
 * court and the source layout are what stand behind that, and this ceiling is stated rather
 * than implied away.
 *
 * @param specifier - module specifier or path. Defaults to {@link defaultContactModuleSpecifier}.
 * @returns the resolver, ready to call.
 * @throws {Error} `messages:nostr-tree-absent` when this deployment carries no nostr tree, or
 *   `messages:contact-module-unloadable` when the module it names cannot be loaded.
 */
export async function loadContactResolver(
  specifier: string = defaultContactModuleSpecifier(),
): Promise<MessagesContactResolver> {
  const cached = resolverCache.get(specifier)
  if (cached !== undefined) return cached
  let loaded: unknown
  try {
    loaded = await import(specifier)
  } catch (cause) {
    throw Object.assign(
      new Error(`the contact resolver could not be loaded from ${specifier}: ${cause instanceof Error ? cause.message : String(cause)}`),
      { code: 'messages:contact-module-unloadable' },
    )
  }
  const resolver = isRecord(loaded) ? loaded.resolveContact : undefined
  if (typeof resolver !== 'function') {
    throw Object.assign(
      new Error(`${specifier} exports no resolveContact function`),
      { code: 'messages:contact-module-unloadable' },
    )
  }
  const typed = resolver as MessagesContactResolver
  resolverCache.set(specifier, typed)
  return typed
}

/**
 * Where this face expects the `contact.mjs` module to be, when nothing else says otherwise.
 *
 * A literal path, exactly the way `documents-reader.ts` names its one private root: the
 * resolver is a fixed dependency of this face, not something a request may choose. It is read
 * only as the LAST candidate in {@link resolveContactModuleSpecifier}, so a differently laid
 * out deployment is found by walking up from this module's own location rather than by
 * editing this line.
 */
/** The refusal a deployment gets when it carries no nostr tree to resolve against. */
export const MESSAGES_NOSTR_TREE_ABSENT = 'messages:nostr-tree-absent'

/** The plugin directory the resolver lives in, named once for every candidate below. */
const CONTACT_MODULE_PLUGIN_DIR = 'aukora-nostr'

/** The resolver's path under its plugin directory. */
const CONTACT_MODULE_RELATIVE = ['lib', 'contact.mjs'] as const

/**
 * The candidate sources this face resolves `contact.mjs` from, named so a court can assert what
 * they are WITHOUT running the resolution.
 *
 * It exists because of the bug it replaced: the list used to end in an absolute path into one
 * developer's checkout. That is invisible to a behavioural arm on the machine that path names —
 * every test passed there — so the property has to be checked structurally, on the declared
 * sources themselves. `relative` is the fragment joined onto this module's directory at runtime.
 */
export const MESSAGES_CONTACT_MODULE_CANDIDATES = Object.freeze({
  env: MESSAGES_CONTACT_MODULE_ENV_NAME,
  relative: ['..', '..', '..', CONTACT_MODULE_PLUGIN_DIR, ...CONTACT_MODULE_RELATIVE].join('/'),
})

/**
 * Environment variable naming the `contact.mjs` module to load, when it is not where this face
 * expects it. An absolute path or a `file:` URL. Set it to point the face at another tree; the
 * test court uses it to measure the loader against a throwaway module.
 */
export const MESSAGES_CONTACT_MODULE_ENV = MESSAGES_CONTACT_MODULE_ENV_NAME

/**
 * Environment variable naming the relays a send or a read uses. A comma- or whitespace-separated
 * list; entries that are not `ws://` or `wss://` are dropped. The court points this at its own
 * in-process relay so nothing touches the public internet.
 */
export const MESSAGES_RELAYS_ENV = MESSAGES_RELAYS_ENV_NAME

/**
 * Environment variable naming the per-relay timeout in MILLISECONDS. A court sets it low so a
 * relay that never acknowledges is a refusal in milliseconds rather than seconds.
 */
export const MESSAGES_RELAY_TIMEOUT_ENV = MESSAGES_RELAY_TIMEOUT_ENV_NAME

/**
 * The module specifier this face loads the resolver from.
 *
 * CANDIDATES, IN ORDER, and the first one that exists on disk wins:
 *
 *   1. `$AUKORA_NOSTR_CONTACT_MODULE`, for a deployment that moved one tree or the other.
 *   2. `<this module's directory>/../../../aukora-nostr/lib/contact.mjs`, which is
 *      `plugins/aukora-nostr/lib/contact.mjs` both from `src/` in this repository and from
 *      `lib/` in a release that keeps every face beside the plugins it uses.
 *
 * A candidate is checked with `existsSync` and never loaded speculatively, so the answer is a
 * path this process can actually import rather than a guess.
 *
 * THERE IS NO ABSOLUTE-PATH FALLBACK, DELIBERATELY. This used to end in a hardcoded path into
 * one developer's checkout. It made the routes work on exactly the machine that path names and
 * fail everywhere else, and it failed by falling through to a module-not-found from deep inside
 * an import — the least actionable form of the failure. A machine without the tree now gets
 * `messages:nostr-tree-absent`, which says what is missing.
 *
 * @returns an absolute path or the configured specifier.
 * @throws {Error} `messages:nostr-tree-absent` when no candidate exists on disk.
 */
export function resolveContactModuleSpecifier(): string {
  const configured = environmentValue(MESSAGES_CONTACT_MODULE_ENV_NAME)
  if (configured !== undefined && configured.trim() !== '') return configured
  const candidate = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', CONTACT_MODULE_PLUGIN_DIR, ...CONTACT_MODULE_RELATIVE)
  if (existsSync(candidate)) return candidate
  throw Object.assign(
    new Error(`this deployment carries no nostr tree at ${candidate}, so no contact can be resolved. `
      + `Install the tree beside this face, or set ${MESSAGES_CONTACT_MODULE_ENV_NAME} to the contact.mjs to use.`),
    { code: MESSAGES_NOSTR_TREE_ABSENT },
  )
}

/**
 * Where `contact.mjs` is loaded from when nothing else says otherwise.
 * @returns the specifier {@link resolveContactModuleSpecifier} chose.
 */
export function defaultContactModuleSpecifier(): string {
  return resolveContactModuleSpecifier()
}

/**
 * Read and resolve the whole contact list.
 *
 * @param resolver - the resolver to read contacts through; see {@link loadContactResolver}.
 * @param roots - where the contacts file and the controller record live. The controller directory in
 *   it is the mounted service's answer, never a value this module looked up; there is deliberately no
 *   default, because a default would be the face deciding where the controller is.
 * @returns the list, or the named refusal.
 */
export async function listContacts(
  resolver: MessagesContactResolver,
  roots: MessagesContactsRoots,
): Promise<MessagesContactsAnswer> {
  // Resolved before the contacts file is opened, so a node with no controller record is told
  // that once rather than once per contact. Without a trusted controller key NOTHING here can
  // be verified, and reporting every contact as FOREIGN for that reason would read as an
  // accusation against them.
  //
  // NOT `no-controller-record`, AND NOT A PATH THIS FILE COMPOSED. When the composition never
  // supplied a controller directory there may be a perfectly good record somewhere this face was
  // never told about — and reporting the misleading name is what sent the owner looking for a
  // ceremony that had already been performed. On a fresh install the directory is named only once
  // the first Aumlok link writes the per-install settings file, so until then this is the ordinary
  // "not linked yet" state and it has its own name in the closed vocabulary (503, a missing
  // prerequisite of this node), rather than a 500 that reads as a broken deployment.
  if (roots.controllerDir === undefined) {
    return refused('messages:aumlok-not-linked',
      'no Aumlok phrase is linked on this install yet (the aumlokControl service names no controller directory). Link your seven words in Aumlok, then quit and reopen AUKORA.')
  }
  const controllerRecord = join(roots.controllerDir, 'local-control.json')
  try {
    // Read, not stat: a record that exists and cannot be read is as unusable as an absent
    // one, and this is the same file `verifyBinding` opens per contact.
    await readFile(controllerRecord, 'utf8')
  } catch {
    return refused('messages:no-controller-record', controllerRecord)
  }
  const read = await readContactsFile(roots.stateDir)
  // NO FILE YET IS NOBODY YET, FOR THE LISTING. The writer says the same (`add-contact.mjs`
  // `readExistingContacts`: "A MISSING file is not an error — that is the first contact"), and on a
  // freshly linked install the file does not exist until the first contact is added. A file that is
  // there and cannot be read keeps its own refusal.
  if (read.kind === 'refused' && read.refusal.reason === 'messages:contacts-state-missing') {
    return { status: 'ok', root: roots.stateDir, contacts: [] }
  }
  if (read.kind === 'refused') return read.refusal
  const contacts = read.contacts.map(contact => resolveStoredContact(resolver, roots, contact))
  return { status: 'ok', root: roots.stateDir, contacts,
    ...(read.skipped === undefined ? {} : { skipped: read.skipped }) }
}
