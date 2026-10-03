// The shell's half of AUMLOK in the app: the public state, the one-bit approval question, and the
// receipt. THIS FILE NO LONGER OPENS A CEREMONY WINDOW AND NO LONGER RUNS A CEREMONY.
//
// THE CEREMONY IS THE AUMLOK SCREEN INSIDE THE FACE, NOT A SEPARATE WINDOW. v2 opened a second
// BrowserWindow from three sites in this file — an opener, a mode whitelist and a page loaded from
// `aumlok-ceremony.html` — and that window, its page and its preload are gone. Binding now happens
// where the person already is: the app GENERATES seven words from real entropy, shows them ONCE on
// the Aumlok screen, and the person types them back. THE SAME SEVEN WORDS DERIVE THE SAME ROOT ON ANY
// MACHINE, and that IS the recovery. THE WINDOW IS NOT MERELY CLOSED, IT IS ABSENT: no second window
// and no session to open first — so there is nothing here that could open one.
//
// NO PHRASE ENTERS THIS FILE AT ALL. That is the strengthening, not a loss: v2 had to defend an IPC
// channel that received the phrase once, inward, and this process existed partly to keep that channel
// safe. A screen that renders its own words and reads its own typing hands the phrase to nothing but
// its own derivation. The shell carries the PUBLIC facts and one bit, and no more.
//
// WHY THE SHELL CARRIES THE APPROVAL AT ALL. An approval is the one thing this development cannot
// delegate to a page: it must be a modal that cannot be scrolled past, over the exact bytes, before a
// key signs them. `ask()` is that job, and it is deliberately the ONLY thing here that opens a window.
// Its answer is one bit, matched to its question by the challenge it echoes.
//
// WHY IT LOOKS INSIDE THE RELEASE AND NOT AT THIS CHECKOUT. The organ is loaded from the release the
// shell is serving (`plugins/aukora-aumlok/lib/**`), not from this tree and not from a copy — because
// two copies of a key-derivation path are two paths that can disagree. If the release does not carry
// it, the answer is a refusal BY NAME rather than a fallback that would derive a different root.
// THE OWNER DAEMON'S DETECTOR, imported rather than re-implemented: whether a daemon is installed and
// reachable is answered in ONE place, and the shell asks that place.
import { ownerDaemonStatus } from '../../plugins/aukora-owner-daemon/lib/detect.mjs'
import { submitProposal, settleBytesFor } from '../../plugins/aukora-owner-daemon/lib/client.mjs'

/**
 * THE REFUSAL THAT REPLACES AN IN-PROCESS SETTLE, and there is no fallback by design.
 *
 * When an owner daemon is installed and reachable, THIS PROCESS MUST NOT SETTLE. It submits the exact frozen
 * bytes over `submit.sock` and tells the screen the approval is pending, because a settle performed here is
 * authorised by nothing but this uid — the claim `SAME_UID` names and the daemon exists to retire. A
 * fallback that settled locally when the daemon was slow or unreachable would be the shell approving itself,
 * which is why the failure to reach the daemon is an ERROR rather than a slower path.
 */
export const SETTLE_REQUIRES_OWNER_DAEMON = 'aukora:settle-requires-owner-daemon'
/**
 * *** AN INSTALLED DAEMON THAT DID NOT ANSWER REFUSES; IT DOES NOT BECOME AN ABSENT ONE. ***
 *
 * This exists because the fall-through was an EXPLOIT AND NOT A DEGENERATE CASE. `ownerDaemonStatus()`
 * reported `installed: false` whenever the hello failed, and both handlers below test
 * `installed && reachable` before routing — so ANYONE WHO COULD MAKE THE HELLO FAIL GOT THE OLD
 * SAME-UID IN-PROCESS SETTLEMENT BACK. Filling the submit connections or stopping the socket is enough.
 * THE OBSTRUCTION DOES NOT HAVE TO FORGE ANYTHING; IT ONLY HAS TO MAKE THE DAEMON LOOK ABSENT.
 */
export const OWNER_DAEMON_UNREACHABLE = 'aukora:owner-daemon-unreachable'

/** The operation names the daemon binds a settle-class approval to, derived from the ceremony itself. */
function settleOperationOf(intent) {
  const ceremony = typeof intent === 'string' ? intent
    : (typeof intent?.ceremony === 'string' ? intent.ceremony : 'unknown')
  return { operation: `aumlok.${ceremony}`, scope: 'aukora-aumlok.ceremony' }
}
import { spawn } from 'node:child_process'
import { lstatSync } from 'node:fs'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
// THE DRAW HALF OF THE CROSSING, imported rather than re-implemented: one module owns the phrase's
// shape, its one in-memory slot and its refusal names, and this file owns the channel it arrives on.
import { BIND_REFUSE, DRAW_REFUSE, createAumlokDraw } from './aumlok-draw.mjs'
import { defaultAumlokDirectory, writeInstallSettingsOnFirstLink } from './install-settings.mjs'
// THE REST OF THIS BRIDGE LIVES IN TWO SIBLINGS, MOVED WHOLE (2026-09-27) so that no file of it passes the
// self-change loop's 64 KiB limit (MAX_PATCH_BYTES, vendor/aukora-seed-app). No moved line was rewritten, every
// name this file exported is still exported from here, and the code below that uses them is unchanged.
//   aumlok-bridge-state.mjs   the channels and refusal names, the question and its card, the organ library, the
//                             binding state, the test-controller retirement and the binding receipt
//   aumlok-approval-view.mjs  the sheet's theme, token grammar, pre-paint colour, z-order and keyboard guards
import {
  APPROVAL_CHANNELS, APPROVAL_REFUSE, admitApprovalQuestion, approvalCardFields, loadOrganLibrary, readBindingState,
  resolveAumlokDirectory, signingReasonName,
} from './aumlok-bridge-state.mjs'
import {
  Z_ORDER_INTERVAL_MS, approvalTokenCss, guardKeyboard, needsRaise, readFaceTokenValues, safeApprovalTokens,
  surfaceColour,
} from './aumlok-approval-view.mjs'
export {
  readPatchPluginDirectories, APPROVAL_CHANNELS, APPROVAL_REFUSE, approvalCardFields, admitApprovalQuestion,
  signingSessionSource, signingReasonName, resolveAumlokDirectory, loadOrganLibrary, readBindingState,
  TEST_CONTROLLER_DIRNAME, retireTestController, BINDING_RECEIPT_FILENAME, BINDING_RECEIPT_DOMAIN,
  writeBindingReceipt,
} from './aumlok-bridge-state.mjs'
export {
  readFaceTokenValues, guardKeyboard, needsRaise, SAFE_APPROVAL_TOKENS, safeApprovalTokens, approvalTokenCss,
} from './aumlok-approval-view.mjs'

