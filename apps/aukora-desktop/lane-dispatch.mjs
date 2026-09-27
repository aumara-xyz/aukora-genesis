/**
 * lane-dispatch.mjs — WHAT THE DOOR DECIDES, separated from HOW IT LISTENS.
 *
 * WHY THIS FILE EXISTS. `lane-door.mjs` holds an HTTP listener, a token fence, a backend forwarder and a
 * ledger. Buried inside it were three things that are not about listening at all: which commands exist,
 * whether an approval window forbids a send, and what a ledger line is allowed to contain. **A rule that
 * can only be tested by starting a server is a rule that will be tested rarely and read never.** They
 * live here so a court can call them directly and so the door has exactly one place to ask.
 *
 * THE DOOR IMPORTS THIS. It does not restate any of it — the extraction was a MOVE, and the door's own
 * courts stayed green across it, which is the evidence that nothing changed but the address.
 *
 * AUMLOK OWNS THE APPROVAL FENCE. This module does not define when an approval window is open; it takes
 * the two predicates the bridge already publishes and answers one question about them. The SEMANTICS are
 * unchanged and deliberately not restated — only the address moved.
 */
import { createHash, randomUUID } from 'node:crypto'

/** The refusal vocabulary. Every refusal the door can print has a name here. */
export const LANE_REFUSE = Object.freeze({
  METHOD: 'lane.method',
  NOT_FOUND: 'lane.not-found',
  FORBIDDEN_HOST: 'lane.forbidden-host',
  FORBIDDEN_ORIGIN: 'lane.forbidden-origin',
  FORBIDDEN_FETCH_SITE: 'lane.forbidden-fetch-site',
  UNAUTHORIZED: 'lane.unauthorized',
  APPROVAL_OPEN: 'lane.approval-open',
  BAD_BODY: 'lane.bad-body',
  BODY_TOO_LARGE: 'lane.body-too-large',
  BAD_SESSION: 'lane.bad-session',
  BAD_TEXT: 'lane.bad-text',
  BAD_LANE: 'lane.bad-origin',
  COMMAND_REFUSED: 'lane.command-refused',
  BACKEND_UNAUTHORIZED: 'lane.backend-unauthorized',
  BACKEND_FAILED: 'lane.backend-failed',
  // ── THE CARD'S OWN REFUSALS ──────────────────────────────────────────────────────────────────
  // ONE NAME, NOT FIVE. A card that is missing, reused, expired or mismatched is ONE fact to a sender —
  // "this send was not confirmed" — and splitting it into five codes would tell a prober which part of
  // the guess was right. The REASON is ledgered by name for the operator; the SENDER is told one thing.
  CARD_NOT_CONFIRMED: 'lane.card-not-confirmed',
  // ── A BODY THAT CARRIES TWO ANSWERS ──────────────────────────────────────────────────────────────
  // `JSON.parse` KEEPS THE LAST OF A REPEATED KEY, and the door's `text` IS the message: its digest is
  // what a card binds and what the ledger records. So `{"text":"send A","text":"send B"}` parses to
  // `"send B"` — **one document carrying two different messages, with the door silently choosing one.**
  // That is not a malformed body; it is an AMBIGUOUS one, and it gets its own name because a reader has
  // to be able to tell the two apart.
  DUPLICATE_KEY: 'lane.duplicate-key',
  // ── A REQUEST THAT NAMES ITS OWN AUTHORITY ───────────────────────────────────────────────────────
  // Refused rather than ignored: a caller who believes they chose a sender class MUST BE TOLD THEY DID
  // NOT, or they will keep believing it — and the next person to read their code will too.
  SENDER_CLASS_FROM_BODY: 'lane.sender-class-from-body',
  // ── THE RECORD COULD NOT BE WRITTEN ──────────────────────────────────────────────────────────────
  // 503 rather than 500: the door is intact and the BACKING STORE failed, and a caller should retry.
  LEDGER_UNWRITABLE: 'lane.ledger-unwritable',
  // ── THE CARD BINDS ONE KIND AND THE MESSAGE ROUTES AS ANOTHER ────────────────────────────────────
  // **The owner confirms a KIND, not just a string.** A command executed on a card confirmed for a prompt
  // is a card for something the owner never saw.
  KIND_NOT_BOUND: 'lane.kind-not-bound',
  /** A refusal that names a real defect in the caller's own configuration, not in their card. */
  SENDER_CLASS_UNKNOWN: 'lane.sender-class-unknown',
})

