// AUKORA desktop shell.
//
// The shell is a door onto the organism, never a second authority. It holds no
// keys, stores nothing of its own, and adds no capability the harness does not
// already serve: it starts one harness process against a state root it owns,
// reads that process's authenticated URL out of its own private log, and shows it.
import { app, BrowserWindow, WebContentsView, shell, session, dialog, ipcMain, nativeTheme } from 'electron'
import { join, dirname, isAbsolute, resolve as resolvePath } from 'node:path'
import { fileURLToPath } from 'node:url'
import { writeFile } from 'node:fs/promises'
import { readFileSync, writeFileSync } from 'node:fs'
import { startHarness, spawnedPid, stopSpawned, startRestartWatchdog } from './supervisor.mjs'
import { resolveTarget } from './resolve.mjs'
import { externalSchemeAllowed, loopbackOnly, permissionAllowed } from './url-policy.mjs'
import { backendStatus, frontendFromBundleUrl, redactTokens, safeOrigin, pruneOwnedAuthCookies, INTERFACE_STATE_SCRIPT } from './backend-status.mjs'
import { installApprovalBridge, loadOrganLibrary, resolveAumlokDirectory, signingSessionSource } from './aumlok-bridge.mjs'
import { defaultAumlokDirectory } from './install-settings.mjs'
import { installEyeDoor } from './eye.mjs'
import { installLaneDoor } from './lane-door.mjs'
// THE CARD SURFACE'S SHELL HALF. The decisions live in `lane-card-window.mjs` (pure, courtable); this
// file only wires them to Electron, the way it does for the approval bridge.
import { installLaneCardBridge, laneCardWindowOptions, presentCardWindow }
  from './lane-card-window.mjs'
import { cardViewModel } from './lane-card-view.mjs'
import { validatePress } from './lane-dispatch.mjs'
import { SIGNER_SOCKET_ENV, resolveSignerSocketPath, startShellSigner } from './aumlok-signer.mjs'
import { installDesktopLog } from './desktop-log.mjs'

const here = dirname(fileURLToPath(import.meta.url))
const BACKGROUND = '#0B0E14'

/**
 * How long an aborted main-frame load may go unreplaced before it is a failure.
 *
 * The one legitimate abort in this shell is the bootstrap superseding the origin load,
 * and that replacement is issued on the next tick and completes against a local backend.
 * Seconds of grace is generous for that and still short enough that a person does not
 * sit in front of an empty window wondering.
 */
const ABORT_GRACE_MS = 8_000

// userData must be set BEFORE requestSingleInstanceLock: the lock is keyed to it.
const supportRoot = process.env.AUKORA_DESKTOP_USERDATA ?? process.env.AUKORA_SUPPORT_ROOT
  ?? join(app.getPath('appData'), 'AUKORA')
if (supportRoot.trim() === '') throw new Error('support-root-empty: refusing an empty support root')
if (!isAbsolute(supportRoot)) throw new Error('support-root-relative: name an absolute support root')
app.setPath('userData', resolvePath(supportRoot))
if (process.platform === 'darwin' && !app.requestSingleInstanceLock()) app.exit(0)

const env = process.env
// The shell's own state root. `resolveTarget` may name another one, which changes
// where an OWNED backend writes — it is not a way to attach to a running one.
const ownStateRoot = join(app.getPath('userData'), 'state')
// FIRST, SO EVERY LINE AND ERROR AFTER THIS ONE LANDS IN <state>/logs/desktop.log (stdout is /dev/null when installed).
installDesktopLog({ app, stateRoot: ownStateRoot })
const port = env.AUKORA_DESKTOP_PORT ? Number(env.AUKORA_DESKTOP_PORT) : undefined

let win = null
let ownedPid = null
// alpha-18 item 2: the graceful-restart watchdog. ON by default, with a kill switch for the cutover (`AUKORA_WATCHDOG=0`)
// so a rollback does not require a rebuild.
let restartWatchdog = null
const WATCHDOG_ENABLED = process.env.AUKORA_WATCHDOG !== '0'
let releaseClaim = null
/** The resolved attach target, when this window attached rather than started one. */
let attach = null
/**
 * The composition this window is actually running: the release the backend was started from and the
 * patch overlays it was given. The approval bridge loads the organ's library out of `releaseDir` — the
 * same bytes the running app is executing — and reads the directory those overlays declare,
 * so "the same organ" and "the directory the app reads" are both measured rather than assumed.
 */
let composition = { releaseDir: null, patchPaths: [], stateRoot: null }

