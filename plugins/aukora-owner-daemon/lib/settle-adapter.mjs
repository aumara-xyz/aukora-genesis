/**
 * THE JOIN: ONE OWNER APPROVAL ON approve.sock BECOMES EXACTLY ONE KIRA MEMORY WRITE.
 *
 * This is the halved design closed. Aumlok's daemon freezes the submitted bytes and consumes the owner's
 * bound approval; KIRA owns the settlement write path. The adapter is the only place the two meet, it lives
 * in the daemon package, and it calls KIRA's exported `settleAuthorized` — so the daemon does not
 * re-implement a single line of the settle, and KIRA's journals, receipts, per-record decisions and
 * consumption markers are all written by the same code that wrote them before the cut.
 *
 * THE BYTES ARE THE DAEMON'S OWN FROZEN COPY, never a re-read from the submitter: `proposal.bytes` was
 * frozen on the way in (`freezeProposal`), which is the whole point of the freeze. What the owner approved
 * is what is settled.
 *
 * THIS ADAPTER REFUSES ANY STORE THAT IS NOT OWNER-OWNED. `settleAuthority().mode` must be OWNER_DAEMON, so
 * the daemon cannot be used to write a same-uid store through the privileged socket — a store the agent can
 * write does not need the daemon, and running it through one would make SAME_UID look like isolation.
 */
import { assertNoDuplicateKeys } from '../../aukora-kira/lib/strict-read.mjs'

import { createMemoryOwner } from '../../aukora-kira/lib/memory-owner.mjs'
import { ownerRefusal } from './binding.mjs'
import { assertScopeInStore } from './dispatch.mjs'
import { SCOPE_KINDS } from './operations.mjs'

/**
 * Settle one frozen proposal into the owner-owned KIRA store.
 *
 * @param {Readonly<{bytes: Buffer, digest: string, nonce: string, operation: string, scope: string}>} proposal
 * @param {Readonly<{storeDir: string, queueDir: string, subject?: string, approverDid?: string, activeControlDigest?: string}>} store
 * @returns {Readonly<{receipt: unknown, authority: string, digest: string}>}
 */
