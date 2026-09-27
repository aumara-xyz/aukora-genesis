// aukora · core/witness/peer.mjs — A SECOND MACHINE THAT REMEMBERS
//
// ══ WHY THIS EXISTS, AND WHY IT COMES BEFORE THE CEREMONY ══
//
// `docs/LIMITS.md` already carries the sentence this module is built on: **signing is not the
// mechanism, retention is.**
//
// Every prefix of a valid chain is a valid chain. Truncate at line 400 and lines 1-400 hash perfectly,
// link perfectly, and verify clean — a hash chain proves what SURVIVED was not edited and says nothing
// about what was removed. Signing does not change that. A signed prefix is still a valid prefix, and
// every signature on the surviving lines is genuine. The attacker deletes; they do not forge.
//
// The only thing that catches a deletion is somebody else remembering a head you can no longer
// produce. That works with no ceremony, no bound root, and no signatures on the chain at all — which
// is precisely why building it first reorders the whole plan.
//
// ══ PAIR FIRST, OR THIS IS THEATRE ══
//
// If any speaker may tell the witness "my head is X", then the same party who truncated the chain
// says so too, and the witness agrees with them. Unsigned retention that the attacker can re-push
// proves exactly nothing.
//
// So retention is written only over a CHANNEL KEY established at pairing. That key is deliberately
// NOT the root and NOT the device key: it answers "may this speaker write to your retention store",
// which is a different question from "is this node bound". A node that has never held a ceremony can
// still be witnessed, and that is the point of doing this now rather than after.
//
// ══ WRITER, NOT JUST repoId ══
//
// `repoId` is `sha256(origin + root_commit)`, so two clones of one repository share it exactly.
// Retention keyed on `repoId` alone compares clone A's head against clone B's — and B, legitimately
// behind, reads as having TRUNCATED a chain it never held. A false accusation is worse than a missed
// one, because a false accusation is the one somebody acts on. Every record is keyed on the pair.
//
// ══ WHAT THIS MODULE IS NOT ══
//
// It is not a network. There is no socket here, no server, no transport. `buildCheckpointPush`
// produces a signed record and `acceptPush` consumes one; how the bytes travel is a separate concern
// and is not pretended at. That keeps this pure, testable, and free of the dependency φ refuses to
// take — and it means the honest description today is "the protocol and both ends", not "peer witness
// is live". `docs/LIMITS.md` says so in those words.

import { generateKeyPairSync, sign as edSign, verify as edVerify, createHash } from 'node:crypto';
import { mkdirSync, writeFileSync, readFileSync, readdirSync, existsSync, openSync, writeSync, fsyncSync, closeSync } from 'node:fs';
import { join } from 'node:path';

import { keysDir, pubToB64, privToB64, pubFromB64, privFromB64 } from './aumlok.mjs';
import { compareFrontier, FRONTIER_STATES, verifyDelta, buildDelta } from './frontier.mjs';

export const PUSH_SCHEMA = 'aukora-peer-push-v3';
export const ACK_SCHEMA = 'aukora-witness-ack-v1';

/**
 * How the retention store was read. Missing, unreadable and corrupt were ALL mapped to an empty
 * store, so a torn write read as "this witness has never heard of you" — which is exactly the answer
 * an attacker would choose. Corruption gets its own loud state.
 */
export const RETENTION_SCHEMA = 'aukora-retention-v3';

export const RETENTION_STATES = Object.freeze({
  FRESH: 'retention:fresh',
  LOADED: 'retention:loaded',
  CORRUPT: 'retention:corrupt',
  UNREADABLE: 'retention:unreadable',
});
export const PEER_SCHEMA = 'aukora-peer-v1';

