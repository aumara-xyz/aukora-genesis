// THE SURFACE'S THREE STATES, IN ONE PLACE A COURT CAN REACH.
//
// Plan §3 is the specification: the Aumlok screen in the app IS the ceremony, one compact layout that
// never changes — the gold anchor card on top (WORD ZERO · ANCHOR), six tiles under it in the three
// bands, the badge — with three states:
//
//   UNBOUND  tiles empty, badge UNBOUND, button "Give me my phrase". The seven words appear in the
//            tiles ONCE, with the warning that a lost phrase means a new instance; then the tiles
//            become inputs and the person types them back, CONFIRMS THAT THEY HAVE THE WORDS, and
//            submits. Match -> BOUND. A wrong answer is one content-free refusal and writes nothing.
//   BOUND    the tiles show dots, badge BOUND, "Your Aumlok is bound" and the receipt (root, bound
//            time). Nothing to type day to day.
//   REFRESH  button "New phrase" on the BOUND state: a new phrase is drawn, shown once, typed back.
//
// WHY THIS LIVES OUTSIDE THE COMPONENT. This face's court already records the doctrine at `badge.ts`:
// the court measures decisions and shipped bytes rather than rendered markup, so a decision that
// existed only inside JSX could not be measured at all. The three states, the badge's word, which
// action a state offers, what a tile shows, the letters in the anchor's six boxes, which first letter
// belongs in a row's small box, whether the confirmation step has been answered, and what the receipt
// says are therefore decided HERE, and `AumlokSurface.tsx` renders these answers rather than
// re-deriving them.
import type { AumlokKey } from './locales.ts'
import type { AumlokControlProjection } from './control-projection.ts'

/** The three states of the one layout, in the plan's own order. There is no fourth. */
export const AUMLOK_SURFACE_STATES = ['unbound', 'bound', 'refresh'] as const

/**
 * What a person has done inside a state that runs a ceremony.
 *
 * `confirm` IS ITS OWN BEAT AND NOT A FLAG ON `typed`. Peter's instruction of 2026-09-23 14:19 is a
 * step between typing the words back and binding with them — "You will never see these words again.
 * Say them out loud." — and a step is what it is in this machine: at `typed` the big button ASKS for
 * the confirmation, and only at `confirm`, with the box ticked, does the same button bind.
 */
export const AUMLOK_CEREMONY_BEATS = ['none', 'shown', 'typed', 'confirm'] as const

export type AumlokSurfaceState = (typeof AUMLOK_SURFACE_STATES)[number]
export type AumlokCeremonyBeat = (typeof AUMLOK_CEREMONY_BEATS)[number]

/** What one tile of the seven shows. The layout never changes; only this does. */
export type AumlokTileFace = 'empty' | 'word' | 'input' | 'dots'

/** The three band tones Peter drew, in his own order: green, blue, purple. */
export type AumlokBandTone = 'green' | 'blue' | 'purple'

/** One themed band: its two positions, its tone, and the copy that names it. */
export interface AumlokBandSpec {
  readonly id: 'root' | 'unite' | 'rise'
  readonly positions: readonly [number, number]
  readonly tone: AumlokBandTone
  readonly label: AumlokKey
  readonly detail: AumlokKey
}

/** Word zero: the anchor, above the six. Position 0 of the same seven tiles. */
export const AUMLOK_ANCHOR_POSITION = 0

/** The one layout: the anchor and the six themed tiles. */
export const AUMLOK_TILE_COUNT = 7

/** The anchor is a SIX-LETTER word, so its card draws six boxes. */
export const AUMLOK_ANCHOR_LETTERS = 6

/** The gold anchor card on top, and the six tiles under it in the three bands. */
export const AUMLOK_BANDS = [
  { id: 'root', positions: [1, 2], tone: 'green', label: 'band.root', detail: 'band.root.detail' },
  { id: 'unite', positions: [3, 4], tone: 'blue', label: 'band.unite', detail: 'band.unite.detail' },
  { id: 'rise', positions: [5, 6], tone: 'purple', label: 'band.rise', detail: 'band.rise.detail' },
] as const satisfies readonly AumlokBandSpec[]

