/**
 * **PETER'S FIRST REAL APPROVAL — the preflight, and the record he is asked to approve.**
 *
 * Plan Phase 0 step 4. The old live test asked the owner to approve a *disposable note*: harmless, and it proved
 * the window works. **IT PROVED NOTHING ABOUT THE PARADIGM.** The thing Peter needs to approve once, for real, is
 * an actual `aukora:repo-advance:v1` record for a move he has already decided on — **and the script must be able
 * to say, before he clicks, that every part of the chain in front of him is the part that was measured.**
 *
 * ── **THE PREFLIGHT REFUSES, AND IT CHECKS ONE THING PER ROW** ────────────────────────────────────────────
 *
 * Three facts have to be true before a real click is worth asking for, and each is its own row so a failure names
 * itself:
 *
 *   * **THE SIGNER ANSWERS** — `serving: true` from the live status, not merely a socket FILE. *A socket file with
 *     nothing behind it is the two-day outage this lane already fixed once; a test that reported against it would
 *     be reporting on a ghost.*
 *   * **THE SHELL CARRIES THE WINDOW FIXES** — a version or tree-sha check against the running app. *A window that
 *     renders the wrong sentence is worse than no window, because the owner reads it and believes it.*
 *   * **THE PIN QUESTION IS SURFACED, NEVER SETTLED** — `docs/owner-pin.json` names a FIXTURE `did:key`, so the
 *     key that would verify a real approval is not in it. **THIS ROW IS ALWAYS A WARNING, NEVER A PASS**, and the
 *     script proposes the REAL pin as a SEPARATE ROTATION RECORD for Peter to approve. *A script that quietly
 *     replaced the pin with a key it had just generated would be a script that made itself the owner.*
 *
 * ── **WHAT THIS MODULE DOES NOT DO** ─────────────────────────────────────────────────────────────────────
 *
 * It does not read the seed, does not sign, and does not answer the window. **IT READS ONE PUBLIC FILE AND
 * COMPARES STRINGS.** Everything that could act lives in the caller, and the caller is a script whose only output
 * is a printed checklist and a printed command.
 */
import { readFileSync } from 'node:fs'
import { buildRepoAdvance, REPO_ADVANCE_KIND } from './repo-advance.mjs'
// **THE PIN'S PATH, RESTATED HERE BECAUSE THE BOUNDARY FORBIDS THE IMPORT.** It is
// `scripts/aukora/advance-main.mjs` that CONSUMES the pin, and this module is in `plugins/`, which may not
// import from `scripts/`; `tests/aukora-aumlok.test.mjs` enforces that. *A path is a weaker thing to restate
// than a format*, and the court that reads the real pin asserts this string equals the verifier's own.
export const OWNER_PIN_PATH = 'docs/owner-pin.json' 

export { REPO_ADVANCE_KIND }

/** The three rows, by name. */
export const PREFLIGHT_ROWS = Object.freeze(['signer-answers', 'shell-carries-the-fixes', 'pin-is-a-fixture'])

/** One row's verdict. `warn` is not `ok` and never becomes `ok`. */
export const ROW_STATE = Object.freeze({ OK: 'ok', REFUSED: 'refused', WARN: 'warn' })

const row = (name, state, detail) => Object.freeze({ name, state, detail })

/**
 * **ROW 1 — THE SIGNER ANSWERS, AND `serving` IS THE WORD THAT MATTERS.**
 *
 * `probe` is `{socketPath, exists, connected, status}` supplied by the caller, so this module never opens a socket
 * and a court can drive it without one. **A SOCKET FILE IS NOT A SIGNER:** `exists` true with `connected` false
 * is the stale-socket case, and it is refused by name rather than reported as a pass.
 */