/**
 * The states a witness can be in, and every one of them is SAID.
 *
 * The failure this lane exists to prevent is a verifier that reports nothing when a witness says
 * nothing — "no news" and "no witness" rendering identically. Only `AGREED` reads ok; the other four
 * are each named separately because they call for different actions:
 *
 *   AGREED       no retained frontier disagrees with the one we can produce, and the witness's own
 *                clock says it was told recently enough. The only ok state.
 *
 *                This said "the witness holds the head we hold" until it was measured: the live chain
 *                carries 52 heads, so there was never one head to hold. That sentence was corrected in
 *                the module header in #139 and SURVIVED HERE, nine lines below the correction —
 *                which is the argument for sweeping a claim everywhere it is stated, not where it was
 *                first noticed.
 *   BEHIND       a retained frontier disagrees with the one we can produce — a truncation, a
 *                length-preserving prefix rewrite, or a lost branch. Each disagreement carries its own
 *                `frontier:*` state in `disagreeing[]`; the name is narrower than the set it now covers.
 *   STALE        it agreed, but too long ago to be current evidence.
 *   SILENT       it has never heard of this repository and writer at all.
 *   UNREACHABLE  we could not ask. NOT an accusation — a partition must not cry wolf — and
 *                emphatically not agreement, which would be the hole this module closes.
 */
export const PEER_STATES = Object.freeze({
  AGREED: 'peer:agreed',
  BEHIND: 'peer:retains-later-head',
  STALE: 'peer:stale',
  SILENT: 'peer:never-witnessed',
  UNREACHABLE: 'peer:unreachable',
});

const peersDir = () => join(keysDir(), 'peers');
const writerPath = () => join(keysDir(), 'writer.id');
const retentionPath = () => join(keysDir(), 'retention.json');
const peerPath = (peerId) => join(peersDir(), `${peerId}.json`);

/** The bytes a push signs over. Fixed order, explicit — key order must never decide a signature. */
function pushPreimage(p) {
  // `atMs` IS INSIDE THE SIGNATURE NOW. It rode outside while being used for freshness, so a sender
  // clock could be moved to a far-future value without invalidating anything — measured, not feared.
  // It remains DIAGNOSTIC: the load-bearing clock is the witness's own `receivedAtMs`, inside the
  // witness-signed acknowledgement, because a sender is not a trustworthy source of when a remote
  // machine heard from it.
  return Buffer.from([
    PUSH_SCHEMA, String(p.peerId ?? ''), String(p.commitment ?? ''),
    String(p.repoId ?? ''), String(p.writerEpoch ?? ''),
    String(p.seq ?? ''), String(p.at ?? ''), String(p.atMs ?? ''),
  ].join('|'), 'utf8');
}

/** The bytes a witness signs to say it heard. The whole push commitment, plus the witness's own clock. */
function ackPreimage(a) {
  return Buffer.from([
    ACK_SCHEMA, String(a.witnessPeerId ?? ''), String(a.pairId ?? ''),
    String(a.checkpointCommitment ?? ''), String(a.senderSeq ?? ''),
    String(a.witnessSeq ?? ''), String(a.receivedAt ?? ''), String(a.receivedAtMs ?? ''),
    String(a.protocolVersion ?? ''),
  ].join('|'), 'utf8');
}

/** A frontier's commitment: one digest over everything it claims, so an ack can name it in one field. */
function commitmentOf(frontier) {
  return createHash('sha256').update([
    String(frontier?.schema ?? ''), String(frontier?.repoId ?? ''), String(frontier?.writerEpoch ?? ''),
    String(frontier?.receiptCount ?? ''), String(frontier?.prefixDigest ?? ''),
    String(frontier?.frontierDigest ?? ''), String(frontier?.frontierCount ?? ''),
    (frontier?.policyVersions ?? []).map((x) => String(x)).sort().join(','),
  ].join('|'), 'utf8').digest('hex');
}

/**
 * Pair with a witness: mint this channel's key and record it.
 *
 * The private half is written 0600 outside the repository and is never returned — a caller that
 * cannot hold it cannot leak it. `peerId` is derived from the public half, so it cannot be chosen.
 */
export function pairPeer({ name, at = null } = {}) {
  mkdirSync(peersDir(), { recursive: true, mode: 0o700 });
  const kp = generateKeyPairSync('ed25519');
  const channelPub = pubToB64(kp.publicKey);
  const peerId = createHash('sha256').update(channelPub, 'utf8').digest('hex').slice(0, 24);
  const record = { schema: PEER_SCHEMA, peerId, name: String(name ?? ''), channelPub, pairedAt: at, retiredAt: null };
  writeFileSync(peerPath(peerId), `${JSON.stringify(record, null, 2)}\n`, { mode: 0o600 });
  writeFileSync(join(peersDir(), `${peerId}.channel`), privToB64(kp.privateKey), { mode: 0o600 });
  return record;
}