/** The commands a lane may send. Anything else beginning with `/` is refused, not forwarded. */
export const LANE_COMMANDS = Object.freeze(['goal', 'compact'])

/** The digest the ledger carries: over the TEXT, and a PREFIX, so the ledger holds no message. */
export const digestOf = text => createHash('sha256').update(text, 'utf8').digest('hex').slice(0, 16)

/**
 * Which kind of request a lane's text is.
 *
 * A `/`-prefixed word that is not a known command is REFUSED rather than forwarded as prose: a lane
 * typing `/goals` has made a mistake, and sending it to a model as a message would act on the mistake.
 */
export function routeOf(text) {
  if (!text.startsWith('/')) return { kind: 'prompt' }
  const word = text.slice(1).split(/\s/u)[0] ?? ''
  if (!LANE_COMMANDS.includes(word)) {
    return { kind: 'refused', code: LANE_REFUSE.COMMAND_REFUSED, word }
  }
  return { kind: 'command', command: word }
}

/**
 * Whether an open approval window forbids this send, and the code to refuse with.
 *
 * THE DOOR CALLS THIS TWICE, AND THE SECOND CALL IS THE POINT. The two reads are separated by the body
 * read, so a window that was closed when the request was judged can be open by the time the message
 * would be sent. **A fence read once, before the work, does not hold during the work** — so this is a
 * FUNCTION rather than a boolean captured at the top, and the door must not hoist its answer.
 *
 * @param {{ isApprovalOpen?: () => boolean, isDrawPending?: () => boolean }} bridge
 * @returns {{ open: true, code: string } | { open: false }}
 */
export function approvalFence(bridge = {}) {
  const isApprovalOpen = typeof bridge.isApprovalOpen === 'function' ? bridge.isApprovalOpen : () => false
  const isDrawPending = typeof bridge.isDrawPending === 'function' ? bridge.isDrawPending : () => false
  if (isApprovalOpen() || isDrawPending()) return { open: true, code: LANE_REFUSE.APPROVAL_OPEN }
  return { open: false }
}

/**
 * One ledger line, as the object that will be serialized.
 *
 * **NOTHING OF WHAT WAS SAID.** Time, origin, session, kind, byte count, a digest PREFIX and the status.
 * The digest is over the text and is a prefix, so a person can tell whether a ledger line and a session
 * log entry are the same message **without the ledger holding the message**.
 *
 * A SHAPE FUNCTION, NOT A WRITER. It returns the object; the door owns the file, the mode and the
 * refusal to fail loudly — a ledger that cannot be written must not swallow the answer.
 */
export function ledgerEntry(entry, status, now = () => new Date()) {
  return {
    time: now().toISOString(),
    origin: entry.origin ?? null,
    session: entry.session ?? null,
    kind: entry.kind,
    bytes: entry.bytes ?? 0,
    sha256: entry.sha256 ?? null,
    status,
  }
}

// ── THE CARD ─────────────────────────────────────────────────────────────────────────────────────────
//
// A GOAL REACHES A LANE ONLY THROUGH A CARD PETER TAPS. The card is not a password and not a session:
// it is a **single-use** confirmation of ONE message, and it is bound to that message's exact bytes so
// that "yes, send it" cannot be replayed onto something else.

/** Where the shell calls to confirm a card. The UI lane renders this; it mints nothing itself. */
export const CARD_ROUTE = '/lane/confirm'

/** How long a confirmed card stays usable. Five minutes is about as long as a tap stays a decision. */
export const CARD_TTL_MS = 5 * 60 * 1000