/** What one of the anchor card's six boxes carries. */
export type AumlokAnchorBox =
  | { readonly kind: 'letter'; readonly letter: string }
  | { readonly kind: 'dot' }
  | { readonly kind: 'empty' }

/** The two facts this screen reads: whether a control is bound, and whether a refresh is in flight. */
export interface AumlokSurfaceInputs {
  readonly bound: boolean
  readonly refreshing: boolean
}

/**
 * Which of the three states the screen is in.
 *
 * A REFRESH BEFORE A BINDING HAS NOTHING TO REPLACE, and §3 offers "New phrase" on the BOUND state
 * only, so an unbound machine is unbound whatever else is asked of it: reporting it as refreshing
 * would draw a second phrase over a machine that has no first one.
 * @param inputs - bound, and whether a refresh has been asked for.
 * @returns the state whose layout and controls the screen renders.
 */
export function aumlokSurfaceState(inputs: AumlokSurfaceInputs): AumlokSurfaceState {
  if (!inputs.bound) return 'unbound'
  return inputs.refreshing ? 'refresh' : 'bound'
}

/**
 * The badge's word.
 *
 * TWO WORDS FOR THREE STATES, and that is the plan's: a refresh is an act ON the bound state, the old
 * binding stands until the new words are typed back, and §3 gives the badge no third word.
 * @param state - the state the screen renders.
 * @returns the badge's dictionary key.
 */
export function aumlokBadgeWord(state: AumlokSurfaceState): 'unbound' | 'bound' {
  return state === 'unbound' ? 'unbound' : 'bound'
}

/**
 * The SIX boxes inside the gold anchor card, one per letter of the anchor.
 *
 * WHY SIX AND ALWAYS SIX. Peter drew the anchor as six gold rounded letter boxes in a row, and the
 * anchor IS a six-letter word; a card that drew as many boxes as a word happened to have would draw a
 * different card at every beat and for every defect in the lists. So a word that is not six letters
 * draws six boxes with the gap left EMPTY — never padded with a letter the anchor does not have, and
 * never re-flowed into a different shape.
 *
 * NO LETTER EVER SURVIVES INTO THE BOUND FACE. The six themed words' initials spell the anchor, so a
 * bound card that still showed them would hand the anchor to whoever is looking at the screen. The
 * dots face therefore returns six dots and reads nothing.
 * @param face - what the tiles show at this beat.
 * @param word - the drawn anchor, while it is on the screen.
 * @returns exactly {@link AUMLOK_ANCHOR_LETTERS} boxes.
 */
export function aumlokAnchorBoxes(face: AumlokTileFace, word: string | undefined): readonly AumlokAnchorBox[] {
  return Array.from({ length: AUMLOK_ANCHOR_LETTERS }, (_, index): AumlokAnchorBox => {
    if (face === 'dots') return { kind: 'dot' }
    if (face !== 'word') return { kind: 'empty' }
    const letter = word?.[index]
    return letter === undefined || letter.length === 0 ? { kind: 'empty' } : { kind: 'letter', letter }
  })
}

/**
 * The first letter for the small gold box beside one themed word in its row.
 *
 * ONLY WHILE THE WORD IS ON THE SCREEN, for the reason the anchor boxes give: these six letters spell
 * the anchor, and a bound row that kept them would publish the phrase one letter at a time. At every
 * other beat this is the empty string, which is a box with nothing in it rather than a letter that is
 * not there.
 * @param face - what the tiles show at this beat.
 * @param word - the drawn word, while it is on the screen.
 * @returns the letter, or '' when there is none to show.
 */
export function aumlokWordInitial(face: AumlokTileFace, word: string | undefined): string {
  if (face !== 'word' || word === undefined || word.length === 0) return ''
  return word.slice(0, 1)
}

/**
 * Whether the confirmation step is being asked, and whether its button is live.
 *
 * BIND IS DEAD UNTIL THE BOX IS TICKED, and dead at every beat except `confirm`. The gate is a
 * decision rather than a JSX condition so a court can hold it: `ask` is the step being on the screen,
 * and `bindEnabled` is the ONE big button being able to write an identity that the person has just
 * said out loud that they will never see again.
 * @param input - the beat, whether the box is ticked, and whether a ceremony is already running.
 * @returns the two answers the screen renders.
 */