/**
 * WHO WROTE THIS CHECKPOINT — a stable identifier for this machine, minted on demand.
 *
 * `repoId` cannot answer it: two clones of one repository share `sha256(origin + root_commit)`
 * exactly, so retention keyed on it alone compares clone A's head against clone B's and reads B,
 * legitimately behind, as having TRUNCATED a chain it never held.
 *
 * It is deliberately NOT the device key and NOT the root: those exist only after a ceremony, and the
 * entire argument for building peer witness first is that it must work in the unsigned era. This is a
 * random 12 bytes in the keys directory, created the first time anything asks. It identifies a
 * machine, carries no secret, and reveals nothing about the phrase or the root.
 */
export function writerId() {
  try { return readFileSync(writerPath(), 'utf8').trim(); } catch { /* first use */ }
  mkdirSync(keysDir(), { recursive: true, mode: 0o700 });
  const id = createHash('sha256').update(generateKeyPairSync('ed25519').publicKey.export({ type: 'spki', format: 'der' })).digest('hex').slice(0, 24);
  writeFileSync(writerPath(), `${id}\n`, { mode: 0o600 });
  return id;
}

export function loadPeer(peerId) {
  try { return JSON.parse(readFileSync(peerPath(peerId), 'utf8')); } catch { return null; }
}

export function listPeers() {
  try {
    return readdirSync(peersDir()).filter((f) => f.endsWith('.json'))
      .map((f) => loadPeer(f.replace(/\.json$/, ''))).filter(Boolean);
  } catch { return []; }
}

/**
 * Retire a channel. Peer replacement, said rather than discovered.
 *
 * A retired channel stops being accepted IMMEDIATELY, or "replacing a compromised witness" would
 * leave the compromised one still able to speak. What it already witnessed is kept — retiring a
 * witness is not a reason to forget what it saw, and deleting that history would hand an attacker a
 * way to erase the evidence by retiring the peer that holds it.
 */
export function retirePeer(peerId, { at = null, reason = '' } = {}) {
  const p = loadPeer(peerId);
  if (!p) return { ok: false, reason: 'unknown peer' };
  const next = { ...p, retiredAt: at ?? true, retiredReason: String(reason ?? '') };
  writeFileSync(peerPath(peerId), `${JSON.stringify(next, null, 2)}\n`, { mode: 0o600 });
  return { ok: true, peer: next };
}

/** Build a signed checkpoint push. `seq` is monotonic per (repoId, writer) — see `acceptPush`. */
export function buildCheckpointPush({ peerId, frontier, seq, at, atMs = null, delta = null }) {
  const body = {
    schema: PUSH_SCHEMA, peerId,
    commitment: commitmentOf(frontier),
    repoId: frontier?.repoId ?? null,
    writerEpoch: frontier?.writerEpoch ?? null,
    frontier, delta, seq, at, atMs,
  };
  let priv;
  try { priv = privFromB64(readFileSync(join(peersDir(), `${peerId}.channel`), 'utf8')); }
  catch { return { ...body, sig: null }; }
  return { ...body, sig: edSign(null, pushPreimage(body), priv).toString('base64') };
}

/**
 * THE ACKNOWLEDGEMENT — a witness saying, in signed bytes, that it heard.
 *
 * `acceptPush` returning `{ ok: true }` is a FUNCTION RETURN. It is not durable evidence that a
 * remote machine ever held anything, and it vanishes with the stack frame. The activation sequence's
 * last gate is "peer acknowledges", and a gate whose evidence is a boolean on the caller's own
 * machine is not a gate at all.
 *
 * The witness's `receivedAtMs` is the load-bearing clock and is inside the signature. The sender's
 * `atMs` stays diagnostic — a sender is not a trustworthy source of when someone else heard from it.
 */
/**
 * CAN THIS WITNESS SIGN AT ALL? Asked BEFORE anything is written.
 *
 * The ack is derived from the RETAINED record, which means the append has already happened by the time
 * it is built. So the old `catch { return { ...body, signature: null } }` produced the worst possible
 * pair of outcomes: the witness KEPT the checkpoint and handed back an acknowledgement proving
 * nothing. Storage said yes and the artefact that crosses the machine boundary said nothing, and only
 * the artefact travels.
 *
 * A node that cannot sign retains NOTHING for that operation. That is the fail-closed reading, and it
 * is the right one here: the alternative leaves a witness holding evidence it cannot attest to, which
 * is indistinguishable from a witness that was never asked.
 */
