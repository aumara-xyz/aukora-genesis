/**
 * lane-card-window.mjs — THE WINDOW PETER TAPS, AND THE ONE RULE ABOUT FOCUS THAT MATTERS.
 *
 * WHY THE DECISION IS SEPARATE FROM THE WINDOW. Everything about WHEN to open, WHAT to show and WHAT a
 * press means is a pure function of the door's state; only the last step needs Electron. So the decisions
 * live in `laneCardDecision` and a court can drive them with no window, no display and no Electron — the
 * same split `lane-card-view.mjs` uses, and for the same reason.
 *
 * ── THE FOCUS RULE, WHICH IS THE WHOLE REASON THIS FILE HAS A COMMENT THIS LONG ──────────────────
 *
 * THE WINDOW OPENS IN FRONT AND MUST NOT STEAL THE KEYBOARD INTO A BUTTON. A card that appears under the
 * cursor is bad; a card that takes the keyboard and puts it on Send is worse, because the next Return
 * Peter presses — finishing a sentence somewhere else — sends a message to a lane. So:
 *
 *   * the window is shown with `showInactive()` where it can be, so it comes forward WITHOUT taking focus;
 *   * `focusable` stays true, because Peter must be able to click it;
 *   * **the page never autofocuses a button** — the court asserts it — so even when the window does take
 *     focus, Return does nothing until Peter has deliberately moved there.
 *
 * The three together are the rule. Any one alone leaves the defect: inactive-show without the page rule
 * still sends if something else focuses the window; the page rule alone still steals the keyboard from
 * whatever Peter was typing into.
 */

/** The card window's own route, matching what the preload invokes. */
export const PENDING_CHANNEL = 'aukora:lane-card:pending'
export const ACT_CHANNEL = 'aukora:lane-card:act'

/** How many cards may be pending at once. ONE, because a card is a decision and decisions queue badly. */
export const MAX_PENDING_CARDS = 1

/**
 * Whether the surface should be open, given what the door holds.
 *
 * A CORE-CLASS CARD IS THE TRIGGER. The door only issues a card to a sender whose class requires one, so a
 * pending card IS the signal — no second test for the class is needed here, and adding one would be a
 * second place to get the class rule wrong.
 *
 * @param {{pending: object|null, windowOpen: boolean}} state
 * @returns {{open: boolean, reason: string}}
 */
export function laneCardDecision(state) {
  const pending = state?.pending ?? null
  if (pending === null) {
    return { open: false, reason: 'no card is pending' }
  }
  // ── **`MAX_PENDING_CARDS` WAS A CLAIM NOTHING READ (AUMLOK-114)** ─────────────────────────────────────────
  //
  // MEASURED: the constant above says *"ONE, because a card is a decision and decisions queue badly"* — and
  // **no code in the tree read it.** So the limit was a sentence in a file, and a door that handed back two
  // pending cards would have had both presented: **the second silently replacing the first, which is exactly
  // the queue the comment says must not exist.** *A limit that is not enforced reads as a limit that is.*
  //
  // **COUNTED FROM THE STATE THE DOOR SUPPLIED, not assumed.** `pending` is what this decision is about; a
  // caller that also passes the door's whole pending list has it counted. A state that carries no list is
  // treated as one card — the one being decided — so this refuses only when the door SAYS there are more.
  const pendingCount = Array.isArray(state?.pendingCards) ? state.pendingCards.length : 1
  if (pendingCount > MAX_PENDING_CARDS) {
    return {
      open: false,
      reason: `${String(pendingCount)} cards are pending and MAX_PENDING_CARDS is ${String(MAX_PENDING_CARDS)}: `
        + 'a card is a decision and decisions queue badly, so the door must resolve one before offering another',
    }
  }
  if (state?.windowOpen === true) {
    // ALREADY OPEN. Re-showing would raise a window the owner may be reading, and re-sending the view would
    // discard a half-made decision.
    return { open: false, reason: 'the surface is already open for this card' }
  }
  return { open: true, reason: `a card for lane ${String(pending.lane)} is pending` }
}

/**
 * The facts a card window is opened with. **`show: false` and a later `showInactive()`** — never
 * `focus()` on open, which is the defect this exists to prevent.
 */
export function laneCardWindowOptions(preloadPath) {
  return {
    width: 560, height: 520, minWidth: 420, minHeight: 320,
    show: false,
    // A CARD IS NOT A TOOLBAR. It sits above the shell so it is not lost behind it, and it is not
    // `alwaysOnTop` in a way that would follow Peter across applications.
    alwaysOnTop: false,
    resizable: true,
    minimizable: false,
    maximizable: false,
    autoHideMenuBar: true,
    webPreferences: {
      sandbox: true, contextIsolation: true, nodeIntegration: false,
      webSecurity: true, webviewTag: false,
      // THE PAGE'S ONLY VERB, and it exposes exactly two calls. See `lane-card-preload.cjs`.
      preload: preloadPath,
    },
  }
}