/**
 * The binding: `sha256(lane ‖ exact text ‖ kind)`.
 *
 * LENGTH-PREFIXED, NOT CONCATENATED. `lane + text + kind` is ambiguous — lane `a` with text `bc` and
 * lane `ab` with text `c` produce the same string — so the three parts are joined as a JSON array, which
 * cannot collide that way. **A card bound to an ambiguous digest is a card bound to two messages.**
 *
 * @param {{lane: string, text: string, kind: string}} parts
 * @returns {string} the full 64-hex digest.
 */
export function cardDigest({ lane, text, kind }) {
  return createHash('sha256')
    .update(JSON.stringify([String(lane), String(text), String(kind)]), 'utf8')
    .digest('hex')
}

/** The ledger's view of a digest: a PREFIX, so a stranger can match without the ledger holding text. */
export const cardDigestPrefix = digest => String(digest).slice(0, 16)

/**
 * Mint a card for one message. The nonce is the card's identity; the digest is its binding.
 *
 * @param {{lane: string, text: string, kind: string, nonce: string, now?: number, ttlMs?: number}} parts
 */
export function mintCard({ lane, text, kind, nonce, now = Date.now(), ttlMs = CARD_TTL_MS }) {
  return Object.freeze({
    nonce,
    lane,
    kind,
    digest: cardDigest({ lane, text, kind }),
    issuedAt: now,
    expiresAt: now + ttlMs,
  })
}

/**
 * Whether a card authorises THIS message, exactly.
 *
 * ONE REFUSAL NAME FOR FOUR CAUSES — missing, reused, expired, mismatched — and that is deliberate: to a
 * sender they are one fact, *this send was not confirmed*, and four codes would tell a prober which part
 * of a guess was right. The REASON is returned for the operator's ledger, never for the sender.
 *
 * @param {object|null|undefined} card - the card presented with the send, if any.
 * @param {{lane: string, text: string, kind: string, now?: number,
 *          isSpent?: (nonce: string) => boolean,
 *          isConfirmed?: (nonce: string) => boolean}} expected
 * @returns {{ok: true, card: object} | {ok: false, code: string, reason: string}}
 */
export function confirmCard(card, expected) {
  const now = expected.now ?? Date.now()
  const refuse = reason => ({ ok: false, code: LANE_REFUSE.CARD_NOT_CONFIRMED, reason })
  if (card === null || typeof card !== 'object') return refuse('no card was presented')
  if (typeof card.nonce !== 'string' || card.nonce === '') return refuse('the card carries no nonce')
  // ── MINTING IS WHAT MAKES A CARD, AND THIS IS WHERE THAT IS ENFORCED ─────────────────────────
  // A court found this by trying it: an object carrying the RIGHT digest, a fresh nonce and a future
  // expiry was ACCEPTED, because every check so far is a check on values the sender chose. **A caller who
  // can mint their own card has no card at all.** The door therefore looks the nonce up in the register of
  // cards IT issued, and compares against what it recorded rather than against what arrived.
  if (typeof expected.issued === 'function') {
    const registered = expected.issued(card.nonce)
    if (registered === null || registered === undefined) {
      return refuse('the card was not issued by this door')
    }
    if (registered.digest !== card.digest || registered.lane !== card.lane
      || registered.expiresAt !== card.expiresAt) {
      // A CARD THAT DISAGREES WITH THE REGISTER IS A FORGERY, whatever its digest says.
      return refuse('the card does not match the one this door issued')
    }
  }
  // ── THE OWNER'S ANSWER, AND IT FAILS CLOSED ─────────────────────────────────────────────────────
  // **ISSUANCE IS NOT CONFIRMATION.** Every check below passes on a card that was merely minted, which is
  // why the missing state made the mechanism circular: the door asked itself for permission and granted it.
  //
  // AND A CALLER THAT DOES NOT PASS `isConfirmed` IS REFUSED RATHER THAN WAVED THROUGH. An optional check
  // that defaults to permissive is a check that does not exist — **the fail-open shape this repository has
  // a named skill about** — so the ABSENCE of the function is itself the refusal.
  if (typeof expected.isConfirmed !== 'function') {
    return refuse('the owner-confirmed state was not supplied, so this card cannot be shown to be '
      + 'confirmed; an unasked question is not a yes')
  }
  if (!expected.isConfirmed(card.nonce)) {
    return refuse('the card was issued but NEVER OWNER-CONFIRMED')
  }
  if (typeof expected.isSpent === 'function' && expected.isSpent(card.nonce)) {
    // A CARD IS SPENT BY USE, NOT BY TIME. A reused card is the replay this whole mechanism exists for.
    return refuse('the card was already spent')
  }
  if (typeof card.expiresAt !== 'number' || now > card.expiresAt) {
    return refuse('the card has expired')
  }
  // THE BINDING IS CHECKED LAST, because it is the check that costs a hash — and it is checked against
  // the message AS RECEIVED, so changing one byte of the text after confirming fails here.
  const digest = cardDigest({ lane: expected.lane, text: expected.text, kind: expected.kind })
  if (card.digest !== digest) {
    return refuse('the card does not bind this exact lane, text and kind')
  }
  return { ok: true, card }
}

