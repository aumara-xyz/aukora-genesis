/**
 * IS AN OWNER DAEMON INSTALLED AND REACHABLE? — ONE SOURCE OF TRUTH, AND IT ASKS THE DAEMON.
 *
 * `ownerDaemonStatus()` is the ONLY function in this project that answers that question. A second one would
 * be a second definition of "installed", and the two would disagree on the day it mattered.
 *
 * IT DOES NOT ASK WHETHER A SOCKET EXISTS. A stale socket, a foreign process, and an unlinked path are
 * indistinguishable from outside; a socket file at the right path is evidence of nothing. The three things
 * it checks are:
 *
 *   1. THE CONFIG is at its install path and names the paths it must;
 *   2. SUBMIT.SOCK is present and connectable;
 *   3. **THE DAEMON ANSWERS A SIGNED HELLO** whose signature verifies, with `node:crypto`, against the
 *      public key RECORDED AT INSTALL — so a process that merely bound the path is not mistaken for the
 *      daemon, and the daemon itself is not mistaken for a stranger.
 *
 * WHAT IT DOES NOT PROVE, AND THE ANSWER IS PRINTED WITH THE STATUS: a verified hello proves the holder of
 * that key is answering on that socket. It does NOT prove the daemon is running as `aukora-owner`, that its
 * directories are private, or that anyone will approve anything — those are the mode checks at its own
 * startup and the owner's answer, and neither is visible from here.
 *
 * WHEN IT IS ABSENT THE APP KEEPS TODAY'S BEHAVIOUR, and says what that behaviour costs: `SAME_UID`, and
 * "approvals remain shell assertions".
 */
import { existsSync, readFileSync } from 'node:fs'
import { connect } from 'node:net'

/**
 * How long a hello stays usable, and how far into the future it may be dated.
 *
 * **A SIGNED ANSWER WITH NO WINDOW IS A SIGNED ANSWER FOREVER.** Ten minutes is long enough for a slow boot
 * and short enough that a recorded answer is useless by the time anyone finds it; the skew allowance is for
 * a clock that is slightly ahead, **not for a timestamp an answerer chose freely.**
 */
export const HELLO_FRESHNESS_MS = 10 * 60 * 1000

/** How far ahead of this process's clock a hello may be dated before it is refused. */
export const HELLO_SKEW_MS = 60 * 1000

/**
 * The age of a hello in milliseconds, or `null` when it cannot be dated.
 *
 * **EXTRACTED SO THE CHECK IS TESTABLE WITHOUT A DAEMON**, and so the court asserts the rule rather than the
 * shape of the function that applies it.
 *
 * @param {unknown} signedAt - the reply's own timestamp, in milliseconds.
 * @param {number} now - this process's clock.
 * @returns {number|null} the signed age, or null when `signedAt` is not a usable number.
 */
export function helloAgeMs(signedAt, now) {
  // ── IT PARSES THE SHAPE THE DAEMON ACTUALLY SENDS (AND MY FIRST VERSION DID NOT) ──────────────────
  //
  // **MEASURED, BY A COURT, IN THE MINUTE AFTER I WROTE IT: `owner-daemon.mjs:641` SENDS `signedAt` AS AN
  // ISO 8601 STRING** — `new Date().toISOString().replace(/\.\d{3}Z$/u, 'Z')` — and my first version did
  // `Number(signedAt)`, which is `NaN` for that shape. **Every live daemon would have been reported
  // `reachable: false`**, and the caller that asked "is the owner daemon here" would have been told there is
  // no daemon while one was answering correctly.
  //
  // **THE COURT'S OWN FIXTURE USES THE SAME ISO SHAPE**, so it went red immediately rather than after a
  // release — and that is the whole reason the fixture is built from the protocol instead of from a number I
  // chose. A liveness check that mis-parses its own protocol's timestamp is worse than no liveness check:
  // **it reports absence for a daemon that is present**, which is the answer an obstruction wants.
  if (typeof signedAt === 'number' && Number.isFinite(signedAt)) return now - signedAt
  if (typeof signedAt === 'string') {
    const parsed = Date.parse(signedAt)
    if (Number.isFinite(parsed)) return now - parsed
  }
  return null
}