function createWindow(ses, status) {
  const window = new BrowserWindow({
    width: 1560, height: 960, minWidth: 480, minHeight: 420,
    backgroundColor: BACKGROUND, title: status.title,
    icon: join(here, 'icons', 'icon.png'),
    autoHideMenuBar: true, show: false,
    webPreferences: {
      session: ses,
      sandbox: true, contextIsolation: true, nodeIntegration: false,
      // THE PRELOAD IS THE PAGE'S ONLY VERB. It exposes `window.aukoraAumlok` with ONE read and
      // no phrase-bearing channel at all; `installApprovalBridge` checks the sender on every
      // handler, so the page cannot reach the approval window's own channels even by naming
      // them. See `aumlok-bridge-preload.cjs`.
      webSecurity: true, webviewTag: false, preload: join(here, 'aumlok-bridge-preload.cjs'),
    },
  })
  // THE TITLE IS THE SHELL'S, AND THIS IS WHY. The page is the backend's own client
  // and would otherwise name the window whatever it likes — including, on a page this
  // shell did not start, whatever somebody else likes. Preventing the update leaves the
  // one line of chrome this shell owns free to carry the facts a person needs before
  // they click the red button: which backend, which release, and whether quitting
  // stops it. `backendStatus` builds that line from an origin, never from the token.
  window.on('page-title-updated', e => e.preventDefault())
  window.setTitle(status.title)
  window.webContents.setWindowOpenHandler(({ url }) => {
    // Parse, never prefix-match: `http://127.0.0.1:1@evil.example/` starts with the
    // loopback prefix and resolves to evil.example, which a prefix test would have
    // opened inside this window. loopbackOnly is the same check used on the page URL.
    try {
      loopbackOnly(url)
      return { action: 'allow' }
    } catch { /* not ours to render; fall through to the external decision */ }
    if (externalSchemeAllowed(url)) shell.openExternal(url).catch(() => {})
    return { action: 'deny' }
  })
  let navigation = 0
  window.webContents.on('did-start-navigation', (_e, _url, inPlace, mainFrame) => {
    if (mainFrame && !inPlace) navigation++
  })
  async function observeInterface() {
    const generation = navigation
    const origin = safeOrigin(window.webContents.getURL())
    for (let attempt = 0; attempt < 60; attempt++) {
      if (window.isDestroyed() || navigation !== generation) return
      const state = await window.webContents.executeJavaScript(INTERFACE_STATE_SCRIPT).catch(() => 'loading')
      if (window.isDestroyed() || navigation !== generation) return
      if (state === 'ready') { console.log(`aukora-desktop: interface ready ${origin}`); return }
      if (state === 'failed') { console.error(`aukora-desktop: interface failed ${origin}`); return }
      await new Promise(resolve => setTimeout(resolve, 1000))
    }
    console.error(`aukora-desktop: interface timed out ${origin}`)
  }
  // Load outcomes are printed so a headless run can be measured rather than assumed.
  window.webContents.on('did-finish-load', async () => {
    console.log(`aukora-desktop: window loaded ${new URL(window.webContents.getURL()).origin}`)
    void observeInterface().catch(() => console.error('aukora-desktop: interface observation failed'))
    const capture = process.env.AUKORA_DESKTOP_CAPTURE
    if (capture) {
      const settle = Number(process.env.AUKORA_DESKTOP_CAPTURE_DELAY_MS ?? 0)
      if (settle > 0) await new Promise(r => setTimeout(r, settle))
      const image = await window.webContents.capturePage()
      await writeFile(capture, image.toPNG())
      console.log(`aukora-desktop: captured ${capture}`)
    }
  })
  window.webContents.on('did-fail-load', (_e, code, description, validatedUrl, isMainFrame) => {
    // Logged with an origin, never the URL: a failing navigation's URL still carries
    // whatever token it was given.
    console.error(`aukora-desktop: load failed ${code} ${description} ${
      isMainFrame ? 'main-frame' : 'subresource'} ${safeOrigin(validatedUrl)}`)
  })
  window.once('ready-to-show', () => window.show())
  window.on('closed', () => { win = null })
  return window
}

/**
 * Rewrite config so only the origin survives a successful bootstrap.
 *
 * A SPENT TOKEN IS NOT A CONNECTION. Leaving it in config.json keeps a dead credential on
 * disk and teaches the next launch to present it again; the cookie the backend just
 * minted is what actually carries this attachment. Only a config-named target is
 * rewritten — an environment variable belongs to whoever set it.
 * @param {{configPath: string, origin: string, fromEnvironment: boolean}} target - the attach target.
 */