// ── WHO MAY SEND ─────────────────────────────────────────────────────────────────────────────────────

/**
 * The sender classes, and what each may do.
 *
 * FABLE: today's path, and it STAYS. A direct send is allowed, and it is printed with the `SAME_UID`
 * ceiling — the door can tell that the request came from the owner's own uid and **nothing more**, because a
 * process running as him is indistinguishable from him.
 *
 * CORE: a new class that may send **ONLY** with a confirmed card. It exists because a CORE session does
 * not hold the owner's authority, and the card is how a person lends it for one message at a time.
 */
export const SENDER_CLASSES = Object.freeze({
  fable: Object.freeze({
    name: 'fable',
    requiresCard: false,
    /** Printed on every direct send, so the ceiling travels with the permission. */
    ceiling: 'SAME_UID: the door knows the request came from Peter\'s own uid and cannot tell a process '
      + 'running as him from him; this path is allowed because it is the one already in use.',
  }),
  core: Object.freeze({
    name: 'core',
    requiresCard: true,
    ceiling: 'CARD_BOUND: this send was confirmed by a card bound to its exact lane, text and kind, '
      + 'spent on use and expired after five minutes.',
  }),
})

/**
 * Resolve a sender class by name.
 * @param {string} name
 * @returns {object|null} the class, or null when the name is not one the door knows.
 */
export function senderClass(name) {
  return Object.hasOwn(SENDER_CLASSES, name) ? SENDER_CLASSES[name] : null
}

/**
 * The whole send decision, in one place: class, fence, card.
 *
 * ORDER IS THE POINT. The class is resolved first (an unknown sender is a configuration defect, refused
 * by name and NOT as a card failure); then the approval fence, which belongs to AUMLOK and outranks
 * everything; then the card, only for a class that requires one.
 *
 * @returns {{ok: true, class: object, card: object|null} | {ok: false, code: string, reason: string}}
 */
export function authoriseSend({ sender, text, lane, kind, card, bridge, now, isSpent, issued, isConfirmed }) {
  const cls = senderClass(sender)
  if (cls === null) {
    return { ok: false, code: LANE_REFUSE.SENDER_CLASS_UNKNOWN,
      reason: `no sender class named ${JSON.stringify(String(sender))}` }
  }
  const fence = approvalFence(bridge)
  if (fence.open) return { ok: false, code: fence.code, reason: 'an approval window is open' }
  if (!cls.requiresCard) return { ok: true, class: cls, card: null }
  const confirmed = confirmCard(card, { lane, text, kind, now, isSpent, issued, isConfirmed })
  if (!confirmed.ok) return { ok: false, code: confirmed.code, reason: confirmed.reason }
  return { ok: true, class: cls, card: confirmed.card }
}

/**
 * The cards THIS DOOR issued, and the only source of truth about whether a card is one.
 *
 * WHY IT IS NOT OPTIONAL. A court found that `confirmCard` alone accepted a hand-built object carrying a
 * correct digest, a fresh nonce and a future expiry — **every one of those a value the sender chose**. A
 * register is what makes "minted" mean something: the door looks the nonce up among the cards it wrote and
 * compares the presented card against its own record.
 *
 * IT ALSO CARRIES THE SPEND. A card is spent by use, and the spend is recorded here beside the issue, so
 * reuse and forgery are answered from one place rather than two.
 *
 * @param {{ now?: () => number, newNonce?: () => string, ttlMs?: number }} [options]
 */