export function aumlokConfirmGate(input: {
  readonly beat: AumlokCeremonyBeat
  readonly acknowledged: boolean
  readonly busy: boolean
}): { readonly ask: boolean; readonly bindEnabled: boolean } {
  const ask = input.beat === 'confirm'
  return { ask, bindEnabled: ask && input.acknowledged && !input.busy }
}

/**
 * THE HANDLE'S OWN SHAPE, MIRRORED FROM THE DERIVATION CONTRACT (X8, Peter 2026-09-23 15:25).
 *
 * The contract owns this pattern — `plugins/aukora-aumlok/lib/derive-v3.mjs` `AUMLOK_HANDLE` — and this
 * copy exists so the FIELD can refuse a handle the ceremony would refuse BEFORE the ceremony is asked.
 * It is a mirror rather than a second author: `tests/aukora-aumlok-kdf-pin.test.mjs` pins the contract's
 * pattern, and the surface court holds this one to the same three rules (length, alphabet, NFKC).
 */
export const AUMLOK_HANDLE_LENGTH = Object.freeze({ min: 3, max: 24 })
export const AUMLOK_HANDLE_PATTERN = /^[a-z0-9._-]{3,24}$/u

/**
 * THE HANDLE GATE: whether the field is asked for, whether what is in it can be a handle, and whether
 * the seven words may be drawn yet.
 *
 * ON A NEW MACHINE THE HANDLE COMES FIRST, THEN THE SEVEN WORDS — Peter's own order, and the reason it
 * is an order rather than a preference: the handle salts the key, so a phrase drawn before the handle
 * is a ceremony with half of its key missing. `canDraw` is that rule as a decision a court can hold,
 * and `AumlokSurface.tsx` consults it before it asks the shell to draw anything.
 *
 * ON A MACHINE THAT IS ALREADY BOUND the field is not asked for again: the record publishes the handle,
 * the shell reads it from there for a refresh, and asking a person to retype a public name would be
 * asking them to remember something that is not a secret.
 *
 * THE NORMALISATION IS THE CONTRACT'S: NFKC first, then lower case, applied before the pattern is
 * tested, so the field accepts `Anchor.Keeper` and a full-width `ＡＮＣＨＯＲ` — which the ceremony
 * accepts — and refuses what the ceremony would refuse. Nothing is trimmed, here or there.
 * @param input - the state the screen renders, and what is in the field.
 * @returns the three answers the screen renders.
 */
export function aumlokHandleGate(input: {
  readonly state: AumlokSurfaceState
  readonly handle: string
}): {
  readonly ask: boolean
  readonly shown: boolean
  readonly locked: boolean
  readonly value: string
  readonly valid: boolean
  readonly canDraw: boolean
} {
  const ask = input.state === 'unbound'
  const normalized = typeof input.handle === 'string'
    ? input.handle.normalize('NFKC').toLowerCase()
    : ''
  const valid = AUMLOK_HANDLE_PATTERN.test(normalized)
  // A BOUND MACHINE SHOWS THE NAME IT IS BOUND UNDER, READ-ONLY (Y2, 2026-09-23). Peter's sentence is
  // "handle still editable" about the screen after his bind, and the whole of the repair is that the
  // handle becomes a FACT THE RECORD PUBLISHES rather than a field a person fills in: the record
  // carries it, the projection carries it, and this is where the screen decides to show it as a name.
  // A record bound before X8 carries none, and then there is nothing to show and nothing to lock —
  // `shown` is false and the screen offers no handle instead of an empty locked box.
  const shown = !ask && typeof input.handle === 'string' && input.handle.length > 0
  return { ask, shown, locked: shown, value: shown ? input.handle : '', valid, canDraw: ask ? valid : true }
}

/** What a person is shown about the binding they have: its root, and when it was made. */
export interface AumlokReceipt {
  readonly root: string
  readonly boundAt: string | undefined
}

