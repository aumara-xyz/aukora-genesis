// aukora · core/echo/courier.mjs — MOVING ONE FACT BETWEEN TWO MACHINES
//
// ══ WHAT THIS IS FOR ══
//
// Everything under `core/witness/**` can already produce and check the artefacts of a two-machine
// witness. None of it has ever crossed a machine. `verifyWitnessAck` sat callerless for four rounds,
// declared as awaiting transport, and `deltaOf` with it. This is that transport, and it is deliberately
// the smallest thing that makes ONE external fact stick:
//
//     a second machine retained Peter's frontier at count N and signed an acknowledgement
//     of the exact checkpoint it retained
//
// Then once more, with the second push extending the first. That is First Echo.
//
// ══ WHY IT IS FILES AND NOT A SOCKET ══
//
// A courier that opens a connection has to be trusted about who it connected to. A courier that writes
// a file the owner carries — by hand, by USB, by an attachment — has no such claim to make: the
// authenticity lives entirely in the ed25519 channel signatures, which is where it belonged anyway.
// The medium is explicitly NOT a security boundary here, and nothing in this file behaves as if it is.
// GitHub carrying the file is not trust; the owner reading a peerId aloud is.
//
// ══ WHAT MAY CROSS, AND WHAT MAY NOT ══
//
// CROSSES:      a peer's public record (peerId + channelPub) · a checkpoint push · an acknowledgement
// NEVER CROSSES: `<peerId>.channel` (the private half) · `retention.json` · `writer.id` · any chain
//                file · any prompt, patch, path or file content
//
// `exportable()` is the one gate and it is an ALLOW-LIST over field names, not a denylist over known
// secrets. A denylist protects against the secrets somebody remembered; the shape of this record will
// change, and the field nobody remembered is exactly the one that leaks.

import { createHash } from 'node:crypto';
import {
  mkdirSync, writeFileSync, readFileSync, existsSync, openSync, writeSync, fsyncSync, closeSync,
} from 'node:fs';
import { join } from 'node:path';

import { keysDir } from '../witness/aumlok.mjs';
import {
  loadPeer, listPeers, writerId, openRetention, witnessPush, buildCheckpointPush,
  verifyWitnessAck, RETENTION_STATES, PEER_SCHEMA,
} from '../witness/peer.mjs';
import { frontierOf, deltaOf, buildDelta } from '../witness/frontier.mjs';

export const ECHO_SCHEMA_PEER = 'aukora-echo-peer-v1';
export const ECHO_SCHEMA_PUSH = 'aukora-echo-push-v1';
export const ECHO_SCHEMA_ACK = 'aukora-echo-ack-v1';

/**
 * The three answers, and they are not a boolean.
 *
 *   VERIFIED     a second machine acknowledged the exact checkpoint it retained, and it correlates
 *   CONTRADICTED the evidence disagrees — a witness holding what we cannot produce, a rewritten prefix
 *   UNAVAILABLE  nobody has answered. NOT a success, and never rendered as one.
 *
 * "Not asked" collapsing into "fine" is the failure this whole subsystem exists to prevent, so the
 * label is printed before anything else and the exit code is derived from it and nothing else.
 */
export const ASSURANCE = Object.freeze({
  VERIFIED: 'VERIFIED',
  CONTRADICTED: 'CONTRADICTED',
  UNAVAILABLE: 'UNAVAILABLE',
});

export const EXIT = Object.freeze({ VERIFIED: 0, CONTRADICTED: 1, UNAVAILABLE: 2 });

const echoDir = () => join(keysDir(), 'echo');
const pendingPath = (peerId) => join(echoDir(), `pending-${peerId}.json`);

function writeAtomic(path, text) {
  mkdirSync(echoDir(), { recursive: true, mode: 0o700 });
  const fd = openSync(path, 'w', 0o600);
  try { writeSync(fd, text); fsyncSync(fd); } finally { closeSync(fd); }
}

/**
 * THE ALLOW-LIST. Only these fields of a peer record are permitted to leave this machine.
 *
 * `channelPub` is the public half and is the entire point of the exchange. `<peerId>.channel` — the
 * private half — lives in a different file with a different extension and is never read here at all;
 * that is a structural separation rather than a rule this function has to remember.
 */
export function exportablePeer(record) {
  if (!record || record.schema !== PEER_SCHEMA) return null;
  return {
    schema: ECHO_SCHEMA_PEER,
    peerId: record.peerId,
    channelPub: record.channelPub,
    name: String(record.name ?? ''),
    pairedAt: record.pairedAt ?? null,
  };
}