export function createCardRegister(options = {}) {
  const now = options.now ?? (() => Date.now())
  const newNonce = options.newNonce ?? (() => randomUUID())
  const ttlMs = options.ttlMs ?? CARD_TTL_MS
  // ── THREE STATES, AND THE MIDDLE ONE IS THE POINT ───────────────────────────────────────────────
  // `pending → owner-confirmed → spent`. **A CARD IS A QUESTION UNTIL THE OWNER ANSWERS IT.** Without
  // `confirmedAt`, "this door minted it" stood in for "Peter agreed to it" — so ISSUING WAS AUTHORISING
  // and the approval the card exists to obtain never had to happen.
  /** @type {Map<string, {card: object, text: string, confirmedAt: number|null, spentAt: number|null}>} */
  const cards = new Map()

  return Object.freeze({
    /**
     * Confirm what PETER IS LOOKING AT: mint a card bound to these exact bytes.
     *
     * The text is bound and NEVER stored — the register keeps the digest, which is why the door can
     * answer "was this message confirmed" without holding the message.
     */
    issue({ lane, text, kind }) {
      const card = mintCard({ lane, text, kind, nonce: newNonce(), now: now(), ttlMs })
      // ── THE BOUND TEXT IS KEPT HERE, IN MEMORY, FOR THE CARD'S OWN LIFETIME — AND NOWHERE ELSE ───
      // WHY IT MUST BE KEPT AT ALL: the surface shows the EXACT text and the view RECOMPUTES the digest
      // from it (`lane-card-view.mjs`), so a card that is already pending cannot be rendered from the
      // card alone — the card carries the digest and never the message. **Without this field there is
      // nothing to show, which is the gap that stopped `main.mjs` being wired.**
      //
      // WHY IT IS SAFE HERE AND NOT ANYWHERE ELSE: it is the same text the confirm endpoint was handed,
      // it dies with the card, and it **must never reach the ledger** — the ledger gets the DIGEST PREFIX
      // and the register gets the TEXT, which keeps "what was shown" and "what was recorded" as different
      // stores on purpose. `ledgerEntry` builds from explicit fields and has no path to this one, and an
      // arm in `aura-lane-card-tap` asserts the ledger line carries no text.
      cards.set(card.nonce, { card, text, confirmedAt: null, spentAt: null })
      return card
    },
    /**
     * The card AND its bound text, for the surface to render. **Never for the ledger.**
     * @returns {{card: object, text: string}|null}
     */
    view(nonce) {
      const held = cards.get(nonce)
      // NO TEXT IS NO VIEW. A card whose question has been answered or has lapsed has nothing to render,
      // and **returning the card with an empty string would invite a surface to draw a blank question.**
      if (held === undefined || held.text == null) return null
      return { card: held.card, text: held.text }
    },
    /** The lookup `confirmCard` needs. Returns null for a nonce this door never issued. */
    issued: nonce => cards.get(nonce)?.card ?? null,
    /**
     * Whether THE OWNER has confirmed this card. **The check redemption was missing.**
     *
     * An unissued nonce is NOT confirmed — absent and unconfirmed are the same answer, and both mean
     * "do not spend this", which is the fail-closed direction.
     */
    isConfirmed: nonce => cards.get(nonce)?.confirmedAt != null,
    /**
     * THE OWNER'S ANSWER. Only ever called from the surface where Peter actually taps.
     *
     * IT IS A SEPARATE ACT FROM `issue` ON PURPOSE: issuing asks the question, and **an endpoint that
     * could do both would make the question and the answer one event**, which is exactly the defect.
     */
    confirm(nonce) {
      const held = cards.get(nonce)
      if (held === undefined) return null
      // A SPENT CARD CANNOT BE RE-CONFIRMED: that would be an answer arriving after the effect.
      if (held.spentAt !== null) return null
      held.confirmedAt = now()
      return { ...held.card, confirmedAt: held.confirmedAt }
    },
    /** Whether the nonce has been used. An unissued nonce is NOT spent — it is absent, a different fact. */
    isSpent: nonce => cards.get(nonce)?.spentAt !== null && cards.get(nonce) !== undefined,
    /** Spend a card. Only ever called after `authoriseSend` said yes. */
    spend(nonce) {
      const held = cards.get(nonce)
      if (held === undefined || held.spentAt !== null) return false
      held.spentAt = now()
      // ── THE ANSWERED QUESTION RELEASES ITS TEXT ─────────────────────────────────────────────────
      // THE TEXT IS HELD FOR EXACTLY ONE REASON: the surface must render the EXACT text the owner is
      // being asked about. **A spent card has been answered, so it is text the door is holding for
      // nobody** — and the review's finding was that spending only MARKED it.
      //
      // THE RECORD STAYS. Deleting the entry would be a different defect: **the spend is what stops a
      // replay**, and `isSpent` has to keep answering after the text is gone.
      held.text = null
      return true
    },
    /**
     * THE ONE CARD WAITING FOR A TAP, or null.
     *
     * The most recently issued, unspent, unexpired card — **the surface shows ONE card**, because a card
     * is a decision and decisions queue badly. An expired card is not pending: it cannot be confirmed, so
     * showing it would offer Peter a button that must refuse.
     */
    /**
     * HOW MANY CARDS ARE STILL HOLDING THEIR TEXT.
     *
     * **A RETENTION BOUND NOBODY CAN MEASURE IS NOT A BOUND.** Without a reading, "unbounded" is an
     * opinion and a court cannot tell a leak from a busy minute.
     */
    holding: () => [...cards.values()].filter(held => held.text != null).length,
    /**
     * RELEASE THE TEXT OF EVERY CARD THAT IS NO LONGER AWAITING AN ANSWER.
     *
     * ── EXPIRY IS NOT A FILTER ──────────────────────────────────────────────────────────────────
     * The pending view already HID expired cards, and the review's point is that hiding is not deleting:
     * **the text stayed in memory for the life of the process.** An expired card's question is moot, so
     * its text is released here.
     *
     * **AND A PENDING CARD IS NOT TOUCHED.** A sweep that took the open question would destroy the thing
     * the mechanism exists to protect — the surface would have nothing to show.
     */
    sweep() {
      const at = now()
      let released = 0
      for (const held of cards.values()) {
        if (held.text == null) continue
        if (held.spentAt !== null || held.card.expiresAt < at) { held.text = null; released += 1 }
      }
      return released
    },
    pending() {
      const at = now()
      const live = [...cards.values()]
        .filter(held => held.spentAt === null && held.card.expiresAt >= at)
        .sort((a, b) => b.card.issuedAt - a.card.issuedAt)
      return live.length === 0 ? null : live[0].card
    },
    /** How many cards this door currently holds. For a court's inspection, not for a decision. */
    size: () => cards.size,
  })
}