function signingKeyFor(witnessPeerId) {
  try {
    return { ok: true, priv: privFromB64(readFileSync(join(peersDir(), `${witnessPeerId}.channel`), 'utf8')) };
  } catch (err) {
    return { ok: false, reason: `this witness cannot read its own signing channel, so it will not sign: ${err?.message ?? 'unreadable'}` };
  }
}

function signAckFromRetained({ witnessPeerId, retained, witnessSeq, receivedAt, receivedAtMs, protocolVersion = ACK_SCHEMA }) {
  // The argument is the RECORD THIS WITNESS APPENDED, never the push. An ack is a claim about
  // what this witness HOLDS; deriving it from the message would let it certify something it stored
  // differently, or never stored at all.
  const body = {
    schema: ACK_SCHEMA,
    witnessPeerId,
    pairId: retained?.peerId ?? null,
    checkpointCommitment: retained?.commitment ?? null,
    senderSeq: retained?.seq ?? null,
    witnessSeq, receivedAt, receivedAtMs, protocolVersion,
  };
  // No `catch` returning an unsigned body. The capability was established by `signingKeyFor` BEFORE
  // anything was appended, so reaching here without a key is a bug rather than a runtime condition —
  // and an unsigned acknowledgement is not a weaker acknowledgement, it is a rumour with a schema.
  const priv = privFromB64(readFileSync(join(peersDir(), `${witnessPeerId}.channel`), 'utf8'));
  return { ...body, signature: edSign(null, ackPreimage(body), priv).toString('base64') };
}

/**
 * Check an acknowledgement off the wire — against the witness's paired channel AND against the push it
 * claims to answer.
 *
 * ══ ONE ARGUMENT WAS NOT ENOUGH ══
 *
 * This took only the ack. It could prove that a witness this node paired with signed an ack-SHAPED
 * object, and that every field inside was covered by the signature. It could not prove the ack answers
 * THIS push, because the push never arrived. So a genuine, correctly-signed acknowledgement of
 * yesterday's checkpoint verified perfectly against today's — and a courier holding both would report
 * agreement it had not received.
 *
 * Correlation is now REQUIRED, not optional. Passing no push is not a lenient mode; it is a caller
 * asking a question this function cannot answer, and it is refused.
 *
 * `afterWitnessSeq` is the replay bound. A witness's own sequence is monotonic per pair, so an ack
 * carrying a sequence at or below one already verified is either a replay or a fork in the witness —
 * both of which must stop here rather than walk a consumer's view backwards.
 */
export function verifyWitnessAck(ack, push, { afterWitnessSeq = null } = {}) {
  if (ack?.schema !== ACK_SCHEMA) return { ok: false, reason: `unknown ack schema: ${String(ack?.schema)}` };
  if (ack.protocolVersion !== ACK_SCHEMA) {
    // Named rather than caught by the signature failing. A witness speaking a version we do not
    // understand is a compatibility fact, not tampering, and the two deserve different sentences.
    return { ok: false, reason: `unsupported acknowledgement protocol: ${String(ack.protocolVersion)}` };
  }
  if (!push || typeof push !== 'object') {
    return { ok: false, reason: 'no push was supplied, so there is nothing this acknowledgement can be checked against' };
  }

  // CORRELATION BEFORE CRYPTOGRAPHY. A signature over the wrong subject is still the wrong subject,
  // and saying so first gives the clearer sentence: "this answers a different checkpoint" rather than
  // "this does not verify".
  if (ack.pairId !== push.peerId) {
    return { ok: false, reason: `this acknowledgement answers pair ${String(ack.pairId)}, not ${String(push.peerId)}` };
  }
  if (ack.checkpointCommitment !== push.commitment) {
    return { ok: false, reason: 'this acknowledgement names a different checkpoint commitment than the push it was checked against' };
  }
  if (Number(ack.senderSeq) !== Number(push.seq)) {
    return { ok: false, reason: `this acknowledgement answers seq ${String(ack.senderSeq)}, not ${String(push.seq)}` };
  }
  if (afterWitnessSeq !== null && !(Number(ack.witnessSeq) > Number(afterWitnessSeq))) {
    return {
      ok: false,
      reason: `witness sequence ${String(ack.witnessSeq)} is not monotonic against the ${afterWitnessSeq} already verified — a replay, or a forked witness`,
    };
  }

  const witness = loadPeer(ack.witnessPeerId);
  if (!witness) return { ok: false, reason: 'the acknowledgement names a witness this node has never paired with' };
  try {
    const good = typeof ack.signature === 'string' && ack.signature.length > 0
      && edVerify(null, ackPreimage(ack), pubFromB64(witness.channelPub), Buffer.from(ack.signature, 'base64'));
    return good ? { ok: true, reason: null } : { ok: false, reason: 'the acknowledgement signature does not verify' };
  } catch {
    return { ok: false, reason: 'the acknowledgement signature does not verify' };
  }
}

