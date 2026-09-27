/**
 * BOUNDED REQUEST PROCESSING — ONE FRAME IN, ONE FRAME OUT, AND CAPACITY THE OWNER KEEPS.
 *
 * **CODEX'S SINGLE MOST IMPORTANT CHANGE FOR THE LISTENER.** The previous loop had no byte cap before the
 * newline, no deadline on a partial line, no connection or processing limit, and it kept accumulating after it
 * had dispatched. Measured consequences, each one a way the daemon is unavailable to the person it exists for:
 *
 *   · a peer that never sends a newline buffers until the daemon dies — `received +=` had no ceiling;
 *   · a peer that sends a newline and then keeps writing kept appending to a string nobody would read again;
 *   · `JSON.parse` failure became `null`, so a malformed request was answered as though it were an empty one;
 *   · a multibyte character split across two chunks was decoded twice, once per chunk, and corrupted;
 *   · `void answer()` left handler, serialisation and write failures as UNHANDLED REJECTIONS, which kill the
 *     process — a submitter could take the owner's daemon down by sending bytes that broke a handler.
 *
 * **AND THE RESERVATION IS THE POINT OF THE WHOLE FILE.** The two sockets are separate `net.Server`s, so a
 * flood cannot take the owner's CONNECTIONS — but every connection shares one event loop and one `handle`, and
 * `handle` is async. A hundred submits waiting inside it delay the owner's approval behind them. So submit may
 * hold at most `total - reserved` handler slots and the owner may hold all of them: **a submit flood cannot
 * occupy the capacity an approval needs.**
 */
import { TextDecoder } from 'node:util'
import { lstatSync, rmSync } from 'node:fs'

/** Every way this listener refuses, by name. */
export const LISTENER_REFUSE = Object.freeze({
  FRAME_TOO_LARGE: 'aukora-owner:frame-too-large',
  FRAME_DEADLINE: 'aukora-owner:frame-deadline',
  INCOMPLETE_FRAME: 'aukora-owner:incomplete-frame',
  TRAILING_INPUT: 'aukora-owner:trailing-input',
  BAD_UTF8: 'aukora-owner:frame-not-utf8',
  BAD_JSON: 'aukora-owner:frame-not-json',
  TOO_MANY_CONNECTIONS: 'aukora-owner:too-many-connections',
  SERVER_BUSY: 'aukora-owner:server-busy',
  /** The processing gate was built from bounds it cannot read, so it would enforce nothing. */
  LIMITS_UNREADABLE: 'aukora-owner:processing-limits-unreadable',
  SOCKET_IN_USE: 'aukora-owner:socket-in-use',
  SOCKET_PROBE_UNCLEAR: 'aukora-owner:socket-probe-unclear',
  SOCKET_PATH_TOO_LONG: 'aukora-owner:socket-path-too-long',
  SOCKET_NOT_A_SOCKET: 'aukora-owner:socket-path-not-a-socket',
  INTERNAL: 'aukora-owner:internal-error',
})

/** THE LIMITS, IN ONE PLACE, BECAUSE A LIMIT IN TWO PLACES IS TWO LIMITS. */
export const LIMITS = Object.freeze({
  /** A frame at or above this is refused BEFORE its bytes are kept. */
  MAX_FRAME_BYTES: 64 * 1024,
  /**
   * HOW LONG THE SERVER KEEPS ITS OWN END OPEN AFTER A REPLY, before destroying the socket.
   *
   * A HALF-CLOSE IS NOT A CLOSE. `socket.end()` sends FIN and waits for the PEER's FIN before the socket is
   * released; the server is created with the default `allowHalfOpen: false`, which destroys it only when the
   * peer closes. A peer that keeps its write side open — one line of code, and the submit socket is the
   * AGENT's — leaves a fully-served connection holding its file descriptor INDEFINITELY, with the deadline
   * already cleared. MEASURED AT HEAD: 60 half-open requests took the process from 14 fds to 134, TWO PER
   * REQUEST, and nothing reclaims them because AF_UNIX has no FIN_WAIT_2 timeout.
   *
   * THAT IS A LOCKOUT, NOT A LEAK. Every fd the agent holds is one the owner's approve.sock accept cannot
   * have: at the process ceiling every accept fails EMFILE on BOTH sockets, and the owner can no longer
   * approve anything until a privileged restart. The two-principal cut exists so the owner can settle, and
   * this lets the agent — who has only submit access — take that away.
   */
  LINGER_MS: 1_000,
  /** Absolute, from CONNECT — not from the last byte, which a slow peer can reset forever. */
  FRAME_DEADLINE_MS: 5_000,
  /** Concurrent connections per role. */
  MAX_CONNECTIONS: Object.freeze({ submit: 16, owner: 4 }),
  /**
   * THE HARD DESCRIPTOR BOUND. Every open socket counts, INCLUDING the ones in linger and the ones this
   * daemon refused, because all of them hold a file descriptor until the kernel closes them.
   *
   * SET ABOVE `MAX_CONNECTIONS` ON PURPOSE: a served request needs its slot AND its descriptor, so a cap
   * below the connection limit would refuse requests the daemon is willing to serve. The gap is the room a
   * linger and a refusal are allowed to occupy — and it is FINITE, WHICH IS THE WHOLE POINT. Before this,
   * a flood's descriptor count was bounded only by how fast peers connected.
   */
  MAX_OPEN_SOCKETS: 64,
  /** Handler slots in total, and the number of them a submit may never occupy. */
  PROCESSING_SLOTS: 8,
  RESERVED_FOR_OWNER: 4,
})

const STRICT_UTF8 = new TextDecoder('utf-8', { fatal: true })