function forgetBootstrapToken(target) {
  if (target.fromEnvironment) return
  try {
    // SYNCHRONOUS, AND THAT IS THE POINT. An awaited write races the quit: a window
    // closed promptly after its first successful load left the spent token on disk, and
    // the NEXT launch would then present a dead credential, be refused, and look like a
    // broken attachment. One small file, once, on the main process — the race is not
    // worth the microseconds.
    const config = JSON.parse(readFileSync(target.configPath, 'utf8'))
    if (config.attachUrl === undefined || config.attachUrl === target.origin) return
    config.attachUrl = target.origin
    writeFileSync(target.configPath, JSON.stringify(config, null, 2) + '\n', { mode: 0o600 })
    console.log(`aukora-desktop: token spent; ${target.configPath} now names only ${target.origin}`)
  } catch (err) {
    // Not fatal: the window is connected either way. It is reported because a config
    // that still holds a dead token will produce a confusing refusal next time.
    console.error(`aukora-desktop: could not rewrite the attach target: ${String(err?.message ?? err)}`)
  }
}

function fail(message) {
  // Printed BEFORE the dialog, and deliberately. showErrorBox is modal: it blocks the
  // main process until somebody clicks it, so a refusal that only lived in that box
  // would be invisible to a log, a test, or anyone who started this from a terminal.
  console.error(`aukora-desktop: ${message}`)
  // A HEADLESS RUN GETS NO MODAL. A test that drives this window against a throwaway
  // backend must be able to provoke a refusal without a dialog appearing on the
  // person's screen and blocking there until somebody clicks it — which is exactly
  // what happened, repeatedly, on a desktop that was in use. The log line above is
  // the whole refusal in that mode; the box exists for a person who double-clicked.
  if (!process.env.AUKORA_DESKTOP_NO_DIALOG) dialog.showErrorBox('AUKORA could not start', message)
  app.exit(1)
}