/** What this node can tell another one about itself. Public halves only, by construction. */
export function identity() {
  const peers = listPeers().filter((p) => !p.retiredAt);
  return {
    writerEpoch: writerId(),
    peers: peers.map(exportablePeer).filter(Boolean),
  };
}

/**
 * Import a peer another machine exported. TRUST ON FIRST USE, and the owner does the trusting.
 *
 * `expect` is the 24-character peerId the owner READ OFF THE OTHER SCREEN. It is compared here, and a
 * mismatch refuses. That comparison is the whole security model of this step and it is deliberately
 * manual: whatever carried the file — GitHub, mail, a USB stick — carried it without vouching for it,
 * and a courier that treated delivery as endorsement would be inventing an authority nobody granted.
 *
 * The peerId is also RE-DERIVED from the public key rather than believed, so a file claiming a peerId
 * the owner recognises while carrying somebody else's key cannot pass the visual check by lying.
 */
export function importPeer(doc, { expect = null } = {}) {
  if (doc?.schema !== ECHO_SCHEMA_PEER) return { ok: false, reason: `not an echo peer document: ${String(doc?.schema)}` };
  if (typeof doc.channelPub !== 'string' || !doc.channelPub) return { ok: false, reason: 'the document carries no channel key' };

  const derived = createHash('sha256').update(doc.channelPub, 'utf8').digest('hex').slice(0, 24);
  if (derived !== doc.peerId) {
    return { ok: false, reason: `the document claims peerId ${String(doc.peerId)} but its key derives ${derived} — it is not what it says it is` };
  }
  if (!expect) {
    return { ok: false, reason: 'refusing to import without --expect: the owner must compare the peerId against the other machine by eye' };
  }
  if (expect !== derived) {
    return { ok: false, reason: `refusing: you expected ${expect}, this document is ${derived}` };
  }

  const existing = loadPeer(derived);
  if (existing && existing.channelPub !== doc.channelPub) {
    // A key change under a known peerId is impossible without a hash collision, so this is either
    // corruption or an attempt. Either way it is not an update.
    return { ok: false, reason: `peer ${derived} is already known with a different channel key — refusing to overwrite` };
  }

  const record = {
    schema: PEER_SCHEMA, peerId: derived, name: String(doc.name ?? ''),
    channelPub: doc.channelPub, pairedAt: doc.pairedAt ?? null, retiredAt: null,
  };
  const dir = join(keysDir(), 'peers');
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  writeFileSync(join(dir, `${derived}.json`), `${JSON.stringify(record, null, 2)}\n`, { mode: 0o600 });
  return { ok: true, peerId: derived, alreadyKnown: Boolean(existing) };
}

/**
 * Produce the push this machine wants a witness to retain — or hand back the one already in flight.
 *
 * ══ ONE UNRESOLVED PUSH AT A TIME ══
 *
 * `seq` is monotonic per pair and a witness refuses anything that does not advance it. So a second
 * `emit` before the first is acknowledged must NOT mint seq+2: that creates two live sequences, only
 * one of which can ever be accepted, and the owner has no way to tell which file is the real one.
 *
 * Re-running returns the SAME artefact, byte for byte, and says so. `--force` is deliberately absent.
 */