/** The retention store this witness keeps: an append-only JSONL log, one line per retained
 *  checkpoint, outside the repository, 0600. */
export function openRetention() {
  let text;
  try {
    text = readFileSync(retentionPath(), 'utf8');
  } catch (err) {
    // MISSING is a fresh witness and is fine. UNREADABLE is a permission or device problem and is
    // NOT fine — mapping them together meant a witness that could not read its own memory answered
    // "I have never heard of you", which is the answer an attacker would choose for it.
    if (err && err.code === 'ENOENT') return { schema: RETENTION_SCHEMA, state: RETENTION_STATES.FRESH, held: {} };
    return { schema: RETENTION_SCHEMA, state: RETENTION_STATES.UNREADABLE, reason: err?.message ?? 'unknown', held: {} };
  }
  // ══ AN APPEND-ONLY LOG, NOT A REWRITTEN BLOB ══
  //
  // v2 held the whole store as one JSON object and rewrote it from a CALLER-SUPPLIED SNAPSHOT on every
  // accept. Two pushes arriving together therefore raced, and the loser's rows vanished — silently,
  // and with them the OLDEST retained checkpoints, which are precisely the evidence an attacker wants
  // gone. A store whose failure mode is "quietly forgets what it witnessed" is not retention.
  //
  // One line per retained checkpoint, appended and fsynced. A torn final line truncates the log rather
  // than destroying it: every prefix of a valid log is a valid log, the same property the receipt chain
  // relies on, applied to the witness's own memory.
  const held = {};
  const lines = text.split('\n').filter((l) => l.trim().length > 0);
  let torn = null;
  for (const [i, line] of lines.entries()) {
    try {
      const row = JSON.parse(line);
      const k = heldKey(row.repoId, row.writerEpoch);
      (held[k] ??= []).push(row);
    } catch (err) {
      // Only a torn LAST line is recoverable. A bad line in the middle means the log was edited.
      if (i === lines.length - 1) { torn = err?.message ?? 'unparseable final line'; break; }
      return { schema: RETENTION_SCHEMA, state: RETENTION_STATES.CORRUPT, reason: `line ${i + 1} is unparseable — this log was edited, not torn`, held: {} };
    }
  }
  return { schema: RETENTION_SCHEMA, state: RETENTION_STATES.LOADED, held, torn };
}

/**
 * Append one retained checkpoint and FLUSH IT TO THE DEVICE before returning.
 *
 * The fsync is the whole point: an ack signed against a record still sitting in the page cache is a
 * promise the witness cannot keep across a power loss, and the ack is durable evidence somewhere else.
 */
function appendRetained(row) {
  mkdirSync(keysDir(), { recursive: true, mode: 0o700 });
  const fd = openSync(retentionPath(), 'a', 0o600);
  try {
    writeSync(fd, `${JSON.stringify(row)}\n`);
    fsyncSync(fd);
  } finally {
    closeSync(fd);
  }
}