/**
 * The receipt, out of the record's own two fields.
 *
 * THE ROOT IS THE RECORD'S OWN DIGEST — `activeControlDigest`, which the v3 record projection fills
 * with the record's `rootId` — and the BOUND TIME IS THE RECORD'S OWN `boundAt`, rendered as the UTC
 * instant it is. A record that carries no readable time gets `undefined`, and the screen says so
 * rather than printing a time nobody recorded: a receipt with an invented date would be worse than no
 * receipt at all. Seconds are the unit the organ writes (`buildRecordV3({root, boundAt})`), and an
 * ISO-8601 string is passed through because that is what a reader of a v1-era record would hold.
 * @param control - the projection the screen is showing.
 * @returns the two facts the bound screen prints.
 */
export function aumlokReceipt(control: Pick<AumlokControlProjection, 'activeControlDigest' | 'boundAt'>): AumlokReceipt {
  const boundAt = control.boundAt
  return {
    root: control.activeControlDigest,
    boundAt: typeof boundAt === 'number' && Number.isFinite(boundAt)
      ? new Date(boundAt * 1000).toISOString()
      : typeof boundAt === 'string' && /^\d{4}-\d{2}-\d{2}T/u.test(boundAt) ? boundAt : undefined,
  }
}

/**
 * "GIVE ME ANOTHER" — PETER'S OWN TWO WORDS, AND THE ONE PLACE A PHRASE CAN BE REDRAWN (Y3).
 *
 * PETER'S BIND, 2026-09-23 17:02, Y3 VERBATIM: "'Give me another': before binding, a button to draw a
 * new phrase as many times as the person likes until one feels right. Nothing is written until they
 * confirm and type it back." This decision is that sentence, and the three clauses of it are the three
 * answers below.
 *
 * "BEFORE BINDING" IS WHY IT IS OFFERED AT ONE BEAT ONLY. The words are on the screen at the `shown`
 * beat and there alone: the moment the person turns them over, they are typing the phrase back and the
 * draw is behind them. So the control appears with the words it would replace and leaves with them.
 *
 * "NOTHING IS WRITTEN" IS WHY IT CANNOT LIVE ON A BOUND MACHINE. A bound machine already has an
 * identity on disk, and a redraw there is the REFRESH — which §3 gives its own control, its own words
 * ("Rotate phrase", Y2) and its own confirmation. Offering "Give me another" beside it would put two
 * controls on the state Peter asked to carry exactly one.
 *
 * AND IT IS A QUIET CONTROL OF A DIFFERENT ELEMENT KIND, WHICH IS A CONSTRAINT AND NOT A STYLE. X6
 * courts EXACTLY ONE `<button>` in this surface, and that one button is the ceremony's own. A redraw
 * added as a second `<button>` would be the second big button Peter ruled out, and would break a
 * ticked requirement to satisfy this one — so the surface renders this as a `<span role="button">`,
 * small and unpressed-looking, and `offered` is what decides whether it is there at all.
 * @param input - the state the screen renders, the beat, and whether a ceremony is already running.
 * @returns whether the quiet redraw is offered, the copy it carries, and the element kind it must be.
 */
export function aumlokRedraw(input: {
  readonly state: AumlokSurfaceState
  readonly beat: AumlokCeremonyBeat
  readonly busy: boolean
}): { readonly offered: boolean; readonly action: AumlokKey | undefined; readonly kind: 'quiet' } {
  const offered = input.state === 'unbound' && input.beat === 'shown' && !input.busy
  return { offered, action: offered ? 'surface.action.another' : undefined, kind: 'quiet' }
}

/**
 * The action each state offers at each beat of its ceremony.
 */
const ACTIONS = {
  unbound: {
    none: 'surface.action.give',
    shown: 'surface.action.learned',
    typed: 'runtime.binding.bind',
    // THE SAME WORD AT THE CONFIRMATION STEP: it is the same button, and it binds.
    confirm: 'runtime.binding.bind',
  },
  bound: {
    // A BOUND SCREEN RUNS NO CEREMONY, so its beats are never reached: the rotating phrase is what
    // the state offers, and pressing it moves the screen to the refresh state. A closed lookup still
    // has to answer for every beat, and answering with anything but this key would put a control on
    // the bound screen that §3 does not give it.
    //
    // THE WORD ON IT IS PETER'S (Y2, 2026-09-23): "one button, 'Rotate phrase'". It used to read "New
    // phrase", which is what his screen still showed after a bind that wrote — the literal text the
    // item quotes. The KEY keeps its name so every arm and probe that reaches the bound screen's
    // control by key keeps working; the words a person reads are the item's.
    none: 'surface.action.newPhrase',
    shown: 'surface.action.newPhrase',
    typed: 'surface.action.newPhrase',
    confirm: 'surface.action.newPhrase',
  },
  refresh: {
    // Between the click and the words arriving, the screen is mid-ceremony: the keys are drawn where
    // the lists are, so this beat is a real wait and the control says so rather than looking idle.
    none: 'runtime.binding.busy',
    shown: 'surface.action.learned',
    typed: 'runtime.binding.bind',
    confirm: 'runtime.binding.bind',
  },
} as const satisfies Record<AumlokSurfaceState, Record<AumlokCeremonyBeat, AumlokKey>>

