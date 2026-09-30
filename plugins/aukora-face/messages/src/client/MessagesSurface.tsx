/**
 * Person-to-person Messages as a copy of the thread lane: the same brand row, filter
 * cluster, card rows, open-conversation view, and composer — blue accent instead of mint.
 *
 * ONE SOURCE, NAMED ON THE SURFACE. The rows come from this node's contacts, read from the host
 * route through `contacts-client.ts`, and each carries the one thing that is actually known about
 * who is on the other end: VERIFIED, TEST, UNBOUND or FOREIGN. Nothing on this surface is
 * invented. The two ways a read can come back empty are two different facts and each is said in
 * its own words: a listing with nobody in it says there are no contacts yet and what to do about
 * it, and a read that failed says so and names the reason the host returned. The status line and
 * the source line say which read is on screen and which directory was read, so a reader never has
 * to guess where a row came from — and no reader is ever shown a conversation nobody had.
 *
 * A SAS IS SHOWN ONLY WHERE ONE EXISTS. `contact.sas` is non-null only when a binding
 * actually verified — TEST and VERIFIED carry one, UNBOUND and FOREIGN do not — and where it
 * is null the row shows a sentence saying so. It never shows a placeholder, a dash, or
 * anything else that could be mistaken for digits to compare: the whole point of the four
 * states is that nobody reads a string aloud for an identity that was never proven.
 *
 * A SEND IS ONLY SHOWN AS SENT WHEN A RELAY ACCEPTED IT. The send route — the endpoint
 * constants live in `../messages-route.ts` and are never spelled here — answering 200 is not
 * delivery: the response body names the relays that accepted the message, `ok` is derived
 * from that list, and a body that names none is rendered as not delivered, in the same place
 * a successful send would have been confirmed.
 *
 * AND THE AGGREGATE IS NOT THE OUTCOME. One NIP-17 send publishes a copy to the recipient and
 * a copy to this node's own key, and either can be refused on its own, so `ok: true` can mean
 * "your friend has it" OR "only your own copy was kept" — two different facts a flat list
 * collapses into one word. The receipt therefore reads the send body's per-copy outcomes and
 * says which copy the relays kept, naming a refusal wherever one happened. A refused copy is
 * NEVER rendered as delivered: if either copy was refused, the sentence says so even though the
 * aggregate says the send succeeded, because the aggregate is what the route reports and the
 * per-copy sentence is what the person is owed.
 */
