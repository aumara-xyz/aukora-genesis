// Aukora Spatial — HER HOME SESSION, learned at mount, and the session every turn goes through.
//
// THE DEFECT THIS MODULE ENDS. The page learned `homeSession` only inside `loadOfferedMinds()`, which ran only
// when the gear opened — so on a fresh app start with no thread selected the home stayed '' and she refused with
// "no home session is configured", which was untrue. One failed fetch also set `mindsAsked` and lost the home
// for the life of the page, and adoption sat AFTER the empty-roster early return.
//
// THE RULES, each a line a court deletes:
//   1. The home is asked for at MOUNT, by `start()`, independent of the gear and of the roster.
//   2. A failed ask RETRIES with bounded backoff (`HOME_RETRY_DELAYS_MS`), then stops; it never gives up silently
//      on the first failure.
//   3. ADOPTION reads `homeSession` whether or not the roster is empty.
//   4. A turn spoken before the home arrives WAITS for it (`waitForHome`), bounded by `HOME_WAIT_MS`.
//   5. The transcript key is a pure function of the session the turn went through (`transcriptLogKey`).
//   6. The fallback sentence is said only when it is TRUE (`fallbackSentence`): the turn named a thread, the host
//      reports it fell back from that thread, and the answer came through another session. An ordinary turn, a
//      fresh start and a turn through a live selected thread never hear it, whatever a header says.
//
// DOM-free on purpose: `tests/laya-auma-live-home-session.test.mjs` imports this file directly, and runs the real
// page against it.

import { CHAT_LOG_PREFIX, UNSELECTED } from '/app/chat-log-key.js';

/** The host route that carries the roster AND the configured home. */
export const MINDS_ENDPOINT = '/api/auma-live/minds';
/** Backoff between asks after a failure. Bounded: after the last delay, the page stops asking on its own. */
export const HOME_RETRY_DELAYS_MS = Object.freeze([500, 1000, 2000, 4000, 8000, 16000]);
/** How long a turn spoken before the home arrives waits for it. */
export const HOME_WAIT_MS = 5000;

/** Response headers the presence route sets, so the page knows where the turn actually went. */
export const SESSION_HEADER = 'x-auma-live-session';
export const FALLBACK_HEADER = 'x-auma-live-fallback';
export const REFUSAL_HEADER = 'x-auma-live-refusal';

/** The canvas surface keeps its own transcript beside the live one. */
export const CANVAS_LOG_PREFIX = 'aukora-auma-canvas-log-v2:';

/** One short, true sentence for a selected thread that was not open, so the turn went through her home. */
export const FALLBACK_SENTENCE = "That thread isn't open, so I answered through my home session.";

const MAX_SESSION_ID = 256;

function cleanId(value) {
  const id = typeof value === 'string' ? value.trim() : '';
  return id.length > 0 && id.length <= MAX_SESSION_ID ? id : '';
}

/**
 * The session a turn goes through: the live selection if there is one, otherwise her home.
 * @param {string} selected - Aukora's current selection ('' when none)
 * @param {string} home - her configured home ('' when not yet learned or not configured)
 * @returns {string}
 */
export function turnSessionId(selected, home) {
  return cleanId(selected) || cleanId(home);
}

/**
 * The transcript key for the session a turn went through. Pure: the same session is always the same key, and
 * the live key is exactly `chatLogKey(session)`, which is what `lane-bridge.js` reads.
 * @param {boolean} canvasMode
 * @param {string} sessionId
 * @returns {string}
 */
export function transcriptLogKey(canvasMode, sessionId) {
  const id = cleanId(sessionId);
  return `${canvasMode ? CANVAS_LOG_PREFIX : CHAT_LOG_PREFIX}${encodeURIComponent(id === '' ? UNSELECTED : id)}`;
}

/** Read one URI-encoded header value; '' when absent or malformed. */
export function headerSessionId(headers, name) {
  const raw = headers && typeof headers.get === 'function' ? headers.get(name) : null;
  if (typeof raw !== 'string' || raw.length === 0) return '';
  try { return cleanId(decodeURIComponent(raw)); } catch { return ''; }
}

/**
 * The fallback sentence, or '' when it would not be true. It is true only when the turn NAMED a thread, the host
 * reports it fell back from THAT thread, and the answer came through a different session. A fresh start named no
 * thread; a live selected thread answered through itself; neither is "that thread isn't open".
 * @param {string} named - the session the turn named ('' when it named none)
 * @param {string} wentThrough - the session the host says the turn went through
 * @param {string} reportedFrom - the host's `x-auma-live-fallback` value ('' when absent)
 * @returns {string}
 */
export function fallbackSentence(named, wentThrough, reportedFrom) {
  const thread = cleanId(named);
  if (!thread || cleanId(reportedFrom) !== thread) return '';
  const through = cleanId(wentThrough);
  if (!through || through === thread) return '';
  return FALLBACK_SENTENCE;
}