export function checkSignerAnswers(probe) {
  if (probe === null || typeof probe !== 'object') {
    return row('signer-answers', ROW_STATE.REFUSED, 'no probe was made, so nothing is known about the signer')
  }
  if (probe.exists !== true) {
    return row('signer-answers', ROW_STATE.REFUSED, `no signer socket at ${String(probe.socketPath)}`)
  }
  if (probe.connected !== true) {
    return row('signer-answers', ROW_STATE.REFUSED,
      `the socket at ${String(probe.socketPath)} is a FILE with nothing listening behind it — a stale socket is `
      + 'not a signer, and the app must be started')
  }
  const status = probe.status
  if (status === null || typeof status !== 'object') {
    return row('signer-answers', ROW_STATE.REFUSED, 'the signer answered the socket but not a status request')
  }
  // **`serving` IS THE SIGNER'S OWN WORD FOR "I AM THE THING YOU SHOULD ASK".** Anything else — including a
  // status that omits the field — is refused rather than read as consent by omission.
  if (status.serving !== true) {
    return row('signer-answers', ROW_STATE.REFUSED,
      `the signer reports serving=${JSON.stringify(status.serving)}${status.reason === undefined ? '' : ` (${String(status.reason)})`}`
      + `${Array.isArray(status.missing) && status.missing.length > 0 ? `; missing ${status.missing.join(', ')}` : ''}`)
  }
  return row('signer-answers', ROW_STATE.OK, `serving=true on ${String(probe.socketPath)}`)
}

/**
 * **ROW 2 — THE SHELL CARRIES THE APPROVAL-WINDOW FIXES.**
 *
 * A running app older than the fixes renders an approval window whose sentence is wrong or whose decision never
 * lands. The caller supplies what the running shell reports and what the checkout expects; **AN UNKNOWN VERSION IS
 * REFUSED, NOT ASSUMED FINE** — *an unmeasurable shell is not a fixed one.*
 */
export function checkShellCarriesTheFixes(input) {
  const running = input?.runningVersion
  const expected = input?.expectedVersion
  if (typeof expected !== 'string' || expected === '') {
    return row('shell-carries-the-fixes', ROW_STATE.REFUSED,
      'the checkout does not name the version it expects, so there is nothing to compare the running shell against')
  }
  if (typeof running !== 'string' || running === '') {
    return row('shell-carries-the-fixes', ROW_STATE.REFUSED,
      `the running shell did not report a version, so whether it carries the window fixes is unknown — an `
      + 'unmeasurable shell is not a fixed one')
  }
  if (running !== expected) {
    return row('shell-carries-the-fixes', ROW_STATE.REFUSED,
      `the running shell is ${running} and this checkout expects ${expected}; restart the app before a real click`)
  }
  return row('shell-carries-the-fixes', ROW_STATE.OK, `the running shell is ${running}`)
}

/** True when a `did:key` is one of the fixtures this lane has used in courts, rather than a real owner key. */
const FIXTURE_KEYS = new Set([
  'did:key:z6Mkf5rGMoatrSj1f4CyvuHBeXJELe9RPdzo2PKGNCKVtZxP',
  'did:key:z6MkewTyteyzJRQH6GgyuD5Sb84uxym4b4XBwuvNMJmdfXWT',
])

/**
 * **ROW 3 — THE PIN QUESTION, SURFACED AND NEVER SETTLED.**
 *
 * It returns `warn` when the pin names a fixture key, and **`warn` is never `ok`**: the morning run must PROPOSE
 * the real pin as a separate rotation record, and *a script that silently replaced the pin would be a script that
 * made itself the owner.*
 */
export function checkPinIsNotAFixture(pinText) {
  let pin = null
  try { pin = JSON.parse(pinText) } catch {
    return row('pin-is-a-fixture', ROW_STATE.REFUSED, `${OWNER_PIN_PATH} is not JSON, so it names no keys at all`)
  }
  const keys = Array.isArray(pin?.approvalKeys) ? pin.approvalKeys : []
  const fixtures = keys.filter(key => FIXTURE_KEYS.has(key))
  if (fixtures.length > 0) {
    return row('pin-is-a-fixture', ROW_STATE.WARN,
      `${OWNER_PIN_PATH} names ${String(fixtures.length)} FIXTURE key(s) and no real owner key, so a real approval `
      + 'cannot verify against it: the morning run must PROPOSE the real pin as a separate rotation record for the '
      + 'owner to approve — it must never replace the pin itself')
  }
  return row('pin-is-a-fixture', ROW_STATE.OK, `${OWNER_PIN_PATH} names no fixture key`)
}