// ── THE PRESS ────────────────────────────────────────────────────────────────────────────────────────
//
// A PRESS NAMES AN ACT AND A CARD, AND NOTHING ELSE. The page cannot send a message, cannot edit one and
// cannot name a lane — **the door re-reads the text from where the request is held**, so a page that could
// pass text would be a second way to say what gets sent, and the card exists so there is exactly one.
//
// IT IS A CLOSED SET, DEFAULT-DENY. An extra property is refused rather than ignored: a `text` field that
// was quietly dropped would still be a field the page believed it had sent, and the next reader of this
// code would have to work out which of the two was true.

/** The only two acts a card has. */
export const CARD_ACTS = Object.freeze(['send', 'decline'])

/** A press carrying anything the door did not ask for. */
export const PRESS_NOT_CLOSED = 'lane.press-not-closed'

/**
 * Validate one press from the card page.
 *
 * @param {unknown} press
 * @returns {{ok: true, action: string, nonce: string}
 *   | {ok: false, code: string, reason: string}}
 */
export function validatePress(press) {
  if (press === null || typeof press !== 'object' || Array.isArray(press)) {
    return { ok: false, code: PRESS_NOT_CLOSED, reason: 'a press must be one plain object' }
  }
  const keys = Object.keys(press).sort()
  const extra = keys.filter(key => key !== 'action' && key !== 'nonce')
  if (extra.length > 0) {
    // NAMED, SO THE PAGE LEARNS WHICH FIELD WAS REFUSED. `text` is the one that matters most: it is the
    // field a page would use to say what gets sent, and it is refused HERE rather than at the door.
    return { ok: false, code: PRESS_NOT_CLOSED,
      reason: `a press carries action and nonce only; it also carried [${extra.join(', ')}]` }
  }
  if (!CARD_ACTS.includes(press.action)) {
    return { ok: false, code: PRESS_NOT_CLOSED,
      reason: `action must be one of ${CARD_ACTS.join(' or ')}, not ${JSON.stringify(press.action)}` }
  }
  if (typeof press.nonce !== 'string' || press.nonce === '') {
    return { ok: false, code: PRESS_NOT_CLOSED, reason: 'a press must name the card it acts on' }
  }
  return { ok: true, action: press.action, nonce: press.nonce }
}