/**
 * The bucket a retained checkpoint belongs to.
 *
 * ══ THE COLLISION THIS REPLACES, REPRODUCED ══
 *
 * This was `${repoId}|${writerEpoch}`, and a delimiter that can appear inside its own operands is not a
 * delimiter. Measured:
 *
 *     ('a|b', 'c')  →  "a|b|c"        ← two different (repository, writer) pairs,
 *     ('a',   'b|c')  →  "a|b|c"      ← one bucket
 *
 * Both strings arrive OVER THE WIRE inside a signed push, so a paired peer chooses them. The write
 * path happened to survive — `verifyDelta` compares the two fields and refused the mismatch — but the
 * READ path did not: `retainedCheckpoints(store, 'a', 'b|c')` returned the rows belonging to
 * ('a|b', 'c'). `verifyEverything` then re-derived this chain's prefix against a FOREIGN frontier and
 * reported a rewrite, so a crafted identity raises a truncation alarm on a healthy chain.
 *
 * `JSON.stringify` of the pair is injective for strings: the quoting escapes any delimiter the operands
 * contain, so no two distinct pairs can produce one key. Same reasoning as the length-prefixing in
 * `aumlok.mjs`'s two-factor KEK — two inputs must not be slidable past each other.
 *
 * Nothing on disk changes: rows store `repoId` and `writerEpoch` as fields and the key is derived at
 * read time, so this is transparent to every retention log that already exists.
 */
const heldKey = (repoId, writerEpoch) => JSON.stringify([String(repoId), String(writerEpoch)]);

/** Every checkpoint this witness holds for one (repository, writer) pair, oldest first — an empty
 *  array if it has never been told. */
export function retainedCheckpoints(store, repoId, writerEpoch) {
  return store?.held?.[heldKey(repoId, writerEpoch)] ?? [];
}

/** The most recent retained checkpoint, or null. Kept for callers that want only the latest. */
export function latestRetained(store, repoId, writerEpoch) {
  const all = retainedCheckpoints(store, repoId, writerEpoch);
  return all.length ? all[all.length - 1] : null;
}

/**
 * WITNESS A PUSH — verify, store, flush, and acknowledge as ONE operation.
 *
 * ══ WHY THIS IS ONE FUNCTION AND NOT THREE ══
 *
 * Before this, `acceptPush` and `buildWitnessAck` were separate exports, and nothing connected them.
 * A caller could sign an acknowledgement for a push that `acceptPush` had REFUSED, or never ran on at
 * all — and the ack is the durable artefact that travels to another machine and gets believed. The
 * signed statement and the stored fact could disagree, and only the signed one left the building.
 *
 * The seam was the vulnerability, so the seam is gone. There is no exported path from a push to a
 * signature that does not go through the log. In order, and none of it optional:
 *
 *   1. verify the channel signature          (is this our peer, on a live channel)
 *   2. verify the commitment binds the frontier
 *   3. verify the CONTINUITY PROOF           (replay the delta from what is already held)
 *   4. append durably and FLUSH to the device
 *   5. read the acknowledgement out of THE STORED RECORD and sign that
 *
 * Step 5 signs the exact record step 4 appended, and only after the fsync returned. Not a re-read: the
 * ack is built from the same object that was written, which is what makes them impossible to
 * disagree. If the ack could be assembled from anything else — the push, a caller's copy — it would be
 * the witness certifying its intention rather than its memory.
 *
 * Four refusals, in this order, and the order is the argument:
 *
 *   1. UNPAIRED — the speaker holds no channel here. This is the caveat that makes the whole thing
 *      more than theatre: without it, whoever truncated the chain simply tells the witness so.
 *   2. RETIRED — the channel existed and was replaced. It stops working the moment it is retired.
 *   3. SIGNATURE — the record does not verify under the paired channel key.
 *   4. REPLAY — `seq` is not strictly greater than what is already held for this (repo, writer).
 *      Without it an attacker who truncates re-sends yesterday\'s push and the witness\'s memory walks
 *      backwards to a head that matches the shortened chain. Monotonic, per pair, never global.
 */