/**
 * What she says when the host refused to answer. Every sentence is true for the refusal it names, and none of
 * them tells Peter to go and choose a thread.
 * @param {string} code - the host's `x-auma-live-refusal` value
 * @param {string} home - her home, when known
 * @param {string} [named] - the session the turn named ('' when it named none)
 * @returns {string}
 */
export function refusalSentence(code, home, named = '') {
  switch (code) {
    case 'no-home':
      // The page names no session only when nothing is selected, so "that thread" would be about no thread at all.
      if (!cleanId(named)) return 'Nothing is selected, and no home session is configured for me to answer through.';
      return 'That thread is not open here, and no home session is configured for me to answer through.';
    case 'home-not-found':
      return home
        ? `My home session ${home} does not exist on this host, so I could not answer.`
        : 'My configured home session does not exist on this host, so I could not answer.';
    case 'home-not-resumable':
      // Nothing on this host can open the home until a session controller is mounted: no promise that trying
      // again will help.
      return 'My home session is not open, and nothing on this host can open it right now.';
    case 'home-unavailable':
      // The resume failed; the host's refusal text says why. A retry may or may not help, so she does not promise.
      return 'My home session could not be opened just now, so I could not answer.';
    default:
      return 'The live channel could not open a model stream. Give me a breath and try once more.';
  }
}

/**
 * Learn her home from the host, starting at mount.
 *
 * @param {object} options
 * @param {(url: string, init?: object) => Promise<any>} options.fetch
 * @param {(fn: () => void, ms: number) => any} [options.setTimeout]
 * @param {(id: any) => void} [options.clearTimeout]
 * @param {readonly number[]} [options.delays] - the bounded backoff
 * @param {(body: object) => void} [options.onAnswer] - the whole minds body, for the roster
 * @param {(home: string) => void} [options.onHome] - called once a home is adopted
 */
export function createHomeSession(options = {}) {
  const doFetch = options.fetch;
  const arm = options.setTimeout ?? ((fn, ms) => setTimeout(fn, ms));
  const disarm = options.clearTimeout ?? ((id) => clearTimeout(id));
  const delays = options.delays ?? HOME_RETRY_DELAYS_MS;
  let home = '';
  let answered = false;
  let failures = 0;
  let timer = 0;
  let inFlight = null;
  let stopped = false;
  const waiters = new Set();

  const release = () => { for (const wake of [...waiters]) wake(); };

  function adopt(body) {
    answered = true;
    // ADOPTION DOES NOT LOOK AT THE ROSTER. The roster is the gear's business; an empty one is still an answer.
    home = cleanId(body.homeSession);
    try { options.onAnswer?.(body); } catch { /* a roster consumer's fault is its own */ }
    if (home) { try { options.onHome?.(home); } catch { /* the home is adopted either way */ } }
    release();
  }

  function retryLater() {
    failures += 1;
    if (stopped || failures > delays.length) { release(); return; }
    // BOUNDED BACKOFF: one more ask after the next delay, never a loop without an end.
    timer = arm(() => { timer = 0; void ask(); }, delays[failures - 1]);
  }

  async function attempt() {
    try {
      const response = await doFetch(MINDS_ENDPOINT, { cache: 'no-store' });
      if (!response || !response.ok) throw new Error(`the minds route answered ${String(response?.status)}`);
      const body = await response.json();
      if (!body || typeof body !== 'object' || Array.isArray(body)) throw new Error('the minds route sent no object');
      if (!stopped) adopt(body);
    } catch {
      if (!stopped && !answered) retryLater();
    }
  }

  function ask() {
    if (stopped || answered || typeof doFetch !== 'function') return Promise.resolve();
    if (inFlight) return inFlight;
    const run = attempt();
    inFlight = run;
    void run.finally(() => { if (inFlight === run) inFlight = null; });
    return run;
  }

  /** Ask now rather than at the next backoff step; one ask at a time. */
  function askNow() {
    if (stopped || answered) return Promise.resolve();
    if (inFlight) return inFlight;
    if (timer) { disarm(timer); timer = 0; }
    return ask();
  }

  return {
    /** Ask now: at mount, and again when the gear opens before the host has answered. */
    start() { return askNow(); },
    /** Stop asking and release every waiting turn. */
    stop() {
      stopped = true;
      if (timer) disarm(timer);
      timer = 0;
      release();
    },
    /** Her home, '' until the host has named one. */
    get id() { return home; },
    /** Whether the host has answered at all: only then is "no home is configured" a true statement. */
    get answered() { return answered; },
    /** How many asks have failed so far. */
    get failures() { return failures; },
    /**
     * A turn is waiting for the home. Ask immediately rather than at the next backoff step, and resolve with the
     * home as soon as the host answers, or with '' after `ms`.
     * @param {number} ms
     * @returns {Promise<string>}
     */
    waitForHome(ms) {
      if (answered || stopped) return Promise.resolve(home);
      void askNow();
      return new Promise((resolve) => {
        let deadline = 0;
        const wake = () => {
          waiters.delete(wake);
          if (deadline) disarm(deadline);
          resolve(home);
        };
        waiters.add(wake);
        deadline = arm(wake, ms);
      });
    },
  };
}
