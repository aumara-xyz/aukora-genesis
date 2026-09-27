// aukora · core/eye/receipt.mjs — A RECEIPT FOR LOOKING
//
// ══ THE GAP ══
//
// `surface/door.ts` gates the eye: `requestAction('spend', 'her eye')` runs before the body is even
// read, so a look is judged and billed. It is not in the witness chain. So the record — the thing that
// answers "what has she actually done here" — contains every file she was allowed to write and NOT ONE
// FRAME OF THE OWNER'S SCREEN THAT SHE WAS SHOWN.
//
// A seeing that leaves no receipt is an absence, and an absence renders as zero. Of all the things
// this system could fail to record, an AI looking at its owner's screen is the one that most needs to
// be in the record rather than only in the billing.
//
// ══ WHAT IT MAY CARRY, AND THE FIELD IT DOES NOT HAVE ══
//
// Digests and counts. NEVER the frame, never the critique text, never the goal the owner typed. A
// receipt carrying the picture would be the surveillance dossier the fence exists to prevent, written
// by the fence itself — and unlike a leaked file, a chain is append-only, so it could never be taken
// back.
//
// `chain.mjs`'s `buildBody` is a CLOSED FIELD SET: anything not in its signature is dropped before
// hashing. That is a good property and this module works inside it rather than around it —
// `core/witness/**` is law-protected and widening the body is the owner's call, not this lane's. So
// the frame's identity travels in the two fields that already mean "the subject of this act":
//
//     path      frame:<digest12>              the short reference
//     resolved  frame:<digest12>@<w>x<h>      the fully-qualified one, dimensions included
//
// Named `frame:` rather than left bare precisely so nobody reads it as a filesystem path later.
//
// ══ THE OFF-MACHINE LOOK IS THE LOUD ONE ══
//
// If a frame leaves this machine for a vendor, that is the most consequential thing this system can
// record. It gets its own `reasonClass` — not a flag inside a shared one — so it is greppable,
// countable, and impossible to average away against the local case.

import { createHash } from 'node:crypto';

import { append } from '../witness/chain.mjs';

/**
 * The closed vocabulary for looking. Three classes and no more, and the split is on the one question
 * that matters afterwards: did the picture leave the machine.
 */
export const EYE_CLASSES = Object.freeze({
  ON_MACHINE: 'eye:looked-on-machine',
  OFF_MACHINE: 'eye:looked-off-machine',
  REFUSED: 'eye:refused',
});

/** Which engines are somebody else's computer. Mirrors `crush.LOOK_EYE_IS_REMOTE`, verified by test. */
export const REMOTE_EYES = Object.freeze(['grok', 'auma-remote', 'openrouter']);

/**
 * The frame's identity, and ONLY its identity.
 *
 * Twelve hex characters of sha256 over the data URL. Enough to say "this is the same frame as that
 * one" and to correlate a look with a later one; not enough to be anything else. The full digest is
 * deliberately truncated — a receipt is not a place to store a handle to content, and 48 bits of
 * collision resistance is ample for "were these two looks at the same screen".
 */
export function frameDigest(dataUrl) {
  return createHash('sha256').update(String(dataUrl ?? ''), 'utf8').digest('hex').slice(0, 12);
}

/**
 * Dimensions from a data URL, WITHOUT decoding the image.
 *
 * Reads the handful of header bytes PNG and JPEG put their size in. Returns null rather than guessing:
 * a receipt that carried made-up dimensions would be worse than one that carried none, and this is a
 * best-effort field on a record whose other fields are exact.
 */
export function frameDimensions(dataUrl) {
  const m = /^data:image\/(png|jpeg|webp);base64,(.*)$/.exec(String(dataUrl ?? ''));
  if (!m) return null;
  let buf;
  try { buf = Buffer.from(m[2].slice(0, 4096), 'base64'); } catch { return null; }

  if (m[1] === 'png' && buf.length >= 24 && buf.toString('latin1', 12, 16) === 'IHDR') {
    return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) };
  }
  if (m[1] === 'jpeg') {
    // Walk the segment headers to the first frame marker. Bounded by the slice above, so a malformed
    // file runs out of buffer and returns null rather than looping.
    let i = 2;
    while (i + 9 < buf.length) {
      if (buf[i] !== 0xff) { i += 1; continue; }
      const marker = buf[i + 1];
      if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
        return { height: buf.readUInt16BE(i + 5), width: buf.readUInt16BE(i + 7) };
      }
      i += 2 + buf.readUInt16BE(i + 2);
    }
  }
  return null;
}