import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import clsx from 'clsx'
import { checkAddContact } from './add-contact.ts'
import type { PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type { MessagesKey } from './locales.ts'
import {
  readContacts, readThread, sendMessage, readIdentity,
  postContact,
  type ContactsFailure, type WireContact, type WireCopyOutcome, type WireSas, confirmSas,
} from './contacts-client.ts'
import type { MessagesThreadBody, MessagesWireContactState } from '../messages-route.ts'
import {
  ArchiveIcon, BackIcon, ChatMarkIcon, CloseIcon, ForeignStateIcon, InfoIcon, PinIcon, PlusIcon, RefreshIcon,
  SasAbsentIcon, SasIcon, SearchIcon, SendDeliveredIcon, SendIcon, SendPartialIcon, SendPendingIcon,
  SendRefusedIcon, ShieldIcon, TestStateIcon, UnboundStateIcon, UnreadIcon, VerifiedStateIcon,
} from './MessagesIcons.tsx'
import css from './Messages.module.css'

// Escape inside a text-entry control edits that control, never the surface.
// Duck-typed so a target from another realm classifies identically.
function isEditableTarget(target: EventTarget | null): boolean {
  const el = target as { tagName?: unknown; isContentEditable?: unknown } | null
  const tag = typeof el?.tagName === 'string' ? el.tagName : ''
  return el?.isContentEditable === true || tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT'
}

/**
 * Connection state of the messaging engine. `not-connected` and `contacts-only` are what
 * this surface can observe today; `connected` arrives with the engine in the core
 * repository and must extend this union rather than bypass it, so the runtime-posture copy
 * stays keyed to one closed vocabulary.
 */
export type MessagingStatus = 'not-connected' | 'contacts-only' | 'connected'

/** Runtime-posture copy keys for each messaging-engine state. */
const RUNTIME_POSTURE = {
  'not-connected': { status: 'runtime.status' },
  'contacts-only': { status: 'runtime.status.contacts-only' },
  'connected': { status: 'runtime.status.connected' },
} as const satisfies Record<MessagingStatus, Record<'status', MessagesKey>>

/** Which read the rows under the status line came from. */
type ContactsScene = 'contacts' | 'contacts-reading' | 'contacts-empty' | 'contacts-failed'

/** The copy for each scene: what the rows are, and which of them the source line names. */
const SCENE = {
  'contacts': { source: 'source.contacts' },
  'contacts-reading': { source: 'source.contacts.reading' },
  'contacts-empty': { source: 'source.contacts.empty' },
  'contacts-failed': { source: 'source.contacts.failed' },
} as const satisfies Record<ContactsScene, Record<'source', MessagesKey>>

/**
 * The one thing known about each contact, as copy. The four states are the wire's own
 * vocabulary (`messages-route.ts`), and every state carries a badge word, a sentence for
 * the badge's `title` and its visually-hidden label, and the honest alternative to a SAS.
 */
const CONTACT_STATE: Record<MessagesWireContactState, {
  badge: MessagesKey
  detail: MessagesKey
  title: MessagesKey
  sasAbsent: MessagesKey
}> = {
  // BOUND AND VERIFIED ARE TWO FACTS AND THE WIRE ALREADY CARRIES BOTH (`messages-route.ts:186`). BOUND is the
  // key that checks out with nobody having confirmed it in person; VERIFIED is a SIGNED confirmation, which is
  // something a second person does and which the owner signer's unbuilt `confirm-nostr-sas` window is how a
  // person would make. Neither copy may borrow the other's word: the first version of this change mapped
  // VERIFIED onto BOUND's sentence, which erased the distinction Beta's wire keeps.
  VERIFIED: {
    badge: 'state.VERIFIED.word',
    detail: 'state.VERIFIED.detail',
    title: 'state.VERIFIED.title',
    sasAbsent: 'sas.absent.VERIFIED',
  },
  BOUND: {
    badge: 'state.BOUND.word',
    detail: 'state.BOUND.detail',
    title: 'state.BOUND.title',
    sasAbsent: 'sas.absent.BOUND',
  },
  TEST: {
    badge: 'state.TEST.word',
    detail: 'state.TEST.detail',
    title: 'state.TEST.title',
    sasAbsent: 'sas.absent.TEST',
  },
  UNBOUND: {
    badge: 'state.UNBOUND.word',
    detail: 'state.UNBOUND.detail',
    title: 'state.UNBOUND.title',
    sasAbsent: 'sas.absent.UNBOUND',
  },
  FOREIGN: {
    badge: 'state.FOREIGN.word',
    detail: 'state.FOREIGN.detail',
    title: 'state.FOREIGN.title',
    sasAbsent: 'sas.absent.FOREIGN',
  },
} satisfies Record<MessagesWireContactState, {
  badge: MessagesKey
  detail: MessagesKey
  title: MessagesKey
  sasAbsent: MessagesKey
}>

/**
 * Fold the initial letters of a name, uppercased, for the avatar seat.
 * @param name - the contact's display name.
 * @returns one or two characters.
 */
function initialOf(name: string): string {
  const parts = name.trim().split(/\s+/u).filter(part => part !== '')
  if (parts.length === 0) return '?'
  if (parts.length === 1) return parts[0]?.slice(0, 1).toUpperCase() ?? '?'
  const first = parts[0]?.slice(0, 1) ?? ''
  const last = parts[parts.length - 1]?.slice(0, 1) ?? ''
  return `${first}${last}`.toUpperCase()
}

/** The state glyph for one contact state. Distinct shapes, so the badges survive colour. */
function stateIcon(state: MessagesWireContactState) {
  switch (state) {
    case 'VERIFIED': return <VerifiedStateIcon />
    case 'TEST': return <TestStateIcon />
    case 'UNBOUND': return <UnboundStateIcon />
    case 'FOREIGN': return <ForeignStateIcon />
  }
}

/**
 * The state badge: a glyph, the state WORD, a `title`, and a visually-hidden sentence.
 *
 * THE WORD IS SHORT AND THE SENTENCE IS NOT LOST. The badge used to show `state.<STATE>.detail` — a whole sentence
 * like "the key checks out; nobody has confirmed it in person" — which at 10px is about sixty characters, so in a
 * third-width pane the badge measured 369px inside 341px and its right edge left the surface. Shrinking it would
 * only have ellipsised the sentence into "the key checks out; nobo…", so the visible word is now the state's own
 * short name and the sentence lives in TWO places that can hold it: the `title` a pointer reveals, and the
 * visually-hidden span that gives the badge its accessible name.
 *
 * Colour is the fourth signal, never the only one.
 * @param props - the state, the copy, and the translate function.
 * @returns the badge element.
 */
function StateBadge({ state, t }: {
  readonly state: MessagesWireContactState
  readonly t: PropsLocale<'messages'>['t']
}) {
  const copy = CONTACT_STATE[state]
  return (
    <span className={css.badge} data-state={state} title={t(copy.title)}>
      {stateIcon(state)}
      <span className={css.badgeWord}>{t(copy.badge)}</span>
      <span className={css.visuallyHidden}>{t(copy.title)}</span>
    </span>
  )
}

interface SasSeatProps {
  /** The state the badge shows; the row's state, or the thread's own when it reports one. */
  readonly state: MessagesWireContactState
  /** The string to read aloud, or null when no binding verified. */
  readonly sas: WireSas | null
  readonly t: PropsLocale<'messages'>['t']
}

/**
 * The SAS seat beside a contact: the string to read aloud when a binding verified, and a
 * sentence — never a stand-in value — when it did not.
 * @param props - the state, the SAS or its absence, and the translate function.
 * @returns the SAS row or the honest alternative to it.
 */
function SasSeat({ state, sas, t }: SasSeatProps) {
  if (sas !== null) {
    return (
      <span className={css.sas} data-sas="present" data-state={state}>
        <span className={css.sasGlyph}><SasIcon /></span>
        <span className={css.sasBody}>
          <span className={css.sasLabel}>
            {t('sas.label')}
            <span className={css.visuallyHidden}>{`: ${t('sas.spoken')}`}</span>
          </span>
          <span className={css.sasDigits} data-sas-spoken={sas.spoken}>{sas.spoken}</span>
          <span className={css.sasHint}>{t('sas.hint')}</span>
        </span>
      </span>
    )
  }
  return (
    <span className={css.sasAbsent} data-sas="absent" data-state={state}>
      <span className={css.sasAbsentGlyph}><SasAbsentIcon /></span>
      <span className={css.sasBody}>
        <span className={css.sasLabel}>{t('sas.label')}</span>
        <span className={css.sasAbsentText}>{t(CONTACT_STATE[state].sasAbsent)}</span>
      </span>
    </span>
  )
}

/**
 * The one trust mark a row carries: a shield, in the state's own colour, with the state's own
 * sentence as its accessible name.
 *
 * THE ROW DOES NOT SPELL TRUST. It was a badge with a word, a key fragment and a box of digits —
 * three separate claims in one row, which is what "too many little texts, badges and boxes" was
 * about. Here there is one mark, and the words it used to carry live in the verify sheet this mark's
 * own row opens: the state's sentence is the mark's `aria-label`, so a screen reader is told the exact
 * state, and a reader who wants it in words taps the row's conversation and the chip in it.
 *
 * @param props - the resolved state and the translate function.
 * @returns the row's trust mark.
 */
function TrustMark({ state, t }: {
  readonly state: MessagesWireContactState
  readonly t: PropsLocale<'messages'>['t']
}) {
  const spoken = t(CONTACT_STATE[state].detail)
  return (
    <span
      className={css.trustMark}
      data-state={state}
      data-trust-mark={state}
      role="img"
      aria-label={spoken}
      title={spoken}
    >
      <ShieldIcon size={13} verified={state === 'VERIFIED'} />
    </span>
  )
}

/** One labelled line in a sheet: a label, and the value with the form the value needs. */
interface SheetRow {
  readonly label: string
  /** The value as text, or null when the sheet renders something richer in its place. */
  readonly value: string | null
  /** Render in the monospace face: keys and paths, where a character-by-character read matters. */
  readonly mono?: boolean
  /** A stable hook for the value element, so a court can read one row without guessing at prose. */
  readonly ref?: string
}

/**
 * The sheet both of the surface's one-tap layers sit in: a panel over the lane, a title, one way out.
 *
 * It is positioned inside the surface rather than the viewport, because the surface is what has a
 * width: a fixed panel would cover the shell and measure the window instead of the lane.
 *
 * @param props - the title, the close label, a test hook, the close action, and the body.
 * @returns the sheet.
 */
function Sheet({ title, closeLabel, hook, onClose, children }: {
  readonly title: string
  readonly closeLabel: string
  readonly hook: string
  readonly onClose: () => void
  readonly children: ReactNode
}) {
  return (
    <div className={css.sheetBackdrop} data-messages-sheet={hook} onClick={onClose}>
      <div
        className={css.sheet}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        onClick={(event) => { event.stopPropagation() }}
      >
        <header className={css.sheetHeader}>
          <h3 className={css.sheetTitle} data-fit="name">{title}</h3>
          <button type="button" className={css.iconButton} aria-label={closeLabel} onClick={onClose}>
            <CloseIcon />
          </button>
        </header>
        <div className={css.sheetBody}>{children}</div>
      </div>
    </div>
  )
}

/**
 * The verify sheet: the whole truth about one contact's identity, one tap from the chip that says
 * "Unverified" and one tap from the row's shield.
 *
 * THE READ-ALOUD DIGITS LIVE HERE, and this is the only place they live. A string two people compare
 * by voice is not a thing to put in a list row: it is a deliberate act, it takes two of them, and a
 * row that shows digits beside a name invites a reader to treat them as decoration. Where no binding
 * verified, the sheet says that in a sentence — never a dash, never a placeholder, never anything
 * shaped like a code.
 *
 * @param props - the state, the SAS or its absence, the copy, and the close action.
 * @returns the verify sheet.
 */
function VerifySheet({ state, sas, contact, npub, onConfirmed, t, onClose }: {
  readonly state: MessagesWireContactState
  readonly sas: WireSas | null
  readonly contact: string
  /** THE ADDRESS, which is what the route confirms. `contact` is a display name and may be either. */
  readonly npub: string
  /** Called after a confirmation the host accepted, so the row can be re-read and show VERIFIED. */
  readonly onConfirmed: () => void
  readonly t: PropsLocale<'messages'>['t']
  readonly onClose: () => void
}) {
  // THE CONFIRMATION IS NOT RENDERED UNTIL THE DIGITS ARE. A button that says "I compared these digits" on a
  // sheet showing no digits is a button that confirms nothing, so the whole block is absent rather than
  // disabled — unreachable is a decision about rendering, not an attribute, and there is nothing here for a
  // reader or a script to reach before the six digits are on screen.
  const [refusal, setRefusal] = useState<string | null>(null)
  // THE WAIT IS REAL AND IT IS LONG: the button asks the host, the host asks the shell signer, and the
  // signer opens a window for a person to decide in. So the button disables itself while that is
  // happening — a second press would raise a second request and a second challenge.
  const [asking, setAsking] = useState(false)
  const ask = async (): Promise<void> => {
    setAsking(true)
    setRefusal(null)
    const answer = await confirmSas(npub)
    setAsking(false)
    // A REFUSAL IS SHOWN UNDER ITS OWN NAME, never softened into a success and never paraphrased: the
    // signer's decline, a reply that did not carry the challenge back, and a signature that did not
    // verify are three different facts and the person is entitled to the one that happened.
    if (answer.kind === 'failed') {
      setRefusal(answer.failure.kind === 'refused' ? answer.failure.reason : answer.failure.detail)
      return
    }
    // CONFIRMED: re-read the list rather than setting a local flag. The row's state comes from the host,
    // and a screen that decided on its own that a contact is VERIFIED would be showing a claim the host
    // had not made.
    onConfirmed()
    onClose()
  }
  return (
    <Sheet title={t('verify.title')} closeLabel={t('sheet.close')} hook="verify" onClose={onClose}>
      <div className={css.sheetBadgeRow}>
        <StateBadge state={state} t={t} />
      </div>
      <p className={css.sheetSentence} data-verify-state={state}>{t(CONTACT_STATE[state].title)}</p>
      <SasSeat state={state} sas={sas} t={t} />
      {sas !== null && (
        <div className={css.verifyConfirm}>
          <button
            type="button"
            className={css.verifyConfirmButton}
            data-verify-confirm="available"
            disabled={asking}
            onClick={() => { void ask() }}
          >
            {t('verify.confirm.button', { contact })}
          </button>
          <p className={css.verifyConfirmNote} data-verify-confirm-note={refusal === null ? (asking ? 'asking' : 'ready') : 'refused'}>
            {refusal ?? t('verify.confirm.ready')}
          </p>
        </div>
      )}
    </Sheet>
  )
}

/**
 * The details sheet: everything true about this conversation or this read that a row must not carry.
 *
 * Peter's rule, applied literally: nothing true gets deleted, it moves one tap away. The key was on
 * every row as a slice; here it is whole. The path the listing was read from was a monospace line
 * under the list; here it is a labelled value. "Relays that answered" was a paragraph in the middle
 * of a conversation; here it is a row. And the receipt sentences — which a mark cannot carry — are
 * rows beside the same outcome the mark shows.
 *
 * @param props - the rows, the copy, and the close action.
 * @returns the details sheet.
 */
function DetailsSheet({ rows, t, onClose }: {
  readonly rows: readonly SheetRow[]
  readonly t: PropsLocale<'messages'>['t']
  readonly onClose: () => void
}) {
  return (
    <Sheet title={t('details.title')} closeLabel={t('sheet.close')} hook="details" onClose={onClose}>
      {rows.map(row => (
        <div className={css.sheetRow} key={row.label} data-details-row={row.ref ?? undefined}>
          <span className={css.sheetLabel}>{row.label}</span>
          {row.value !== null && (
            row.mono === true
              ? <code className={css.npub} data-details-value={row.ref ?? undefined}>{row.value}</code>
              : <span className={css.sheetValue} data-details-value={row.ref ?? undefined}>{row.value}</span>
          )}
        </div>
      ))}
    </Sheet>
  )
}

/**
 * THE ADD-CONTACT SHEET: THE ONLY WAY A CONVERSATION WITHOUT A COUNTERPARTY CAN BE STARTED, WHICH IS TO SAY
 * IT CANNOT BE.
 *
 * Three fields, and every one of them is checked before the host is asked anything: the npub is DECODED as
 * bech32 (`checkNpub`), the controller key must be 64 lower-case hex, and the name must exist. A refusal is
 * shown INLINE, WITH THE NAME THE HOST OR THE CHECKER GAVE IT — never a toast, never a silent close, because a
 * person who typed a key is owed the reason it was not written.
 *
 * ON ALREADY-PRESENT THERE IS NO SECOND PRESS. The route refuses to overwrite an existing contact, so a submit
 * button left on screen could only fail again; where the refusal is that one, the button is not rendered at all.
 *
 * ON SUCCESS THE ROW COMES FROM THE HOST, NOT FROM HERE: `onAdded` re-reads the contacts, so the row that
 * appears is the host's own — including its state, which is UNBOUND until somebody confirms that key in person.
 *
 * @param props - the copy, the close action, and the re-read to run once a contact exists.
 * @returns the add-contact sheet.
 */
function AddContactSheet({ t, onClose, onAdded }: {
  readonly t: PropsLocale<'messages'>['t']
  readonly onClose: () => void
  readonly onAdded: () => void
}) {
  const [draft, setDraft] = useState({ name: '', npub: '', controller: '' })
  const [refusal, setRefusal] = useState<{ readonly reason: string; readonly detail: string } | null>(null)
  const [sending, setSending] = useState(false)
  // THE ROUTE REFUSES TO OVERWRITE, SO THE SHEET DOES NOT OFFER TO. One code, and no second press.
  const noRetry = refusal?.reason === 'messages:add-already-present'
  const ready = draft.name.trim() !== '' && draft.npub.trim() !== ''
  const submit = (): void => {
    const checked = checkAddContact(draft)
    if (checked.ok !== true) {
      setRefusal({ reason: checked.reason, detail: checked.detail })
      return
    }
    setSending(true)
    void postContact(checked.body).then((read) => {
      setSending(false)
      if (read.kind === 'added') {
        setRefusal(null)
        onAdded()
        onClose()
        return
      }
      setRefusal(read.kind === 'refused'
        ? { reason: read.reason, detail: read.detail }
        : { reason: 'messages:add-unreachable', detail: read.detail })
    })
  }
  return (
    <Sheet title={t('add.title')} closeLabel={t('sheet.close')} hook="add" onClose={onClose}>
      <div className={css.addForm}>
        <label className={css.addField}>
          <input
            className={css.addInput}
            value={draft.name}
            aria-label={t('add.name')}
            placeholder={t('add.name')}
            data-add-field="name"
            onChange={(event) => { setDraft({ ...draft, name: event.target.value }) }}
          />
        </label>
        <label className={css.addField}>
          <input
            className={css.addInput}
            value={draft.npub}
            aria-label={t('add.npub')}
            placeholder={t('add.npub')}
            data-add-field="npub"
            spellCheck={false}
            autoComplete="off"
            onChange={(event) => { setDraft({ ...draft, npub: event.target.value }) }}
          />
        </label>
        <label className={css.addField}>
          <input
            className={css.addInput}
            value={draft.controller}
            aria-label={t('add.controller')}
            placeholder={t('add.controller')}
            data-add-field="controller"
            spellCheck={false}
            autoComplete="off"
            onChange={(event) => { setDraft({ ...draft, controller: event.target.value }) }}
          />
        </label>
        {noRetry !== true && (
          <button
            type="button"
            className={css.addSubmit}
            data-add-submit="ready"
            disabled={sending || ready !== true}
            onClick={submit}
          >
            {t('add.submit')}
          </button>
        )}
      </div>
      {refusal !== null && (
        <span className={css.addRefusal} data-add-refusal={refusal.reason} role="alert"
          aria-label={refusal.detail} title={refusal.detail}>
          <ForeignStateIcon />
        </span>
      )}
    </Sheet>
  )
}

/** The short way to say "a send of yours is not in a state a sentence-less mark can leave unsaid". */
// **FIVE STATES, AND THE FIFTH WAS THE MISSING ONE.** It used to be four, and an ACCEPTED receipt whose per-copy
// outcomes had not been read was rendered as `refused` — the aggregate said the message was accepted and the mark said
// it was refused, a false statement about a message somebody sent. `unknown` says what is true: the send was accepted
// and what each copy did has not been read.
type MarkState = 'pending' | 'delivered' | 'partial' | 'refused' | 'unknown'

/** The glyph for each mark state, so the four are four shapes and never four colours alone. */
const MARK_ICON = {
  'pending': SendPendingIcon,
  'delivered': SendDeliveredIcon,
  'partial': SendPartialIcon,
  'refused': SendRefusedIcon,
  // **`unknown` WAS ADDED TO `MarkState` AND NOT TO THIS MAP, AND THE COMPILER SAID SO IN A WAY THAT POINTED
  // ELSEWHERE.** The error read *"Type '{ readonly pending: … }' does not satisfy …"* — **a wall of type text whose
  // second clause was the whole answer: *"Property 'unknown' is missing … but required in
  // 'Record<MarkState, …>'."*** Reading the first clause and stopping suggested a props or return mismatch,
  // **and three candidate causes that all turned out to be fine.** The missing PROPERTY was the cause.
  //
  // **THE GLYPH IS `RefreshIcon`, AND THAT IS A CHOICE RATHER THAN A DISCOVERY.** No `UnknownIcon` exists in
  // `MessagesIcons.tsx`, **and the comment above this map states the rule — *"the four are four shapes and never four
  // colours alone"* — so a fifth state needs a fifth SHAPE, which is a drawing rather than a line of code.** The
  // state's own comment says what it means: *"the send was accepted and what each copy did has not been read."*
  // `RefreshIcon` carries that sense of *not yet resolved* and is already imported. **If the owner wants a distinct
  // glyph, this is the one line to change — and the type is honest in the meantime, which it was not before.**
  'unknown': RefreshIcon,
} as const satisfies Record<MarkState, (props: { size?: number }) => ReactNode>

/**
 * Which mark a receipt earns, read from the send's per-copy outcome rather than from the aggregate.
 *
 * `not-accepted` IS REFUSED WHATEVER THE COPIES SAY. The route sets it when no relay took the send or
 * the aggregate is false, and the one thing this mark must never do is show the two-check state over a
 * message nobody took. An `accepted` send is only `delivered` when every copy this send reported was
 * accepted; a copy that was refused lands on `partial`, which is the mark that exists because the
 * aggregate cannot tell "your friend has it" from "only your own copy was kept".
 *
 * @param receipt - what the host said about the newest send in this conversation.
 * @param outcome - the per-copy outcome, or undefined when the receipt carries no copies.
 * @returns the mark state.
 */
function markOf(receipt: SendReceipt, outcome: CopyOutcome | undefined): MarkState {
  switch (receipt.kind) {
    case 'pending': return 'pending'
    case 'failed': return 'refused'
    case 'not-accepted': return 'refused'
    // AN ACCEPTED SEND WHOSE COPIES WERE NOT READ IS NOT A REFUSAL. It is the case this panel could not previously
    // express, and saying `refused` about it was the honest-empty defect in its most expensive form: a claim about a
    // message that did reach the relays, contradicted by the receipt sitting beside it.
    case 'accepted': return outcome === undefined ? 'unknown' : COPY_OUTCOME[outcome].tone
  }
}

/**
 * The sentence behind a mark, as the mark's accessible name.
 *
 * THE MARK IS NOT THE WHOLE STORY, AND IT DOES NOT PRETEND TO BE. Sighted readers get a shape in a
 * place they already look; everyone gets the exact sentence from the route, and the details sheet
 * shows that same sentence to everyone. A refused copy is named here even when the aggregate says the
 * send succeeded, because the aggregate is what the route reports and the per-copy sentence is what
 * the person is owed.
 *
 * @param receipt - what the host said about the newest send.
 * @param outcome - the per-copy outcome, or undefined when the receipt carries no copies.
 * @param t - the translate function.
 * @returns the sentence the mark stands for.
 */
function markSentence(
  receipt: SendReceipt,
  outcome: CopyOutcome | undefined,
  t: PropsLocale<'messages'>['t'],
): string {
  if (receipt.kind === 'pending') return t(SEND_RECEIPT.pending)
  if (receipt.kind === 'failed') return `${t(SEND_RECEIPT.failed)} ${failureText(receipt.failure)}`
  // **THE SENTENCE GIVES THE REASON, WHICH IS WHAT "unknown WITH ITS REASON" MEANS.** An unaccepted receipt keeps its
  // own sentence; an accepted receipt with no copy outcomes gets one of its own rather than borrowing the refusal.
  if (receipt.kind === 'not-accepted') return t(SEND_RECEIPT['not-accepted'])
  if (outcome === undefined) return t('send.outcome.unread')
  return t(COPY_OUTCOME[outcome].sentence)
}

/**
 * The receipt as a mark: one small state mark on the message it is about, with the sentence as its
 * accessible name.
 *
 * @param props - the receipt, its per-copy outcome, and the translate function.
 * @returns the mark, or null when there is nothing to mark.
 */
function ReceiptMark({ receipt, outcome, t }: {
  readonly receipt: SendReceipt
  readonly outcome: CopyOutcome | undefined
  readonly t: PropsLocale<'messages'>['t']
}) {
  const mark = markOf(receipt, outcome)
  // **NO GLYPH FOR AN UNKNOWN MARK, BECAUSE EVERY GLYPH HERE IS A CLAIM.** The four shapes say pending, delivered,
  // partial and refused; there is no shape for "accepted, copies unread", so none is drawn and the accessible sentence
  // carries the fact. A borrowed glyph would be a claim nobody made.
  const Icon = mark === 'unknown' ? null : MARK_ICON[mark]
  const sentence = markSentence(receipt, outcome, t)
  return (
    <span
      className={css.receiptMark}
      data-receipt={mark}
      data-messages-receipt={mark}
      data-copies={outcome === undefined ? undefined : COPY_OUTCOME[outcome].tone}
      role="img"
      aria-label={sentence}
      title={sentence}
    >
      {Icon === null ? null : <Icon size={13} />}
    </span>
  )
}

/** Everything one list row needs, passed rather than closed over, so the row is one readable unit. */
interface ContactRowProps {
  readonly entry: LaneEntry
  readonly t: PropsLocale<'messages'>['t']
  /** The name to show, already resolved: a contact's, this screen's own label, or "no name yet". */
  readonly name: string
  /** The newest thing this screen holds for the conversation, or that it holds nothing. */
  readonly preview: string
  readonly onOpen: (entry: LaneEntry) => void
  readonly onToggle: (entry: LaneEntry, key: 'pinned' | 'unread' | 'archived') => void
  readonly onDetails: (entry: LaneEntry) => void
}

/**
 * One row, in Signal's grammar: avatar, name, preview, time, and one mark.
 *
 * The row this replaces carried a name, a badge with a state word, a sliced key, a box of digits or a
 * sentence saying there were none, a source tag and three status markers — six or seven claims where a
 * person scanning a list reads two. Everything that left this row is behind one of the row's own
 * controls: the conversation for the messages, the shield for the identity, and the info button for
 * the key, the source and the host.
 *
 * @param props - the row, its resolved name and preview, and the three actions a row has.
 * @returns the row.
 */
function ContactRow({ entry, t, name, preview, onOpen, onToggle, onDetails }: ContactRowProps) {
  return (
    <div
      role="listitem"
      tabIndex={0}
      className={clsx(css.personRow, entry.contact !== undefined && css.contactRow)}
      data-person-row={entry.id}
      data-contact-state={entry.contact?.state}
      onClick={() => { onOpen(entry) }}
      onKeyDown={(event) => {
        if (event.key !== 'Enter' && event.key !== ' ') return
        event.preventDefault()
        onOpen(entry)
      }}
    >
      <span className={css.avatar} aria-hidden="true">{initialOf(name)}</span>
      <span className={css.rowMain}>
        <span className={css.rowTop}>
          <span className={css.rowTitleInMain} data-fit="name">{name}</span>
          {entry.contact !== undefined && <TrustMark state={entry.contact.state} t={t} />}
          {entry.unread && (
            <span className={css.unreadDot} data-unread-mark role="img" aria-label={t('status.unread')} title={t('status.unread')} />
          )}
          {entry.pinned && (
            <span className={css.pinMark} data-pin-mark role="img" aria-label={t('status.pinned')} title={t('status.pinned')}>
              <PinIcon size={12} />
            </span>
          )}
          <span className={css.time} data-fit="line">{t('time.now')}</span>
        </span>
        <span className={css.rowPreview} data-fit="line">{preview}</span>
      </span>
      {/* Row verbs act on the row, never on the open action: the click that reaches a verb must not
          also open the conversation underneath it. */}
      <span
        className={css.rowActions}
        onClick={(event) => { event.stopPropagation() }}
        onKeyDown={(event) => { event.stopPropagation() }}
      >
        <button
          type="button"
          className={css.iconButton}
          aria-label={t('details.open')}
          onClick={() => { onDetails(entry) }}
        >
          <InfoIcon />
        </button>
        <button
          type="button"
          className={clsx(css.iconButton, css.pinAction)}
          aria-label={entry.pinned ? t('row.unpin') : t('row.pin')}
          aria-pressed={entry.pinned}
          onClick={() => { onToggle(entry, 'pinned') }}
        >
          <PinIcon />
        </button>
        <button
          type="button"
          className={clsx(css.iconButton, css.unreadAction)}
          aria-label={entry.unread ? t('row.markRead') : t('row.markUnread')}
          aria-pressed={entry.unread}
          onClick={() => { onToggle(entry, 'unread') }}
        >
          <UnreadIcon />
        </button>
        <button
          type="button"
          className={clsx(css.iconButton, css.archiveAction)}
          aria-label={entry.archived ? t('row.unarchive') : t('row.archive')}
          aria-pressed={entry.archived}
          onClick={() => { onToggle(entry, 'archived') }}
        >
          <ArchiveIcon />
        </button>
      </span>
    </div>
  )
}

/** List filters, the same trio as the thread lane's brand-row cluster. */
interface ListFilters {
  pinned: boolean
  unread: boolean
  archived: boolean
}

/**
 * One row as the surface holds it: a contact read from the host, plus the local row flags the
 * viewer sets and the text the viewer typed here.
 */
interface LaneEntry {
  id: string
  /** Set for rows read from the host's contacts route; absent for a conversation started here. */
  contact?: WireContact
  pinned: boolean
  unread: boolean
  archived: boolean
  /** Messages acknowledged by the host, keyed by the NIP-17 rumor id. */
  sent: readonly LaneMessage[]
}

/** One rendered message. `live` messages came from the host and are shown as they arrived. */
interface LaneMessage {
  id: string
  at: number
  from: 'me' | 'them'
  text: string
}

/** What the host's thread read produced for the open conversation. */
type ThreadView =
  | { readonly kind: 'idle' }
  | { readonly kind: 'loading' }
  | { readonly kind: 'ready'; readonly thread: MessagesThreadBody }
  | { readonly kind: 'failed'; readonly failure: ContactsFailure }

/** What the host said about one send. `not-accepted` is not delivery. */
type SendReceipt =
  | { readonly kind: 'pending' }
  | {
    readonly kind: 'accepted'
    readonly id: string
    readonly at: number
    readonly accepted: readonly string[]
    readonly verdict: string
    /** One parsed outcome per copy of the send: `recipient` and/or `self`. */
    readonly copies: readonly WireCopyOutcome[]
  }
  | {
    readonly kind: 'not-accepted'
    readonly id: string
    readonly at: number
    readonly accepted: readonly string[]
    readonly verdict: string
    readonly copies: readonly WireCopyOutcome[]
  }
  | { readonly kind: 'failed'; readonly failure: ContactsFailure }

/** The receipt line for each send outcome. A `not-accepted` send says exactly that. */
const SEND_RECEIPT = {
  'pending': 'send.pending',
  'accepted': 'send.accepted',
  'not-accepted': 'send.unaccepted',
  'failed': 'send.refused',
} as const satisfies Record<SendReceipt['kind'], MessagesKey>

/**
 * What the relays did with each of the send's two copies, as one closed vocabulary.
 *
 * `delivered` is the only state that may read as a plain sent message, and it is reached only
 * when EVERY copy this send reported was accepted. A send whose recipient copy was refused and
 * whose own copy was kept lands on `self-kept` and not on `delivered`, which is the whole point:
 * the aggregate `ok` is true in both cases and cannot tell them apart.
 */
type CopyOutcome = 'delivered' | 'self-kept' | 'recipient-kept' | 'both-refused'

/**
 * The sentence for each per-copy outcome, and the tone its receipt paints with.
 *
 * Every one of the four is copy, so none of them is spelled in the JSX. `tone` is the value the
 * receipt carries in `data-copies`, which is what makes a refused copy visually distinct from a
 * clean send rather than merely different words: `delivered` is the only one painted as success.
 */
const COPY_OUTCOME = {
  'delivered': { sentence: 'send.outcome.delivered', tone: 'delivered' },
  'self-kept': { sentence: 'send.outcome.self-kept', tone: 'partial' },
  'recipient-kept': { sentence: 'send.outcome.recipient-kept', tone: 'partial' },
  'both-refused': { sentence: 'send.outcome.both-refused', tone: 'refused' },
} as const satisfies Record<CopyOutcome, { sentence: MessagesKey; tone: 'delivered' | 'partial' | 'refused' }>

/**
 * The outcome of one send, read from its per-copy outcomes rather than from the aggregate.
 *
 * THE REFUSAL WINS OVER THE SUM, IN BOTH DIRECTIONS. If any copy was refused the result names
 * which one, even when the other copy was accepted and `ok` is true — showing that send as
 * plainly delivered would claim the recipient has a message the relays never took. A body whose
 * `copies` names no accepted copy at all is `both-refused` whatever else it says, because a send
 * with nothing taken must never reach a sent state.
 *
 * An empty `copies` list cannot come from the host parser, which refuses a send body that names
 * no copy; it is read as `both-refused` anyway, since "no copy reported" is the answer that
 * claims nothing, not the one that claims delivery.
 *
 * @param copies - the parsed per-copy outcomes of one send.
 * @returns the outcome the receipt is written from.
 */
function copyOutcomeOf(copies: readonly WireCopyOutcome[]): CopyOutcome {
  const recipient = copies.find(copy => copy.copy === 'recipient')
  const self = copies.find(copy => copy.copy === 'self')
  const anyAccepted = copies.some(copy => copy.accepted)
  if (!anyAccepted) return 'both-refused'
  // Accepted and refused at once: name the refused copy, which is the one the aggregate hides.
  if (recipient !== undefined && !recipient.accepted) return 'self-kept'
  if (self !== undefined && !self.accepted) return 'recipient-kept'
  return 'delivered'
}

/**
 * The named reason each refused copy gave, one per copy, for the diagnostic detail line.
 *
 * A refusal is a named code and never prose, so it is shown as it arrived — beside the copy it
 * belongs to — rather than paraphrased into a second vocabulary that could drift from the host's.
 *
 * @param copies - the parsed per-copy outcomes of one send.
 * @returns one `<copy>: <code>` line per refused copy, in the order the send reported them.
 */
function copyRefusalDetails(copies: readonly WireCopyOutcome[]): string[] {
  // The wire's two role names are its own closed vocabulary and are shown as they arrived;
  // paraphrasing them here would be a second vocabulary that can drift from the host's.
  return copies
    .filter(copy => !copy.accepted && copy.refusal !== null)
    .map(copy => `${copy.copy}: ${copy.refusal}`)
}

/** The contacts read: nothing yet, in flight, the listing, or why there is none. */
type ContactsView =
  | { readonly kind: 'idle' }
  | { readonly kind: 'loading' }
  | { readonly kind: 'ready'; readonly contacts: readonly WireContact[]; readonly root: string }
  | { readonly kind: 'failed'; readonly failure: ContactsFailure }

/** How often the listing is re-read while the lane is open. Slow on purpose. */
const CONTACTS_POLL_MS = 60_000
const THREAD_POLL_MS = 3_000

/**
 * Fold a contacts listing into the local rows, keeping every flag the viewer set.
 * @param current - the rows held now.
 * @param contacts - the listing that just arrived.
 * @returns contact rows, in the order the host listed them.
 */
function mergeContacts(current: readonly LaneEntry[], contacts: readonly WireContact[]): LaneEntry[] {
  const held = new Map(current.filter(entry => entry.contact !== undefined).map(entry => [entry.id, entry]))
  return contacts.map((contact) => {
    const previous = held.get(contact.npub)
    return {
      id: contact.npub,
      contact,
      pinned: previous?.pinned ?? false,
      unread: previous?.unread ?? false,
      archived: previous?.archived ?? false,
      sent: previous?.sent ?? [],
    }
  })
}

/**
 * A one-line, human-readable account of a read failure. Diagnostic, never localized copy.
 * @param failure - the failure the client layer reported.
 * @returns the reason as text.
 */
function failureText(failure: ContactsFailure): string {
  switch (failure.kind) {
    case 'transport': return `no answer from the host route: ${failure.detail}`
    case 'http': return `the host answered HTTP ${String(failure.status)} with no named refusal: ${failure.detail}`
    case 'refused': return `${failure.reason} (${failure.subject})`
    case 'malformed': return `an answer this screen cannot read: ${failure.detail}`
  }
}

/** Props assembled for the always-mounted Messages center surface. */
export type MessagesSurfaceProps =
  PropsRuntime<'shell.surface'>
  & PropsLocale<'messages'>
  & {
    /** Messaging-engine state; absent means the engine is not connected. */
    messagingStatus?: MessagingStatus
  }

/**
 * Render the Messages lane over this node's contacts: a filterable list with one of four
 * identity states and their SAS on every row, click-to-open conversations read from the
 * host, and a composer whose receipt comes from the send response rather than a status code.
 * @param props - shell visibility, close action, and localized copy.
 * @returns the always-mounted Messages surface.
 */
export function MessagesSurface({ activeSurface, closeSurface, t, messagingStatus = 'not-connected' }: MessagesSurfaceProps) {
  const active = activeSurface === 'messages'
  const [contactsView, setContactsView] = useState<ContactsView>({ kind: 'idle' })
  const [entries, setEntries] = useState<LaneEntry[]>([])
  const [filters, setFilters] = useState<ListFilters>({ pinned: false, unread: false, archived: false })
  const [searchOpen, setSearchOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [openId, setOpenId] = useState<string | null>(null)
  const [drafts, setDrafts] = useState<Record<string, string>>({})
  const draft = openId === null ? '' : drafts[openId] ?? ''
  const setDraft = (text: string): void => {
    if (openId !== null) setDrafts(current => ({ ...current, [openId]: text }))
  }
  const [thread, setThread] = useState<ThreadView>({ kind: 'idle' })
  const [receipts, setReceipts] = useState<Record<string, SendReceipt>>({})
  /**
   * The one layer over the lane: the verify sheet a chip opens, or the details sheet an info button
   * opens. One state rather than two booleans, so "both open at once" is not a shape this can be in.
   * `entry` is the conversation the layer is about, and null for the lane's own read — the list's
   * details are about a read rather than about a person.
   */
  const [sheet, setSheet] = useState<{ readonly kind: 'verify' | 'details' | 'add'; readonly entry: LaneEntry | null } | null>(null)
  const listRef = useRef<HTMLDivElement>(null)
  const composerRef = useRef<HTMLTextAreaElement>(null)
  const messagesRef = useRef<HTMLDivElement>(null)
  const returnToRef = useRef<string | null>(null)
  const contactsGeneration = useRef(0)
  const threadGeneration = useRef(0)
  const threadInFlight = useRef(new Map<string, Promise<void>>())
  const sending = useRef(new Set<string>())
  const currentOpen = useRef<string | null>(null)
  currentOpen.current = active ? openId : null
  const [copyState, setCopyState] = useState<'idle' | 'pending' | 'copied' | 'failed'>('pending')
  const [publicNpub, setPublicNpub] = useState<string | null>(null)
  const [threadFailure, setThreadFailure] = useState<ContactsFailure | null>(null)

  const openConversation = entries.find(conversation => conversation.id === openId)
  const openContact = openConversation?.contact
  // WHICH READ THE LIST IS SHOWING, and it is one of four facts rather than two: the host listed
  // contacts, the host listed none, the host has not answered yet, or the host refused. An empty
  // listing is not a failure and a failure is not an empty listing, so the source line says which
  // one it is and the copy under it says what can be done about that one.
  const showingContacts = contactsView.kind === 'ready'
  const scene: ContactsScene = contactsView.kind === 'ready'
    ? (contactsView.contacts.length === 0 ? 'contacts-empty' : 'contacts')
    : contactsView.kind === 'failed' ? 'contacts-failed' : 'contacts-reading'
  const posture: MessagingStatus = messagingStatus === 'not-connected' && showingContacts
    ? 'contacts-only'
    : messagingStatus

  // NO KEY FRAGMENT WHERE A NAME GOES. This was `contact.npub.slice(0, 16)`, which is Peter's "truncated
  // contact name while an npub is shown": half a key standing in for a person, unreadable at a third of the
  // width and wrong at any width. An unnamed contact now says so, and the WHOLE key is `handleOf`, which the
  // details sheet shows — a key is a detail, so it lives one tap away rather than shredded into the row.
  const contactName = (contact: WireContact): string =>
    contact.name === '' ? t('contact.unnamed') : contact.name

  const nameOf = (entry: LaneEntry): string =>
    entry.contact === undefined ? t('new.title') : contactName(entry.contact)
  /**
   * The whole key, and the only place it is read from. `handleOf` is what the details sheet shows and
   * what nothing on the list shows: a row that displayed it was Peter's "raw key on the main list",
   * and a row that displayed a slice of it was his "truncated contact name while an npub is shown".
   */
  const handleOf = (entry: LaneEntry): string =>
    entry.contact === undefined ? t('new.handle') : entry.contact.npub

  /**
   * The row's one preview line: the newest thing this screen actually holds for that conversation.
   *
   * A LISTING READ CARRIES NO MESSAGE TEXT — `readContacts` returns seven leaf fields per contact and
   * none of them is a message — so for a contact whose conversation has not been read, the honest
   * preview is that there is nothing here yet, said in words rather than filled with a line this
   * screen invented. Text sent from this screen is held, so it is what a row shows once there is any.
   */
  const previewOf = (entry: LaneEntry): string => {
    const said = entry.sent[entry.sent.length - 1]
    // **"NO MESSAGES YET" CLAIMED MORE THAN THIS FUNCTION KNOWS.** `entry.sent` is what was sent from THIS screen, so
    // an empty list means nothing was sent from here — not that the conversation is empty, which is what the old
    // sentence told a person. The row now says what is true of the thing it actually read.
    return said?.text ?? ''
  }

  /** Open one of the two layers. Opening a conversation closes whatever was over it. */
  const openSheet = (kind: 'verify' | 'details', entry: LaneEntry | null): void => {
    setSheet({ kind, entry })
  }

  const loadContacts = useCallback((): void => {
    contactsGeneration.current += 1
    const mine = contactsGeneration.current
    setContactsView(current => (current.kind === 'ready' ? current : { kind: 'loading' }))
    void readContacts().then((read) => {
      // A read superseded by a newer one — or by the lane closing — must not land.
      if (contactsGeneration.current !== mine) return
      setContactsView(read.kind === 'ready'
        ? { kind: 'ready', contacts: read.value.contacts, root: read.value.root }
        : { kind: 'failed', failure: read.failure })
      if (read.kind === 'ready') {
        setEntries(current => mergeContacts(current, read.value.contacts))
      }
    })
  }, [])

  const loadThread = useCallback((npub: string): Promise<void> => {
    const pending = threadInFlight.current.get(npub)
    if (pending !== undefined) return pending
    const mine = threadGeneration.current
    const work = readThread(npub, null).then((read) => {
      if (threadGeneration.current !== mine || currentOpen.current !== npub) return
      if (read.kind === 'failed') {
        setThreadFailure(read.failure)
        setThread(current => current.kind === 'ready' ? current : { kind: 'failed', failure: read.failure })
        return
      }
      setThreadFailure(null)
      setThread(current => {
        const messages = new Map<string, LaneMessage>()
        if (current.kind === 'ready' && current.thread.npub === npub) {
          for (const message of current.thread.messages) messages.set(message.id, message)
        }
        for (const message of read.thread.messages) messages.set(message.id, message)
        return { kind: 'ready', thread: { ...read.thread, messages: [...messages.values()]
          .sort((a, b) => a.at - b.at || a.id.localeCompare(b.id)) } }
      })
    }).finally(() => { threadInFlight.current.delete(npub) })
    threadInFlight.current.set(npub, work)
    return work
  }, [])

  // Each request finishes before the next poll starts. Switching or closing a thread invalidates
  // its outstanding reply, while refreshing an open conversation keeps its bubbles on screen.
  useEffect(() => {
    if (!active || openId === null) return undefined
    threadGeneration.current += 1
    setThread({ kind: 'loading' })
    setThreadFailure(null)
    let cancelled = false
    let timer: number | undefined
    const poll = async (): Promise<void> => {
      await loadThread(openId)
      if (!cancelled) timer = window.setTimeout(() => { void poll() }, THREAD_POLL_MS)
    }
    void poll()
    return () => {
      cancelled = true
      if (timer !== undefined) window.clearTimeout(timer)
      threadGeneration.current += 1
    }
  }, [active, openId, loadThread])

  const copyIdentity = (): void => {
    if (publicNpub === null) return
    setCopyState('pending')
    // Start the clipboard operation during the gesture; WebKit loses permission after a fetch.
    try {
      void navigator.clipboard.writeText(publicNpub).then(
        () => { setCopyState('copied') },
        () => { setCopyState('failed') },
      )
    } catch { setCopyState('failed') }
  }

  useEffect(() => {
    if (!active) return undefined
    let cancelled = false
    void readIdentity().then(read => {
      if (cancelled) return
      if (read.kind === 'ready') {
        setPublicNpub(read.value.npub)
        setCopyState('idle')
      } else setCopyState('failed')
    })
    return () => { cancelled = true }
  }, [active])

  // One read when the surface mounts, then a slow poll while the lane is open. A closed
  // lane does not poll: the surface is always mounted, so `active` is the only gate.
  useEffect(() => {
    if (!active) return undefined
    loadContacts()
    const timer = window.setInterval(() => { loadContacts() }, CONTACTS_POLL_MS)
    return () => {
      window.clearInterval(timer)
      // A read in flight when the lane closes must not land on a hidden surface.
      contactsGeneration.current += 1
    }
  }, [active, loadContacts])

  useEffect(() => {
    if (!active) return
    // Bubble-phase, deferring to consumed events: Modal/Menu take Escape in
    // capture and mark it defaultPrevented, and Escape inside a text-entry
    // control belongs to that control. An unclaimed press peels one layer:
    // the open conversation first, then the surface — the same order the
    // thread lane resolves it.
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key !== 'Escape' || event.defaultPrevented) return
      if (isEditableTarget(event.target)) return
      event.preventDefault()
      // The sheet is the topmost layer, so it is the first one an unclaimed press peels.
      if (sheet !== null) setSheet(null)
      else if (openId !== null) setOpenId(null)
      else closeSurface()
    }
    document.addEventListener('keydown', onKeyDown)
    return () => { document.removeEventListener('keydown', onKeyDown) }
  }, [active, closeSurface, openId, sheet])

  // Opening puts the caret where the viewer acts next; returning puts focus
  // back on the row that was open, so the keyboard never falls to the body
  // and out of the surface.
  useEffect(() => {
    if (!active) return
    if (openId !== null) {
      composerRef.current?.focus()
      return
    }
    const returning = returnToRef.current
    if (returning === null) return
    returnToRef.current = null
    const row = listRef.current?.querySelector(`[data-person-row="${returning}"]`)
    if (row instanceof HTMLElement) row.focus()
  }, [active, openId])

  // Newest message stays in view: the column is a scrollport, so an appended
  // bubble would otherwise land below the fold.
  const messageCount = (openConversation?.sent.length ?? 0) + (thread.kind === 'ready' ? thread.thread.messages.length : 0)
  useEffect(() => {
    const column = messagesRef.current
    if (column === null) return
    column.scrollTop = column.scrollHeight
  }, [openId, messageCount])

  const mutate = (id: string, change: (entry: LaneEntry) => LaneEntry): void => {
    setEntries(current => current.map(conversation =>
      conversation.id === id ? change(conversation) : conversation))
  }

  const toggleFilter = (key: keyof ListFilters): void => {
    setFilters(current => ({ ...current, [key]: !current[key] }))
  }

  const openThread = (entry: LaneEntry): void => {
    // Opening clears the unread reminder, exactly like the thread lane.
    mutate(entry.id, conversation => ({ ...conversation, unread: false }))
    returnToRef.current = entry.id
    setSheet(null)
    setOpenId(entry.id)
    setReceipts(current => {
      const next = { ...current }
      delete next[entry.id]
      return next
    })
    setThread({ kind: 'loading' })
  }


  /**
   * Send the draft. A contact row goes to the host and the receipt follows the response body; a
   * conversation with no contact behind it stays on this screen, where the viewer's own words are
   * the only ones in it.
   * @param entry - the open conversation.
   */
  const sendTo = (entry: LaneEntry): void => {
    const text = draft.trim()
    const contact = entry.contact
    if (text === '' || contact === undefined || sending.current.has(entry.id)) return
    const submittedDraft = draft
    sending.current.add(entry.id)
    setReceipts(current => ({ ...current, [entry.id]: { kind: 'pending' } }))
    void sendMessage(contact.npub, text).then((read) => {
      setReceipts(current => ({ ...current, [entry.id]: read }))
      if (read.kind === 'accepted') {
        const message: LaneMessage = { id: read.id, at: read.at, from: 'me', text }
        mutate(entry.id, current => ({ ...current, sent: [...current.sent.filter(item => item.id !== read.id), message] }))
        setDrafts(current => current[entry.id] === submittedDraft ? { ...current, [entry.id]: '' } : current)
        if (currentOpen.current === contact.npub) void loadThread(contact.npub)
      }
    }).finally(() => { sending.current.delete(entry.id) })
  }

  const toggle = (entry: LaneEntry, key: 'pinned' | 'unread' | 'archived'): void => {
    mutate(entry.id, current => ({ ...current, [key]: !current[key] }))
  }

  const visible = entries.filter(entry =>
    entry.archived === filters.archived
    && (!filters.pinned || entry.pinned)
    && (!filters.unread || entry.unread)
    && (query === '' || nameOf(entry).toLowerCase().includes(query.toLowerCase())))

  const liveThread = thread.kind === 'ready' && thread.thread.npub === openId ? thread.thread : undefined
  const openThreadSas: WireSas | null = liveThread?.sas ?? openContact?.sas ?? null
  const mergedMessages = new Map<string, LaneMessage>()
  for (const message of openConversation?.sent ?? []) mergedMessages.set(message.id, message)
  for (const message of liveThread?.messages ?? []) mergedMessages.set(message.id, message)
  const openLiveMessages = [...mergedMessages.values()].sort((a, b) => a.at - b.at || a.id.localeCompare(b.id))
  const openReceipt = openId === null ? undefined : receipts[openId]

  // WHAT THE RELAYS DID WITH EACH COPY, read from the send's own per-copy outcomes rather than
  // from the aggregate. `ok` is true both when the recipient has the message and when only this
  // node's own copy was kept, so the aggregate cannot choose the sentence — this can.
  const openCopies = openReceipt !== undefined
      && (openReceipt.kind === 'accepted' || openReceipt.kind === 'not-accepted')
    ? openReceipt.copies
    : undefined
  const openOutcome = openCopies === undefined || openCopies.length === 0 ? undefined : copyOutcomeOf(openCopies)

  const openState = openContact?.state
  // The sheet's subject, read from the state the sheet is about rather than from whatever is open
  // behind it: a sheet opened from a row keeps describing that row while the lane stays where it is.
  const sheetEntry = sheet?.entry ?? null
  const sheetState = sheetEntry?.contact?.state
  // The thread's own answer wins over the listing's, exactly as it does for the digits themselves:
  // a read of the conversation is more recent than the read of the contacts file.
  const sheetSas = sheetEntry === null
    ? null
    : (sheetEntry.id === openId ? openThreadSas : sheetEntry.contact?.sas ?? null)
  const closeSheet = (): void => { setSheet(null) }

  /**
   * Open the add-contact sheet, empty. The '+' USED TO INVENT A LOCAL CONVERSATION HERE (id `local-N`, handle
   * '@new') that could neither send nor receive and wrote nothing; step 4 deletes that path.
   */
  const openAddContact = (): void => { setSheet({ kind: 'add', entry: null }) }
  // EVERYTHING TRUE THAT A ROW MUST NOT CARRY, in one list, built where the facts are. The sheet is
  // rendered from this and not from a second reading of the state, so a row that moved here cannot
  // have moved to a place that says something slightly different.
  const detailsOf = (entry: LaneEntry | null): SheetRow[] => {
    const rows: SheetRow[] = []
    if (contactsView.kind === 'failed') rows.push({ label: t('contacts.error.title'), value: failureText(contactsView.failure) })
    if (entry?.id === openId && threadFailure !== null) rows.push({ label: t('details.host'), value: failureText(threadFailure) })
    const contact = entry?.contact
    if (entry !== null) {
      rows.push({ label: t('state.label'), value: contact === undefined ? t('new.handle') : t(CONTACT_STATE[contact.state].detail) })
      rows.push({ label: t('contact.npub'), value: handleOf(entry), mono: true, ref: 'npub' })
    }
    rows.push({
      label: t('source.contacts.root'),
      value: contactsView.kind === 'ready' ? contactsView.root : t(SCENE[scene].source),
      mono: contactsView.kind === 'ready',
      ref: 'source',
    })
    rows.push({ label: t('details.host'), value: t(RUNTIME_POSTURE[posture].status), ref: 'host' })
    // The relays that answered belong to a conversation read, and they were a paragraph in the middle
    // of the conversation itself. They are a fact about the read, so they are a row about the read.
    if (entry !== null && entry.id === openId && liveThread !== undefined) {
      rows.push({
        label: t('thread.answered'),
        value: liveThread.answered.length === 0 ? t('thread.unanswered') : liveThread.answered.join(', '),
        ref: 'relays',
      })
    }
    // The receipt, in words, beside the mark that stands for it on the message itself.
    if (entry !== null && entry.id === openId && openReceipt !== undefined) {
      rows.push({ label: t('details.sending'), value: markSentence(openReceipt, openOutcome, t), ref: 'send' })
      for (const detail of openCopies === undefined ? [] : copyRefusalDetails(openCopies)) {
        rows.push({ label: t('send.verdict'), value: detail, mono: true })
      }
      if ((openReceipt.kind === 'accepted' || openReceipt.kind === 'not-accepted') && openReceipt.verdict !== '') {
        rows.push({ label: t('send.verdict'), value: openReceipt.verdict, mono: true })
      }
    }
    return rows
  }

  return (
    <section
      data-messages-surface
      className={css.surface}
      hidden={!active}
      aria-hidden={!active}
      aria-label={t('title')}
    >
      {openConversation === undefined
        ? (
          <div className={css.lane} data-messages-list data-messages-source={scene}>
            <header className={css.brandRow}>
              <span className={css.brandMark}><ChatMarkIcon /></span>
              <h2 className={css.brandName} data-fit="name">{t('title')}</h2>
              <span className={clsx(css.actions, css.brandActions)}>
                <button type="button" className={css.iconButton} data-copy-identity={copyState}
                  aria-label={t(copyState === 'copied' ? 'identity.copied' : copyState === 'failed' ? 'identity.failed' : 'identity.copy')}
                  disabled={copyState === 'pending' || publicNpub === null} onClick={copyIdentity}>
                  {copyState === 'copied' ? <VerifiedStateIcon /> : copyState === 'failed' ? <ForeignStateIcon /> : <SasIcon />}
                </button>
                <button
                  type="button"
                  className={css.iconButton}
                  aria-label={t('actions.new')}
                  onClick={openAddContact}
                >
                  <PlusIcon />
                </button>
                <button
                  type="button"
                  className={css.iconButton}
                  aria-label={t('contacts.refresh')}
                  onClick={loadContacts}
                >
                  <RefreshIcon />
                </button>
                <button
                  type="button"
                  className={clsx(css.iconButton, css.pinAction)}
                  aria-label={t('filters.pinned')}
                  aria-pressed={filters.pinned}
                  onClick={() => { toggleFilter('pinned') }}
                >
                  <PinIcon />
                </button>
                <button
                  type="button"
                  className={clsx(css.iconButton, css.unreadAction)}
                  aria-label={t('filters.unread')}
                  aria-pressed={filters.unread}
                  onClick={() => { toggleFilter('unread') }}
                >
                  <UnreadIcon />
                </button>
                <button
                  type="button"
                  className={clsx(css.iconButton, css.archiveAction)}
                  aria-label={t('filters.archived')}
                  aria-pressed={filters.archived}
                  onClick={() => { toggleFilter('archived') }}
                >
                  <ArchiveIcon />
                </button>
                {/* The lane's own read, behind one button: which directory the rows came from, and
                    what the host says about itself. A path under the list is a line nobody reads and
                    everybody's eye stops on, and it is a fact about the read rather than about a row. */}
                <button
                  type="button"
                  className={css.iconButton}
                  aria-label={t('details.open')}
                  data-list-details
                  onClick={() => { openSheet('details', null) }}
                >
                  <InfoIcon />
                </button>
              </span>
            </header>
            {contactsView.kind === 'failed' && (
              <button type="button" className={css.iconButton} data-messages-error
                aria-label={failureText(contactsView.failure)} title={failureText(contactsView.failure)}
                onClick={() => { openSheet('details', null) }}><ForeignStateIcon /></button>
            )}
            <div className={css.searchRow}>
              {searchOpen && (
                <input
                  className={css.searchInput}
                  value={query}
                  placeholder={t('search.placeholder')}
                  aria-label={t('search.placeholder')}
                  onChange={(event) => { setQuery(event.target.value) }}
                />
              )}
              <button
                type="button"
                className={css.iconButton}
                aria-label={t('actions.search')}
                aria-pressed={searchOpen}
                onClick={() => {
                  setSearchOpen(open => !open)
                  setQuery('')
                }}
              >
                <SearchIcon />
              </button>
            </div>
            <div className={css.rows} role="list" ref={listRef}>
              {visible.map(entry => (
                <ContactRow
                  key={entry.id}
                  entry={entry}
                  t={t}
                  name={nameOf(entry)}
                  preview={previewOf(entry)}
                  onOpen={openThread}
                  onToggle={toggle}
                  onDetails={(subject) => { openSheet('details', subject) }}
                />
              ))}
              {/* "No conversations match" is about a filter hiding rows, so it is said only when
                  there are rows to hide: with none at all, the empty or failed state above is the
                  honest sentence and this one would contradict it. */}
              {visible.length === 0 && entries.length > 0 && <span className={css.listEmpty} aria-label={t('list.none')}><SearchIcon /></span>}
            </div>
          </div>
        )
        : (
          <div className={css.thread} data-messages-thread>
            <header className={css.threadHeader}>
              <button
                type="button"
                className={css.iconButton}
                aria-label={t('back')}
                onClick={() => { setOpenId(null) }}
              >
                <BackIcon />
              </button>
              <span className={css.threadTitle} data-fit="name">{nameOf(openConversation)}</span>
              {/* THE CHIP IS THE WHOLE IDENTITY CLAIM THE CONVERSATION MAKES OUT LOUD, and it is one
                  word: a conversation with a binding that verified says nothing, because there is
                  nothing to warn about, and every other state says "Unverified". WHICH unverified is
                  one tap away — the sheet names the exact state and carries the digits to read — so
                  the chip never has to spell TEST, UNBOUND and FOREIGN into a header. */}
              <span className={css.headerTail}>
                {openState !== undefined && openState !== 'VERIFIED' && (
                  <button
                    type="button"
                    className={css.chip}
                    data-trust-chip={openState}
                    aria-label={t('verify.open')}
                    onClick={() => { openSheet('verify', openConversation) }}
                  >
                    <ShieldIcon size={12} verified={false} />
                  </button>
                )}
                <span className={css.actions}>
                  <button
                    type="button"
                    className={css.iconButton}
                    aria-label={t('details.open')}
                    data-thread-details
                    onClick={() => { openSheet('details', openConversation) }}
                  >
                    <InfoIcon />
                  </button>
                  <button
                    type="button"
                    className={clsx(css.iconButton, css.pinAction)}
                    aria-label={t('thread.pin')}
                    aria-pressed={openConversation.pinned}
                    onClick={() => { toggle(openConversation, 'pinned') }}
                  >
                    <PinIcon />
                  </button>
                  <button
                    type="button"
                    className={clsx(css.iconButton, css.archiveAction)}
                    aria-label={t('thread.archive')}
                    onClick={() => {
                      // Archiving files the conversation away, so the view
                      // returns to the list like the thread lane does.
                      toggle(openConversation, 'archived')
                      setOpenId(null)
                    }}
                  >
                    <ArchiveIcon />
                  </button>
                </span>
              </span>
            </header>
            <div className={css.messages} ref={messagesRef}>
              {openContact !== undefined && thread.kind === 'loading' && (
                <span className={css.threadNotice} data-thread-status="loading" aria-label={t('thread.loading')}><SendPendingIcon /></span>
              )}
              {threadFailure !== null && (
                <button type="button" className={css.iconButton} data-thread-status="failed"
                  aria-label={failureText(threadFailure)} title={failureText(threadFailure)}
                  onClick={() => { openSheet('details', openConversation) }}><ForeignStateIcon /></button>
              )}
              {openLiveMessages.map(message => (
                <div
                  key={message.id}
                  data-message-id={message.id}
                  className={message.from === 'me' ? css.msgMe : css.msgThem}
                  data-message={message.from}
                >
                  <span className={css.bubbleText}>{message.text}</span>
                  {openReceipt?.kind === 'accepted' && message.id === openReceipt.id && (
                    <ReceiptMark receipt={openReceipt} outcome={openOutcome} t={t} />
                  )}
                </div>
              ))}
            </div>
            <div className={css.composerCard} data-messages-composer>
              {/* THE RECEIPT IS A MARK ON THE MESSAGE, NOT A PARAGRAPH OVER THE COMPOSER. Three
                  sentences about relays used to sit here permanently, one per send, in the place a
                  person looks when they are about to type — and the sentence they replaced said
                  nothing about WHICH message it was about. The mark is on the message; the sentences
                  and the named refusals are rows in the details sheet. */}
              <textarea
                ref={composerRef}
                rows={1}
                value={draft}
                placeholder={t('composer.placeholder')}
                aria-label={t('composer.placeholder')}
                onChange={(event) => { setDraft(event.target.value) }}
                onKeyDown={(event) => {
                  if (event.key !== 'Enter' || event.shiftKey) return
                  event.preventDefault()
                  sendTo(openConversation)
                }}
              />
              <div className={css.composerRow}>
                <button
                  type="button"
                  className={css.sendCircle}
                  aria-label={t('composer.send')}
                  disabled={draft.trim() === '' || openReceipt?.kind === 'pending'}
                  onClick={() => { sendTo(openConversation) }}
                >
                  {openReceipt?.kind === 'pending' ? <SendPendingIcon /> : openReceipt?.kind === 'failed' || openReceipt?.kind === 'not-accepted' ? <SendRefusedIcon /> : <SendIcon />}
                </button>
              </div>
            </div>
          </div>
        )}
      {/* THE TWO ONE-TAP LAYERS, rendered from the state they describe rather than from a second
          reading of it. The verify sheet is what the "Unverified" chip opens and what the rows' own
          shields stand for; the details sheet is what every info button opens, with the lane's own
          read behind it when no conversation is in question. */}
      {sheet !== null && sheet.kind === 'verify' && sheetEntry !== null && sheetState !== undefined && (
        <VerifySheet
          state={sheetState}
          sas={sheetSas}
          contact={sheetEntry.contact?.name ?? sheetEntry.contact?.npub ?? ''}
          npub={sheetEntry.contact?.npub ?? ''}
          onConfirmed={loadContacts}
          t={t}
          onClose={closeSheet}
        />
      )}
      {sheet !== null && sheet.kind === 'add' && (
        <AddContactSheet t={t} onClose={closeSheet} onAdded={loadContacts} />
      )}
      {sheet !== null && sheet.kind === 'details' && (
        <DetailsSheet rows={detailsOf(sheetEntry)} t={t} onClose={closeSheet} />
      )}
    </section>
  )
}