/**
 * THE PROCESSING GATE: how many requests may be inside `handle` at once, and who may hold them.
 *
 * @param {Readonly<{total: number, reserved: number}>} limits
 * @returns {Readonly<{acquire: Function, release: Function, inFlight: Function, peak: Function}>}
 */
export function createProcessor(limits) {
  // ── A GATE BUILT FROM BOUNDS IT CANNOT READ MUST REFUSE AT CONSTRUCTION (CODEX R10, FINDING 1) ────
  //
  // **MEASURED: THIS READ `limits.total` AND `limits.reserved` WHILE THE ONLY CALLER PASSED `LIMITS`, WHOSE
  // FIELDS ARE `PROCESSING_SLOTS` AND `RESERVED_FOR_OWNER`.** So `ceiling` was `undefined`,
  // `inFlight >= undefined` was ALWAYS FALSE, and **the gate never refused anything** — while the code, the
  // docstring and the error message all described a reserved-slot policy that was not in force.
  //
  // **A NAME MISMATCH IS THE ONE FAILURE A GATE CANNOT REPORT BY BEHAVING NORMALLY.** It enforced nothing
  // and looked correct, so the defect could only be found by reading two functions side by side. These
  // checks turn it into a refusal at construction, where it is loud and attributable — the rule
  // `aukora-fail-open-pin` records: **present-and-unusable is a fault, not a ceiling.**
  const total = limits?.total
  const reserved = limits?.reserved
  if (!Number.isInteger(total) || total <= 0) {
    const error = new Error(`${LISTENER_REFUSE.LIMITS_UNREADABLE}: the processing gate needs a positive `
      + `integer \`total\`, and it was ${JSON.stringify(total)}. A gate built from a bound it cannot read `
      + 'admits every request while reading as though it enforced the bound')
    error.code = LISTENER_REFUSE.LIMITS_UNREADABLE
    throw error
  }
  if (!Number.isInteger(reserved) || reserved < 0 || reserved >= total) {
    const error = new Error(`${LISTENER_REFUSE.LIMITS_UNREADABLE}: \`reserved\` must be a non-negative `
      + `integer below \`total\` (${String(total)}), and it was ${JSON.stringify(reserved)}. A reservation `
      + 'that is not inside the total reserves nothing')
    error.code = LISTENER_REFUSE.LIMITS_UNREADABLE
    throw error
  }
  let inFlight = 0
  let peak = 0
  return Object.freeze({
    /**
     * Take a slot for one request, or refuse by name.
     *
     * **THE OWNER MAY USE THE RESERVED SLOTS AND A SUBMIT MAY NOT.** `total - reserved` is the ceiling for a
     * submit, so however many arrive, the owner's next approval always has somewhere to run.
     *
     * @param {string} role
     * @returns {true}
     * @throws {Error} `aukora-owner:server-busy`.
     */
    acquire(role) {
      const ceiling = role === 'owner' ? limits.total : limits.total - limits.reserved
      if (inFlight >= ceiling) {
        const error = new Error(`${LISTENER_REFUSE.SERVER_BUSY}: ${String(inFlight)} request(s) are already in `
          + `the handler and the ${role} role may hold ${String(ceiling)} of ${String(limits.total)}. `
          + `${String(limits.reserved)} slot(s) are reserved for the owner, so a submit flood cannot occupy `
          + 'the capacity an approval needs')
        error.code = LISTENER_REFUSE.SERVER_BUSY
        throw error
      }
      inFlight += 1
      peak = Math.max(peak, inFlight)
      return true
    },
    release() { inFlight = Math.max(0, inFlight - 1) },
    inFlight: () => inFlight,
    peak: () => peak,
  })
}

/**
 * ACCUMULATE ONE FRAME, WITH THE CAP APPLIED **BEFORE** THE BYTES ARE KEPT.
 *
 * **AT THE CAP, NOT AFTER THE NEWLINE.** A check that looks for a newline first and measures afterwards has
 * already stored whatever arrived, which is the whole of the memory the cap exists to bound — a peer sending
 * a gigabyte without a newline is refused only once the gigabyte is in the heap.
 *
 * @param {Readonly<{maxBytes: number}>} limits
 * @returns {Readonly<{push: Function, size: Function, frame: Function, done: Function}>}
 */