/**
 * Record one look in the witness chain.
 *
 * NEVER THROWS. A chain that cannot be written must not take the door down — the same rule
 * `guard.mjs` keeps — but unlike the guard, the failure is RETURNED so a caller can say the record is
 * incomplete rather than assume it is not.
 *
 * The verdict is always `unguarded` and the OUTCOME is in `reasonClass` — see the note at that field,
 * which is the most consequential decision in this module.
 */
export function receiptForLook(repoRoot, {
  dataUrl, eye = null, mode = 'critique', session = '', agent = null, refused = null, at = null,
}) {
  const digest = frameDigest(dataUrl);
  const dims = frameDimensions(dataUrl);
  const offMachine = eye !== null && REMOTE_EYES.includes(eye);

  const body = {
    ts: at ?? new Date().toISOString(),
    tool: 'Eye',
    // The SUBJECT of the act, addressed by content rather than by location. Prefixed `frame:` so it
    // cannot be mistaken for a path by anything reading this chain later.
    path: `frame:${digest}`,
    resolved: dims ? `frame:${digest}@${dims.width}x${dims.height}` : `frame:${digest}`,
    // ══ `unguarded`, AND THIS IS THE LOAD-BEARING CHOICE IN THIS FILE ══
    //
    // `verdict` is the FENCE's vocabulary, and `classifyReceipt` maps `allowed`/`refused` to
    // JUDGED_WRITE_PATH — which is the one number `standingOf` counts. Measured before writing this:
    // an eye receipt carrying `allowed` classified as `witness:judged-write-path`, so every look would
    // have inflated her standing. `figure.ts` predicts that failure in as many words — "if talking ever
    // writes to the chain that standing counts, chat volume becomes standing" — and says the rule lives
    // in whatever appends the receipts. That is this file.
    //
    // The fence did not judge this. It cannot: `guard.mjs` judges declared write PATHS, and a frame is
    // not one. What judged the look was the standing seam, which permitted a SPEND. So the honest
    // verdict is `unguarded` — recorded, and not inspected by the law — with the real outcome in
    // `reasonClass`, where it is greppable and countable without being counted as a deed.
    //
    // A dedicated EYE class in `core/witness/action.mjs` would say this better than borrowing
    // `unguarded` does. That file is law-protected and widening the taxonomy is the owner's call, so
    // this is the honest shape available today rather than the best one imaginable.
    verdict: 'unguarded',
    reasonClass: refused ? EYE_CLASSES.REFUSED : (offMachine ? EYE_CLASSES.OFF_MACHINE : EYE_CLASSES.ON_MACHINE),
    // WHICH EYE ANSWERED. `rule` is "what decided this outcome", and for a look that is the engine.
    // For a refusal it is the refusal class the door returned, which is the same kind of fact.
    rule: refused ? String(refused) : (eye === null ? null : String(eye)),
    session: String(session ?? ''),
    agent,
    mode: String(mode ?? ''),
  };

  try {
    const { entry } = append(repoRoot, body);
    return { ok: true, entry, digest, offMachine, dimensions: dims };
  } catch (e) {
    return { ok: false, reason: e?.message ?? 'the look could not be recorded', digest, offMachine };
  }
}

/**
 * WHAT THE EYE DID, over a set of receipts.
 *
 * Published as counts the way `biographyOf` is, and kept SEPARATE from it: looking is neither a
 * judged write path nor shell nobody could inspect, and folding it into either would lose the one
 * distinction that matters here.
 *
 * `offMachine` is its own number rather than a share of the total. "She looked 40 times" and "4 of
 * those frames went to a vendor" are different sentences, and a percentage would let the second
 * disappear into the first.
 */
export function eyeReport(receipts) {
  let onMachine = 0;
  let offMachine = 0;
  let refused = 0;
  const engines = {};
  const frames = new Set();

  for (const r of receipts ?? []) {
    if (!r || r.tool !== 'Eye') continue;
    if (typeof r.path === 'string' && r.path.startsWith('frame:')) frames.add(r.path.slice(6));
    if (r.reasonClass === EYE_CLASSES.OFF_MACHINE) offMachine += 1;
    else if (r.reasonClass === EYE_CLASSES.ON_MACHINE) onMachine += 1;
    else if (r.reasonClass === EYE_CLASSES.REFUSED) { refused += 1; continue; }
    if (typeof r.rule === 'string' && r.rule) engines[r.rule] = (engines[r.rule] ?? 0) + 1;
  }

  return {
    schema: 'aukora-eye-report-v1',
    looks: onMachine + offMachine,
    onMachine,
    offMachine,
    refused,
    // DISTINCT frames, beside the look count. Forty looks at one frame and forty at forty different
    // ones are not the same event, and only one of them is a session of work.
    distinctFrames: frames.size,
    engines,
  };
}