export function emit(repoRoot, { asPeerId, forWitness = null, at = null, atMs = null, anchor = false } = {}) {
  const me = loadPeer(asPeerId);
  if (!me) return { ok: false, reason: `unknown peer ${String(asPeerId)} — pair it first` };
  if (me.retiredAt) return { ok: false, reason: `peer ${asPeerId} was retired and no longer speaks for this node` };

  // A RESOLVED PUSH LEAVES AN EMPTY FILE, NOT A MISSING ONE — the file's existence is not the question,
  // its contents are. Absent and empty both mean "nothing in flight"; unreadable-but-present does not,
  // and minting a fresh push there is exactly the divergent sequence this guard exists to prevent.
  const path = pendingPath(asPeerId);
  let raw = null;
  try { raw = existsSync(path) ? readFileSync(path, 'utf8') : null; }
  catch { return { ok: false, reason: 'the pending push file exists and cannot be read — resolve it by hand rather than minting a second sequence' }; }

  if (raw !== null && raw.trim()) {
    let pending;
    try { pending = JSON.parse(raw); }
    catch { return { ok: false, reason: 'the pending push file is unparseable — resolve it by hand rather than minting a second sequence' }; }
    return {
      ok: true, pending: true, doc: pending,
      reason: `a push is already awaiting acknowledgement (seq ${pending.push?.seq}); carry that one rather than minting a second`,
    };
  }

  const store = openRetention();
  if (store.state === RETENTION_STATES.CORRUPT || store.state === RETENTION_STATES.UNREADABLE) {
    return { ok: false, reason: `this node cannot read its own retention (${store.state}), so it cannot know its own state` };
  }
  if (store.torn) {
    // TORN FINAL LINE: refuse. Appending after it buries the tear, and repairing it invents a row.
    return { ok: false, reason: 'the retention log has a torn final line — refusing to emit. Do not repair it; carry it to the owner.' };
  }

  // ══ THE SENDER'S SEQUENCE COMES FROM THE SENDER'S OWN MEMORY, NOT FROM RETENTION ══
  //
  // The first version read `latestRetained` — the LOCAL retention store — to decide the next seq and
  // the delta's starting point. But this machine is the writer, not the witness: it retains nothing
  // for itself, so `prior` was always null and every push minted seq 1 with a delta from genesis. The
  // second echo could never advance, and a witness enforcing monotonic seq would have refused it
  // forever. Found by the second-echo test, which is the only place it could show.
  //
  // What the sender actually knows is what a witness CONFIRMED holding, and that is recorded when an
  // acknowledgement verifies. A frontier is counts and digests, so keeping it costs no content.
  const confirmed = lastConfirmed(asPeerId, forWitness);
  const mine = frontierOf(repoRoot);
  // An anchor is only meaningful at first contact — once a witness has confirmed anything, the delta
  // has somewhere to continue FROM and there is nothing to anchor.
  const anchoring = anchor && !confirmed;
  const doc = {
    schema: ECHO_SCHEMA_PUSH,
    forWitness,
    push: buildCheckpointPush({
      peerId: asPeerId, frontier: mine, seq: (confirmed?.senderSeq ?? 0) + 1, at, atMs,
      delta: anchoring
        ? buildDelta({ from: null, to: mine, appended: [], anchor: true })
        : deltaOf(repoRoot, confirmed?.frontier ?? null),
    }),
  };
  writeAtomic(path, `${JSON.stringify(doc, null, 2)}\n`);
  return { ok: true, pending: false, doc };
}

/**
 * The witness side: retain a push and sign an acknowledgement of what was retained.
 *
 * A WRITER EPOCH CHANGE IS LOUD. If this witness already holds checkpoints for this repository under a
 * DIFFERENT writer, that is either a second machine or a deleted writer identity — and the second
 * possibility is precisely the attack: wipe `writer.id`, and every retained checkpoint for the old
 * epoch stops being compared against, so the node looks like a fresh innocent one with no history.
 * It is reported and the caller decides; it is never silently treated as a new pair.
 */