/**
 * Show a card window IN FRONT WITHOUT TAKING THE KEYBOARD.
 *
 * `showInactive` is the whole point and is used when the runtime has it; `show` is the fallback, and the
 * page's no-autofocus rule is what keeps Return harmless in that case. **Neither branch calls `focus()`.**
 */
export function presentCardWindow(window) {
  if (typeof window?.showInactive === 'function') { window.showInactive(); return 'showInactive' }
  window?.show?.()
  return 'show'
}

/**
 * What a press does at the door.
 *
 * THE PRESS IS RE-VALIDATED HERE, not trusted from the page. A sandboxed page and a preload are a boundary,
 * but the handler is the last place the argument can be checked before it reaches the door — and the door
 * re-checks the card itself, so this is a gate and not the gate.
 *
 * @param {unknown} press
 * @param {{validatePress: Function, confirm: Function, decline: Function}} deps
 */
export async function handlePress(press, deps) {
  const valid = deps.validatePress(press)
  if (!valid.ok) return { ok: false, code: valid.code, reason: valid.reason }
  if (valid.action === 'decline') {
    // A DECLINE SENDS NOTHING. It records the fact and returns — there is no branch here that could
    // forward a message, which is what makes the arm provable rather than promised.
    const recorded = await deps.decline({ nonce: valid.nonce })
    return { ok: true, declined: true, recorded }
  }
  const sent = await deps.confirm({ nonce: valid.nonce })
  return { ok: sent?.ok === true, reason: sent?.reason ?? null }
}

/**
 * Install the card bridge: the two channels the preload invokes, and the window they open.
 *
 * WHY IT IS A FUNCTION AND NOT INLINE IN `main.mjs`. The shell's own split is that `main.mjs` creates
 * windows and a bridge module installs handlers (`aumlok-bridge.mjs` does exactly this). Following it
 * keeps the handler logic testable and keeps `main.mjs` a wiring file.
 *
 * THE HANDLERS RE-VALIDATE. A sandboxed page and a preload are a boundary, but the handler is the last
 * place an argument can be checked before it reaches the door — and the door re-checks the card itself,
 * so this is a gate and not the gate.
 *
 * @param {object} deps
 * @param {object} deps.ipcMain - Electron's ipcMain.
 * @param {(nonce: string) => Promise<object>} deps.confirm - sends through the door, by nonce.
 * @param {(press: {nonce: string}) => Promise<object>} deps.decline - records a decline. SENDS NOTHING.
 * @param {() => object|null} deps.getPending - the card the door currently holds, or null.
 * @param {() => object|null} deps.getView - the render model for that card, or null.
 * @param {(view: object) => void} [deps.openSurface] - called when a card should be shown.
 * @param {object} [deps.validatePress] - the press rule; injected so a court can drive this.
 */
export function installLaneCardBridge(deps) {
  const { ipcMain, confirm, decline, getPending, getView, openSurface, validatePress } = deps
  if (ipcMain === undefined) throw new Error('lane-card: ipcMain is required')
  for (const [name, fn] of [['confirm', confirm], ['decline', decline],
    ['getPending', getPending], ['getView', getView]]) {
    if (typeof fn !== 'function') throw new Error(`lane-card: ${name} must be a function`)
  }
  if (typeof validatePress !== 'function') throw new Error('lane-card: validatePress is required')

  /** Whether the surface is open for the card currently held. One card, one surface. */
  let openFor = null

  ipcMain.handle(PENDING_CHANNEL, () => {
    const pending = getPending()
    // NOTHING PENDING IS `null`, NOT AN ERROR. The page renders "no card is waiting" — an exception here
    // would make an empty queue look like a fault.
    if (pending === null || pending === undefined) return null
    const decision = laneCardDecision({ pending, windowOpen: openFor === pending.nonce })
    const view = getView()
    if (decision.open && typeof openSurface === 'function') {
      openFor = pending.nonce
      openSurface(view)
    }
    return view
  })

  ipcMain.handle(ACT_CHANNEL, async (_event, press) => {
    const result = await handlePress(press, { validatePress, confirm, decline })
    if (result.ok) openFor = null          // the card is answered; the surface is no longer open for it
    return result
  })

  return {
    channels: [PENDING_CHANNEL, ACT_CHANNEL],
    /** For a court: which card the surface is currently open for. */
    openFor: () => openFor,
  }
}