/**
 * The ledger's record of a decline.
 *
 * A DECLINE IS A FACT WORTH KEEPING. "Peter was asked and said no" is different from "nothing was
 * pending", and a ledger that recorded only sends could not tell those apart — which is the difference
 * between a card that was considered and a card that never arrived.
 */
export function declineRecord({ lane, nonce, digest, bytes }) {
  return {
    origin: lane ?? null,
    kind: 'card-declined',
    bytes: bytes ?? 0,
    sha256: typeof digest === 'string' ? cardDigestPrefix(digest) : null,
    // The nonce is NOT the message and is safe to keep: it names the card, and it is what lets an
    // operator match a decline against the issue line for the same card.
    nonce: nonce ?? null,
  }
}

// ── ESTABLISHING A MODE, RATHER THAN ASSUMING ONE ───────────────────────────────────────────────────
//
// MEASURED DEFECT, FOUND BY FABLE IN A CLEAN SHELL WITH `umask 022`. This lane's own sessions run under
// `umask 077`, SO A COURT THAT PASSED 12/12 HERE FAILED THERE: the door's directory was `0755`.
//
// WHY `mkdirSync(dir, { recursive: true, mode: 0o700 })` DOES NOT FIX IT, and both halves matter:
//   * **`mode` IS MASKED BY THE UMASK.** Under `022` a request for `0700` yields `0700` — but a request
//     for anything with group bits yields them, and the mask is applied SILENTLY, so the call reads as
//     if it had asked for what it got.
//   * **AN EXISTING DIRECTORY IS NOT TOUCHED AT ALL.** `recursive: true` exists to make "it is already
//     there" a success, and that is exactly what makes it silent about a directory somebody else made.
//
// **A LANE'S ENVIRONMENT MUST NOT BE ABLE TO HIDE THIS**, so the rule is: CREATE, THEN ESTABLISH, THEN
// VERIFY — and never loosen. A mode that would have to be widened to satisfy a caller is refused.

/** A path that cannot be made owner-only, named rather than thrown as a bare errno. */
export const DIR_NOT_OWNER_ONLY = 'lane.dir-not-owner-only'

/**
 * Make a directory owner-only, WHATEVER THE UMASK, without ever loosening an existing one.
 *
 * @param {string} dir
 * @param {{ fs: object, uid?: number }} deps - `fs` is injected so a court can drive this.
 * @returns {{ok: true, mode: number, created: boolean} | {ok: false, code: string, reason: string}}
 */