export function accept(doc, { asWitness, receivedAt = null, receivedAtMs = null, acceptNewEpoch = false } = {}) {
  if (doc?.schema !== ECHO_SCHEMA_PUSH) return { ok: false, reason: `not an echo push document: ${String(doc?.schema)}` };
  const push = doc.push;
  if (!push) return { ok: false, reason: 'the document carries no push' };
  // ── THE RECIPIENT BINDING, WHICH USED TO BE A FIELD AND NOT A CHECK ──────────────────────────
  //
  // KIMI's sweep (issue #187): `emit` writes `forWitness` onto the push document and NOTHING read it.
  // The parameter fed `lastConfirmed` for sequence minting; the field on the document was decoration.
  // So a push addressed to witness A was accepted, retained and acknowledged by witness B — recipient
  // binding unenforced by construction, in the one module whose job is who-told-whom.
  //
  // AN ABSENT ADDRESS IS NOT A MISMATCH. `emit` defaults `forWitness` to null, and an unaddressed push
  // is a legitimate broadcast — refusing those would invent a requirement nobody stated and would break
  // every existing pairing. The field is enforced WHEN IT IS PRESENT, which is the only claim the
  // document actually makes. That distinction is the same one this repository draws everywhere else
  // between "no answer" and "the wrong answer".
  //
  // ORDERED WITH THE OTHER DOCUMENT CHECKS, ABOVE THE IDENTITY CHECK, AND THAT ORDER WAS MEASURED:
  // placed after `loadPeer` the branch was unreachable for anyone who is not already a configured
  // witness, which is precisely the caller a misaddressed push arrives at. "Who are you" and "is this
  // for you" are different questions, and this one is answerable from the document plus a string.
  if (doc.forWitness != null && doc.forWitness !== asWitness) {
    return {
      ok: false,
      reason: `this push is addressed to witness ${String(doc.forWitness)}, not to ${String(asWitness)} — `
        + 'a document naming its recipient is not acceptable to a different one',
    };
  }

  if (!loadPeer(asWitness)) return { ok: false, reason: `unknown witness identity ${String(asWitness)}` };

  // ══ ADDRESSING IS CHECKED, OR IT IS DECORATION ══
  //
  // `forWitness` was written into every emitted document and read by nobody on this side, so a push
  // addressed to witness A was acceptable to witness B. A field that only the writer consults is not a
  // constraint; it is a comment stored in JSON.
  //
  // Absent addressing stays legitimate — `emit` without `--for` means "whoever will hold this" — so
  // this refuses only when the document NAMES someone and it is not us. Treating an unaddressed push
  // as addressed-to-nobody would break the broadcast case for the sake of tidiness.
  const addressed = doc.forWitness ?? null;
  if (addressed !== null && addressed !== asWitness) {
    return { ok: false, reason: `this push is addressed to ${addressed}, not to ${asWitness}` };
  }

  const store = openRetention();
  if (store.torn) {
    return { ok: false, reason: 'this witness has a torn final retention line — refusing to accept. Do not repair it.' };
  }

  const epochs = epochsHeldFor(store, push.repoId);
  const foreignEpochs = epochs.filter((e) => e !== push.writerEpoch);

  // ══ THE DECISION: A CHANGED WRITER EPOCH IS A HARD STOP THE OWNER CAN CLEAR ══
  //
  // The spec asked for LOUD. Grok's field run showed loud-and-exit-0, and asked which was intended.
  // The answer is that loud alone cannot be right here, because the two things a new epoch means are
  // not comparable:
  //
  //   · a genuine second machine — ordinary, and worth one confirmation
  //   · a DELETED `writer.id` — after which every checkpoint retained under the old epoch stops being
  //     compared against, and a node with a rewritten history presents as a fresh innocent one
  //
  // A witness cannot tell those apart from the bytes, and a warning that still exits 0 is invisible to
  // the pipeline that would otherwise catch the second. So it refuses, and `acceptNewEpoch` lets the
  // owner clear it — the same manual act as `--expect` on import, in the same place for the same
  // reason: an identity change is exactly the moment a human has to look.
  if (foreignEpochs.length > 0 && !acceptNewEpoch) {
    return {
      ok: false,
      epochChange: foreignEpochs,
      reason: `this witness already holds checkpoints for this repository under writer epoch ${foreignEpochs.join(', ')}. `
        + 'A new epoch is a second machine OR a deleted identity, and this cannot tell which. '
        + 'Confirm with --accept-new-epoch once you know.',
    };
  }

  const out = witnessPush(store, push, {
    witnessPeerId: asWitness,
    receivedAt: receivedAt ?? new Date().toISOString(),
    receivedAtMs: receivedAtMs ?? Date.now(),
  });
  if (!out.ok) return { ok: false, reason: out.reason, epochChange: foreignEpochs };

  return {
    ok: true,
    doc: { schema: ECHO_SCHEMA_ACK, ack: out.ack, answers: { peerId: push.peerId, seq: push.seq, commitment: push.commitment } },
    // `anchored` CARRIED THROUGH, not dropped. `peer.mjs` marks the retained row for exactly this
    // reason — "so a later reader can tell a checkpoint this witness replayed from genesis apart from
    // one it merely adopted" — and this summary is the one thing `bin/echo.mjs`'s human-facing
    // `accept` verb reads. Dropping it here meant the caveat that command's own `emit --anchor` help
    // text promises ("the witness starts HERE and proves nothing before it") could never be printed
    // on the side that actually retains the checkpoint.
    retained: { seq: out.retained.seq, receiptCount: push.frontier?.receiptCount ?? null, anchored: out.retained.anchored === true },
    // Non-empty means this repository has been witnessed under another writer identity. Surfaced on
    // SUCCESS as well as failure, because the acceptance is legitimate and the fact is still alarming.
    epochChange: foreignEpochs,
  };
}

function epochsHeldFor(store, repoId) {
  const seen = new Set();
  for (const rows of Object.values(store?.held ?? {})) {
    for (const r of rows) if (r.repoId === repoId && typeof r.writerEpoch === 'string') seen.add(r.writerEpoch);
  }
  return [...seen];
}