export function createFrame(limits) {
  const chunks = []
  let size = 0
  let frame = null
  let terminal = null
  return Object.freeze({
    /**
     * Take a chunk. Returns the frame when the newline has arrived, `null` while more is expected.
     * @throws {Error} `frame-too-large` at the cap, before the chunk is kept.
     */
    push(chunk) {
      // BYTES AFTER A COMPLETE FRAME ARE TRAILING INPUT WHENEVER THEY ARRIVE. The first version decided the
      // policy from the bytes that happened to share the newline's CHUNK: a newline at the end of one chunk
      // made `rest.length` 0, the frame 'complete', and everything the peer sent afterwards hit
      // `terminal !== null` and was SILENTLY IGNORED. The same bytes got different answers depending on how
      // the network split them — which is not a policy, it is a coincidence.
      if (terminal === 'complete') {
        if (chunk.length > 0) terminal = LISTENER_REFUSE.TRAILING_INPUT
        return null
      }
      if (terminal !== null) return null
      // THE CAP IS CHECKED AGAINST WHAT THIS CHUNK WOULD MAKE THE TOTAL, and the chunk is dropped when it
      // would cross — so the memory high-water mark is the cap and not the cap plus one chunk.
      if (size + chunk.length > limits.maxBytes) {
        terminal = LISTENER_REFUSE.FRAME_TOO_LARGE
        const error = new Error(`${LISTENER_REFUSE.FRAME_TOO_LARGE}: a frame reached `
          + `${String(size + chunk.length)} bytes and the limit is ${String(limits.maxBytes)}. The bytes are `
          + 'refused BEFORE they are kept, so a peer cannot make this daemon hold them')
        error.code = LISTENER_REFUSE.FRAME_TOO_LARGE
        throw error
      }
      const newline = chunk.indexOf(0x0a)
      if (newline === -1) {
        chunks.push(chunk)
        size += chunk.length
        return null
      }
      chunks.push(chunk.subarray(0, newline))
      size += newline
      const rest = chunk.subarray(newline + 1)
      // ── THE TRAILING-INPUT POLICY, STATED RATHER THAN IMPLIED ────────────────────────────────────────
      // One line in and one line out is the protocol, so anything after the first newline is refused BY NAME.
      // The previous loop ignored extra lines while RETAINING their bytes, which is the worst of both: the
      // caller is not told and the daemon keeps what it will never read.
      terminal = rest.length > 0 ? LISTENER_REFUSE.TRAILING_INPUT : 'complete'
      frame = Buffer.concat(chunks, size)
      chunks.length = 0
      return frame
    },
    size: () => size,
    frame: () => frame,
    done: () => terminal !== null,
    /** Set when the newline arrived but the caller must be refused for what followed it. */
    terminal: () => terminal,
    /** Drop everything held. Called once the request is dispatched, so nothing buffers after it. */
    release() { chunks.length = 0; frame = null },
  })
}

/**
 * DECODE ONE BOUNDED FRAME: STRICT UTF-8, THEN JSON, EACH REFUSED BY NAME.
 *
 * **THE WHOLE FRAME IS DECODED AT ONCE, WHICH IS WHY IT MUST BE BOUNDED FIRST.** Decoding chunk by chunk
 * corrupted a multibyte character split across two of them; a strict decoder over the complete frame both
 * fixes that and turns invalid bytes into a refusal rather than a replacement character.
 *
 * @param {Buffer} frame
 * @returns {unknown} the parsed request.
 * @throws {Error} `frame-not-utf8` or `frame-not-json`, by name.
 */
export function decodeFrame(frame) {
  let text = null
  try {
    text = STRICT_UTF8.decode(frame)
  } catch {
    const error = new Error(`${LISTENER_REFUSE.BAD_UTF8}: the frame is not valid UTF-8. A replacement `
      + 'character would make a malformed request look like a well-formed one')
    error.code = LISTENER_REFUSE.BAD_UTF8
    throw error
  }
  if (text.trim() === '') {
    const error = new Error(`${LISTENER_REFUSE.BAD_JSON}: the frame is empty`)
    error.code = LISTENER_REFUSE.BAD_JSON
    throw error
  }
  try {
    return JSON.parse(text)
  } catch (cause) {
    // **A PARSE FAILURE IS A NAMED REFUSAL, NOT `null`.** The old loop set `request = null`, so a malformed
    // request was handled as though the caller had sent an empty one — a different complaint about different
    // bytes, and one the caller could not act on.
    const error = new Error(`${LISTENER_REFUSE.BAD_JSON}: the frame is not JSON: `
      + `${String(cause?.message ?? cause).slice(0, 120)}`)
    error.code = LISTENER_REFUSE.BAD_JSON
    throw error
  }
}

/**
 * SERVE ONE SOCKET WITH ALL OF THE ABOVE.
 *
 * @param {Readonly<{socketPath: string, role: string, handle: Function, log: Function, limits?: object, processor?: object, say?: Function}>} input
 * @returns {Promise<import('node:net').Server>}
 */
/**
 * REMOVE A SOCKET NOBODY IS LISTENING ON, AND REFUSE TO TOUCH ONE SOMEBODY IS.
 *
 * @param {string} socketPath
 * @param {Function} log
 * @throws {Error} `aukora-owner:socket-in-use` when something answers, `aukora-owner:socket-path-not-a-socket`
 *   when the path is a regular file this daemon did not create.
 */