import { verify as nodeVerify } from 'node:crypto'
/**
 * The most a reply may accumulate before it is refused.
 *
 * **A TIMEOUT BOUNDS DURATION, NOT MEMORY (CODEX R10, FINDING 6).** MEASURED: this accumulated
 * `received += chunk` until a newline arrived, with nothing bounding the total — so a peer that sent bytes
 * and never a newline **grew this process's heap for as long as the timeout allowed.** **A peer that can make
 * you allocate is a peer that can stop you**, and `received.indexOf` on an ever-growing string is a second
 * cost on the same input.
 *
 * It matches the frame ceiling the LISTENER already refuses at, so the two ends of one protocol agree on what
 * a frame may be; a client that accepted what its own server would refuse would be measuring neither.
 */
const MAX_REPLY_BYTES = 64 * 1024


/** Where the installer puts things. One place, so the app and the installer cannot disagree. */
export const OWNER_INSTALL = Object.freeze({
  config: '/usr/local/etc/aukora-owner.json',
  code: '/usr/local/libexec/aukora-owner',
  /** The daemon's PUBLIC KEY, recorded at install. The pin a hello is verified against. */
  pubkey: '/Library/Application Support/AUKORA-Owner/owner.pub',
  launchDaemon: '/Library/LaunchDaemons/com.aukora.owner.plist',
})

/** The refusal the app raises when a settle-class approval is attempted without a daemon. */
export const SETTLE_REQUIRES_OWNER_DAEMON = 'aukora:settle-requires-owner-daemon'

/** The ceiling printed when no daemon is installed. Verbatim, so a screen cannot improve it. */
export const ABSENT_CEILING = Object.freeze([
  'SAME_UID: this app and the agent run under one macOS account, so this is a procedure and not an isolation boundary.',
  'approvals remain shell assertions: the approval you are answering is a boolean this process produced, and it proves nothing about who was at the keyboard.',
])

/** One refusal, named. */
export function settleRequiresOwnerDaemon(what) {
  const error = new Error(`${SETTLE_REQUIRES_OWNER_DAEMON}: ${what} is a settle-class approval and an owner `
    + 'daemon is installed and reachable, so it MUST be submitted over submit.sock and answered by the owner '
    + '(console or phone). There is NO in-process fallback: a fallback would be the shell approving itself, '
    + 'which is the exact claim the daemon exists to retire')
  error.code = SETTLE_REQUIRES_OWNER_DAEMON
  return error
}

/**
 * WHERE THE AGENT READS THE DAEMON'S PUBLIC KEY — **A PLACE IT CAN READ AND CANNOT WRITE.**
 *
 * **INDEPENDENT REVIEW R5, AND THE DETECTOR WAS ALWAYS WRONG ON A REAL INSTALL.** This returned
 * `${config.ownerDir}/owner.pub`, and the owner directory is `0700` — so the app, running as the AGENT uid,
 * could not traverse into it. **The file's own mode did not matter; the directory was the wall.** Every check
 * in {@link ownerDaemonStatus} therefore answered `absent`, and the app settled in-process — **the exact claim
 * the daemon exists to retire.** The detector was not failing to detect; it was reading a room it has no key to.
 *
 * **THE RUN DIRECTORY IS ALREADY THE BOUNDARY BETWEEN THEM.** It is `0750`: the submit group TRAVERSES it and
 * may not write it (this daemon refuses a group-writable one outright), and `submit.sock` — the thing the agent
 * connects to — lives there. So the published key sits beside the socket the agent already reaches, in a
 * directory it can walk into and cannot alter, at mode `0640`.
 *
 * **NO FALLBACK TO THE OWNER DIRECTORY, DELIBERATELY.** A fallback would report `present` only where the agent
 * happens to be able to read a `0700` directory — the development host — and `absent` in production: **the same
 * bug wearing a green light.** The absence names the path it wanted, so an operator can tell a publish that did
 * not happen from a detection that cannot see.
 *
 * **FOR THE INSTALLER:** this path is DERIVED FROM THE CONFIG, so the config must be readable by the agent uid
 * (`OWNER_INSTALL.config`). The key's own name is the daemon's business; nothing in the installer needs it.
 *
 * @param {{runDir?: string}} [config]
 * @returns {string}
 */