/**
 * Close the loop: does this acknowledgement answer the push we are still waiting on?
 *
 * The pending push is read from disk rather than passed in, because the question is not "do these two
 * documents agree" — anyone can produce two documents that agree — but "did the machine we sent OUR
 * push to acknowledge THAT push". The pending file is the only thing that knows which push that was.
 */
export function verify(_repoRoot, { asPeerId, ackDoc } = {}) {
  const path = pendingPath(asPeerId);
  if (!existsSync(path)) {
    return { assurance: ASSURANCE.UNAVAILABLE, reason: 'there is no push awaiting acknowledgement — nothing was asked, so nothing is established' };
  }
  let pending;
  try { pending = JSON.parse(readFileSync(path, 'utf8')); }
  catch { return { assurance: ASSURANCE.UNAVAILABLE, reason: 'the pending push is unreadable, so it cannot be matched against anything' }; }

  if (ackDoc?.schema !== ECHO_SCHEMA_ACK) {
    return { assurance: ASSURANCE.UNAVAILABLE, reason: `not an echo acknowledgement: ${String(ackDoc?.schema)}` };
  }

  const prior = lastVerifiedWitnessSeq(asPeerId, ackDoc.ack?.witnessPeerId);
  const v = verifyWitnessAck(ackDoc.ack, pending.push, { afterWitnessSeq: prior });
  if (!v.ok) {
    // A signature that does not verify, or an ack for a different checkpoint, is a CONTRADICTION: we
    // hold two documents that cannot both be true. It is not "unavailable" — something answered.
    return { assurance: ASSURANCE.CONTRADICTED, reason: v.reason };
  }

  recordVerified(asPeerId, ackDoc.ack, pending.push?.frontier ?? null);
  // The pending push is RESOLVED, so the next `emit` may mint the next sequence. Truncated rather than
  // deleted: a file that was here and is now empty says "this pair has echoed before", which a missing
  // file does not, and that distinction is worth keeping on disk.
  try { writeAtomic(path, ''); } catch { /* the append above is the durable part */ }

  return {
    assurance: ASSURANCE.VERIFIED,
    reason: null,
    witnessPeerId: ackDoc.ack.witnessPeerId,
    receiptCount: pending.push?.frontier?.receiptCount ?? null,
    seq: pending.push?.seq ?? null,
  };
}

const verifiedPath = (peerId) => join(echoDir(), `verified-${peerId}.jsonl`);

/** Append-only, for the same reason retention is: the earliest evidence is the first thing a rewrite wants gone. */
function recordVerified(peerId, ack, frontier) {
  mkdirSync(echoDir(), { recursive: true, mode: 0o700 });
  const fd = openSync(verifiedPath(peerId), 'a', 0o600);
  try {
    // The FRONTIER is stored, not just the commitment, and that is what makes the next delta possible:
    // the sender has to know which prefix the witness already holds in order to send only what follows
    // it. Counts and digests only — nothing here is content.
    writeSync(fd, `${JSON.stringify({
      witnessPeerId: ack.witnessPeerId, witnessSeq: ack.witnessSeq, senderSeq: ack.senderSeq,
      commitment: ack.checkpointCommitment, at: ack.receivedAt, frontier,
    })}\n`);
    fsyncSync(fd);
  } finally { closeSync(fd); }
}

/** The last checkpoint a witness CONFIRMED holding for this pair — the sender's own memory of it. */
export function lastConfirmed(peerId, witnessPeerId = null) {
  try {
    const rows = readFileSync(verifiedPath(peerId), 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));
    const mine = rows.filter((r) => !witnessPeerId || r.witnessPeerId === witnessPeerId);
    return mine.length ? mine[mine.length - 1] : null;
  } catch { return null; }
}

/** The highest witness sequence already verified for this pair, or null if none. */
export function lastVerifiedWitnessSeq(peerId, witnessPeerId) {
  try {
    const rows = readFileSync(verifiedPath(peerId), 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));
    const mine = rows.filter((r) => !witnessPeerId || r.witnessPeerId === witnessPeerId);
    return mine.length ? Math.max(...mine.map((r) => Number(r.witnessSeq))) : null;
  } catch { return null; }
}


/** Is there an unresolved push for this pair? Used by `emit` and by the CLI's status line. */
export function pendingFor(peerId) {
  try {
    const text = readFileSync(pendingPath(peerId), 'utf8');
    return text.trim() ? JSON.parse(text) : null;
  } catch { return null; }
}