async function clearStaleSocket(socketPath, log) {
  const { createConnection } = await import('node:net')
  let state = null
  try { state = lstatSync(socketPath) } catch { return }
  if (!state.isSocket()) {
    // **A FILE THAT IS NOT A SOCKET IS NOT A STALE SOCKET.** Removing it would destroy something this daemon
    // did not create and cannot account for; refusing says so instead.
    throw refuse(LISTENER_REFUSE.SOCKET_NOT_A_SOCKET,
      `${socketPath} exists and is not a socket, so this daemon will not remove it`)
  }
  // *** ONLY `ECONNREFUSED` PROVES NOBODY IS LISTENING, AND THIS USED TO UNLINK ON ANYTHING ELSE. ***
  // Every error was treated as "nothing answered" and SO WAS A TIMEOUT, and both reached `rmSync`. A listener
  // that is ALIVE BUT SLOW — blocked in a handler, or simply loaded — therefore produced a timeout, and this
  // daemon DELETED THE SOCKET OF A RUNNING OWNER and started a second one on the same path. THE CODE COULD
  // NOT DISTINGUISH "no process" FROM "no answer yet", AND IT ACTED AS IF IT COULD.
  //
  // `ECONNREFUSED` IS THE ONE ANSWER THAT MEANS NOBODY HOLDS THE PATH: the kernel refused because no process
  // has it bound. Anything else — a timeout, `EAGAIN`, a permission error — MEANS THE QUESTION WAS NOT
  // ANSWERED, and an unanswered question is not a dead listener. So this REFUSES TO START, BY NAME, rather
  // than clearing the way for a second owner.
  const probeResult = await new Promise(resolvePromise => {
    const probe = createConnection(socketPath)
    const done = value => { probe.destroy(); resolvePromise(value) }
    probe.on('connect', () => done('answered'))
    probe.on('error', error => done(error?.code === 'ECONNREFUSED' ? 'refused' : `unanswered:${String(error?.code ?? error)}`))
    setTimeout(() => done('unanswered:timeout'), STALE_SOCKET_PROBE_MS)
  })
  // THE DECISION IS IN `staleSocketVerdict`, WHICH IS PURE AND THEREFORE COURTED DIRECTLY. What is left here
  // is only the ACTING: the mapping from a verdict to a refusal or an unlink has no judgement in it.
  const verdict = staleSocketVerdict(probeResult)
  if (verdict === 'keep') {
    throw refuse(LISTENER_REFUSE.SOCKET_IN_USE,
      `something is already listening on ${socketPath} — this daemon does not take a path another one is `
      + "serving, because both would answer and only one of them is the owner's")
  }
  if (verdict === 'unverified') {
    throw refuse(LISTENER_REFUSE.SOCKET_PROBE_UNCLEAR,
      `could not establish that anything is listening on ${socketPath}, and could not establish that nothing `
      + `is either — the probe said ${probeResult}. THIS DAEMON DOES NOT REMOVE A SOCKET IT COULD NOT QUESTION: `
      + 'a live listener that is slow to answer looks exactly like this, and removing the path would start a '
      + 'second owner beside the first. Remove the file only once you know the process is gone.')
  }
  rmSync(socketPath, { force: true })
  log(`removed a stale socket at ${socketPath}: the kernel refused the connection, so no process holds it`)
}

/**
 * WHAT TO DO WITH A CHUNK THAT ARRIVES ON A CONNECTION, DECIDED FROM THE CONNECTION'S STATE ALONE.
 *
 * *** THIS EXISTS SO A REVIEWER READS A POLICY RATHER THAN A BYPASS. *** Codex read the data handler's
 * `if (replied || frame.done()) return` as skipping the late-input check at `createFrame.push`, and the
 * mechanism is exactly that: after the frame completes, `push` is never called again, so ITS trailing-input
 * branch is unreachable from a connection. THE BEHAVIOUR IS DELIBERATE AND COURTED — R6b measured that a
 * reply cannot be unsent, so the server answers once and drops what follows — BUT NOTHING IN THE CODE SAID SO,
 * WHICH IS WHY A CAREFUL READER CONCLUDED THE CHECK WAS BYPASSED. A bare `return` is not a policy.
 *
 * THE TWO LEVELS ANSWER DIFFERENT QUESTIONS AND BOTH ARE RIGHT:
 *
 *   `createFrame.push`   "are these bytes part of the frame I am assembling?"      -> trailing input is a
 *                        REFUSAL, and it is chunk-independent (bounds court, R4).
 *   `lateInputVerdict`   "what does this CONNECTION do with a chunk now?"          -> once the request has
 *                        been answered the bytes are DROPPED and never answered, because the reply is out.
 *
 * @param {{replied: boolean, frameDone: boolean}} state
 * @returns {'accept'|'ignore'} whether the chunk should be handed to the frame.
 */
export function lateInputVerdict({ replied, frameDone }) {
  // ALREADY ANSWERED: the reply is gone and cannot be recalled or amended, so these bytes are dropped and
  // NEVER ANSWERED. Not a refusal, because a second reply would be a second answer to one request.
  if (replied) return 'ignore'
  // THE FRAME IS COMPLETE AND THE HANDLER IS RUNNING: `push` must not see another byte, or a slow handler
  // and a fast peer could append to a frame already being served. The connection is paused here, and this
  // guard holds even if a chunk was already in flight when the pause took effect.
  if (frameDone) return 'ignore'
  return 'accept'
}

/**
 * WHAT TO DO ABOUT A SOCKET THAT IS ALREADY AT THE PATH, DECIDED FROM THE PROBE'S OUTCOME ALONE.
 *
 * *** THIS EXISTS BECAUSE THE DECISION WAS UNTESTABLE IN PLACE AND ITS MUTANT SURVIVED. *** The three-way
 * choice used to be written inline among `createConnection`, a `setTimeout` and an `rmSync`, so the only way
 * to reach the TIMEOUT case was to INDUCE a probe that neither connects nor is refused within 500 ms — and
 * over AF_UNIX that cannot be done from outside, because `connect` either succeeds at once or returns
 * `ECONNREFUSED` at once. MEASURED: restoring the old "any error or timeout means nobody is listening" left
 * the listener court at 18/18 GREEN, because no arm could produce the branch that changed.
 *
 * SO THE DECISION IS A PURE FUNCTION OVER THE OUTCOME, and the outcome is a VALUE a court can pass in:
 *
 *   'answered'            something accepted the connection -> KEEP: refuse to start, never unlink. A second
 *                         daemon on a path a live owner is serving would answer new clients while the owner
 *                         keeps its old ones, and only one of them is the owner's.
 *   'refused'             the kernel returned ECONNREFUSED -> UNLINK: the one answer that proves no process
 *                         holds the path, because the kernel refused BECAUSE nothing is bound to it.
 *   anything else         a timeout, `EAGAIN`, a permission error -> UNVERIFIED: REFUSE TO START. The question
 *                         was not answered, and AN UNANSWERED QUESTION IS NOT A DEAD LISTENER. This is the
 *                         case that used to delete a live owner's socket.
 *
 * @param {string} outcome - what the probe reported.
 * @returns {'unlink'|'keep'|'unverified'} the decision, with no side effect of its own.
 */