export function pubkeyPathFor(config) {
  if (typeof config?.runDir !== 'string' || config.runDir.length === 0) return OWNER_INSTALL.pubkey
  return `${config.runDir}/owner.pub`
}

/**
 * The status of the owner daemon on this machine.
 *
 * @param {{configPath?: string, timeoutMs?: number, connect?: Function}} [options]
 * @returns {Promise<Readonly<{installed: boolean, reachable: boolean, reason: string|null, pubkeyHex: string|null,
 *   ceiling: readonly string[]}>>}
 */
export async function ownerDaemonStatus(options = {}) {
  const configPath = options.configPath ?? OWNER_INSTALL.config
  // **THE FILESYSTEM IS INJECTABLE SO A COURT CAN MAKE A FILE VANISH BETWEEN TWO CALLS (CODEX R6 SEAM 3).**
  // `askDaemon` already takes `options` for its own seam; these are the same idea for the reads below.
  const exists = options.existsSync ?? existsSync
  const read = options.readFileSync ?? readFileSync
  const absent = reason => Object.freeze({
    installed: false, reachable: false, state: 'absent', reason, pubkeyHex: null, ceiling: ABSENT_CEILING,
  })
  /**
   * *** AN INSTALLATION THAT IS THERE AND DID NOT ANSWER IS NOT AN INSTALLATION THAT IS NOT THERE. ***
   *
   * EVERY failure below this line used to return `absent(...)`, INCLUDING "the socket is present and nothing
   * answered the hello" and "something answered with the wrong key". So a config on disk with a daemon that
   * could not be reached reported `installed: false`, THE SHELL READ THAT AS "NO DAEMON HERE" AND SETTLED
   * IN-PROCESS — which is the one thing the owner daemon exists to prevent.
   *
   * AND AN AGENT CAN CAUSE IT: fill the submit connections, or stop the socket, and the hello fails; the
   * caller then gets the OLD SAME-UID IN-PROCESS SETTLEMENT BACK. The obstruction does not have to forge
   * anything — IT ONLY HAS TO MAKE THE DAEMON LOOK ABSENT, WHICH IS WHY "UNREACHABLE" HAS TO BE A STATE OF ITS
   * OWN RATHER THAN A FLAVOUR OF ABSENCE.
   *
   * `installed` STAYS TRUE HERE ON PURPOSE: the installation IS there, and every reader that asks "is this
   * machine an owner-daemon machine" must keep getting yes. The refusal lives in `reachable` plus this state.
   */
  const unreachable = reason => Object.freeze({
    installed: true, reachable: false, state: 'unreachable', reason, pubkeyHex: null, ceiling: ABSENT_CEILING,
  })
  if (!exists(configPath)) return absent(`no config at ${configPath}`)
  let config
  try {
    config = JSON.parse(readFileSync(configPath, 'utf8'))
  } catch (cause) {
    return unreachable(`the config at ${configPath} is present and is not readable JSON: ${String(cause?.message ?? cause)}`)
  }
  if (typeof config?.submitSocket !== 'string' || !exists(config.submitSocket)) {
    return unreachable(`the config names ${String(config?.submitSocket)} and no socket is there`)
  }
  const pubkeyPath = pubkeyPathFor(config)
  if (!exists(pubkeyPath)) {
    return unreachable(`no public key published at ${pubkeyPath}: the daemon publishes it beside the socket it `
      + 'answers on, in a directory the submit group traverses and cannot write. A socket without the key it '
      + 'should answer with is not a daemon this app can trust')
  }
  // ── THE READ IS GUARDED, BECAUSE A FILE THAT EXISTED IS NOT A FILE THAT READS ────────────────────
  //
  // **MEASURED SHAPE: THE EXISTENCE CHECK RETURNED TRUE AND THE READ ON THE NEXT LINE THREW.** The file can be
  // removed between the two calls — by a reinstall, by an operator, by anything — and the throw leaves this
  // function entirely. **It does not return a wrong answer; it returns NO answer**, and every caller that asked
  // "is there an owner daemon here" gets an exception where the contract promises a status.
  //
  // **AND HOW A CALLER HANDLES THAT THROW IS THE SEAM THAT MATTERS** (r7 residual 1): the shell's catch renames
  // a `TypeError` to `CEREMONY_ABSENT` — *"no ceremony here"* — when the truth is *"the installation is there
  // and could not be read"*. **`installed: true, reachable: false` WITH A NAMED REASON is the answer this
  // function already has for exactly this situation; it simply never got the chance to give it.**
  // A check-then-read is a question followed by a different question.
  let pinned
  try {
    pinned = read(pubkeyPath, 'utf8').trim()
  } catch (cause) {
    return unreachable(`the public key at ${pubkeyPath} could not be read: ${String(cause?.code ?? cause)}. `
      + 'The file was present a moment ago and is not readable now, so this is an installation that is THERE '
      + 'and cannot be reached — never an absent one')
  }
  if (!/^[0-9a-f]{64}$/u.test(pinned)) return unreachable(`the recorded public key at ${pubkeyPath} is malformed`)
  // ── A FRESH CHALLENGE, SO THE REPLY IS BOUND TO *THIS* QUESTION (CODEX R11, FINDING 3) ──────────────
  //
  // **MEASURED: THE REQUEST WAS `{ op: 'hello' }` AND THE SIGNATURE BOUND ONLY THE KEY AND A TIMESTAMP.** A
  // reply is therefore valid for ANY asker inside the ten-minute window, and **a recorded hello replays as a
  // live daemon.** Proving that the key holder *answered at some point recently* is not the same claim as
  // proving it *answers on this socket now*, and only the second is worth anything to a caller about to settle.
  //
  // **A CHALLENGE MAKES THE REPLY ANSWER A QUESTION NOBODY CAN RE-ASK.** The daemon signs it together with the
  // key and the time, and a reply carrying any other challenge is refused by name below.
  const challenge = (await import('node:crypto')).randomBytes(32).toString('hex')
  const reply = await askDaemon(config.submitSocket, { op: 'hello', challenge }, options)
  if (reply === null) return unreachable('the socket is present and nothing answered the hello')
  if (reply.ok !== true || reply.pubkeyHex !== pinned) {
    return unreachable(`something answered on ${config.submitSocket} and its key is ${String(reply.pubkeyHex)}`
      + `, not the one recorded at install (${pinned.slice(0, 16)}…)`)
  }
  // ── AND THE REPLY MUST ANSWER *OUR* QUESTION (CODEX R11, FINDING 3) ────────────────────────────────
  //
  // **A DAEMON THAT DOES NOT ECHO THE CHALLENGE IS REFUSED BY NAME — NEVER SILENTLY ACCEPTED.** Two cases
  // arrive here and both must fail: a **recorded** reply produced for an earlier challenge, and a reply from a
  // daemon still speaking v1, which carries no challenge at all. **Accepting either would leave the replay hole
  // open while this client believed it was closed**, which is worse than not having tried.
  if (reply.challenge !== challenge) {
    return unreachable(`the reply carries challenge ${String(reply.challenge)} and this client asked `
      + `${challenge.slice(0, 16)}…, so it is an answer to ANOTHER question — a recorded hello replayed, or a `
      + 'daemon that has not been updated. Either way it does not prove the key holder is answering NOW')
  }
  // THE SIGNATURE IS THE POINT: a process that bound the path cannot answer it without the private half.
  // **v2 BINDS THE CHALLENGE**, so the signature is over this question and cannot be lifted onto another.
  const preimage = `aukora-owner-hello:v2\n${pinned}\n${challenge}\n${String(reply.signedAt)}`
  let verified = false
  try {
    const spki = Buffer.concat([Buffer.from('302a300506032b6570032100', 'hex'), Buffer.from(pinned, 'hex')])
    const { createPublicKey } = await import('node:crypto')
    verified = nodeVerify(null, Buffer.from(preimage, 'utf8'),
      createPublicKey({ key: spki, format: 'der', type: 'spki' }), Buffer.from(String(reply.signatureHex), 'hex'))
  } catch { verified = false }
  // AND A HELLO THAT DOES NOT VERIFY IS UNREACHABLE, NOT ABSENT. Something answered and it is not the
  // daemon this install recorded — WHICH IS THE CASE AN OBSTRUCTION WANTS, because a forged or broken
  // answer that reads as "no daemon here" hands the caller the in-process path.
  if (!verified) return unreachable('the hello did not verify against the key recorded at install')
  // ── AND THE SIGNATURE MUST BE RECENT, OR IT PROVES NOTHING ABOUT NOW (CODEX R10, FINDING 5) ────────
  //
  // **MEASURED: THE PREIMAGE IS `aukora-owner-hello:v1\n<pinned>\n<signedAt>`, AND `signedAt` COMES FROM THE
  // REPLY** — so the signature covers a timestamp the ANSWERER chose, and **nothing checked it against the
  // clock.** A hello signed once, at any point in the past, verifies forever: **a recorded answer replays as
  // a live daemon**, and the status this function returns says `reachable: true, state: 'reachable'`.
  //
  // **THE SOCKET BEING PRESENT IS NOT LIVENESS EITHER** — a stale socket file is exactly what an uninstalled
  // or crashed daemon leaves behind, and an obstruction that can serve one old answer gets the caller to
  // believe the daemon is there. **A SIGNATURE PROVES WHO SPOKE, NOT WHEN.**
  const age = helloAgeMs(reply.signedAt, options.now ?? Date.now())
  if (age === null) {
    return unreachable(`the hello carried no usable \`signedAt\` (${JSON.stringify(reply.signedAt)}), so it `
      + 'cannot be dated and may be a recorded answer replayed as a live one')
  }
  if (age > HELLO_FRESHNESS_MS || age < -HELLO_SKEW_MS) {
    return unreachable(`the hello was signed ${String(Math.round(age / 1000))}s from now, outside the `
      + `${String(HELLO_FRESHNESS_MS / 1000)}s freshness window, so it is a recorded answer rather than a `
      + 'live daemon. A signature proves who spoke, not when')
  }
  return Object.freeze({
    installed: true, reachable: true, state: 'reachable', reason: null, pubkeyHex: pinned,
    // THE SOCKET TRAVELS WITH THE STATUS, because a caller that only learns "present" cannot submit. One
    // verification, one answer, and the caller never has to re-read the config to find out where to write.
    submitSocket: config.submitSocket,
    signedAt: reply.signedAt,
    ceiling: HELLO_CEILING,
  })
}