export function settleAuthorisedProposal(proposal, store) {
  if (proposal === null || typeof proposal !== 'object' || !Buffer.isBuffer(proposal.bytes)) {
    throw ownerRefusal('SETTLE_ADAPTER_MALFORMED', 'the adapter settles a frozen proposal, and this is not one')
  }
  // ── THE FROZEN BYTES ARE SCANNED BEFORE THEY ARE PARSED (AUMLOK-92 ITEM 2) ───────────────────────
  //
  // **MEASURED, KIMI AUKORA-37 VULNERABILITY 2: `JSON.parse` KEEPS THE LAST DUPLICATE KEY SILENTLY.** A
  // settle command carrying `authorization` twice means two things at once — a screen reading the first shows
  // operation A, and this function reads `command.authorization` and settles B. **Both readers are correct
  // about the bytes; the bytes are the defect.** The answer is not to choose which parse wins but to refuse
  // the document, because a duplicate key is not a document with two values.
  //
  // **AND IT IS SCANNED FIRST, BEFORE THE PARSE AND BEFORE THE STORE.** The refusal has to be about the
  // MEANING of the bytes rather than about anything downstream, or an operator chasing a store error would
  // never learn that the document was ambiguous.
  const text = proposal.bytes.toString('utf8')
  try {
    assertNoDuplicateKeys(text, 'the frozen settle command')
  } catch (error) {
    throw ownerRefusal('SETTLE_ADAPTER_AMBIGUOUS',
      `the frozen command repeats a key, so it means more than one thing: ${String(error?.message ?? error)}`)
  }
  let command = null
  try { command = JSON.parse(text) } catch {
    throw ownerRefusal('SETTLE_ADAPTER_MALFORMED', 'the frozen bytes are not a JSON settle command')
  }
  if (command === null || typeof command !== 'object' || typeof command.authorization !== 'object') {
    throw ownerRefusal('SETTLE_ADAPTER_MALFORMED', 'the frozen command carries no Kira authorization')
  }
  const owner = createMemoryOwner({ stateDir: store.storeDir, queueDir: store.queueDir })
  const authority = owner.settleAuthority()
  if (authority.mode !== 'OWNER_DAEMON') {
    throw ownerRefusal('SETTLE_ADAPTER_NOT_OWNER_DAEMON',
      `the daemon settles only a store it owns; this one reports ${authority.mode} `
      + `(store uid ${String(authority.storeUid)}, process uid ${String(authority.euid)})`)
  }
  // ── THE SCOPE IS CHECKED **LAST**, AND THE ORDER IS THE POINT ─────────────────────────────────────
  //
  // **CODEX P1 #2: the adapter ignored the proposal's operation and scope entirely**, so a proposal the person
  // read as being about one thing could be settled against a store that had nothing to do with it.
  //
  // **AND IT GOES LAST BECAUSE A CHECK PLACED EARLY MASKS THE CHECKS BEHIND IT.** MEASURED: with this check
  // first, the join court's `a-store-that-is-not-owner-marked` arm — which removes the mode check and expects
  // the next refusal to be about the malformed command — reported `scope-not-this-store` instead, so an arm
  // about the owner marker was answering a different question.
  //
  // The order is: is this a proposal → is it a Kira command → **does this process own the store** → does the
  // scope name that store. Each refusal is the most specific true thing about the request.
  // **CODEX r3: THE SCOPE CHECK WAS SELF-REFERENTIAL.** It compared the scope's target to the PROPOSAL'S OWN
  // `ledgerId` — this line, with dispatch.mjs:62-74 comparing `parsed.target !== String(expectedTarget)` — so a
  // self-consistent proposal passed against ANY store the daemon was configured with, and the person's
  // approval could land in a ledger they never read. THE EXPECTED TARGET IS THE CONFIGURED LEDGER NOW, and the
  // proposal must agree with it. (The daemon pre-checks the same thing; this is the writer's own gate, because
  // the adapter is the module that actually settles.)
  const configuredLedger = typeof store.ledgerId === 'string' ? store.ledgerId.trim() : ''
  if (configuredLedger === '') {
    throw ownerRefusal('SETTLE_STORE_LEDGER_UNDECLARED',
      `this daemon is configured with a Kira store at ${store.storeDir} and no ledger identity, so it cannot `
      + 'show that store is the one the approval names; refusing rather than settling into an unnamed ledger')
  }
  if (String(proposal.ledgerId) !== configuredLedger) {
    throw ownerRefusal('SETTLE_LEDGER_NOT_THIS_STORE',
      `the approval names ledger ${String(proposal.ledgerId)} and this daemon is configured with `
      + `${configuredLedger}: acting on another ledger is a different act`)
  }
  assertScopeInStore(proposal.scope, SCOPE_KINDS.KIRA_STORE, configuredLedger)
  // **R2: THE AGENT-AUTHORED COMMAND IS NOT A PLACE TO SET A PIN.** These three fell back to the command's own
  // values — `command.subject ?? store.subject` and its two siblings — so a document the AGENT prepared could
  // name its own approver, its own control head, or its own subject and OVERRIDE the daemon's configuration. The
  // pins exist to be the operator's; a command carrying one is refused rather than preferred over it. That is the
  // difference between "the configured approver approved this" and "whoever wrote the document said so".
  for (const pin of ['subject', 'approverDid', 'activeControlDigest']) {
    if (command[pin] !== undefined) {
      throw ownerRefusal('SETTLE_COMMAND_CARRIES_A_PIN',
        `the frozen command names its own ${pin}; the daemon's configuration is the only place a pin may come `
        + 'from, so this is refused rather than preferred over it')
    }
  }
  const receipt = owner.settleAuthorized({
    authorization: command.authorization,
    approval: command.approval,
    subject: store.subject,
    approverDid: store.approverDid,
    activeControlDigest: store.activeControlDigest,
  })
  return Object.freeze({ receipt, authority: authority.mode, digest: proposal.digest })
}