/** The whole checklist, in order. **A REFUSED ROW ANYWHERE IS A REFUSAL TO PROCEED.** */
export function preflight(input) {
  const rows = Object.freeze([
    checkSignerAnswers(input?.probe),
    checkShellCarriesTheFixes(input?.shell),
    checkPinIsNotAFixture(input?.pinText ?? ''),
  ])
  return Object.freeze({
    rows,
    // **`warn` DOES NOT BLOCK, AND THAT IS DELIBERATE:** the pin being a fixture is a fact about TOMORROW's
    // rotation, not a reason Peter cannot approve an advance today. It is displayed, and the script says what to
    // do about it. Everything else must be `ok`.
    ok: rows.every(entry => entry.state !== ROW_STATE.REFUSED),
    warned: rows.filter(entry => entry.state === ROW_STATE.WARN).length,
  })
}

/**
 * **THE RECORD PETER IS ASKED TO APPROVE — A REAL ADVANCE, DRY RUN.**
 *
 * `from` is the current remote main and `to` is the head of the branch under review. **THE RECORD IS BUILT BY THE
 * SHIPPED BUILDER**, so what the window shows is what the verifier will read; a record assembled here would be a
 * second implementation of the format.
 */
export function buildMorningRecord(input) {
  return buildRepoAdvance({
    repo: input.repo,
    from: input.from,
    to: input.to,
    tree: input.tree,
    commitCount: input.commitCount,
    headlines: input.headlines,
    courtsRunId: input.courtsRunId,
    stampDigest: input.stampDigest,
    gateChanges: input.gateChanges ?? [],
  })
}

// ══ **THE FOUR STEPS AFTER PETER CLICKS** ═════════════════════════════════════════════════════════════════

/** Every refusal the steps raise, by name. */
export const MORNING_REFUSE = Object.freeze({
  KEY_NOT_IN_PIN: 'morning:key-not-in-pin',
  RECEIPT_REFUSED: 'morning:receipt-refused',
  ADVANCE_REFUSED: 'morning:advance-refused',
  WITNESS_REFUSED: 'morning:witness-refused',
  LOG_UNREADABLE: 'morning:event-log-unreadable',
})

const refuse = (code, detail) => Object.assign(new Error(detail), { code })

/**
 * **(a) VERIFY THE RECEIPT THROUGH THE SHIPPED VERIFIER, AGAINST THE KEY THE PIN NAMES.**
 *
 * **READ-ONLY AND NEVER THE SEED.** The caller supplies the verifier and the pin's keys; this function reads no
 * file, opens no socket and holds no key material. *The one thing this must never do is sign.*
 *
 * **THE KEY MUST BE IN THE PIN BEFORE THE SIGNATURE IS CHECKED**, in that order, because "signed by a key this
 * installation accepts" is a question about the TRUST ANCHOR and the signature is a question about the bytes.
 * A receipt whose key has no standing is refused for that reason, not for a cryptographic one.
 */
export function verifyReceiptAgainstPin(input) {
  const { verifier, receipt, record, subject, now, pinKeys } = input
  const signedBy = receipt?.approvalKeyDid
  if (typeof signedBy !== 'string' || signedBy === '') {
    throw refuse(MORNING_REFUSE.KEY_NOT_IN_PIN,
      'the receipt does not name the key that signed it, so it cannot be shown to have standing')
  }
  if (!Array.isArray(pinKeys) || !pinKeys.includes(signedBy)) {
    throw refuse(MORNING_REFUSE.KEY_NOT_IN_PIN,
      `this approval was signed by ${signedBy} and the pin names ${String(pinKeys?.length ?? 0)} key(s), none of `
      + 'them this one — a real approval cannot verify against a pin that does not hold the key')
  }
  try {
    return verifier.verifyApproval(receipt, {
      subject, memoryPut: { key: record.kind, value: record }, now, approverDid: signedBy,
    })
  } catch (error) {
    throw refuse(MORNING_REFUSE.RECEIPT_REFUSED, `${String(error?.code ?? 'refused')}: ${String(error?.message ?? error)}`)
  }
}

/**
 * **(b) THE DRY RUN — SIX CHECKS, AND A PRINTED COMMAND THAT IS NEVER RUN.**
 *
 * A thin pass-through to the shipped verifier, and the thinness is the point: **this function exists so the step
 * has a name in the evidence, not so it can have an opinion.** `executed: false` is asserted here rather than
 * trusted, because *a dry run whose caller is not told it was dry is a dry run one refactor away from a real one.*
 */