/**
 * WHAT A VERIFIED HELLO ESTABLISHES — AND THE ONE THING IT DOES NOT (CODEX R11, FINDING 3).
 *
 * **IT USED TO SAY:** *"A verified hello proves the holder of that key answers on that socket."*
 *
 * **MEASURED, AND CODEX IS RIGHT: IT DOES NOT.** The hello carries **no challenge** (`:217`) and the signature
 * binds only the key and a timestamp (`:224`), so a reply **recorded within the last
 * `HELLO_FRESHNESS_MS` replays as a live daemon.** What is proved is that the key holder produced *this reply*
 * at some point inside that window — **not that it answers now, and not that the process on the other end is
 * the one that signed it.**
 *
 * **THE CLAIM WAS STRONGER THAN THE HELLO, WHICH IS THE DEFECT THIS LANE EXISTS TO REMOVE.** So it now names the
 * window it cannot see past, and a reader knows exactly how exposed they are.
 *
 * **AND THIS DOES NOT PRETEND TO CLOSE THE REPLAY HOLE — IT NAMES IT.** The protocol fix is a challenge in the
 * request and a signature over it: **a change to what is signed on the wire, on both sides**, which is a
 * compatibility decision that is not a lane's to make alone. It is recorded as still open, and this constant is
 * the honest description of the code as it stands rather than of the code we would like.
 */