export function staleSocketVerdict(outcome) {
  if (outcome === 'refused') return 'unlink'
  if (outcome === 'answered') return 'keep'
  return 'unverified'
}

/** The module's own refusal shape: a named code and a sentence a person can act on. */
function refuse(code, message) {
  const error = new Error(message)
  error.code = code
  return error
}

/**
 * THE LONGEST UNIX SOCKET PATH THIS DAEMON WILL BIND — **AND IT IS A REAL LIMIT ON THIS PLATFORM.**
 *
 * **I FIRST CONCLUDED THE OPPOSITE, AND THE MEASUREMENT THAT CONVINCED ME WAS MEASURING THE WRONG THING.**
 * I bound 149, 201, 249 and 301-byte paths, saw `server.address().path` come back with the full path, and
 * wrote that "this Mac accepts up to 301 bytes and returns the path exactly". **`server.address()` REPORTS THE
 * PATH NODE WAS ASKED TO BIND, NOT THE ONE THE KERNEL CREATED.** It is an echo of the request, so it cannot
 * witness a truncation — **a reader that reports back what it was told is not evidence about what happened.**
 *
 * **RE-MEASURED, ASKING THE FILESYSTEM INSTEAD OF THE SOCKET** (macOS 26.1 / M4 / Node 22), in a 22-byte
 * directory, binding a name of `x`-es and then `lstat`-ing the EXACT path that was asked for:
 *
 *     asked   server.address() says   lstat(asked)   file actually created
 *      103    103                     EXISTS         103 bytes
 *      104    104                     EXISTS         104 bytes
 *      105    105                     **ENOENT**     **104 bytes**
 *      110    110                     ENOENT         104 bytes
 *      117    117                     ENOENT         104 bytes
 *
 * **AT 105 AND ABOVE THE KERNEL SILENTLY TRUNCATES THE PATH TO 104 AND BINDS THERE.** The daemon thinks it is
 * listening on the path it asked for; `lstat` on that path fails with `ENOENT`; a file exists one truncation
 * away. MEASURED ON OUR OWN CODE: the Kira signer bound a ~117-byte path and its own `lstat` of that path
 * returned `ENOENT`, which is this table happening to us.
 *
 * SO THE REFUSAL IS NOT MERELY PORTABILITY. It fires before the kernel can silently bind somewhere else:
 *
 *   · **A TRUNCATED PATH IS A COLLISION, NOT AN ERROR.** Two different long paths agreeing in their first 104
 *     bytes become ONE socket, so the second daemon binds the first one's path — or dies with `EADDRINUSE`
 *     for a reason that looks like none of this;
 *   · **Linux is 108 INCLUDING THE NUL**, so 107 usable — and `owner-cut-linux` runs there;
 *   · and it came from the failure that started this: a court scratch base made a **129-byte** path, and the
 *     symptom was an `EADDRINUSE` on a restart that had nothing to do with the socket still being held. **The
 *     real cause was the stale socket R6 fixed — but a limit nobody checks is a limit that reports as some
 *     other bug.**
 *
 * PRODUCTION PATHS ARE ABOUT 60 BYTES, so this refuses nothing real. **104 ITSELF STILL BINDS WHOLE** — the
 * table above shows the file at the asked path at exactly 104 — so `>= 104` gives up one byte that would have
 * worked, deliberately: the boundary is the platform's, and a guard that sits ON it is one byte from the
 * truncation it exists to prevent.
 */
// **EXPORTED SO THE ARM THAT MEASURES PRODUCTION HEADROOM READS THIS AND NOT A COPY.** A court holding its
// own 104 would keep passing if this constant moved, which is the one thing the arm exists to notice.
export const SUN_PATH_MAX = 104

/**
 * REFUSE A SOCKET PATH THE PLATFORM WOULD NOT KEEP WHOLE.
 *
 * @param {string} socketPath
 * @throws {Error} `aukora-owner:socket-path-too-long`.
 */
export function assertSocketPathFits(socketPath) {
  const length = Buffer.byteLength(socketPath, 'utf8')
  if (length >= SUN_PATH_MAX) {
    throw refuse(LISTENER_REFUSE.SOCKET_PATH_TOO_LONG,
      `the socket path ${socketPath} is ${String(length)} bytes, and this daemon binds nothing at or over `
      + `${String(SUN_PATH_MAX)}. MEASURED: at 105 bytes and above this kernel SILENTLY TRUNCATES the path to `
      + '104 and binds there — `server.address()` still echoes the path it was asked for, so nothing reports '
      + 'it, and `lstat` on the asked path returns ENOENT. A path the kernel truncates does not fail either: '
      + 'two long paths agreeing in their first 104 bytes become ONE socket, and the second daemon takes the '
      + `first one's. Linux allows 108 INCLUDING the NUL and owner-cut-linux runs there. The install paths are `
      + 'about 60 bytes, so this refuses nothing real')
  }
  return socketPath
}

/** How long a liveness probe may take before the path is called stale. */
const STALE_SOCKET_PROBE_MS = 500

/**
 * The processing bounds, in the names the gate reads.
 *
 * **THIS FUNCTION EXISTS BECAUSE A NAME MISMATCH WAS INVISIBLE (CODEX R10, FINDING 1).** The gate read
 * `total`/`reserved`; `LIMITS` carries `PROCESSING_SLOTS`/`RESERVED_FOR_OWNER`; **both sides were correct on
 * their own and the seam between them enforced nothing.** Translating in ONE place means there is one seam
 * to get wrong rather than one per caller.
 *
 * @returns {{total: number, reserved: number}} the bounds the gate enforces.
 */