app.whenReady().then(async () => {
  if (process.platform === 'darwin') app.dock?.setIcon(join(here, 'icons', 'icon.png'))
  // `persist:` IS LOAD-BEARING, NOT DECORATION. A partition name without that prefix is
  // an IN-MEMORY session: the cookie the backend mints is gone the moment this process
  // exits, so a window that attached yesterday would arrive today with no credential and
  // no token — the token having been spent and, correctly, forgotten. The whole
  // reconnect story depends on the cookie outliving the window, and that is what this
  // prefix buys. It also means the cookie lands on disk under userData, which is why the
  // tests isolate with AUKORA_DESKTOP_USERDATA.
  const ses = session.fromPartition('persist:aukora-main', { cache: true })

  let url
  let status
  // THE EYE, AND WHY IT IS OPENED BEFORE THE BACKEND. The backend child learns the door's address
  // and token from its ENVIRONMENT — never a command line, never a file — so the door has to exist
  // before that child is spawned. It photographs the window `getWindow` names, and the window is
  // created further down, so a look arriving in between is refused by name (`eye.no-window`)
  // rather than answered with nothing. Attach mode opens no door: the window did not start that
  // backend and has no child to hand a token to.
  let eye = null
  /** The lane door, in OWNED mode only: this shell started the app, so it may open a way into it. */
  let laneDoor = null
  let aumlokBridge = null
  // The approval socket, resolved ONCE below and read by two sides: the backend child's environment
  // and this shell's own signer. Null only when there is no state root to put a socket in.
  let signerSocket = null
  try {
    // One resolution for both modes. An attach target short-circuits inside
    // resolveTarget, so nothing below the attach branch here can start a backend.
    const target = await resolveTarget({
      env,
      userData: app.getPath('userData'),
      checkoutsDir: join(app.getPath('userData'), 'checkouts'),
    })
    console.log(`aukora-desktop: ${target.why.join('; ')}`)

    if (target.mode === 'attach') {
      // NOTHING IS STARTED HERE, AND NOTHING WILL BE. `ownedPid` stays null, so the
      // will-quit handler below has nothing to signal and the backend outlives this
      // window — which is the whole point of attaching to somebody else's deployment.
      url = target.url
      attach = target
      status = backendStatus({ mode: 'attach', url })
    } else {
      // ── ONE RESOLUTION OF THE APPROVAL SOCKET, BEFORE EITHER SIDE IS STARTED ───────────────────
      // The backend child learns this from its ENVIRONMENT, so it has to be decided BEFORE that child
      // is spawned, and the shell's own signer binds exactly this string further down. One value, two
      // readers: the two sides can no longer agree only because an operator typed the same path twice.
      const backendStateRoot = resolvePath(target.stateRoot ?? ownStateRoot)
      signerSocket = resolveSignerSocketPath({ env, stateRoot: backendStateRoot })
      eye = await installEyeDoor({
        getWindow: () => win,
        // A FUNCTION, NOT A VALUE. The door calls this on every request, so passing the boolean
        // `isApprovalOpen()` would hand it a value to invoke: a request arriving while nothing is open
        // would have thrown instead of being answered.
        isApprovalOpen: () => aumlokBridge?.isApprovalOpen?.() === true,
        // E1: the bind surface is refused for the same reason, and the door learns about it the same
        // way — a getter, never a value, so a request arriving while nothing is showing cannot make
        // this door hold a handle on the ceremony.
        //
        // THE NAME IS THE BRIDGE'S OWN, AND IT WAS NOT. This read `isCeremonyOpen`, which
        // `aumlok-bridge.mjs` does not publish: the bridge publishes `isDrawPending` (`:947`) and
        // `isApprovalOpen` (`:938`). The optional call on a missing method returned undefined, so the
        // fence never fired once — anything holding the eye token during a phrase draw could have read
        // the seven words off the bind surface through `/eye/snapshot`. `tests/aukora-eye-sight.test.mjs`
        // now reads the bridge's published getter names and fails if this file asks for one the bridge
        // does not have.
        isDrawPending: () => aumlokBridge?.isDrawPending?.() === true,
        // The token's second home, under this shell's own state root: the live check reads it as its
        // owner, which is how a lane can authenticate at all. The backend child still gets the token in
        // its environment; the door's fences are unchanged.
        tokenFile: ownStateRoot === null ? undefined : join(ownStateRoot, 'eye', 'door.token'),
        log: line => console.log(`aukora-desktop: ${line}`),
      })
      const started = await startHarness({
        checkout: resolvePath(target.checkout),
        // THE SOCKET PATH RIDES WITH THE EYE DOOR'S, because `supervisor.mjs` already forwards this
        // object into the launcher's environment and a second channel would be a second thing to keep.
        eyeEnv: signerSocket === null
          ? eye.env
          : { ...eye.env, [SIGNER_SOCKET_ENV]: signerSocket.socketPath },
        release: resolvePath(target.release),
        stateRoot: backendStateRoot,
        port,
        patch: target.patch.map(p => resolvePath(p)),
        approvedRecordSha: target.approvedRecordSha,
        allowUnapproved: target.allowUnapproved,
        nodePath: target.nodePath,
        // The launcher's own stdout, redacted at the boundary: it prints the whole
        // authenticated URL, and forwarding that verbatim would put the launch token
        // in this shell's log.
        onDiagnostic: line => { if (line) console.log(`aukora-desktop: ${redactTokens(line)}`) },
      })
      url = loopbackOnly(started.url)
      // ── THE LANE DOOR, AFTER THE HARNESS AND ONLY IN OWNED MODE ────────────────────────────────
      // AFTER, because it mints its cookie from the authenticated launch URL this shell just read, and
      // because a door installed earlier would put its token in scope while `startHarness` is building
      // the child's environment — the one place this token must never appear. OWNED ONLY: in attach mode
      // there is no door at all, since this shell did not start that app and has no business opening a
      // second way into it.
      try {
        laneDoor = await installLaneDoor({
          stateRoot: ownStateRoot,
          backendUrl: started.url,
          isApprovalOpen: () => aumlokBridge?.isApprovalOpen?.() === true,
          isDrawPending: () => aumlokBridge?.isDrawPending?.() === true,
          log: line => console.log(`aukora-desktop: ${line}`),
        })
        console.log(`aukora-desktop: lane door on 127.0.0.1:${laneDoor.port} (token in ${laneDoor.tokenFile})`)
        // ── THE CARD SURFACE, WIRED TO THE DOOR ──────────────────────────────────────────────
        // A CORE-CLASS CARD OPENS IT. The door only issues a card to a sender whose class requires one,
        // so a pending card IS the signal — no second class test here, which would be a second place to
        // get the class rule wrong. Every getter reads the door LIVE: the card can arrive or expire
        // between the window opening and the press.
        let cardWindow = null
        installLaneCardBridge({
          ipcMain,
          validatePress,
          getPending: () => laneDoor?.pendingCard() ?? null,
          getView: () => {
            const held = laneDoor?.pendingView() ?? null
            // THE VIEW IS BUILT FROM THE CARD AND THE TEXT THE REGISTER KEPT, and `cardViewModel`
            // REFUSES when the text does not reproduce the card's digest — so a page can never be shown
            // a string the card does not bind.
            if (held === null) return null
            try { return cardViewModel(held.card, held.text) } catch (error) {
              console.log(`aukora-desktop: card view refused (${error?.message ?? error})`)
              return null
            }
          },
          // A SEND GOES THROUGH THE DOOR'S OWN ROUTE, WITH THE NONCE — the page never supplies text, and
          // the door re-reads it from the register. `sender: 'core'` is what requires the card.
          confirm: async ({ nonce }) => {
            const held = laneDoor?.pendingView() ?? null
            if (held === null || held.card.nonce !== nonce) {
              return { ok: false, reason: 'that card is no longer pending' }
            }
            const answer = await fetch(`${laneDoor.url}`, {
              method: 'POST',
              headers: { 'content-type': 'application/json', 'x-lane-token': laneDoor.token },
              body: JSON.stringify({ lane: held.card.lane, session: held.card.session ?? 'shell',
                text: held.text, sender: 'core', card: held.card }),
            })
            return { ok: answer.ok, reason: answer.ok ? null : `the door refused with ${answer.status}` }
          },
          // A DECLINE SENDS NOTHING. It spends the card so it cannot be confirmed afterwards, and records
          // the fact — "Peter was asked and said no" is different from "nothing was pending".
          decline: async ({ nonce }) => {
            const held = laneDoor?.pendingView() ?? null
            laneDoor?.spendCard?.(nonce)
            console.log(`aukora-desktop: card declined (${String(nonce).slice(0, 8)}…)`)
            return { kind: 'card-declined', nonce, lane: held?.card?.lane ?? null }
          },
          openSurface: view => {
            if (view === null) return
            if (cardWindow !== null && !cardWindow.isDestroyed?.()) return
            cardWindow = new BrowserWindow(laneCardWindowOptions(join(here, 'lane-card-preload.cjs')))
            cardWindow.on('closed', () => { cardWindow = null })
            cardWindow.loadFile(join(here, 'lane-card.html'))
            cardWindow.once('ready-to-show', () => {
              // IN FRONT, WITHOUT THE KEYBOARD. `presentCardWindow` uses showInactive and never focus().
              presentCardWindow(cardWindow)
            })
          },
        })
      } catch (error) {
        // A SHELL WITH NO LANE DOOR STILL STARTS. Lanes lose a channel; the person keeps their app.
        laneDoor = null
        console.log(`aukora-desktop: lane door not installed (${error?.message ?? error})`)
      }
      composition = {
        releaseDir: resolvePath(target.release),
        patchPaths: target.patch.map(p => resolvePath(p)),
        stateRoot: resolvePath(target.stateRoot ?? ownStateRoot),
      }
      ownedPid = await spawnedPid(started.stateRoot).catch(() => null)
      releaseClaim = started.releaseClaim ?? null
      status = backendStatus({
        mode: 'own', url, release: target.release, commit: target.releaseCommit,
      })
    }
    if (status.owned) console.log(`aukora-desktop: removed ${await pruneOwnedAuthCookies(ses.cookies, url)} stale login cookies`)
    console.log(`aukora-desktop: backend ${status.text}`)
    // ── THE GRACEFUL-RESTART WATCHDOG, ARMED WHERE A BACKEND EXISTS ──────────────────────────────────────────────
    // THE TWO SOURCES OF TRUTH. The footprint reader is the module default: `footprint(1)`'s `phys_footprint`, the
    // number the crash itself reports, never `ps` rss. The approval predicate is wired FAIL-CLOSED: `aumlokBridge` is
    // assigned LATER in this block, and a closure returning `false` while it is still undefined would answer "no
    // approval is open" from an approval surface that does not exist yet. It returns `undefined` instead, which the
    // watchdog treats as unknown and refuses to act on.
    // WHY `start` RELAUNCHES THE SHELL rather than only the backend: the lane door mints its cookie from the launch
    // URL, so a backend-only restart would leave the door unauthenticated. `app.relaunch()` rebuilds the backend, the
    // door, the bridge, the signer and the cookie together. The cost is that the window closes and reopens — visible,
    // which is why the threshold is high and the restart only happens in a quiet moment.
    if (WATCHDOG_ENABLED && restartWatchdog === null) {
      restartWatchdog = startRestartWatchdog({
        pidOf: async () => ownedPid,
        approvalOpen: () => (aumlokBridge === null || aumlokBridge === undefined
          ? undefined
          : typeof aumlokBridge.isDrawPending === 'function' ? aumlokBridge.isDrawPending() === true : undefined),
        stop: async (pid) => { stopSpawned(pid) },
        start: async () => { app.relaunch(); app.exit(0) },
        log: line => console.log(`aukora-desktop: ${line}`),
      })
      console.log('aukora-desktop: restart watchdog ARMED — footprint(1), never mid-approval, quiet moments only')
    }
    // The same facts where macOS puts an application's identity. No token: the panel
    // is built from the status line, which is built from an origin.
    app.setAboutPanelOptions?.({ applicationName: 'AUKORA', applicationVersion: status.text })
  } catch (err) {
    fail(String(err.message ?? err))
    return
  }

  // Electron requests carry mediaTypes; permission checks carry singular mediaType.
  // Both paths use the same camera/microphone policy and exact app origin.
  const mediaTypesOf = details => details?.mediaTypes !== undefined
    ? details.mediaTypes
    : details?.mediaType !== undefined ? [details.mediaType] : undefined
  ses.setPermissionRequestHandler((wc, permission, cb, details) => {
    cb(permissionAllowed(permission, details?.securityOrigin ?? details?.requestingUrl
      ?? (details?.isMainFrame ? wc?.getURL() : undefined), url, mediaTypesOf(details)))
  })
  ses.setPermissionCheckHandler((_wc, permission, requestingOrigin, details) => (
    permissionAllowed(permission, details?.securityOrigin ?? details?.requestingUrl ?? requestingOrigin, url, mediaTypesOf(details))
  ))

  win = createWindow(ses, status)
  // THE BINDING BRIDGE, INSTALLED ONCE AND OWNED BY THIS WINDOW. An attached session has no
  // release of its own, so `composition.releaseDir` stays null there and the bridge refuses by
  // name rather than loading a library out of a checkout that is not the one being served.
  // DECLARED BEFORE THE BRIDGE, because the bridge is told how to find it. The signer itself starts
  // further down (it is awaited), so the bridge is given a SOURCE rather than a session: a value read
  // now would be null for the lifetime of the window, which is the same defect as not passing one.
  let shellSigner = null
  let signerStart = Promise.resolve()
  const aumlok = aumlokBridge = installApprovalBridge({
    BrowserWindow, WebContentsView, ipcMain, session, app, here,
    // LIGHT OR DARK FOR THE APPROVAL WINDOW COMES FROM THE SHELL, WHICH IS THE ONLY THING THAT KNOWS IT.
    // The window is a sandboxed renderer with no verb that reaches the theme, and a window that guessed
    // from `matchMedia` would be a second answer to a question this process has already answered. The
    // bridge reads `shouldUseDarkColors` at the moment it opens a window, so a theme change reaches the
    // next approval without a relaunch.
    nativeTheme,
    getWindow: () => win,
    // An attached loopback page has no verified authority to use privileged shell IPC.
    applicationOrigin: status.owned ? status.origin : null,
    getReleaseDir: () => composition.releaseDir ?? '',
    getPatchPaths: () => composition.patchPaths,
    // THE FIRST LINK'S TWO DESTINATIONS: the key folder defaults to `<state root>/aumlok` when no patch names
    // one, and the per-install settings file goes into the support root beside config.json.
    getStateRoot: () => composition.stateRoot,
    getSupportRoot: () => app.getPath('userData'),
    // THE SIGNING SESSION IS READ THROUGH A SOURCE RATHER THAN A VALUE. The signer starts below, so a
    // session captured here would be null for the lifetime of the window and every screen would be
    // told there is no signer.
    getSigningSession: signingSessionSource(() => shellSigner),
    onBound: () => ensureShellSigner(),
    log: line => console.log(`aukora-desktop: ${line}`),
  })
  app.on('will-quit', () => {
    aumlok.dispose()
    if (eye !== null) void eye.dispose()
    // THE LANE DOOR'S TOKEN IS REMOVED ON THE WAY OUT, so a token file that outlives this process is a
    // dead file at a known path rather than a live one.
    if (laneDoor !== null) void laneDoor.dispose()
  })

  // ── THE SHELL'S SIGNER, STARTED AT LAUNCH AND STARTED LOCKED ──────────────────────────────
  // THE PATH IS THE ONE `signerSocket` ABOVE ALREADY PUT IN THE BACKEND CHILD'S ENVIRONMENT: same
  // string, resolved once, so the two sides cannot disagree. A shell that cannot start this signer
  // still starts: the window stays up and the reason is printed by name.
  function ensureShellSigner() {
    // Serialize launch with first bind: they may overlap, but must never own two sockets.
    signerStart = signerStart.then(async () => {
      if (shellSigner?.serving === true) return shellSigner
      try {
        const binding = resolveAumlokDirectory(composition.patchPaths)
          ?? (composition.stateRoot === null ? null : { directory: defaultAumlokDirectory(composition.stateRoot) })
        if (signerSocket === null) {
          console.log('aukora-desktop: aumlok signer: no state root for an approval socket')
          return
        }
        const lib = composition.releaseDir === null ? null : await loadOrganLibrary(composition.releaseDir)
        // OPTIONAL TOUCH ID AFTER APPROVE, loaded lazily: if it cannot load, approvals run exactly as before.
        let presence
        try {
          presence = (await import('./aumlok-presence.mjs')).createDesktopPresence(app.getPath('userData'))
        } catch (error) {
          console.warn(`aukora-desktop: Touch ID presence off: ${String(error?.message ?? error)}`)
        }
        shellSigner = await startShellSigner({
          presence,
          library: lib,
          directory: binding === null ? null : binding.directory,
          socketPath: signerSocket.socketPath,
          // Every operation still needs its own answer in the approval card.
          ask: request => aumlok.ask(request),
          log: line => console.log(`aukora-desktop: ${line}`),
        })
        return shellSigner
      } catch (error) {
        console.error(`aukora-desktop: aumlok signer failed to start: ${String(error?.message ?? error)}`)
      }
    })
    return signerStart
  }
  void ensureShellSigner()
  app.on('will-quit', () => { if (shellSigner?.stop) void shellSigner.stop().catch(() => {}) })
  // The interface is not known until the page asks for its plugin bundle. When it does,
  // the title says which one arrived — the difference between "attached to the spatial
  // preview" and "attached to an older deployment that has no spatial frame at all".
  const statusInputs = { mode: status.owned ? 'own' : 'attach', url }
  if (status.owned) Object.assign(statusInputs, { release: status.releasePath, commit: status.commitHash })
  // A PAGE MAY ASK FOR MORE THAN ONE BUNDLE. The first one the harness's client loads
  // need not be the one carrying the spatial frame, so a bundle WITHOUT it proves
  // nothing on its own — concluding "stock" from it produced a title that said NOT the
  // spatial frontend for a moment and then corrected itself, which is a false alarm.
  // The spatial frame, once seen, is final; "stock" is only concluded when the page
  // has finished loading without it ever appearing.
  let frontendSeen
  const announce = (frontend) => {
    if (!win) return
    const known = backendStatus({ ...statusInputs, frontend })
    win.setTitle(known.title)
    console.log(`aukora-desktop: backend ${known.text}`)
  }
  ses.webRequest.onCompleted({ urls: ['http://127.0.0.1/*', 'http://127.0.0.1:*/*'] }, (details) => {
    if (frontendSeen === 'spatial') return
    if (frontendFromBundleUrl(details.url) === 'spatial') {
      frontendSeen = 'spatial'
      announce('spatial')
    }
  })
  win.webContents.on('did-finish-load', () => {
    if (frontendSeen === undefined) {
      frontendSeen = 'stock'
      announce('stock')
    }
  })
  // A BACKEND THAT WILL NOT LOAD IS A REFUSAL, NOT A PROMPT TO IMPROVISE. In attach
  // mode especially: the operator named a deployment, and the only honest outcomes are
  // showing it or saying plainly that it could not be shown. Starting a backend of our
  // own here would be a different application than the one that was asked for.
  // ELECTRON'S OWN ERROR STRINGS CARRY THE URL. A loadURL rejection reads
  // `ERR_FAILED (-2) loading 'http://127.0.0.1:1/?token=...'`, so a refusal built from
  // it prints the credential into the log and the dialog. Every detail that reaches a
  // refusal is redacted, whoever wrote it — and refusing twice is pointless noise, so
  // the first one wins.
  let refused = false
  let everLoaded = false
  let bootstrapSpent = false
  let abortWatch = null
  let tokenForgotten = false
  win.webContents.on('did-finish-load', () => {
    everLoaded = true
    if (abortWatch) { clearTimeout(abortWatch); abortWatch = null }
    // FORGET THE TOKEN ON A LOAD THAT ACTUALLY HAPPENED, not on loadURL resolving. The
    // bootstrap URL answers 303, and a redirect makes loadURL REJECT with ERR_ABORTED —
    // the first navigation really was aborted, by its own redirect — so keying the
    // rewrite to that promise meant a spent token was never forgotten. Being loaded is
    // the fact that matters, and it is the one this listens for.
    if (bootstrapSpent && !tokenForgotten && attach?.bootstrapUrl) {
      tokenForgotten = true
      forgetBootstrapToken(attach)
    }
    // FLUSH THE COOKIE WHILE WE KNOW WE HAVE ONE. Chromium writes its cookie store lazily,
    // and this window is frequently ended by a signal rather than a menu quit — a test
    // harness, a crash, a reboot. The credential that carries the NEXT launch would then
    // be the one thing that did not survive, and the token that could have replaced it has
    // already been spent and forgotten. Flushing here costs a file write once per load and
    // makes the reconnect independent of how this process ends.
    ses.cookies.flushStore().catch(() => {
      // Not fatal: the store flushes on a clean quit anyway. Silent because a failure
      // here is only visible as the next launch needing a fresh token, which it reports.
    })
  })

  /**
   * An abort is only forgivable while something else is arriving.
   *
   * Suppressing every ERR_ABORTED was too wide: a main-frame load that aborts with
   * NOTHING replacing it leaves a blank window and no message, which is the worst of
   * both — the shell has not refused and the person has nothing to look at. So an abort
   * arms a watchdog instead of being dropped. A replacement that finishes loading
   * disarms it; silence past the grace period is a refusal that says exactly that.
   * @param {string} detail - the abort's own text.
   */
  const watchAbort = (detail) => {
    if (everLoaded || abortWatch !== null) return
    abortWatch = setTimeout(() => {
      abortWatch = null
      if (everLoaded) return
      refuseNow(`${detail} — and nothing replaced it. The window is showing no document.`)
    }, ABORT_GRACE_MS)
  }

  const refuseNow = (rawDetail) => {
    if (refused) return
    refused = true
    const detail = redactTokens(rawDetail)
    return fail(
    `${status.owned ? 'load-failed' : 'attach-failed'}: could not load ${status.origin}. ${detail}\n\n` +
    (status.owned
      ? 'This window started that backend; see the shell log for the failure code.'
      : 'This window attached to a backend it does not own. It was not started here and ' +
        'nothing has been started in its place. Check that the deployment is running and ' +
        'that the attach URL still carries a valid token.'))
  }

  /** Refuse, unless this is an abort that something else may still be replacing. */
  const refuse = (rawDetail) => {
    if (/ERR_ABORTED|\(-3\)/.test(String(rawDetail))) {
      watchAbort(redactTokens(rawDetail))
      return
    }
    refuseNow(rawDetail)
  }
  win.webContents.on('did-fail-load', (_e, code, description, _validatedUrl, isMainFrame) => {
    // -3 is ABORTED, which a normal in-page navigation produces; subresources are the
    // page's own business. Only a main-frame failure means the backend is not showing.
    if (!isMainFrame || code === -3) return
    refuse(`${description} (${code})`)
  })
  // A REFUSAL THAT ARRIVES AS A PAGE IS STILL A REFUSAL. Chromium counts an HTTP error
  // with a body as a completed navigation, so did-fail-load never sees it: a stale
  // attach token lands on the backend's own 401 and the window would sit there showing
  // somebody else's "unauthorized" as though it had attached. The launch token is
  // per-process — a backend restart invalidates a persisted attachUrl — so this is the
  // ordinary way a saved attach target goes bad, not an exotic one.
  // THE COOKIE IS TRIED FIRST, THE TOKEN ONCE, AND NEITHER IS GUESSED AT. The window
  // loads the bare origin, because a session that has attached before still holds the
  // cookie and that path is silent. Only a 401 on that load spends the bootstrap token,
  // and only once — a second 401 means the token is dead too, and that is a refusal.
  win.webContents.on('did-navigate', async (_e, _navigationUrl, httpResponseCode, httpStatusText) => {
    if (typeof httpResponseCode !== 'number' || httpResponseCode < 400) {
      // A NAVIGATION THAT COMMITTED IS A WINDOW WITH A DOCUMENT IN IT. Disarming only on
      // did-finish-load would refuse a page that committed and is still fetching its
      // assets past the grace period — a false alarm on a slow but working backend.
      if (abortWatch) { clearTimeout(abortWatch); abortWatch = null }
      everLoaded = true
      return
    }
    const unauthenticated = httpResponseCode === 401 || httpResponseCode === 403
    if (unauthenticated && attach?.bootstrapUrl && !bootstrapSpent) {
      bootstrapSpent = true
      console.log('aukora-desktop: the saved cookie was not accepted; presenting the launch token (valid until the backend restarts)')
      // OUT OF THE HANDLER FIRST. Navigating from inside did-navigate cancels the
      // navigation that just fired it, and Electron reports that cancellation as
      // ERR_ABORTED on the new load — a failure message for a load that is proceeding.
      setTimeout(() => {
        win?.loadURL(attach.bootstrapUrl).catch((err) => {
          // A 303 aborts the request that produced it, so ERR_ABORTED here says nothing
          // about success; did-finish-load above is what reports that. Anything else is
          // a real failure of the one credential left.
          if (String(err?.message ?? err).includes('ERR_ABORTED')) return
          refuse(`the launch token was refused as well (${String(err?.message ?? err)})`)
        })
      }, 0)
      return
    }
    refuse(`the backend answered ${httpResponseCode} ${httpStatusText ?? ''}`.trim() +
      (unauthenticated
        ? '. A launch token is per-process and is spent on first use; the cookie it mints '
          + 'is keyed to host:port. Re-attach with the URL this backend printed most recently.'
        : '.'))
  })
  win.loadURL(url).catch(err => refuse(String(err?.message ?? err)))
})

app.on('second-instance', () => {
  if (!win) return
  if (win.isMinimized()) win.restore()
  win.focus()
})
app.on('window-all-closed', () => app.quit())
// Only ever the process this shell spawned; an attached app keeps running.
app.on('will-quit', () => {
  if (ownedPid) stopSpawned(ownedPid)
  // The claim goes back with the process that held it. A claim left behind is not fatal
  // — the next launch finds its pid dead and breaks it — but leaving one is how a
  // recoverable state becomes a confusing one.
  if (releaseClaim) { void releaseClaim().catch(() => {}) }
})