export function dryRunAdvance(input) {
  const verdict = input.verifyAdvance(input.request)
  // **A REFUSED VERDICT HAS NO EXECUTION TO REPORT, AND MY FIRST GUARD CONFUSED THE TWO.** It read
  // `verdict.executed !== false`, so a verdict that was simply `ok: false` — with no `executed` field at all —
  // threw `advance-refused`, and the REAL refusal was replaced by my own guard's message. *A guard that fires on
  // the absence of a field it only expects on success hides the failure it was meant to report.*
  if (verdict.ok === true && verdict.executed !== false) {
    throw refuse(MORNING_REFUSE.ADVANCE_REFUSED,
      'the verifier reported an execution, and a dry run must execute nothing')
  }
  return verdict
}

/**
 * **(c) APPEND THE RECEIPT TO THE CONSUMPTION WITNESS, SO A SECOND RUN IS REFUSED.**
 *
 * Through the shipped helper, so the consumption is recorded OUTSIDE the daemon's own state and survives a restore
 * of it. **THE FIRST RUN CONSUMES; THE SECOND IS REFUSED BY THE WITNESS** — which is what makes the morning run a
 * one-use authorisation rather than a script Peter can run twice and get two effects from.
 */
export function consumeThroughWitness(input) {
  try {
    return input.recordConsumptionBeforeEffect({
      journal: input.journal, witness: input.witness, nonce: input.challenge,
      localConsumed: input.localConsumed ?? [],
      witnessRecordedState: input.witnessRecordedState,
    })
  } catch (error) {
    // **A REUSED CHALLENGE AND A ROLLED-BACK STATE ARE DIFFERENT ANSWERS AND BOTH ARE REFUSALS.** They are passed
    // through with their own codes rather than flattened, because they tell the reader different things.
    throw refuse(String(error?.code ?? MORNING_REFUSE.WITNESS_REFUSED), String(error?.message ?? error))
  }
}

/**
 * **(d) THE EVIDENCE THE APPROVAL-EVENT LOG RECORDED — AND NO MESSAGE TEXT.**
 *
 * The log lines are JSON. **WHAT IS PRINTED IS THE FIELDS THAT PROVE THE CHAIN: the digests, how long the window
 * was open, and the decision.** What is NOT printed is the message text — *the evidence a person needs is that a
 * decision was made about a named operation, and reproducing the sentence turns a log into a transcript of what
 * the owner was shown, which is not what the audit needs and is not what this prints.*
 *
 * Only events newer than `eventsBefore` are returned, so the report is about THIS run rather than the whole
 * history — the same anchor discipline the old script used.
 */
export function readApprovalEvidence(logText, options = {}) {
  const since = options.eventsBefore ?? 0
  const lines = String(logText ?? '').split('\n').filter(line => line.trim() !== '')
  if (lines.length < since) {
    throw refuse(MORNING_REFUSE.LOG_UNREADABLE,
      `the log holds ${String(lines.length)} line(s) and the anchor said ${String(since)} were already there, so `
      + 'the log was truncated or replaced during the run')
  }
  const events = []
  for (const line of lines.slice(since)) {
    let parsed = null
    try { parsed = JSON.parse(line) } catch {
      // **A LINE THAT WILL NOT PARSE IS REPORTED AS UNREADABLE EVIDENCE, NOT SKIPPED.** *Silently dropping an
      // event is how a run with no decision comes to look like a run with a decision.*
      events.push(Object.freeze({ unreadable: true }))
      continue
    }
    events.push(Object.freeze({
      at: parsed.at ?? parsed.timestamp ?? null,
      event: parsed.event ?? parsed.kind ?? null,
      decision: parsed.decision ?? parsed.verdict ?? null,
      // THE DIGESTS, WHICH ARE THE POINT.
      operationDigest: parsed.operationDigest ?? null,
      challenge: parsed.challenge ?? null,
      approvalKeyDid: parsed.approvalKeyDid ?? parsed.approverDid ?? null,
      // **THE DWELL: how long the window was in front of the person.** Reported, and never interpreted.
      dwellMs: typeof parsed.dwellMs === 'number' ? parsed.dwellMs : null,
      // **AND NO MESSAGE TEXT.** The field is deliberately absent rather than filtered out later; a projection
      // that listed every field and then removed one is a projection that leaks the day somebody adds a field.
      wokenAt: parsed.wokenAt ?? null,
    }))
  }
  return Object.freeze(events)
}