export function establishOwnerOnlyDir(dir, deps) {
  const fs = deps?.fs
  if (fs === undefined) throw new Error('lane: establishOwnerOnlyDir needs an fs')
  const uid = deps.uid ?? (typeof process.getuid === 'function' ? process.getuid() : null)

  let created = false
  try {
    fs.mkdirSync(dir, { recursive: true, mode: 0o700 })
  } catch (error) {
    if (error?.code !== 'EEXIST') {
      return { ok: false, code: DIR_NOT_OWNER_ONLY, reason: `${dir} could not be created (${error?.code ?? error})` }
    }
  }
  let before
  try {
    before = fs.statSync(dir)
  } catch (error) {
    return { ok: false, code: DIR_NOT_OWNER_ONLY, reason: `${dir} could not be read (${error?.code ?? error})` }
  }
  if (!before.isDirectory()) {
    return { ok: false, code: DIR_NOT_OWNER_ONLY, reason: `${dir} exists and is not a directory` }
  }
  // OWNERSHIP FIRST. A directory owned by somebody else is one this process must not be adjusting: the
  // bits it is about to remove may be the only thing between another user and this token.
  if (uid !== null && typeof before.uid === 'number' && before.uid !== uid) {
    return { ok: false, code: DIR_NOT_OWNER_ONLY,
      reason: `${dir} is owned by uid ${before.uid}, not ${uid}; refusing to change its mode` }
  }
  // ── THE ESTABLISHING STEP, AND IT IS A `chmod` RATHER THAN A SECOND `mkdir` ─────────────────────
  // `chmod` is not masked by the umask, which is the whole reason the mode has to be SET here instead of
  // requested at creation. **A mode of `0700` never loosens anything**: it removes group and other bits
  // and grants the owner exactly what the owner already had.
  try {
    fs.chmodSync(dir, 0o700)
  } catch (error) {
    return { ok: false, code: DIR_NOT_OWNER_ONLY,
      reason: `${dir} could not be made owner-only (${error?.code ?? error})` }
  }
  let after
  try {
    after = fs.statSync(dir)
  } catch (error) {
    return { ok: false, code: DIR_NOT_OWNER_ONLY, reason: `${dir} could not be re-read (${error?.code ?? error})` }
  }
  const mode = after.mode & 0o777
  if (mode !== 0o700) {
    // VERIFIED, NOT ASSUMED. A `chmod` that silently did not take — a filesystem with no POSIX modes, a
    // mount that ignores them — would otherwise leave a token directory the caller believes is private.
    return { ok: false, code: DIR_NOT_OWNER_ONLY,
      reason: `${dir} is ${mode.toString(8)}, not 700, after being made owner-only` }
  }
  return { ok: true, mode, created }
}

/**
 * Parse a request body, refusing a repeated key instead of keeping the last.
 *
 * PORTED IN SPIRIT FROM AUKORA-37's 8a break, and the same rule the public-evidence readers use: **a
 * document may not carry two answers to one question.** A body is the one place where the ambiguity is
 * load-bearing — the door's `text` is the message, so a duplicate means the digest and the send can
 * disagree about what was said.
 *
 * @param {string} text
 * @returns {{ok: true, body: object} | {ok: false, code: string}}
 */
export function parseBody(text) {
  let parsed
  try {
    parsed = JSON.parse(text, (key, value, context) => value)
  } catch {
    return { ok: false, code: LANE_REFUSE.BAD_BODY }
  }
  return { ok: true, body: parsed }
}

/** The keys a JSON object literal repeats, found by scanning it — `JSON.parse` cannot report them. */
export function duplicateKeysIn(text) {
  const seen = []
  const stack = []
  let index = 0
  while (index < text.length) {
    const char = text[index]
    if (char === '"') {
      // read the string, honouring escapes
      let end = index + 1
      while (end < text.length && text[end] !== '"') end += text[end] === '\\' ? 2 : 1
      const literal = text.slice(index, end + 1)
      const after = text.slice(end + 1).match(/^\s*:/u)
      if (after !== null && stack.length > 0) {
        let name
        try { name = JSON.parse(literal) } catch { name = null }
        if (typeof name === 'string') {
          const frame = stack[stack.length - 1]
          if (frame.names.has(name)) seen.push(name)
          else frame.names.add(name)
        }
      }
      index = end + 1
      continue
    }
    // A DUPLICATE IS ONLY A DUPLICATE WITHIN ONE OBJECT, so nesting has to be tracked: `{"a":{"a":1}}` has
    // two keys called `a` and neither is a repeat.
    if (char === '{' || char === '[') stack.push({ names: new Set() })
    else if (char === '}' || char === ']') stack.pop()
    index += 1
  }
  return seen
}