/** A key folder that exists but is not a plain directory, named as `bindV3` names it; null when it is fine or absent. */
function folderFault(directory) {
  try {
    const folder = lstatSync(directory)
    if (folder.isDirectory()) return null
    return `aumlok:bind-write-failed:${folder.isSymbolicLink() ? 'ELOOP' : 'ENOTDIR'}`
  } catch (error) {
    return error?.code === 'ENOENT' ? null : 'aumlok:bind-write-failed'
  }
}

/** Whether anything at all sits at a record path (lstat: a file, a directory, a live or dangling symlink). */
function recordPathOccupied(path) {
  try {
    lstatSync(path)
    return true
  } catch (error) {
    return !(error?.code === 'ENOENT' || error?.code === 'ENOTDIR')
  }
}

/** Electron's sending frame must still be the live main frame that sent this invocation. */
function currentIpcFrame(event, contents) {
  try {
    if (!contents || contents.isDestroyed() || event?.sender !== contents || event.type !== 'frame') return null
    const frame = event.senderFrame, main = contents.mainFrame
    if (!frame || !main || frame.isDestroyed() || frame.detached !== false || frame.parent !== null
      || !Number.isSafeInteger(frame.processId) || !Number.isSafeInteger(frame.routingId)
      || frame.processId !== main.processId || frame.routingId !== main.routingId
      || event.processId !== frame.processId || event.frameId !== frame.routingId) return null
    return frame
  } catch { return null } // Destroyed/detached frame access can throw in Electron.
}

/** Register the approval question's IPC surface and hand back a disposer.
 *
 * ONE WINDOW AT A TIME, AND IT IS MODAL. A second approval window would be a second chance to answer,
 * and the answer is one bit about one operation: two questions on screen at once would make "the
 * person said yes" ambiguous about WHICH operation.
 *
 * SENDER VALIDATION IS PER CHANNEL. `state` is callable only by the application's own window; `ask`
 * and `answer` only by the approval window. The application's page is served by the backend, so it
 * must not be able to reach the channel that settles a signature by guessing its name.
 *
 * @param {object} deps - the Electron surfaces and the shell's own facts.
 * @returns {{dispose: () => void, close: () => void, ask: Function, isApprovalOpen: () => boolean}} the bridge.
 */