export function witnessPush(store, push, { witnessPeerId = null, receivedAt = null, receivedAtMs = null } = {}) {
  const refuse = (reason) => ({ ok: false, reason, ack: null, retained: null });

  if (push?.schema !== PUSH_SCHEMA) return refuse(`unknown push schema: ${String(push?.schema)}`);
  // A witness that cannot read its own memory must not accept — it would be agreeing from amnesia,
  // and the append would sit on top of a history it could not check the push against.
  if (store?.state === RETENTION_STATES.CORRUPT || store?.state === RETENTION_STATES.UNREADABLE) {
    return refuse(`the retention store is ${store.state} — this witness cannot honestly accept anything`);
  }
  const peer = loadPeer(push.peerId);
  if (!peer) return refuse('unpaired speaker — no channel is established for this peer');
  if (peer.retiredAt) return refuse('this channel was retired and no longer speaks for that peer');

  let good = false;
  try {
    good = typeof push.sig === 'string' && push.sig.length > 0
      && edVerify(null, pushPreimage(push), pubFromB64(peer.channelPub), Buffer.from(push.sig, 'base64'));
  } catch { good = false; }
  if (!good) return refuse('the push signature does not verify against the paired channel');

  if (commitmentOf(push.frontier) !== push.commitment) {
    return refuse('the frontier does not match the commitment the signature covers');
  }

  // ══ THE DURABLE LOG IS AUTHORITATIVE, NOT THE CALLER\'S SNAPSHOT ══
  //
  // The `store` argument is whatever the caller read at some earlier moment. Checking continuity and
  // replay against THAT is the same defect the blob rewrite had, moved one layer up: a witness holding
  // a stale snapshot would accept a push it should have refused, and — worse — would refuse a
  // legitimate one for the wrong reason. Re-read from disk so the check is against what is actually
  // retained. This is also the ONLY correct place to notice a second process appended in between.
  const fresh = openRetention();
  if (fresh.state === RETENTION_STATES.CORRUPT || fresh.state === RETENTION_STATES.UNREADABLE) {
    return refuse(`the retention store is ${fresh.state} — this witness cannot honestly accept anything`);
  }
  const key = heldKey(push.repoId, push.writerEpoch);
  const held = fresh.held?.[key] ?? [];
  const prior = held.length ? held[held.length - 1] : null;

  if (prior && !(Number(push.seq) > Number(prior.seq))) {
    return refuse(`replay refused — seq ${push.seq} is not ahead of the retained ${prior.seq}`);
  }

  // ══ THE CONTINUITY PROOF ══
  //
  // Not `compareFrontier`. That function compares two opaque digests, and with a higher count and no
  // chain bytes it cannot do anything but believe the sender — which is how a rewritten prefix rode in
  // as an extension. `verifyDelta` REPLAYS the appended hashes from the digest this witness already
  // holds. It reads no ledger, because a witness has none. That is the point of a witness.
  const v = verifyDelta(prior ? prior.frontier : null, push.delta);
  if (!v.ok) return refuse(`refused — the continuity proof does not hold: ${v.reason}`);
  if (push.delta.toFrontier.prefixDigest !== push.frontier.prefixDigest
    || push.delta.toFrontier.receiptCount !== push.frontier.receiptCount) {
    return refuse('the delta proves a different frontier than the one the signature covers');
  }

  // APPEND, never overwrite. The old shape rewrote one JSON blob from a caller snapshot, so the
  // EARLIEST evidence — the one an attacker most wants gone — was the first thing a race discarded.
  const row = {
    seq: Number(push.seq), at: push.at, senderAtMs: push.atMs ?? null,
    receivedAtMs: receivedAtMs === null ? null : Number(receivedAtMs), receivedAt,
    repoId: push.repoId, writerEpoch: push.writerEpoch,
    peerId: push.peerId, commitment: push.commitment, frontier: push.frontier,
    transition: v.state,
    // MARKED, so a later reader can tell a checkpoint this witness replayed from genesis apart from
    // one it merely adopted. Unmarked, the two would read identically and the weaker claim would
    // inherit the stronger one's authority.
    anchored: v.state === 'delta:anchored',
  };
  // PREFLIGHT, and it must be here — above the append, below every refusal. A witness asked to
  // acknowledge must prove it CAN before it keeps anything.
  if (witnessPeerId) {
    const key = signingKeyFor(witnessPeerId);
    if (!key.ok) return refuse(key.reason);
  }

  try {
    appendRetained(row);
  } catch (err) {
    // A witness that could not durably store must NOT acknowledge. This is the case the split design
    // could not express at all: there, the ack was already signed and gone.
    return refuse(`the witness could not durably retain this checkpoint, so it will not acknowledge it: ${err?.message ?? 'write failed'}`);
  }
  // Reconcile the caller\'s snapshot with what is now durable, so it does not go on answering from a
  // history it no longer matches.
  (store.held ??= {})[key] = [...held, row];

  const ack = witnessPeerId
    ? signAckFromRetained({ witnessPeerId, retained: row, witnessSeq: store.held[key].length, receivedAt, receivedAtMs })
    : null;
  return { ok: true, reason: null, retained: row, ack, state: v.state };
}