export function defaultProcessorLimits() {
  return { total: LIMITS.PROCESSING_SLOTS, reserved: LIMITS.RESERVED_FOR_OWNER }
}

export async function serveBounded(input) {
  const { createServer, createConnection } = await import('node:net')
  const limits = { ...LIMITS, ...(input.limits ?? {}) }
  // **THE BOUNDS COME FROM `defaultProcessorLimits()`, NOT FROM THE SPREAD.** MEASURED: the spread carried
  // `PROCESSING_SLOTS` and `RESERVED_FOR_OWNER`, and the gate read neither — so this is the one line that
  // makes the reservation real. An explicit `input.processor` still wins, for a caller that brought its own.
  const processor = input.processor
    ?? createProcessor(input.processorLimits ?? defaultProcessorLimits())
  const say = input.say ?? (value => JSON.stringify(value))
  const log = input.log ?? (() => {})
  let connections = 0
  /**
   * *** EVERY OPEN DESCRIPTOR, INCLUDING THE ONES `connections` DOES NOT COUNT. ***
   *
   * `connections` counts the connections being SERVED, and it is decremented when the request finishes —
   * but the socket stays OPEN through the linger so the reply can flush. The overflow socket is refused
   * BEFORE `connections` is ever incremented and then held for `LINGER_MS` too. SO THE PEAK NUMBER OF OPEN
   * DESCRIPTORS IS `connections` PLUS EVERY SOCKET IN LINGER, PLUS EVERY REFUSED SOCKET STILL DRAINING, and
   * the cap was applied only to the first term. A flood therefore accumulated descriptors with the cap
   * satisfied the whole time: THE LIMIT WAS ON CONCURRENCY AND THE RESOURCE IS DESCRIPTORS.
   *
   * THIS COUNTS FROM ACCEPT TO CLOSE, WHATEVER PATH THE SOCKET TAKES, so lingering and overflow sockets are
   * inside it by construction rather than by remembering to add them.
   */
  let openSockets = 0

  // ── A CRASH LEAVES ITS SOCKET BEHIND, AND THIS DAEMON COULD NEVER RESTART (R6) ──────────────────
  //
  // **MEASURED, AND I HID IT FROM MYSELF.** `server.listen(socketPath)` with no handling of an existing path
  // means a SIGKILL — or a power loss — leaves the socket FILE, and the next start dies with `EADDRINUSE` for
  // ever. **The kill court hit exactly this and I fixed it IN THE FIXTURE**, by deleting the socket files
  // before each restart: the court went green and the daemon kept the defect. **A fixture that repairs what it
  // is testing measures the repair.**
  //
  // THE ORDER IS THE SAFETY PROPERTY, NOT A CONVENIENCE. Unlinking first would let a second daemon take a path
  // a LIVE one is still serving on — the old process keeps its accepted connections while every new client
  // reaches the new process, so one socket path would front two daemons. **Liveness is asked FIRST, and only a
  // path nobody answers on is removed.**
  // **BEFORE ANY FILE IS TOUCHED.** A path the platform would truncate must be refused before this daemon
  // removes a stale entry at it, because the entry it would remove may belong to a DIFFERENT socket that
  // truncated to the same bytes.
  assertSocketPathFits(input.socketPath)
  await clearStaleSocket(input.socketPath, log)

  return new Promise((resolvePromise, rejectPromise) => {
    const server = createServer(socket => {
      // COUNTED FIRST, BEFORE ANY DECISION, because every path below holds a descriptor: the refusal is
      // written and then lingered, and the served request lingers after its slot is released.
      openSockets += 1
      socket.once('close', () => { openSockets = Math.max(0, openSockets - 1) })
      // *** THE HARD CAP DESTROYS IMMEDIATELY; THE SOFT ONE STILL ANSWERS POLITELY, AND THE DIFFERENCE IS
      // THE WHOLE POINT. *** MEASURED: a 120-connection flood held a 122-DESCRIPTOR PEAK WITH THE CAP AT 8
      // AND AT 64 — IDENTICAL — because the refusal below WRITES A REPLY AND LINGERS FOR `LINGER_MS`, so a
      // REFUSED SOCKET COSTS A DESCRIPTOR ANYWAY. Refusing to serve is not the same as letting go, and a
      // flood arrives faster than the linger expires, so the count grew by one per connection while the cap
      // reported itself satisfied. A DESCRIPTOR BOUND HAS TO CLOSE DESCRIPTORS.
      if (openSockets > limits.MAX_OPEN_SOCKETS) {
        // NO REPLY, NO LINGER, NO TIMER. The peer learns nothing, which is the correct trade at the point
        // where the alternative is running out of descriptors for every OTHER connection this daemon serves.
        socket.destroy()
        return
      }
      if (connections >= limits.MAX_CONNECTIONS[input.role]) {
        // REFUSED BY NAME AND CLOSED, rather than accepted and starved: a connection this daemon will not
        // serve is better told so than left waiting until a deadline it cannot see.
        // TWO LIMITS REACH THIS BRANCH AND THEY ARE NOT THE SAME LIMIT: `MAX_CONNECTIONS` bounds how many
        // requests are SERVED at once, `MAX_OPEN_SOCKETS` bounds DESCRIPTORS — served, lingering and refused
        // together. The second is the one a flood attacks, because a refused socket still costs a descriptor
        // for LINGER_MS while the first counter has already stopped moving.
        // AN `'error'` LISTENER BEFORE THE WRITE, OR THE REFUSAL ITSELF CAN CRASH THE PROCESS. `end()` on a
        // socket the peer has already reset emits `'error'` with no handler, and an unhandled 'error' on a
        // net.Socket is an uncaught exception — so the connection this daemon REFUSES is the one that takes
        // the daemon down.
        socket.on('error', () => {})
        // THE SAME HALF-CLOSE PROBLEM, AND THIS PATH HAS NO DEADLINE AT ALL. A refused peer that never sends
        // FIN held its descriptor forever too, and this branch returns before `finish` exists to close it.
        const lingerRefusal = setTimeout(() => socket.destroy(), limits.LINGER_MS)
        socket.once('close', () => clearTimeout(lingerRefusal))
        try { socket.end(`${say({ ok: false, reason: LISTENER_REFUSE.TOO_MANY_CONNECTIONS })}\n`) } catch { socket.destroy() }
        return
      }
      connections += 1
      // THE CAP IS NAMED ONCE. `createFrame` reads `limits.maxBytes`; `LIMITS` declares `MAX_FRAME_BYTES`.
      // Passing the whole object meant `limits.maxBytes` was undefined and `size + chunk.length > undefined`
      // IS ALWAYS FALSE — SO THE CAP NEVER FIRED IN PRODUCTION. The court was green because it called
      // `createFrame({maxBytes: 1024})` directly, exercising the one shape the server never builds. A LIMIT
      // DECLARED IN ONE PLACE AND READ IN ANOTHER IS TWO LIMITS, AND THE ONE THAT MATTERS IS THE ONE THE
      // SERVER PASSES. This is the single conversion, at the boundary.
      const frame = createFrame({ maxBytes: limits.MAX_FRAME_BYTES })
      let replied = false
      // **WHETHER A HANDLER IS RUNNING RIGHT NOW** (Codex r11, finding 2). Distinct from `replied`, which
      // means an answer was already sent.
      let serving = false
      // TWO SLOTS, TWO FLAGS, AND THEY MUST NOT SHARE ONE. `released` below is the PROCESSOR slot: it is set
      // when `processor.acquire` succeeds and cleared on the processor's own release path. I first reused it
      // for the CONNECTION slot, so `releaseSlot` set it before `processor.acquire` ever ran and the
      // processor's release was then skipped — a leak that showed up as `too-many-connections` in three
      // neighbour courts while the listener's own court stayed green. ONE FLAG FOR TWO SLOTS IS THE DEFECT,
      // not the arithmetic.
      let released = false
      let slotReleased = false
      /** Release this connection's slot EXACTLY ONCE, from completion, error, deadline or peer close. */
      const releaseSlot = () => {
        if (slotReleased) return
        slotReleased = true
        connections = Math.max(0, connections - 1)
      }

      /**
       * WRITE THE REPLY, THEN CLOSE THE SERVER'S OWN END WHETHER OR NOT THE PEER EVER DOES.
       *
       * The linger is there so the reply is actually flushed before the socket is destroyed — `destroy()`
       * immediately would lose it — and the `once('close')` clears the timer for a peer that closes
       * properly, so a polite peer is not held for the full second. What it removes is the case where the
       * ONLY thing that could close the socket was THE PEER'S COOPERATION: after this, a peer that never
       * sends FIN costs one file descriptor for at most LINGER_MS instead of one forever.
       */
      const closeAfter = (socket, text) => {
        const linger = setTimeout(() => socket.destroy(), limits.LINGER_MS)
        socket.once('close', () => clearTimeout(linger))
        try { socket.end(text) } catch (cause) {
          log(`could not write the reply on ${input.role}: ${String(cause?.message ?? cause)}`)
          socket.destroy()
        }
      }

      const finish = (reply, close) => {
        if (replied) return
        replied = true
        clearTimeout(deadline)
        // THE SLOT IS RELEASED HERE, NOT ONLY ON `'close'`. `finish` calls `end()` on a socket it PAUSED, and
        // a peer that never closes never emits `'close'` — so MAX_CONNECTIONS completed requests were enough
        // to lock everyone else out, and the limit became a function of THE PEER'S BEHAVIOUR rather than of
        // this daemon's work.
        releaseSlot()
        // **NOTHING BUFFERS AFTER DISPATCH.** The frame's bytes are dropped here, so a peer that keeps writing
        // after its newline cannot grow this daemon's heap.
        frame.release()
        if (socket.destroyed) return
        closeAfter(socket, `${say(reply)}\n`)
      }

      /** ONE REQUEST, AND EVERY FAILURE INSIDE IT HAS SOMEWHERE TO GO. */
      const answer = async () => {
        try {
          if (frame.terminal() === LISTENER_REFUSE.TRAILING_INPUT) {
            finish({ ok: false, reason: LISTENER_REFUSE.TRAILING_INPUT })
            return
          }
          const request = decodeFrame(frame.frame() ?? Buffer.alloc(0))
          processor.acquire(input.role)
          released = true
          // Paused BEFORE the handler runs, so no more bytes are read while the request is being served.
          socket.pause()
          let reply = null
          // **SET BEFORE THE AWAIT AND CLEARED AFTER IT**, so the deadline can tell "nothing has happened yet"
          // from "the effect is in flight".
          serving = true
          try {
            // The optional third argument identifies the accepted connection itself.
            reply = await input.handle(input.role, request, socket)
          } finally {
            serving = false
            processor.release()
          }
          finish(reply ?? { ok: false, reason: LISTENER_REFUSE.INTERNAL })
        } catch (error) {
          if (released) { released = false }
          const code = typeof error?.code === 'string' ? error.code : LISTENER_REFUSE.INTERNAL
          if (code === LISTENER_REFUSE.INTERNAL) {
            log(`INTERNAL ERROR serving ${input.role}: ${String(error?.stack ?? error?.message ?? error)}`)
          }
          finish({ ok: false, reason: code })
        }
      }

      // **THE TERMINAL CATCH: WITHOUT IT A HANDLER FAILURE IS AN UNHANDLED REJECTION, AND AN UNHANDLED
      // REJECTION KILLS THE PROCESS.** MEASURED: `void answer()` left handler, serialisation and write
      // failures with nowhere to go, so a submitter whose bytes broke a handler took the OWNER'S DAEMON down
      // with them. Every path above is inside the try, so this catch is the last line of defence rather than
      // the first — and it closes the connection rather than leaving it open with no reply coming.
      const answerSafely = () => { answer().catch(error => {
        log(`UNCAUGHT in answer() on ${input.role}: ${String(error?.stack ?? error?.message ?? error)}`)
        finish({ ok: false, reason: LISTENER_REFUSE.INTERNAL }, true)
      }) }

      // AN ABSOLUTE DEADLINE, FROM CONNECT. A timer reset by each byte is a timer a slow peer never trips.
      const deadline = setTimeout(() => {
        if (replied) return
        // ── A REFUSAL MAY NOT PRECEDE A COMPLETED EFFECT (CODEX R11, FINDING 2) ─────────────────────────
        //
        // **MEASURED: THIS FIRED WHILE `input.handle` WAS STILL RUNNING.** The handler is not cancelled by this
        // timer — it runs to completion — so a request that CONSUMED A NONCE, WROTE A RECORD OR SETTLED AN
        // APPROVAL could be answered `frame-deadline`, and `finish` then discarded the handler's real reply as
        // late. **THE CALLER IS TOLD THE REQUEST WAS REFUSED WHILE THE ACT IT ASKED FOR HAS ALREADY
        // HAPPENED.** That is the mirror of this lane's worst answer — *a success report for an act that did
        // not happen* — and it is worse in one way: the caller retries an operation that already took effect.
        //
        // **SO WHILE A HANDLER IS RUNNING, THIS TIMER WARNS INSTEAD OF ANSWERING.** The reply is the
        // handler's, because only the handler knows whether the effect completed. **The deadline still bounds
        // everything up to the moment a handler starts** — a peer that sends bytes slowly, or never sends a
        // newline, is refused exactly as before.
        if (serving) {
          log('FRAME DEADLINE passed while a handler is still running, so this is NOT answered as a refusal: '
            + 'the handler may already have completed the effect, and refusing here would deny an act that '
            + 'happened. The handler\'s own reply will be sent.')
          return
        }
        finish({ ok: false, reason: LISTENER_REFUSE.FRAME_DEADLINE }, true)
      }, limits.FRAME_DEADLINE_MS)

      socket.on('data', chunk => {
        // THE DECISION IS NAMED AND PURE, SO IT READS AS A POLICY RATHER THAN AS A SKIP. See
        // `lateInputVerdict`: once the request is answered these bytes are DROPPED AND NEVER ANSWERED,
        // because a reply cannot be unsent and a second reply would be a second answer to one request.
        // `createFrame.push` still refuses trailing input for a caller that keeps pushing (bounds R4).
        if (lateInputVerdict({ replied, frameDone: frame.done() }) === 'ignore') return
        try {
          const complete = frame.push(chunk)
          if (complete !== null) answerSafely()
        } catch (error) {
          finish({ ok: false, reason: error?.code ?? LISTENER_REFUSE.INTERNAL })
        }
      })
      // **EOF WITHOUT A NEWLINE IS A NAMED REFUSAL, NOT A REQUEST.** The old loop answered on `'end'`, so a
      // truncated frame was handled as a complete one. One line in and one line out means a peer that closes
      // without its newline did not finish asking.
      socket.on('end', () => {
        if (replied) return
        finish({ ok: false, reason: LISTENER_REFUSE.INCOMPLETE_FRAME })
      })
      socket.on('error', () => { replied = true; clearTimeout(deadline) })
      socket.on('close', () => { releaseSlot(); clearTimeout(deadline) })
    })
    server.on('error', rejectPromise)
    // *** THE BACKLOG IS A DESCRIPTOR BUDGET TOO, AND IT WAS THE LARGEST UNBOUNDED ONE. ***
    // MEASURED: a 120-connection flood against a server with `MAX_OPEN_SOCKETS` of 8 AND of 64 produced THE
    // SAME 136-DESCRIPTOR PEAK, 122 above baseline. The counter could not see any of the difference, because
    // `openSockets` only counts sockets NODE HAS ACCEPTED — and `server.listen()` with NO BACKLOG argument
    // leaves the kernel queueing up to Node's default of 511 connections that the process OWNS AS DESCRIPTORS
    // and this module never sees. A CAP THE KERNEL'S QUEUE SITS OUTSIDE OF IS NOT A CAP.
    //
    // SIZED TO THE CAP, NOT ABOVE IT: the backlog is the room peers may occupy BEFORE this daemon decides
    // anything about them, so it is added to `MAX_OPEN_SOCKETS` rather than folded into it. The point is that
    // the total is now a NUMBER rather than however fast peers can connect.
    //
    // AND A FULL BACKLOG MAKES CONNECTS WAIT RATHER THAN FAIL, WHICH IS THE CORRECT BEHAVIOUR FOR A FLOOD:
    // a peer that cannot be served is queued at a known bound instead of being handed a descriptor.
    server.listen({ path: input.socketPath, backlog: limits.MAX_OPEN_SOCKETS }, () => resolvePromise(server))
  })
}