export function installApprovalBridge(deps) {
  // `WebContentsView` IS WHAT AN APPROVAL IS DRAWN IN NOW: a view the shell owns and docks inside the
  // application's own window, rather than a window of its own that reads as a different application.
  const { WebContentsView, ipcMain, session, app, here, getWindow, getReleaseDir, getPatchPaths, log } = deps
  // THE DRAW IS BUILT HERE UNLESS ONE WAS HANDED IN. A court measures `aumlok-draw.mjs` directly and
  // passes its own instance; the app builds the shell's one and nothing else in this process can make
  // a second, so there is exactly one place a phrase can be drawn from and exactly one slot holding it.
  const draw = deps.draw ?? createAumlokDraw()
  // Only the shell-owned backend supplies this pin. An attach URL is a display target,
  // not authority to use this bridge; never infer trust from the renderer or any loopback URL.
  let applicationOrigin = null
  try {
    const expected = new URL(deps.applicationOrigin)
    if (expected.protocol === 'http:' && expected.hostname === '127.0.0.1'
      && expected.origin === deps.applicationOrigin) applicationOrigin = expected.origin
  } catch { /* Missing or malformed trusted context refuses every application IPC. */ }
  const approvalDocument = pathToFileURL(join(here, 'aumlok-approval.html')).href
  // TWO SEAMS, AND EACH IS ONE LINE BECAUSE A SEAM THAT NEEDS MORE IS A REWRITE.
  //
  // `ownerDaemonStatus` IS INJECTABLE so a court can put the daemon PRESENT or ABSENT without installing one
  // at `/usr/local/etc/`. Its default is the REAL detector (`ownerDaemonStatus()` from
  // `plugins/aukora-owner-daemon/lib/detect.mjs`), which verifies a signed hello against the key recorded at
  // install — so the default is the honest answer and a caller that substitutes it is saying so explicitly.
  //
  // `readBindingState` IS INJECTABLE so the harness can drive SUBMIT without a bound identity on disk. It is
  // the same shape `draw` already had (`deps.draw ?? createAumlokDraw()`), for the same reason: the shell
  // builds the real one and a court hands in its own.
  const ownerDaemonStatusOf = deps.ownerDaemonStatus ?? ownerDaemonStatus
  const readState = deps.readBindingState ?? readBindingState
  let approval = null
  /** The resize listener that keeps the docked sheet over the pane, so it can be removed with it. */
  let dockedResize = null
  /** The timer that keeps the sheet topmost while it is docked. */
  let zOrderGuard = null
  /** The keyboard guard's disposer, kept so the main renderer's keys come back with the sheet's absence. */
  let keyboardGuard = null
  let approvalSession = null
  let library = null
  let directory = null

  const say = typeof log === 'function' ? log : () => {}

  /** The controller directory and the organ library, resolved once per bridge. */
  async function context() {
    if (library === null) library = await loadOrganLibrary(getReleaseDir())
    if (directory === null) {
      // A FRESH INSTALL NAMES NO KEY FOLDER until its first link writes the per-install settings file, so
      // the folder the ceremony writes into is `<state root>/aumlok` (the owner's layout). A patch that
      // declares one always wins, so a deployment that names its folder is unchanged.
      const stateRoot = typeof deps.getStateRoot === 'function' ? deps.getStateRoot() : null
      const binding = resolveAumlokDirectory(getPatchPaths())
        ?? (typeof stateRoot === 'string' && stateRoot !== ''
          ? { directory: defaultAumlokDirectory(stateRoot), source: 'default' } : null)
      if (binding === null) {
        const error = new Error(`${APPROVAL_REFUSE.NO_DIRECTORY}: no aukora-aumlok row in any `
          + 'composition patch declares config.directory, so this bridge has no destination')
        error.code = APPROVAL_REFUSE.NO_DIRECTORY
        throw error
      }
      directory = binding.directory
    }
    return { library, directory }
  }

  /**
   * THE FIRST LINK WRITES THE PER-INSTALL SETTINGS (install-settings.mjs), so Kira mounts on the next start.
   *
   * After the ceremony succeeded, never instead of it: the verdict the screen gets is the ceremony's, and a
   * settings file that could not be written costs a log line, not the binding. Written only when the support
   * root has no such file yet, from the public projection of the record just written.
   */
  function recordInstallSettings(lib, dir) {
    try {
      const supportRoot = typeof deps.getSupportRoot === 'function' ? deps.getSupportRoot() : null
      const stateRoot = typeof deps.getStateRoot === 'function' ? deps.getStateRoot() : null
      if (typeof supportRoot !== 'string' || supportRoot === '' || typeof stateRoot !== 'string' || stateRoot === '') {
        say('install settings not written: this shell was given no support root or state root')
        return
      }
      const result = writeInstallSettingsOnFirstLink({
        supportRoot, stateRoot, directory: dir, state: readState(lib, dir),
      })
      say(result.written
        ? `install settings written: ${result.path} (Kira mounts on the next start)`
        : `install settings not written: ${String(result.reason)} (${result.path})`)
    } catch (error) {
      say(`install settings not written: ${String(error?.code ?? error?.message ?? error)}`)
    }
  }

  /** Only the current main document at the shell-owned backend's exact origin may call. */
  function fromApplication(event) {
    try {
      const frame = currentIpcFrame(event, getWindow()?.webContents)
      if (!frame || applicationOrigin === null || frame.origin !== applicationOrigin) return false
      const url = new URL(frame.url)
      return url.protocol === 'http:' && url.origin === applicationOrigin && url.username === '' && url.password === ''
    } catch { return false }
  }

  /** Only the approval window may ask what it is answering, or answer it. */
  function fromApproval(event) {
    try {
      const frame = currentIpcFrame(event, approval?.webContents)
      // Electron 44 serializes file-frame origins as file://. That alone trusts every file;
      // also pin the exact packaged document, preserving its theme query and fragment.
      if (!frame || frame.origin !== 'file://') return false
      const url = new URL(frame.url)
      url.search = ''; url.hash = ''
      return url.href === approvalDocument
    } catch { return false }
  }

  /**
   * PUT THE SHEET BACK ON TOP, IF SOMETHING IS ABOVE IT.
   *
   * Removal and re-addition rather than a z-index, because a `View` has no z-index: the last child is the
   * topmost one. Called from the guard below for as long as the sheet is docked, so a view added by anyone
   * else is answered by the next tick rather than by the person noticing they are approving something
   * through an overlay.
   */
  function raiseApproval() {
    const win = typeof getWindow === 'function' ? getWindow() : null
    const view = approval
    if (win === null || win === undefined || view === null) return
    const content = win.contentView
    if (content === null || content === undefined) return
    if (!needsRaise(content.children, view)) return
    content.removeChildView(view)
    content.addChildView(view)
  }

  /**
   * A SMALL CARD JUST ABOVE THE CHAT BOX, NOT A SHEET OVER THE WHOLE WINDOW (2026-09-27, Peter: "it should just be a
   * little pop-up in the chat"). The shell still draws it and still holds the key; only its size changed. It is placed
   * from two measurements it re-reads on every guard tick: where the page's composer card is (`[data-composer-card]`)
   * and how tall the approval card's content is. With no composer on screen it sits bottom-left.
   */
  let composerRect = null
  let cardHeight = 0
  function dockApproval() {
    const win = typeof getWindow === 'function' ? getWindow() : null
    if (win === null || win === undefined || approval === null) return
    const { width, height } = win.getContentBounds()
    const zoom = typeof win.webContents?.getZoomFactor === 'function' ? win.webContents.getZoomFactor() || 1 : 1
    const margin = 8
    const anchor = composerRect === null
      ? { x: 16, y: height - 96, width: Math.min(460, width - 32) }
      : { x: composerRect.x * zoom, y: composerRect.y * zoom, width: composerRect.width * zoom }
    const w = Math.min(Math.max(anchor.width, 340), width - 2 * margin)
    const x = Math.min(Math.max(margin, anchor.x), width - w - margin)
    const room = Math.max(160, anchor.y - 2 * margin)
    const h = Math.min(cardHeight > 0 ? cardHeight : 320, room, 720)
    const y = Math.max(margin, anchor.y - margin - h)
    // A CHILD VIEW'S BOUNDS ARE IN ITS PARENT'S SPACE (the window's content area).
    approval.setBounds({ x: Math.floor(x), y: Math.floor(y), width: Math.max(0, Math.floor(w)), height: Math.max(0, Math.floor(h)) })
  }
  /** Re-read the two measurements the card is placed from; a page that answers nothing leaves the last ones. */
  function measureDock() {
    const win = typeof getWindow === 'function' ? getWindow() : null
    const view = approval
    if (win === null || win === undefined || view === null || deps.headless === true) return
    const page = win.webContents
    const own = view.webContents
    if (page?.isDestroyed?.() || own?.isDestroyed?.()) return
    Promise.all([
      page.executeJavaScript(`(() => {
        const all = [...document.querySelectorAll('[data-composer-card]')].filter((el) => el.getBoundingClientRect().width > 0)
        const el = document.activeElement?.closest?.('[data-composer-card]') ?? all[0]
        if (!el) return null
        const r = el.getBoundingClientRect()
        return { x: r.left, y: r.top, width: r.width }
      })()`, false).catch(() => composerRect),
      own.executeJavaScript(`(() => { const c = document.querySelector('main.card'); return c ? Math.ceil(c.scrollHeight) + 2 : 0 })()`, false)
        .catch(() => cardHeight),
    ]).then(([rect, h]) => {
      if (approval !== view) return
      const changed = JSON.stringify(rect) !== JSON.stringify(composerRect) || h !== cardHeight
      composerRect = rect && Number.isFinite(rect.x) && Number.isFinite(rect.y) && Number.isFinite(rect.width) ? rect : null
      cardHeight = Number.isFinite(h) ? h : 0
      if (changed) dockApproval()
    }, () => {})
  }

  /**
   * PAINT THE SHEET IN THE SITE'S OWN TOKENS.
   *
   * Read from the release's face bundles, exactly the way the pre-paint colour is read, and injected into
   * the sheet as a `:root` block: whatever `--dsw-…` the site declares is what the sheet's own
   * `var(--dsw-…)` references resolve to, so the sheet follows the site instead of carrying a copy of it.
   * A token that resolves to nothing, or to another `var()`, is DROPPED rather than injected: an unresolved
   * token is not a colour, and a sheet that inherited one would paint in whatever the browser defaulted to.
   */
  async function applySiteTokens(view, theme) {
    const release = typeof getReleaseDir === 'function' ? getReleaseDir() : null
    if (release === null || release === undefined) return
    const { library } = await context()
    // PUT THROUGH THE GRAMMAR FIRST: the site's values are parsed, bounded and contrast-checked, and any
    // refusal is logged and replaced from the shell's own palette.
    const safe = safeApprovalTokens(readFaceTokenValues(release, library, theme), { warn: line => say(line) })
    const css = approvalTokenCss(safe.values)
    if (css.length === 0) return
    await view.webContents.insertCSS(css)
  }

  /**
   * TAKE THE SHEET DOWN, AND LET ITS DESTRUCTION DECLINE.
   *
   * The question is settled by the `destroyed` listener the ask registers, which is why this function's job
   * is only to unmount: removing the child view and closing the contents. A sheet that is taken down leaves
   * the signer with `approve: false`, never waiting for a person who has gone.
   */
  function closeApproval() {
    const view = approval
    if (view === null) return
    // THE DECLINE IS RECORDED HERE, NOT ONLY ON THE DESTROY EVENT. `settleAsk` is settle-once, so the
    // listener the ask registers is a second chance rather than the mechanism: a renderer that never emits
    // `destroyed` — a hung process, a close that is queued — must not leave the signer waiting for an answer
    // from a person who has already been shown the sheet closing.
    settleAllAsks({ approve: false })
    approval = null
    if (zOrderGuard !== null) {
      clearInterval(zOrderGuard)
      zOrderGuard = null
    }
    // FOCUS AND THE KEYBOARD GO BACK TOGETHER, and the guard is disposed even when the view is already gone:
    // a listener left on the main renderer would keep a closed sheet's keyboard block in place.
    if (keyboardGuard !== null) {
      keyboardGuard()
      keyboardGuard = null
    }
    const win = typeof getWindow === 'function' ? getWindow() : null
    if (win !== null && win !== undefined && dockedResize !== null) {
      win.removeListener('resize', dockedResize)
      dockedResize = null
      try {
        win.contentView.removeChildView(view)
      } catch { /* already gone with the window */ }
    }
    if (!view.webContents.isDestroyed()) view.webContents.close()
  }

  /**
   * THE ONE PENDING QUESTION. `{challenge, facts, settle}` while an approval is on screen.
   *
   * **THE AMBIGUITY WAS REMOVED; THE BINDING WAS NOT.** A second question used to be refused (`ASK_BUSY`) because
   * "the answer is matched to the question by the challenge it echoes, so a window that was left open cannot answer
   * a question asked after it. Two questions at once would make 'the person said yes' ambiguous about WHICH
   * operation, and an ambiguity in this direction is an approval for something nobody looked at."
   *
   * Every word of that still holds, and the queue is how it holds with more than one question waiting: **each entry
   * carries its OWN challenge and its OWN derived line, a click NAMES the challenge it answers, and `settleAsk`
   * settles exactly the one that matches.** A window left open still cannot answer a question asked after it, and
   * "the person said yes" still means one named operation. **There is no path that settles several** — `settleAsk`
   * takes one challenge and settles one entry, so a batch approval is a shape this code cannot express rather than
   * a rule somebody has to remember not to break.
   */
  let pendingQueue = []

  /**
   * Settle ONE queued question, named by its challenge.
   *
   * SETTLE-ONCE IS KEPT PER ENTRY: the entry is REMOVED before it is settled, so a second answer naming the same
   * challenge finds nothing and is refused by name rather than settling a question twice.
   * @returns {boolean} whether a queued question was settled.
   */
  function settleAsk(challenge, answer) {
    const at = pendingQueue.findIndex(entry => entry.challenge === challenge)
    if (at === -1) return false
    const [entry] = pendingQueue.splice(at, 1)
    entry.settle(Object.freeze({ ...answer }))
    return true
  }

  /** End EVERY queued question. A window closing or being destroyed ends all of them, not just the newest. */
  function settleAllAsks(answer) {
    const queued = pendingQueue
    pendingQueue = []
    for (const entry of queued) entry.settle(Object.freeze({ ...answer }))
  }

  /**
   * OPEN THE ONE-BIT APPROVAL WINDOW, AND NOTHING ELSE OPENS A WINDOW HERE.
   *
   * This is the v2 ceremony window's machinery narrowed to its one surviving job. The window it opens
   * shows the PUBLIC facts of the pending question and returns ONE BIT. It draws no words, asks for
   * none, derives nothing and writes nothing: there is no phrase on this path to protect.
   */
  /**
   * THE SOUND A CARD MAKES WHEN IT ARRIVES.
   *
   * `afplay` is preferred because it is the mechanism ALREADY OBSERVED to be audible on this Mac; the
   * system alert sound needs no asset of ours and no bundling step. `shell.beep` is not reachable from
   * here and is not worth a second dependency, so a machine with no `afplay` is a machine that opens
   * the sheet in silence - which is exactly the behaviour that shipped before, not a new failure.
   *
   * DETACHED AND UNREFERENCED, and every failure is swallowed: the player must never be a reason this
   * app stays alive, must never hold an approval open, and must never fail an approval. A card that
   * cannot beep is still a card that can be clicked.
   */
  function alert() {
    try {
      const player = spawn('/usr/bin/afplay', ['/System/Library/Sounds/Sosumi.aiff'],
        { detached: true, stdio: 'ignore' })
      player.on('error', () => { /* no player on this machine: the sheet still opens */ })
      player.unref()
    } catch { /* no audio at all: the sheet still opens */ }
  }

  function openApprovalWindow() {
    if (approval !== null && !approval.webContents.isDestroyed()) {
      approval.webContents.focus()
      return { ok: false, reason: `${APPROVAL_REFUSE.WINDOW_OPEN}: an approval window is already open` }
    }
    // The shell selects the requested dark face palette before injecting the checked tokens.
    const theme = 'dark' // Peter's approval card shares the Messages/Memory dark glass palette.
    const background = surfaceColour(getReleaseDir(), theme)
    // AN IN-MEMORY SESSION, AND ITS OWN. `persist:` is absent on purpose: the approval needs no
    // cookie, no cache and nothing that outlives it, and reusing the application's partition would
    // let the backend-served page share a storage area with the window that answers for a key.
    approvalSession = session.fromPartition('aukora-approval', { cache: false })
    approvalSession.setPermissionRequestHandler((_contents, _permission, callback) => callback(false))
    const options = {
      webPreferences: {
        session: approvalSession,
        preload: join(here, 'aumlok-approval-preload.cjs'),
        sandbox: true, contextIsolation: true, nodeIntegration: false,
        webSecurity: true, webviewTag: false, spellcheck: false,
        // NO DEVTOOLS: a console in the window whose answer authorizes a signature is a place that
        // answer can be read from by anything that can reach this app's debugging surface.
        devTools: false,
      },
    }
    // THE SURFACE IS A VIEW INSIDE THE APPLICATION'S OWN WINDOW, NOT A WINDOW OF ITS OWN.
    //
    // It used to be a separate always-on-top black window, and Peter's report was that it looked like a
    // different application. A `WebContentsView` owned by the shell and added to the main window's
    // `contentView` is the same document, the same preload and the same fences — drawn where the person is
    // already looking, over the conversation they were reading.
    const win = typeof getWindow === 'function' ? getWindow() : null
    if (win === null || win === undefined) return { ok: false, reason: APPROVAL_REFUSE.NO_DOCK }
    delete options.parent
    delete options.modal
    delete options.backgroundColor
    const view = new WebContentsView(options)
    // A VIEW IS WHITE UNTIL TOLD OTHERWISE, and the sheet's scrim is translucent: without this the app behind was replaced by
    // a white page (2026-09-27, "it's going to blind people at night"). Transparent, so the app shows through the dark tint.
    view.setBackgroundColor('#00000000')
    approval = view
    if (deps.headless !== true) {
      win.contentView.addChildView(view)
      dockedResize = () => { dockApproval() }
      dockApproval()
      win.on('resize', dockedResize)
      // THE GUARD RUNS FOR AS LONG AS THE SHEET IS DOCKED, and only then: a timer that outlived the sheet
      // would be a timer holding a destroyed view. `unref` so it can never be the reason this process stays
      // alive — the sheet is not a reason for the application to keep running.
      // A CARD THAT OPENS IN SILENCE GETS MISSED, AND A MISSED CARD EXPIRES UNSIGNED. The sound belongs
      // to the surface that owns the sheet, and it lives HERE rather than in `main.mjs` because this is
      // the only module on the path that may be changed: `main.mjs` is a self-protecting path.
      // IT IS INSIDE THE DOCKING GUARD ON PURPOSE. `headless` is the seam a court uses to open the real
      // sheet without putting it on a person's screen; a court must never sound on his Mac either.
      alert()
      composerRect = null
      cardHeight = 0
      measureDock()
      zOrderGuard = setInterval(() => { raiseApproval(); measureDock() }, Z_ORDER_INTERVAL_MS)
      if (typeof zOrderGuard.unref === 'function') zOrderGuard.unref()
      // AND THE KEYBOARD BELONGS TO THE SHEET while it is on screen.
      keyboardGuard = guardKeyboard(win, view)
    }
    // THE SITE'S OWN TOKENS ARE INJECTED INTO THE SHEET, so what it is painted in changes when the site
    // changes. The one colour read synchronously above is the pre-paint colour; this is the rest of them,
    // and it lands as soon as the document has one.
    view.webContents.on('did-finish-load', () => {
      void applySiteTokens(view, theme).catch(() => { /* the sheet keeps its fallbacks, which are the site's own values as of the build */ })
    })
    // THE WINDOW NAVIGATES NOWHERE. It is a local file and it stays one: an open handler that denied
    // nothing would let a link, or a compromised renderer, turn it into a browser.
    view.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
    view.webContents.on('will-navigate', event => event.preventDefault())
    // A COURT OPENS THE REAL SHEET AND MUST NOT PUT IT ON A PERSON'S SCREEN. `headless` skips only the
    // docking; every other fact about the view — its session, preload, devtools setting, that it loads a
    // local file — is exactly what ships.
    view.webContents.once('destroyed', () => { if (approval === view) approval = null })
    view.webContents.loadFile(join(here, 'aumlok-approval.html'), { query: { theme } }).catch(error => {
      say(`aumlok approval: page failed to load: ${String(error?.message ?? error)}`)
      closeApproval()
    })
    return { ok: true }
  }

  /** What a screen needs to know about the signing session, in the session's OWN words. */
  function readSigningState() {
    const source = typeof deps.getSigningSession === 'function' ? deps.getSigningSession : null
    let session = null
    try {
      session = source === null ? null : source()
    } catch {
      session = null
    }
    if (session === null || session === undefined || typeof session.status !== 'function') {
      // NO SIGNER, SO THERE IS NOTHING TO OPEN. `available: false` is what stops a screen offering a
      // button that would refuse, and `locked: true` says signing is not open either way.
      return Object.freeze({ available: false, locked: true, reason: 'aumlok:signing-session-absent',
        expiresAt: null, remainingMs: 0, windowMs: null })
    }
    const status = session.status()
    // THE SESSION'S OWN FIELDS, NOT A SECOND OPINION. `reason` is the session's name for why it is shut,
    // which is exactly the distinction a screen needs and exactly the one it cannot invent. The one v2
    // name is translated; see `signingReasonName`.
    //
    // `locked` NO LONGER READS A SESSION FIELD, AND THAT IS THE v3 FACT RATHER THAN A TIDY-UP. It used
    // to read the open/shut boolean the deleted v2 session produced, and that field went with the
    // session: the v3 signer holds the root seed this machine kept after binding and signs without a
    // window, so there is no open/shut state to report and nothing that could report one.
    // The old read survived in code that can no longer be reached at all — `startShellSigner` returns
    // `{serving, reason, socketPath}`, which has no `session` for `signingSessionSource` to hand over,
    // so this function returns the absent-session answer above and never arrives here. Written the
    // other way round it would have been a permissive default, which is why it is spelled out: a
    // session that cannot state it is serving is not serving.
    return Object.freeze({
      available: true,
      locked: status.serving !== true,
      reason: signingReasonName(status.reason) ?? null,
      expiresAt: status.expiresAt ?? null,
      remainingMs: status.remainingMs ?? 0,
      windowMs: status.windowMs ?? null,
    })
  }

  ipcMain.handle(APPROVAL_CHANNELS.STATE, async (event) => {
    if (!fromApplication(event)) return { ok: false, reason: APPROVAL_REFUSE.FORBIDDEN_SENDER }
    try {
      const { library: lib, directory: dir } = await context()
      if (!fromApplication(event)) return { ok: false, reason: APPROVAL_REFUSE.FORBIDDEN_SENDER }
      return { ok: true, directory: dir, ...readState(lib, dir), signing: readSigningState() }
    } catch (error) {
      return { ok: false, reason: error?.code ?? String(error?.message ?? error) }
    }
  })

  /**
   * DRAW ONE PHRASE FOR THE APPLICATION'S OWN WINDOW, and for no other caller.
   *
   * THE WORDS GO TO THE PAGE AND NOWHERE ELSE. `fromApplication` is the same check `state` uses, and it
   * checks the current main frame and pinned origin. The draw also belongs to its webContents,
   * so another window cannot answer a phrase drawn for this one.
   */
  ipcMain.handle(APPROVAL_CHANNELS.DRAW, async (event, payload) => {
    // THE DRAW MODULE'S OWN NAME, not the approval module's: a court and a screen both match on the
    // name, and two names for one fact is how a refusal stops being recognisable.
    if (!fromApplication(event)) return { ok: false, reason: DRAW_REFUSE.FORBIDDEN_SENDER }
    // A MALFORMED PAYLOAD IS NOT A DRAW. An intent this shell does not run is refused by the draw
    // module's own name rather than being coerced into one of the two that exist.
    const intent = typeof payload === 'string' ? payload : payload?.intent
    try {
      // A BOUND FOLDER IS REFUSED BEFORE ANY WORDS EXIST (2026-09-29). Both intents reach `bindV3` in this process,
      // and `bindV3` never replaces an identity (`aumlok:bind-already-bound`) — so drawing seven words here would only
      // spend them on a refusal. Before that guard, the same press silently re-named the person. With an owner daemon
      // installed the ceremony is routed to it instead (SUBMIT below), and that path is left exactly as it was.
      // THE SAME TEST `bindV3` APPLIES (`refuseIfBound`): ANYTHING at the record path, by lstat — a readable record, a
      // damaged one, a symlink. Asking "does it read as bound?" instead let a damaged record through to a draw that
      // could only end in `already-bound`, which is the retry loop again (A4, 2026-09-29).
      if (intent === 'bind' || intent === 'refresh') {
        const daemon = await ownerDaemonStatusOf()
        if (daemon?.installed !== true) {
          const { library: lib, directory: dir } = await context()
          // THE FOLDER ITSELF FIRST, with the names `bindV3` would give after seven typed words.
          const fault = folderFault(dir)
          if (fault !== null) return { ok: false, reason: fault }
          if (recordPathOccupied(join(dir, lib.LOCAL_AUMLOK_CONTROL_FILENAME ?? 'local-control.json'))) {
            return { ok: false, reason: BIND_REFUSE.ALREADY_BOUND }
          }
        }
      }
      if (!fromApplication(event)) return { ok: false, reason: DRAW_REFUSE.FORBIDDEN_SENDER }
      const result = await draw.draw(event.sender, intent, getReleaseDir())
      if (!fromApplication(event)) {
        draw.forget()
        return { ok: false, reason: DRAW_REFUSE.FORBIDDEN_SENDER }
      }
      return result
    } catch (error) {
      say(`draw refused: ${String(error?.message ?? error)}`)
      // A NAME OF OURS OR THE DRAW MODULE'S OWN, never a raw message: the same rule SUBMIT's catch applies below.
      const code = error?.code
      const ours = typeof code === 'string' && code.length <= 128
        && (code.startsWith('aumlok:') || code.startsWith('aukora-owner:'))
      return { ok: false, reason: ours ? code : DRAW_REFUSE.CEREMONY_ABSENT }
    }
  })

  /**
   * TAKE THE TYPED WORDS BACK, PERFORM THE CEREMONY, and answer with a verdict carrying none of them.
   *
   * THE SENDER IS CHECKED TWICE AND THAT IS NOT REDUNDANT: here by the same window test as every other
   * channel, and inside the draw module by the webContents the pending phrase belongs to. The first
   * keeps another window off the channel at all; the second means a phrase drawn for one window can
   * never be answered by another, even if the window test were ever loosened.
   *
   * THE DESTINATION AND THE CEREMONY ARE RESOLVED BEFORE THE VERDICT, AND A FAILURE TO RESOLVE IS A
   * REFUSAL RATHER THAN A THROW. `context()` can refuse by name — no `aukora-aumlok` row declares a
   * `config.directory`, or the release carries no organ library — and the screen has to be TOLD that.
   * Letting it throw would land in the catch below and answer a raw message where a name belongs, and
   * answering nothing at all is the silent failure this whole path exists to remove.
   */
  ipcMain.handle(APPROVAL_CHANNELS.SUBMIT, async (event, payload) => {
    if (!fromApplication(event)) return { ok: false, reason: DRAW_REFUSE.FORBIDDEN_SENDER }
    // THE CALLER NAMES THE CEREMONY AND THE WORDS, IN THE FACE'S OWN ORDER. A payload that is not the
    // contracted shape reaches the draw module as `undefined` and is refused by its own name.
    const intent = payload === null || typeof payload !== 'object' ? undefined : payload.intent
    const words = payload !== null && typeof payload === 'object' && Array.isArray(payload.words)
      ? payload.words : null
    // THE HANDLE, AS TYPED, OR NOTHING. A payload that is not the contracted shape reaches the draw
    // module as `undefined` and is refused by the ceremony's own name. AN EMPTY FIELD IS "NOT TYPED"
    // RATHER THAN A MALFORMED HANDLE: on a new machine the ceremony then refuses by name, and on a
    // machine that is already bound the record's own handle is used below.
    const typedHandle = payload !== null && typeof payload === 'object'
      && typeof payload.handle === 'string' && payload.handle.length > 0
      ? payload.handle : undefined
    try {
      const { library, directory } = await context()
      if (!fromApplication(event)) return { ok: false, reason: DRAW_REFUSE.FORBIDDEN_SENDER }
      // WHERE THE HANDLE COMES FROM, PER CEREMONY. A BIND carries the handle the person just typed —
      // on a new machine it is the first thing they type. A REFRESH does not ask for it again: the
      // record on disk already publishes it, so it is read from the same public state `state` reads.
      // A machine whose record carries none (or a bind that typed none) passes `undefined` straight
      // through, and the ceremony refuses BY NAME rather than deriving under a different contract.
      const handle = typedHandle ?? readState(library, directory).handle
      // ── THE ROUTING: A DAEMON PRESENT MEANS THIS PROCESS DOES NOT SETTLE ────────────────────────────
      // The check is BEFORE the ceremony, so nothing is drawn, nothing is signed and nothing is written
      // here. The bytes frozen in the daemon are the SAME bytes this handler would have handed the draw
      // (`settleBytesFor` is the one place that serialisation lives), so the owner answers the operation the
      // screen asked for rather than a summary of it.
      const daemon = await ownerDaemonStatusOf()
      if (!fromApplication(event)) return { ok: false, reason: DRAW_REFUSE.FORBIDDEN_SENDER }
      // *** AN INSTALLATION THAT IS PRESENT AND DID NOT ANSWER REFUSES HERE, BEFORE THE CEREMONY. ***
      // Falling through to the in-process settle is what an agent gets by making the hello fail, so this
      // branch comes FIRST and writes nothing: no draw, no signature, no file.
      if (daemon?.installed === true && daemon?.reachable !== true) {
        say(`settle refused: an owner daemon is installed and did not answer — ${String(daemon.reason)}`)
        return {
          ok: false, reason: OWNER_DAEMON_UNREACHABLE,
          pending: { phase: 'awaiting-owner', authority: null, ceiling: daemon.ceiling ?? [],
            reason: 'this machine has an owner daemon and it could not be reached, so the shell will not '
              + 'settle in its place. NOTHING WAS WRITTEN. Restore the daemon and ask again.' },
        }
      }
      if (daemon?.installed === true && daemon?.reachable === true) {
        const bytes = settleBytesFor({ intent, words })
        const { operation, scope } = settleOperationOf(intent)
        const frozen = await submitProposal({
          socketPath: daemon.submitSocket,
          bytes, operation, scope,
          ledgerId: typeof handle === 'string' && handle.length > 0 ? handle : 'aumlok-no-handle',
        })
        say(`submit routed to the owner daemon: ${frozen.digest.slice(0, 16)}… awaiting the owner`)
        return {
          ok: false,
          reason: SETTLE_REQUIRES_OWNER_DAEMON,
          pending: {
            phase: 'awaiting-owner',
            nonce: frozen.nonce, digest: frozen.digest,
            operation, scope, ledgerId: typeof handle === 'string' ? handle : null,
            expiresAt: frozen.expiresAt,
            authority: null,
            ceiling: daemon.ceiling ?? [],
            reason: null,
          },
        }
      }
      const verdict = await draw.submit(event.sender, intent, words, { library, directory, handle })
      if (!fromApplication(event)) return { ok: false, reason: DRAW_REFUSE.FORBIDDEN_SENDER }
      if (verdict?.ok === true) {
        recordInstallSettings(library, directory)
        // Launch initially found no key. Serve it now, before the face refreshes its state.
        // Startup failure cannot undo the completed binding or invite another bind.
        try { await deps.onBound?.({ library, directory }) }
        catch (error) { say(`bound, but signer startup failed: ${String(error?.message ?? error)}`) }
      }
      // THE VERDICT CARRIES `drawSpent` FROM THE DRAW ITSELF (aumlok-draw.mjs), decided when the slot was consumed.
      return verdict
    } catch (error) {
      say(`submit refused: ${String(error?.message ?? error)}`)
      // A NAME OF OURS, OR A NAME OF OURS. `error.code` is NOT safe to pass through on its own:
      // MEASURED, a plain `TypeError` in modern Node carries `ERR_INVALID_ARG_TYPE`, and putting that
      // on the screen where X1 requires a named refusal is the same class of defect as saying nothing.
      // Only an `aumlok:`-prefixed code is ours; anything else becomes the draw module's own name for a
      // ceremony that could not be performed.
      // **THREE NAMESPACES NOW, AND MISSING THE SECOND ONE FLATTENED A REAL REFUSAL.** MEASURED: with the
      // routing in place and the daemon unreachable, this catch reported `aumlok:ceremony-absent` — because
      // `aukora-owner:submit-unreachable` does not start with `aumlok:` and every name not ours was being
      // replaced. An operator would have read "no ceremony here" when the truth was "the owner daemon did
      // not answer", which is a different fact with a different remedy. The owner daemon's namespace and the
      // routing refusal pass through with their own names.
      const ours = typeof error?.code === 'string'
        && (error.code.startsWith('aumlok:')
          || error.code.startsWith('aukora-owner:')
          || error.code === SETTLE_REQUIRES_OWNER_DAEMON)
      const name = ours ? error.code : DRAW_REFUSE.CEREMONY_ABSENT
      return { ok: false, reason: name }
    }
  })

  ipcMain.handle(APPROVAL_CHANNELS.ASK, (event) => {
    if (!fromApproval(event)) return { ok: false, reason: APPROVAL_REFUSE.FORBIDDEN_SENDER }
    if (pendingQueue.length === 0) return { ok: false, reason: APPROVAL_REFUSE.CANCELLED }
    // THE PUBLIC FACTS, PLUS ONE DERIVED LINE. The identity, the digest and the window are the request's
    // own fields. `words`/`wordsDigest` are the SIGNER'S OWN derivation of the operation's bytes, handed
    // on so a person can read what they are approving — never a summary the requesting side chose, and
    // the page re-checks the digest before displaying the line. THE DIGEST IS STILL THE ONLY THING
    // SIGNED: none of this is inside the preimage and no verifier compares it.
    return Object.freeze({
      ok: true,
      // THE QUEUE, NEWEST FIRST, and each entry carries exactly the three things the view may show: the derived
      // line, its digest and the times. No raw text, no diff: the facts object never held one.
      queue: Object.freeze([...pendingQueue].reverse().map(entry => entry.facts)),
      // AND THE NEWEST FLAT, because a reader that knew only the single-question shape keeps working and reads the
      // question it would have seen before.
      ...pendingQueue[pendingQueue.length - 1].facts,
    })
  })

  ipcMain.handle(APPROVAL_CHANNELS.ANSWER, async (event, payload) => {
    if (!fromApproval(event)) return { ok: false, reason: APPROVAL_REFUSE.FORBIDDEN_SENDER }
    // ── AND THE ANSWER IS NOT AN AUTHORITY EITHER, WHEN A DAEMON IS PRESENT ──────────────────────────
    // A shell boolean was already not an approval; with an owner daemon installed it must not become one by
    // arriving on this channel instead. The person's answer here is NOT submitted as a proposal, because the
    // proposal was already frozen on the SUBMIT path — this refusal exists so that answering the sheet
    // cannot settle anything the daemon never saw. NO FALLBACK, and the same name as the SUBMIT refusal so a
    // screen reports one fact rather than two.
    //
    // **AND IT IS MEASURED, WHICH IT WAS NOT WHEN THIS REFUSAL WAS FIRST WRITTEN.** The gate is
    // `fromApproval`, which needs a live approval sheet — and the harness now OPENS THE REAL ONE through this
    // bridge's own `ask()`, with `deps.headless: true` (the seam that exists so a court can open the real
    // sheet without putting it on a person's screen). So the gate passes because there genuinely IS an
    // approval view and the event genuinely is from it, NOT because the check was stubbed.
    // `tests/aukora-aumlok-bridge-handlers.test.mjs` (e) holds both directions and (d) removes this very
    // block, so the refusal is a red arm rather than a claim.
    const daemonForAnswer = await ownerDaemonStatusOf()
    if (!fromApproval(event)) return { ok: false, reason: APPROVAL_REFUSE.FORBIDDEN_SENDER }
    // AND THE SAME REFUSAL ON THE ANSWER PATH, for the same reason: an unreachable daemon must not hand this
    // handler the authority to answer a question the owner was asked to settle.
    if (daemonForAnswer?.installed === true && daemonForAnswer?.reachable !== true) {
      say(`answer refused: an owner daemon is installed and did not answer — ${String(daemonForAnswer.reason)}`)
      return {
        ok: false, reason: OWNER_DAEMON_UNREACHABLE,
        pending: { phase: 'awaiting-owner', authority: null, ceiling: daemonForAnswer.ceiling ?? [],
          reason: 'this machine has an owner daemon and it could not be reached, so the shell will not '
            + 'answer in its place. NOTHING WAS ANSWERED. Restore the daemon and ask again.' },
      }
    }
    if (daemonForAnswer?.installed === true && daemonForAnswer?.reachable === true) {
      say('answer refused: an owner daemon settles this, not the shell')
      return {
        ok: false, reason: SETTLE_REQUIRES_OWNER_DAEMON,
        pending: { phase: 'awaiting-owner', authority: null, ceiling: daemonForAnswer.ceiling ?? [],
          reason: 'the owner daemon is the authority; answer it there (console or phone)' },
      }
    }
    const answering = payload?.challenge
    if (pendingQueue.length === 0) {
      return { ok: false, reason: `${APPROVAL_REFUSE.CANCELLED}: no question is pending` }
    }
    // THE CHALLENGE IS REQUIRED, NOT TRUSTED, AND NOW IT SELECTS RATHER THAN MERELY MATCHING. A window left open
    // from an earlier question would otherwise answer a later one; naming the challenge is how that is made
    // impossible rather than unlikely, and with a queue it is what keeps the answer bound to ONE named operation.
    // A challenge that names nothing is refused BY NAME and settles nothing — it is not allowed to fall through to
    // whichever question happens to be newest.
    if (!pendingQueue.some(entry => entry.challenge === answering)) {
      return { ok: false, reason: `${APPROVAL_REFUSE.BAD_MODE}: the answer names challenge `
        + `${String(answering)}, and no queued question is that one` }
    }
    // ONLY AN EXPLICIT `true` APPROVES. A truthy value, a missing field or a string is a NO, because
    // the failure this whole path exists to prevent is an approval nobody gave.
    // The page's own report (not proof) goes to the event log if well-formed; else unchecked/null.
    const facts = {}
    if (typeof payload?.wordsOk === 'boolean') facts.wordsOk = payload.wordsOk
    if (Number.isSafeInteger(payload?.dwellMs) && payload.dwellMs >= 0) facts.dwellMs = payload.dwellMs
    settleAsk(answering, { approve: payload?.approve === true, ...facts })
    // ONE ANSWER SETTLES ONE QUESTION; the next shows 1 s later, past a double-click.
    if (pendingQueue.length === 0) closeApproval()
    else setTimeout(() => approval?.webContents.isDestroyed() === false && approval.webContents.reload(), 1000)
    return { ok: true, approve: payload?.approve === true }
  })

  return {
    /**
     * Whether a one-bit approval window is open right now.
     *
     * Published for the eye (`apps/aukora-desktop/eye.mjs`), which photographs the app window and must
     * be shut while a question is on screen. It reports this bridge's OWN state rather than letting a
     * caller guess: the window is created and closed here, and nothing outside this module can tell
     * whether one exists.
     * @returns true while the approval window is open.
     */
    isApprovalOpen: () => approval !== null && !approval.webContents.isDestroyed(),
    /**
     * Whether a drawn phrase is in flight, as a BOOLEAN AND NEVER THE PHRASE.
     *
     * Published for the same reason `isApprovalOpen` is — a caller that must not photograph a screen
     * with words on it needs to be able to ask — and it is deliberately the only thing this bridge will
     * ever say about a pending draw.
     * @returns true while a drawn phrase is waiting to be typed back.
     */
    isDrawPending: () => draw.isPending(),
    /** Forget the pending phrase; used when the window that drew it goes away. */
    forgetDraw: () => draw.forget(),
    /**
     * Put ONE operation in front of a person and resolve with their answer.
     *
     * IT NEVER REJECTS AND NEVER APPROVES BY DEFAULT. Every way of not getting an answer — no window to
     * open, a question already on screen, the window closing unanswered — resolves
     * `{approve: false, unavailable}` or `{approve: false}`, and the caller decides which of those is
     * which. `unavailable` is reserved for "nobody could be asked": a person who saw the question and
     * said no is a different fact, and the signer keeps them apart on the wire.
     *
     * NO TIMER LIVES HERE. The wait is bounded by the SIGNER, which polls the request's own `expiresAt`
     * (`owner-signer.mjs`): a second bound in this module would be a second source of truth for when a
     * request ends, and the two would disagree in exactly the case that matters — a person answering as
     * the window closes. This resolves when the person answers or when the window goes away.
     * @param {Readonly<Record<string, unknown>>} request - the signer's request, which NAMES the operation.
     * @returns {Promise<{approve: boolean, unavailable?: boolean}>} the person's answer, or a refusal.
     */
    async ask(request) {
      // ADMITTED BEFORE ANYTHING IS OPENED. A request with no expiry, or one carrying its own summary
      // of the operation, is refused BY NAME HERE — and the refusal is upstream of
      // `openApprovalWindow()`, so there is no window to close and no question on a person's screen.
      const admitted = admitApprovalQuestion(request)
      if (admitted.ok !== true) {
        return Object.freeze({ approve: false, unavailable: true, reason: admitted.reason })
      }
      const { challenge } = admitted
      // ── ONE WINDOW, MANY QUESTIONS ────────────────────────────────────────────────────────────────────────────
      // A window already up is FOCUSED, not refused: the queue is what waits, and the person answers each entry on
      // the one surface. This is the second refusal the goal does not name — `openApprovalWindow()` returns
      // `WINDOW_OPEN` when one exists, and `ask` used to return that verbatim, so removing `ASK_BUSY` alone would
      // have left the queue permanently unable to grow past one. A window that genuinely cannot be opened is still
      // a refusal, reported by name.
      if (approval === null || approval.webContents.isDestroyed()) {
        const opened = openApprovalWindow()
        if (opened.ok !== true) {
          return Object.freeze({ approve: false, unavailable: true, reason: opened.reason })
        }
      } else {
        approval.webContents.focus()
      }
      return new Promise(resolve => {
        // NEWEST LAST IN THE ARRAY, NEWEST FIRST WHEREVER IT IS READ. The facts object is unchanged: the queue
        // carries the same fields the single case carried, so nothing downstream has to learn a new shape.
        pendingQueue.push(Object.freeze({
          challenge,
          facts: Object.freeze({
            challenge,
            subject: String(request.subject ?? ''),
            // THE TOUCH ID ICON, ONE OF THREE NAMES OR NOTHING. It is the shell's own reading of this Mac, never the
            // requester's, and it changes nothing about the question or the answer.
            presenceState: ['ready', 'confirmed', 'downgraded'].includes(request.presenceState?.state)
              ? request.presenceState.state : null,
            operationDigest: String(request.operationDigest ?? ''),
            issuedAt: request.issuedAt ?? null,
            expiresAt: admitted.expiresAt,
            // THE SIGNER'S OWN DERIVATION, AND NOTHING ELSE. `words`/`wordsDigest` come from the
            // operation's bytes (`aumlok-signer.mjs`), the page checks the digest before it shows the
            // line, and a caller-supplied description never reaches this object — `admitApprovalQuestion`
            // has already refused one.
            words: admitted.witness === null ? null : admitted.witness.words,
            wordsDigest: admitted.witness === null ? null : admitted.witness.wordsDigest,
            wordsTruncated: admitted.witness !== null && admitted.witness.wordsTruncated === true,
            wordsOmittedChars: admitted.witness === null ? 0 : admitted.witness.wordsOmittedChars,
            // THE CARD, COMPOSED HERE SO THE PAGE RENDERS A LIST AND DECIDES NOTHING.
            fields: approvalCardFields(
              admitted.witness === null ? {} : admitted.witness.fields,
              request.subject,
              admitted.expiresAt,
            ),
          }),
          settle: resolve,
        }))
        // THE WINDOW CAN GO AWAY WITHOUT ANSWERING. Closing it, or a crash, must release EVERY signer waiting on
        // it rather than leave them waiting for a person who is no longer there.
        if (approval !== null && !approval.webContents.isDestroyed()) {
          approval.webContents.once('destroyed', () => settleAllAsks({ approve: false }))
        }
      })
    },
    dispose() {
      settleAsk({ approve: false, unavailable: true })
      closeApproval()
      // THE PHRASE DIES WITH THE BRIDGE, and it is the first thing dropped: a disposed bridge that
      // still held a drawn phrase would be memory nobody owns and nothing can clear.
      draw.forget()
      for (const channel of Object.values(APPROVAL_CHANNELS)) {
        ipcMain.removeHandler(channel)
        ipcMain.removeAllListeners(channel)
      }
    },
    close: closeApproval,
  }
}