/**
 * The old two-step name, kept for callers that only store. It CANNOT produce an acknowledgement — the
 * absent `witnessPeerId` is what makes that structural rather than a convention someone has to follow.
 */
export function acceptPush(store, push) {
  const r = witnessPush(store, push, {});
  return { ok: r.ok, reason: r.reason, retained: r.retained };
}

/**
 * What does this witness say about us — and every answer is LOUD.
 *
 * `reachable: false` is checked FIRST and returns its own state, because a partition must never be
 * rendered as a truncation alarm. A verifier that cried wolf on every flight would be turned off, and
 * a verifier that read a partition as agreement would be the hole itself.
 */
export function peerFreshness(store, { frontier, nowMs = 0, maxAgeMs = 86_400_000, reachable = true }) {
  if (!reachable) {
    return { ok: false, state: PEER_STATES.UNREACHABLE, disagreeing: [], reason: 'the witness could not be reached, so it has said nothing either way' };
  }
  // A store that could not be read is not a store that said nothing. Named before anything else,
  // because every answer below would otherwise be computed over an empty object.
  if (store?.state === RETENTION_STATES.CORRUPT || store?.state === RETENTION_STATES.UNREADABLE) {
    return { ok: false, state: PEER_STATES.UNREACHABLE, disagreeing: [], reason: `the retention store is ${store.state} — its memory cannot be consulted` };
  }

  const held = retainedCheckpoints(store, frontier?.repoId, frontier?.writerEpoch);
  if (!held.length) {
    return { ok: false, state: PEER_STATES.SILENT, disagreeing: [], reason: `this witness has never been told a frontier for ${frontier?.repoId} / ${frontier?.writerEpoch}` };
  }

  // EVERY retained checkpoint, not just the latest. Checking only the newest lets an attacker who
  // truncates below an OLDER checkpoint pass, because the newest one they also replaced agrees with
  // them — and the old evidence is exactly what append-only retention was kept for.
  // `compareFrontier` is the right tool HERE and the wrong one in `witnessPush`: this runs on the
  // writer\'s own node with the live frontier in hand, so a rewritten prefix is caught by
  // `verifyFrontierAgainstChain` in `verifyEverything`. On the witness there are no bytes to re-derive
  // from, which is why that path replays a delta instead.
  const disagreeing = [];
  for (const h of held) {
    const v = compareFrontier(frontier, h.frontier);
    if (!v.ok) disagreeing.push({ seq: h.seq, state: v.state, reason: v.reason });
  }
  if (disagreeing.length) {
    return {
      ok: false, state: PEER_STATES.BEHIND, disagreeing,
      reason: `${disagreeing.length} retained checkpoint(s) disagree with this chain: ${disagreeing[0].reason}`,
    };
  }

  // THE WITNESS\'S OWN CLOCK. This read `latest.atMs` — the SENDER\'S timestamp — while the comment two
  // functions up said a sender is not a trustworthy source of when someone else heard from it. The
  // comment was right and the code did the other thing: anyone who could sign a push could hold their
  // checkpoint fresh forever by stamping it now. `receivedAtMs` is written by the witness at the moment
  // it durably stored the row, and nothing on the wire can set it.
  const latest = held[held.length - 1];
  if (latest.receivedAtMs === null || latest.receivedAtMs === undefined) {
    return { ok: false, state: PEER_STATES.STALE, disagreeing: [], reason: 'this checkpoint was retained without a witness timestamp, so its age cannot be established', retained: latest };
  }
  if (nowMs - Number(latest.receivedAtMs) > maxAgeMs) {
    return { ok: false, state: PEER_STATES.STALE, disagreeing: [], reason: 'the witness agrees, but was last told too long ago to be current evidence', retained: latest };
  }
  return { ok: true, state: PEER_STATES.AGREED, disagreeing: [], reason: null, retained: latest };
}