/**
 * The button the state offers at this beat.
 * @param state - the state the screen renders.
 * @param beat - how far the person is through the ceremony that state runs.
 * @returns the key of the words on the button.
 */
export function aumlokActionKey(state: AumlokSurfaceState, beat: AumlokCeremonyBeat): AumlokKey {
  return ACTIONS[state][beat]
}

/**
 * What one tile shows.
 *
 * THE WORDS LEAVE AS THE TILES TURN OVER. At the `shown` beat all seven tiles carry the drawn words;
 * at the `typed` and `confirm` beats they carry inputs and the words are gone from the screen,
 * because a screen that showed them while accepting them would be reading the phrase back to the
 * person typing it — and at the confirmation step it would be reading it back to somebody who has
 * just been told it is the last time they will see it. In the refresh state the old binding still
 * stands until the new words are typed back, so the tiles show dots rather than an empty screen where
 * a binding exists.
 * @param state - the state the screen renders.
 * @param beat - how far the person is through the ceremony that state runs.
 * @returns what every one of the seven tiles shows.
 */
export function aumlokTileFace(state: AumlokSurfaceState, beat: AumlokCeremonyBeat): AumlokTileFace {
  switch (state) {
    case 'bound': return 'dots'
    case 'unbound': return beat === 'shown' ? 'word' : beat === 'none' ? 'empty' : 'input'
    case 'refresh': return beat === 'none' ? 'dots' : beat === 'shown' ? 'word' : 'input'
  }
}

/**
 * The technical status, keyed by the one discriminator the screen already branches on.
 *
 * IT LIVES HERE RATHER THAN IN THE MIDDLE OF THE MARKUP because Peter's 14:20 instruction puts every
 * sentence of it behind one closed disclosure, and the screen that renders it should hold no
 * technical key of its own: the disclosure reads this table, and a court can hold the table without
 * rendering anything. `action` is gone with the read-only button X6 deletes — a disabled control that
 * did nothing was the sentence a person did not need to act on, in button form.
 */
export const AUMLOK_RUNTIME_POSTURE = {
  'not-connected': {
    status: 'runtime.status',
    detail: 'runtime.detail',
  },
  'connected': {
    status: 'runtime.connected.status',
    detail: 'runtime.connected.detail',
  },
} as const satisfies Record<'not-connected' | 'connected', Record<'status' | 'detail', AumlokKey>>

/** The copy for each named absence, which is what the disclosure quotes when there is no control. */
export const AUMLOK_NOT_CONNECTED_REASON = {
  'no-controller-service': 'runtime.reason.no-controller-service',
  'adapter-unbound': 'runtime.reason.adapter-unbound',
  'controller-absent': 'runtime.reason.controller-absent',
  'control-unreadable': 'runtime.reason.control-unreadable',
  // THE FIFTH ABSENCE NEEDS COPY OF ITS OWN, and the build is what proved it: with the reason added to
  // the host's union and not here, `python3 scripts/build-face.py --only aumlok` failed at
  // `AumlokSurface.tsx(594,27): error TS7053: Element implicitly has an 'any' type because expression of
  // type 'AumlokNotConnectedReason' can't be used to index type {...}`. A reason with no sentence is a
  // blank line on the screen, and the type system refused to compile one.
  'record-names-no-machine': 'runtime.reason.record-names-no-machine',
} as const satisfies Record<
  'no-controller-service' | 'adapter-unbound' | 'controller-absent' | 'control-unreadable'
  | 'record-names-no-machine',
  AumlokKey
>