export const HELLO_CEILING = Object.freeze([
  'OWNER DAEMON: present and reachable, and its hello verified against the key recorded at install.',
  'A verified hello proves the holder of that key answered THIS CLIENT\'S OWN CHALLENGE within the last 10 '
  + 'minutes. The challenge is fresh and random for every hello and the signature covers it, so a reply '
  + 'RECORDED from an earlier hello is refused by name: it answers a question nobody is asking any more. That '
  + 'is what makes this current possession rather than a memory of possession.',
  'It also does NOT prove the daemon is running as aukora-owner, that its directories are private, or that '
  + 'anyone will approve anything.',
])

/** One request over one socket, or null when nothing answered. */
function askDaemon(socketPath, request, options) {
  const connectFn = options.connect ?? connect
  const timeoutMs = options.timeoutMs ?? 2000
  return new Promise(resolvePromise => {
    let received = ''
    let settled = false
    const socket = connectFn(socketPath)
    const finish = value => { if (!settled) { settled = true; socket.destroy(); resolvePromise(value) } }
    socket.on('connect', () => socket.write(`${JSON.stringify(request)}\n`))
    socket.on('data', chunk => {
      received += chunk.toString('utf8')
      // ── AND THE ACCUMULATION IS BOUNDED (CODEX R10, FINDING 6) ───────────────────────────────────
      //
      // **MEASURED: THIS APPENDED UNTIL A NEWLINE ARRIVED, WITH NO CEILING AND NO NEWLINE EVER REQUIRED.**
      // The timeout bounded how LONG a peer could do it, not how MUCH it could make this process hold — so a
      // peer that sent bytes and no newline grew the heap for the whole timeout window. **A peer that can
      // make you allocate is a peer that can stop you.**
      if (received.length > MAX_REPLY_BYTES) {
        // **TERMINATE THROUGH `finish`, WHICH EXISTS (CODEX R11, FINDING 1).**
        //
        // MEASURED: this called `fail`, which `askDaemon` NEVER DEFINES — so the overflow threw a
        // `ReferenceError` from inside a socket `data` handler, where no caller's `try/catch` can reach it, and
        // **killed the process that asked "is there an owner daemon here?"**. A peer that sends bytes and no
        // newline does not get a refusal; it gets to stop you — which is the exact opposite of what the comment
        // above this guard promises.
        //
        // **`finish(null)` RESOLVES THE PROMISE, SO THE CALLER'S EXISTING NULL PATH NAMES IT:** *"the socket is
        // present and nothing answered the hello"*, reported as `unreachable`. **The answer is a status with a
        // reason, which is what `ownerDaemonStatus` promises, rather than an exception it never promised.**
        finish(null)
        return
      }
      const newline = received.indexOf('\n')
      if (newline === -1) return
      try { finish(JSON.parse(received.slice(0, newline))) } catch { finish(null) }
    })
    socket.on('error', () => finish(null))
    setTimeout(() => finish(null), timeoutMs)
  })
}
