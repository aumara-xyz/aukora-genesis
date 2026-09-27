// aukora · core/witness/verify.mjs — recompute, do not trust
//
// The claim this file has to earn: a stranger who does not trust Aukora, does
// not trust us, and does not run our code can still reach the same verdict with
// `shasum` and `openssl`. If that is not true, `verify` is theatre.
//
// So everything here is defined in terms a shell can reproduce, and
// `explain()` hands over the literal preimage bytes rather than describing them.

import { createHash } from 'node:crypto';

import { readAll, canonicalJSON, preimage, GENESIS_PREV, chainPath } from './chain.mjs';
import { readPub, verifyDeviceCert, verifyReceiptSig } from './aumlok.mjs';
import { repoIdentity } from './identity.mjs';
import { biographyOf, BIOGRAPHY_SCHEMA } from './action.mjs';
import { openRetention, peerFreshness, writerId, retainedCheckpoints, PEER_STATES, RETENTION_STATES } from './peer.mjs';
import { frontierOf, verifyFrontierAgainstChain } from './frontier.mjs';
import {
  ANCHOR_KINDS, readAnchors, verifyAnchor, checkLawAuthority, explainAnchor,
} from './authority.mjs';

/** The receipt body: everything except the link, the hash, and the signature. */
/**
 * The hashed body: every key the receipt carries, except the three that cannot
 * cover themselves.
 *
 * There used to be a fourth rule here — skip any key starting with `__` — because
 * `readAll()` merged `__line` and `__raw` into the entry. That made the exclusion a
 * property of the DATA: any key on disk with that prefix was removed from the
 * preimage before the hash was recomputed, so arbitrary content could be injected
 * into a receipt at rest and the chain still verified. See
 * `test/witness-injection.test.mjs` for the measurement and `chain.mjs` for why the
 * metadata now travels beside the entry instead of inside it.
 *
 * NO NAME-SHAPE EXCLUSIONS. If a key is on the line, it is in the hash.
 */
export function bodyOf(entry) {
  const out = {};
  for (const [k, v] of Object.entries(entry)) {
    if (k === 'prev' || k === 'hash' || k === 'sig') continue;
    out[k] = v;
  }
  return out;
}

/**
 * Verify a chain.
 *
 * Three independent questions, reported separately, because collapsing them
 * into one boolean is how "verified" comes to mean nothing:
 *
 *   hashes    does each receipt hash to what it says it does?
 *   links     does each receipt name a predecessor that exists?
 *   custody   is each signature from a device certified by the committed root?
 *   authority is the law file the one the owner signed?
 *
 * The fourth is the one a hash chain cannot answer about itself. `intact` is
 * still purely about the chain — it decides `aukora verify`'s exit code and
 * must not start meaning something broader — so `authority` is reported beside
 * it and folded only into `ok`.
 */

/** The schema the face narrows. Producer-owned, and named here because this is the producer. */
export const PEER_REPORT_SCHEMA = 'aukora-peer-report-v1';

/**
 * WHAT THE WITNESS SAID, PUBLISHED WHERE THE FACE ACTUALLY LOOKS.
 *
 * ══ THE GAP THIS CLOSES ══
 *
 * `core/aura/state.ts` imports `verifyChain`, and `verifyChain` carried no peer field. The peer verdict
 * lived on `verifyEverything`, which the face never calls. So `narrowPeer` correctly reported "this
 * build cannot see whether any second machine remembers this record" — a TRUE sentence for the WRONG
 * REASON, and the face had no way to tell the difference between "we asked and nobody has been told"
 * and "this build cannot ask".
 *
 * That is the same failure as the empty-chain bypass: a check guarded one level down and rebuilt one
 * level up. Grok's field run made it visible by producing a real acknowledgement that the face still
 * could not see.
 *
 * ══ ONE PRODUCER ══
 *
 * `peerFreshness` is the real producer and stays the only one. This is a PROJECTION of it, not a rival
 * computation — `verifyEverything` reuses what `verifyChain` already derived rather than deriving its
 * own, because two producers of "what the witness said" is precisely how they come to disagree.
 *
 * The state strings cross verbatim. Measured against `core/aura/state.ts`'s `AURA_PEER_STATES`: the
 * five wire values are identical and only the local constant NAMES differ (BEHIND/CONTRADICTS,
 * SILENT/NEVER_ASKED). Vocabulary has not forked; the labels are each lane's own business.
 */
export function peerReport(repoRoot, { store = null, nowMs = Date.now(), maxAgeMs = 86_400_000, reachable = true } = {}) {
  const held = store ?? openRetention();
  const verdict = peerFreshness(held, { frontier: frontierOf(repoRoot), nowMs, maxAgeMs, reachable });
  const retained = verdict.retained ?? null;
  return {
    schema: PEER_REPORT_SCHEMA,
    state: verdict.state,
    // WHICH PAIRING heard this — the channel the agreement came through. Deliberately not called
    // "the witness": a retained row records the pair, and the witness's own identity travels on the
    // ACK rather than into retention. Naming it precisely is what stops the face overclaiming.
    witnessRef: typeof retained?.peerId === 'string' ? retained.peerId.slice(0, 12) : null,
    agedMs: typeof retained?.receivedAtMs === 'number' ? Math.max(0, nowMs - retained.receivedAtMs) : null,
    // The full disagreement list, for a caller that wants to say WHICH checkpoints object. The face
    // narrows this away; a CLI does not have to.
    disagreeing: verdict.disagreeing ?? [],
    reason: verdict.reason ?? null,
    verdict,
  };
}

export function verifyChain(repoRoot, { nowMs = Date.now(), store = null, maxAgeMs = 86_400_000, reachable = true } = {}) {
  const peer = peerReport(repoRoot, { store, nowMs, maxAgeMs, reachable });
  const { records, unparsable } = readAll(repoRoot);

  const pub = readPub(repoRoot);
  const identity = repoIdentity(repoRoot);
  const custody = { ok: false, reason: pub.ok ? null : pub.reason, rootId: null, deviceId: null, certOk: false };
  if (pub.ok) {
    const cert = verifyDeviceCert(pub.pubFile);
    custody.rootId = pub.pubFile.rootId;
    custody.deviceId = pub.pubFile.device?.deviceId ?? null;
    custody.certOk = cert.ok;
    custody.ok = cert.ok;
    custody.reason = cert.ok ? null : cert.reason;
  }

  // WHICH POLICIES PRODUCED THIS RECORD. Distinct, in first-seen order, and `null` for any line
  // written before the field existed — reported rather than back-filled, because assuming an old
  // receipt was judged under today's semantics is the exact claim it cannot support.
  const policySeen = [];
  const policySeenSet = new Set();

  const hashBreaks = [];
  // ── A REPEATED HASH IS NOT A MISMATCH ────────────────────────────────────
  //
  // These used to go into `hashBreaks`, which means "this receipt does not hash to what
  // it claims" — and they were pushed carrying the hash that had just been recomputed
  // CORRECTLY, so `log.mjs` printed a hash against itself as evidence against itself:
  //
  //     line 855: hash mismatch
  //         claims     a0d0ccb7…
  //         recomputes a0d0ccb7…
  //
  // over this repository's own chain, in `verify`, the one command a skeptic runs first.
  // Nine lines further down the same output the same command explained that a fork costs
  // "one total order, not integrity" — so it contradicted itself on one screen.
  //
  // A repeated hash IS a fork, in its degenerate form: `chain.mjs` documents two guard
  // processes reading the same head and both appending, and when they also agree on the
  // millisecond, tool, path and verdict, the two receipts are the same bytes. Every one
  // of them still hashes to what it claims. Nothing is corrupt, so nothing here may
  // touch `intact` — see the note at the `intact` line for the bound on that.
  const duplicates = [];
  const sigBreaks = [];
  const byHash = new Map();
  let signed = 0;

  // `unsignedAt` collects every missing signature; `sigGaps` below (after the loop, once
  // `firstSignedLine` is known) filters it down to the ones that should not exist.
  const unsignedAt = [];
  let firstSignedLine = null;

  for (const { entry: e, line } of records) {
    const pv = typeof e.policyVersion === 'string' ? e.policyVersion : null;
    if (!policySeenSet.has(pv)) { policySeenSet.add(pv); policySeen.push(pv); }
    const body = bodyOf(e);
    const recomputed = createHash('sha256').update(preimage(e.prev ?? '', body)).digest('hex');
    if (recomputed !== e.hash) {
      hashBreaks.push({ line, claimed: e.hash, recomputed });
    }
    if (byHash.has(e.hash)) {
      // No `claimed`/`recomputed` pair on purpose. Those two field names are what invited
      // the renderer to print one against the other; a duplicate has exactly one hash and
      // the shape says so. `first` is the line it repeats.
      duplicates.push({ line, hash: e.hash, first: byHash.get(e.hash) });
    } else {
      byHash.set(e.hash, line);
    }

    // ── AN ABSENT SIGNATURE IS NOT A NEUTRAL ──────────────────────────────────
    //
    // This was a bare `continue`, ported from aukora-seed's own history before its cdfad18 fix — and
    // the same forgery aukora-seed measured applies here byte for byte, since `bodyOf` excludes `sig`
    // from the hash: take a REFUSED receipt, edit it to ALLOWED, recompute every hash after it, and
    // either forge a new signature (caught below, in sigBreaks) or simply DELETE the signature.
    // Deletion left `sigBreaks` empty and `intact` true — `aukora verify` read as clean over a record
    // that no longer said what the guard actually did.
    //
    // The rule: once this repository has signed anything, every receipt from that point on must be
    // signed. Receipts written before the repo was ever bound are legitimately unsigned and are not
    // gaps — see `sigGaps` below, which is positional rather than absolute for exactly that reason.
    if (e.sig === null || e.sig === undefined) { unsignedAt.push(line); continue; }
    if (custody.ok && verifyReceiptSig(pub.pubFile.device.devicePub, e.hash, e.sig)) {
      signed += 1;
      if (firstSignedLine === null) firstSignedLine = line;
    } else {
      sigBreaks.push({ line, reason: custody.ok ? 'signature does not verify' : 'no verified custody to check against' });
    }
  }

  // A gap is an unsigned receipt that comes AFTER the first receipt in this file that is still
  // signed — everything before that is honest pre-binding history (a repository that adopted this
  // late has unsigned receipts behind it, and calling those forgeries would make adoption
  // impossible). This still holds against an attacker: slipping an unsigned receipt in among signed
  // ones means recomputing every hash after it, which invalidates those receipts' own signatures and
  // lands them in `sigBreaks` — appending at the end is the cheap move, and the end is always after
  // the first signed receipt.
  //
  // NOT YET PORTED from aukora-seed: a checkpoint-attested reference point that also catches every
  // signature being stripped at once (which leaves no `firstSignedLine` for this rule to measure
  // from), and an `unknownFields` guard against `__`-prefixed keys riding outside the signed body.
  // Both are real, both are next — this closes the confirmed hole (verify exits 0 on a chain with
  // its signatures simply deleted), not the whole of what aukora-seed has since found past it.
  const sigGaps = unsignedAt
    .filter((line) => firstSignedLine !== null && line > firstSignedLine)
    .map((line) => ({
      line,
      reason: 'unsigned, but this repository was already signing by this point — a signature was removed, or the device key was missing',
    }));

  // ── links and forks ──────────────────────────────────────────────────────
  // A receipt's `prev` must be genesis or some other receipt's hash. Two
  // receipts naming the SAME prev is a fork, not corruption: two guard
  // processes honestly ran at once. Report it by name and position.
  const orphans = [];
  const prevUse = new Map();
  for (const { entry: e, line } of records) {
    if (e.prev !== GENESIS_PREV && !byHash.has(e.prev)) {
      orphans.push({ line, prev: e.prev });
    }
    const seen = prevUse.get(e.prev) ?? [];
    seen.push(line);
    prevUse.set(e.prev, seen);
  }
  const forks = [...prevUse.entries()]
    .filter(([, lines]) => lines.length > 1)
    .map(([prev, lines]) => ({ prev, lines }));

  const referenced = new Set(records.map((r) => r.entry.prev));
  const heads = records.filter((r) => !referenced.has(r.entry.hash)).map((r) => ({ line: r.line, hash: r.entry.hash }));

  // `duplicates` is deliberately NOT folded in. This is a relaxation — a chain that used
  // to exit 1 now exits 0 — and relaxations are the dangerous direction, so the bound is
  // named here and pinned by a test: a receipt whose BYTES were edited still lands in
  // `hashBreaks` and still fails this, which is what
  // `test/witness-verify-duplicate.test.mjs` asserts last and separately. What a duplicate
  // costs is not integrity but COUNTING — `counts` below, and the "N allowed" line the
  // renderer prints, cannot tell a concurrent double-write from a deliberate replay,
  // because they are the same bytes. That is why duplicates are reported rather than
  // swallowed; see `renderVerify`.
  const intact = hashBreaks.length === 0 && orphans.length === 0 && unparsable.length === 0;
  const authority = verifyAnchors(repoRoot, pub);

  // ── THE SIGNED CHECKPOINTS, ACTUALLY READ ────────────────────────────────
  //
  // Every hour the guard signs `{ head, repoId, writer, chainFile }` and appends it to the anchors.
  // The `writer` field is inside the SIGNED subject on purpose, not cosmetic. Nothing
  // ever read `subject.head`. The object was signed, verified as well-formed, and used as evidence
  // about nothing — which is a worse state than not having it, because a reader sees a signed
  // checkpoint and assumes it was checked.
  //
  // What can honestly be checked LOCALLY: a head this device signed must still be somewhere in the
  // chain. Heads are only ever appended, so a signed head that has vanished means the chain was
  // rewritten below the point this device vouched for.
  //
  // What this does NOT buy, and the distinction is the whole of LIMITS §12: the anchors live in the
  // same tree as everything else and are signed by a key on the same machine, so an attacker who
  // rewrites the chain can rewrite these too. This catches accident, careless tampering, and a
  // partial job. It does not catch a determined local attacker. Only a copy retained somewhere the
  // writer cannot reach does that.
  const checkpointBreaks = [];
  for (const { record, line } of readAnchors(repoRoot, 'checkpoint').records) {
    const signedHead = record?.subject?.head;
    if (typeof signedHead !== 'string' || signedHead.length !== 64) continue;
    if (signedHead === GENESIS_PREV) continue;                  // an empty chain vouched for nothing
    if (!byHash.has(signedHead)) {
      checkpointBreaks.push({
        line, head: signedHead, at: record.at ?? null,
        reason: 'a head this device signed is no longer anywhere in the chain — it was rewritten below that point',
      });
    }
  }

  return {
    ok: intact && sigBreaks.length === 0 && sigGaps.length === 0 && checkpointBreaks.length === 0
      && custody.ok && authority.ok,
    intact,
    // ── the exit-code question, answered here rather than at the CLI ──────────
    //
    // `intact` is about the hash chain alone and must stay that way — it is purely structural, and a
    // forged chain is trivially "intact" because the attacker is the one who recomputed it. But
    // `renderVerify` returned `intact ? 0 : 1`, so deleting a signature exited 0 under a green "chain
    // intact". This asks the question the CLI actually needs instead of borrowing the structural one.
    //
    // Custody is deliberately excluded, matching aukora-seed: a repository that has never been bound
    // has no key and no signatures, and `aukora verify` must still exit 0 there or the tool is broken
    // for every repository that has not adopted the signed-law layer yet — see LIMITS on binding.
    //
    // `authority.ok` is NOT excluded for the same reason custody is, and its absence here was a real
    // gap — MEASURED tonight by direct reproduction of the identical bug in aukora-seed's own
    // verify.mjs (its `trustworthy` never consulted `authority.ok` either): a checkpoint anchor
    // genuinely signed over the real chain head, plus `aukora.law.json` edited afterward, verified
    // every hash and every signature clean while `checkLawAuthority` correctly returned `ok: false`
    // underneath — `ok` (above) already folds that in; `trustworthy` silently didn't.
    //
    // It is not a blanket `&& authority.ok` though — first attempt at this fix broke a real, legitimate
    // state: `boundRepo()` in test/witness-verify-trustworthy.test.mjs has device custody (can sign
    // receipts) but never sealed a law anchor at all, which `checkLawAuthority` correctly reports as
    // `ok: false, state: 'law-unsigned'` — same "has not adopted this layer yet" shape as `unbound`,
    // just for the law-sealing ceremony specifically rather than binding. `unbound` already returns
    // `ok: true`, so it needs no special case; `law-unsigned` does not, so it is named explicitly. Every
    // OTHER not-ok state (`downgraded`, `law-forged`, `law-unreadable`, `law-mismatch`) is a real signal
    // and still fails `trustworthy`, which is the actual bug this closes.
    trustworthy: intact && sigBreaks.length === 0 && sigGaps.length === 0 && checkpointBreaks.length === 0
      && (authority.ok || authority.law.state === 'law-unsigned'),
    // ── IS THIS NODE BOUND? Said here, once, rather than re-derived by everyone who asks ──────
    //
    // The whole answer was already computed above and never stated. `custody.ok` is
    // `verifyDeviceCert(pubFile).ok`, which is the difference between binding material being PRESENT
    // and it genuinely being this root's — and the gap between those two is where the bug lives. A
    // swapped device half, a revoked key, or an `aukora.pub` copied out of another repository all
    // pass "the file is there" and fail "the certificate verifies".
    //
    // MEASURED, in the AURA lane: `aukora.pub` was read for two strings, custody was checked by
    // nobody, and the face printed two contradictory sentences on one screen — "the record is sound
    // but this node is not bound — nothing has signed for it", directly above the word "bound". That
    // lane could not simply ask this function, because this lane's own path fence correctly refuses
    // it `core/witness/**`; so it synthesized the field and left a note saying the tidy fix belonged
    // here. This is that fix, and the synthesis goes away in their follow-up.
    //
    // A DERIVED FIELD, NOT A SECOND OPINION. It is `custody.ok` and nothing else — never `&& intact`,
    // never `&& authority.ok`. `bound` reports a FACT about custody; `ok` and `trustworthy` above are
    // the ones that GRADE the node, and neither is touched by this line: both are expressions over
    // locals computed before this object literal exists. In particular `trustworthy` still excludes
    // custody on purpose, so an unbound repository — a legitimate state, and the one every repository
    // is in before it adopts the signed-law layer — stays trustworthy and still exits 0.
    // Pinned in both directions by test/witness-bound.test.mjs.
    bound: custody.ok,
    /**
     * WHICH RECORD THIS VERDICT IS ABOUT.
     *
     * A chain is keyed by identity, not by path, so "the chain verified clean" is only meaningful
     * beside which chain. Repointing `origin` selects a different file, and a verdict that does not
     * name its subject reports success about a record nobody asked for. Content-free: a truncated
     * identity, how it was derived, and the file — no receipt contents.
     */
    identity: { id: identity.id, source: identity.source, chainFile: chainPath(repoRoot) },
    /**
     * The policies this record was produced under, distinct and in first-seen order.
     *
     * "The chain is intact" is a weaker sentence than anyone reads it as, if the reader cannot also
     * see which rules produced the lines that are intact. A `null` here is a line written before the
     * field existed and is reported as such — never assumed to be the current policy.
     */
    policyVersions: policySeen,
    receipts: records.length,
    // THE PEER SECTION, published from the function the face calls. See `peerReport`.
    peer,
    // THE ONE CANONICAL BIOGRAPHY PROJECTION. Published here, from the verified chain, so there is a
    // single place the question "what is this evidence of" gets answered — and so no surface has to
    // invent its own reading of `unguarded`. Coverage is `receipts` ABOVE, deliberately outside this
    // object: a total that sits inside a biography is a total that gets read as part of one.
    biography: biographyOf(records.map((r) => r.entry).filter(Boolean)),
    signed,
    unsigned: records.length - signed - sigBreaks.length,
    heads,
    forks,
    hashBreaks,
    duplicates,
    sigBreaks,
    sigGaps,
    checkpointBreaks,
    orphans,
    unparsable,
    custody,
    authority,
    counts: countVerdicts(records.map((r) => r.entry)),
  };
}

/**
 * Every anchor, re-checked from the committed public half.
 *
 * This is the part a stranger cares about most and the part that is cheapest to
 * fake: an anchor file full of well-formed JSON proves nothing until someone
 * runs the signatures. So each record is verified individually — including its
 * `signedBy`, so a checkpoint the device signed cannot be filed as a law — and
 * the counts are reported per kind rather than as one boolean.
 *
 * `law` is the verdict the guard acts on, restated here so that what a stranger
 * reads and what the fence enforces come from the same function.
 */
export function verifyAnchors(repoRoot, pub = readPub(repoRoot)) {
  const rootPub = pub.ok ? pub.pubFile.rootPub : null;
  const devicePub = pub.ok ? (pub.pubFile.device?.devicePub ?? null) : null;

  const kinds = {};
  const breaks = [];
  let total = 0;

  for (const kind of ANCHOR_KINDS) {
    const { records, unparsable } = readAnchors(repoRoot, kind);
    let good = 0;
    for (const { record, line } of records) {
      const v = verifyAnchor(record, { rootPub, devicePub });
      if (v.ok) good += 1;
      else breaks.push({ kind, line, reason: v.reason });
    }
    for (const u of unparsable) breaks.push({ kind, line: u.line, reason: `not JSON — ${u.reason}` });
    total += records.length;
    kinds[kind] = { count: records.length, verified: good, latest: records[records.length - 1]?.record ?? null };
  }

  // ── HAS THE RECORD BEEN SEPARATED FROM THE REPOSITORY? ────────────────────
  //
  // A chain is keyed by `sha256(origin_url + root_commit)`, which is what makes renaming a checkout
  // safe. It also makes `git remote set-url` a SWITCH: the identity changes, a different file is
  // read, and nothing says so. Measured — three receipts, repoint origin, "chain intact · 1 receipt",
  // exit 0, the prior three orphaned in silence. Not corruption; substitution, reported as success.
  //
  // The evidence was already being written and simply was not read: every checkpoint anchor carries
  // `repoId` inside the subject a DEVICE KEY SIGNED. So this compares a signed claim about which
  // repository the record belongs to against the repository actually being verified. It cannot be
  // forged without the device key, and it costs one comparison.
  //
  // Scope, stated rather than implied: this DETECTS the switch, it does not prevent it, and it
  // cannot recover the orphaned chain. A node that has never bound has no signed checkpoint to
  // compare against and gets nothing from this. See docs/LIMITS.md.
  const latestCheckpoint = kinds.checkpoint?.latest ?? null;
  const signedRepoId = latestCheckpoint?.subject?.repoId ?? null;
  const current = repoIdentity(repoRoot);
  if (signedRepoId && current.id && signedRepoId !== current.id) {
    breaks.push({
      kind: 'checkpoint',
      line: null,
      reason: `identity changed since this record was anchored — signed over ${signedRepoId.slice(0, 12)}, `
        + `this repository now answers to ${current.id.slice(0, 12)}. The chain being read is not the one `
        + 'that was checkpointed; an origin URL or the root commit has moved.',
    });
  }

  const law = checkLawAuthority(repoRoot);

  return {
    ok: breaks.length === 0 && law.ok,
    anchors: total,
    kinds,
    breaks,
    /** Which record this verified, said out loud rather than left to be inferred from a path. */
    identity: { id: current.id, source: current.source, chainFile: chainPath(repoRoot) },
    law: {
      ok: law.ok, state: law.state, reason: law.reason, hint: law.hint,
      expected: law.expected ?? null, actual: law.actual ?? null, signedAt: law.signedAt ?? null,
    },
  };
}

/**
 * The anchor half of `--explain`. Same promise as `explain()` above: the
 * literal bytes, not a description of them.
 */
export function explainLawAnchor(repoRoot) {
  const { records } = readAnchors(repoRoot, 'law');
  const record = records[records.length - 1]?.record;
  if (!record) return { ok: false, reason: 'no law anchor — this repository has not signed its law' };
  const pub = readPub(repoRoot);
  const x = explainAnchor(record);
  return {
    ok: true,
    record,
    ...x,
    verified: verifyAnchor(record, { rootPub: pub.ok ? pub.pubFile.rootPub : null }),
    // The subject hash is over the law file's raw bytes, so this is the whole
    // of what a skeptic needs to check that the file on disk is the signed one.
    lawRecipe: `shasum -a 256 ${record.subject?.file ?? 'aukora.law.json'}`,
  };
}

function countVerdicts(entries) {
  const c = { refused: 0, allowed: 0, unguarded: 0, other: 0 };
  for (const e of entries) {
    if (e.verdict === 'refused' || e.verdict === 'allowed' || e.verdict === 'unguarded') c[e.verdict] += 1;
    else c.other += 1;
  }
  return c;
}

/**
 * Hand a skeptic the literal bytes.
 *
 * Two recipes, because they fail in different directions:
 *
 *   jq  — readable, and reproduces the canonical body if and only if jq's
 *         serialiser agrees with ours. It does today; a test asserts it.
 *   hex — the preimage itself. Cannot disagree with anything. This is the one
 *         to reach for if the jq recipe ever gives a different answer, because
 *         then the disagreement is the finding.
 */
export function explain(repoRoot, lineNumber) {
  const { records } = readAll(repoRoot);
  const rec = records.find((r) => r.line === lineNumber) ?? records[records.length - 1];
  if (!rec) return { ok: false, reason: 'no receipts' };
  const { entry: e, line } = rec;

  const body = bodyOf(e);
  const canonical = canonicalJSON(body);
  const bytes = preimage(e.prev, body);
  const recomputed = createHash('sha256').update(bytes).digest('hex');

  return {
    ok: true,
    line,
    prev: e.prev,
    canonical,
    preimageHex: bytes.toString('hex'),
    claimed: e.hash,
    recomputed,
    matches: recomputed === e.hash,
    recipes: {
      // `prev` is stripped from the body as well as `hash` and `sig` — it is
      // the other half of the preimage, not part of what is being hashed.
      // The chain path is RESOLVED, not written here: chains live at
      // ~/.aukora/chains/<identity>.jsonl since 4630587, and a hardcoded
      // `.aukora/chain.jsonl` would hand the skeptic the legacy file — which
      // verifies clean forever, because nothing appends to it anymore.
      jq: `sed -n '${line}p' ${chainPath(repoRoot)} | jq -j '.prev + (del(.prev,.hash,.sig)|to_entries|sort_by(.key)|from_entries|tojson)' | shasum -a 256`,
      hex: `printf '%s' '${bytes.toString('hex')}' | xxd -r -p | shasum -a 256`,
    },
  };
}


/**
 * THE ONE ENTRY POINT — chain integrity, checkpoint authenticity, and remote retention, joined.
 *
 * ══ WHY JOINING THEM IS THE POINT ══
 *
 * These were three separate objects and nothing composed them, so "verified" meant whichever of the
 * three the caller happened to ask for. Each answers a question the others cannot:
 *
 *   verifyChain    do the surviving receipts hash and link? — says NOTHING about what was deleted.
 *   verifyAnchors  were the checkpoints signed by a certified device, over this repository?
 *   peerFreshness  does a second machine still hold a FRONTIER — every head at once — that this
 *                  chain can no longer produce? (It stopped being a head comparison in #139; asking
 *                  about one of 52 heads was a question whose answer could not catch a deleted branch.)
 *
 * The third is the only one that catches truncation, because every prefix of a valid chain is a valid
 * chain. A caller who ran the first alone would get a clean bill of health over a chain with its last
 * four hundred lines removed — and that reading was available today, from the entry point everyone
 * uses.
 *
 * ══ THE PEER HALF IS NOT OPTIONAL-BY-SILENCE ══
 *
 * `peers: false` means "I am deliberately not asking", and says so in the verdict. It does NOT mean
 * "no problems found". A verdict that renders an unasked question the same as an answered one is the
 * exact failure this composition exists to remove, so `peerChecked` is always present and always
 * explicit.
 */
export function verifyEverything(repoRoot, { peers = true, store = null, nowMs = 0, maxAgeMs = 86_400_000, reachable = true } = {}) {
  // The peer options travel INTO verifyChain, so the section it publishes and the verdict used here
  // are the same computation rather than two that happen to agree today.
  const heldOnce = store ?? openRetention();
  const chain = verifyChain(repoRoot, { store: heldOnce, nowMs, maxAgeMs, reachable });
  const anchors = verifyAnchors(repoRoot);

  if (!peers) {
    return {
      ok: false, peerChecked: false,
      reason: 'retention was not consulted — this verdict covers integrity and authenticity only, and neither can see a deletion',
      chain, anchors, peer: null,
    };
  }

  const held = heldOnce;
  // THE FRONTIER, not a head. `verifyChain` reports 52 heads on the live node; asking the witness
  // about one of them is asking a question whose answer cannot catch a deleted branch.
  // REUSED, not recomputed. Two producers of "what the witness said" is how they come to disagree.
  const peer = chain.peer.verdict;

  // ══ THE STRONG CHECK, AND WHY IT BELONGS HERE AND ONLY HERE ══
  //
  // `peerFreshness` compares digests, because on a WITNESS there is nothing else to compare — it has
  // no ledger. This function is the other case: it runs on the writer's own node, so it holds the
  // bytes and can re-derive the witnessed prefix rather than take the count's word for it.
  //
  // It was not wired in, and the omission was disguised twice over: `compareFrontier` returned
  // `ok: true` with a reason string NAMING this check, and a comment in `peer.mjs` said it happened
  // "in verifyEverything". Neither was true — `verifyFrontierAgainstChain` had zero callers through
  // two rounds, including the round that fixed the witness side. A function nobody calls is not a
  // check, however precisely two comments describe it.
  //
  // EVERY retained checkpoint, not just the latest, for the same reason `peerFreshness` walks them
  // all: a prefix rewritten below an OLD checkpoint is invisible to the newest one, and the old
  // evidence is exactly what append-only retention was kept for.
  // UNGATED BY FRESHNESS, and that was a real hole in the first version of this: the loop ran only
  // when the peer verdict was ok or BEHIND, and a checkpoint older than `maxAgeMs` reports STALE. So
  // an attacker who rewrote a witnessed prefix and WAITED A DAY skipped the check entirely.
  //
  // Staleness is about CURRENCY, not validity. A checkpoint from last month is weak evidence that the
  // chain is current and perfect evidence about what its prefix used to be — and a prefix does not
  // expire. The only thing that disqualifies a retained row here is a store that could not be read,
  // which `peerFreshness` has already named.
  const rewritten = [];
  if (held?.state !== RETENTION_STATES.CORRUPT && held?.state !== RETENTION_STATES.UNREADABLE) {
    const now = frontierOf(repoRoot);
    for (const h of retainedCheckpoints(held, now.repoId, now.writerEpoch)) {
      const strong = verifyFrontierAgainstChain(repoRoot, h.frontier);
      if (!strong.ok) rewritten.push({ seq: h.seq, state: strong.state, reason: strong.reason });
    }
  }

  // HAS THIS NODE EVER BEEN WITNESSED? Distinct from "does a witness agree right now". A node that was
  // witnessed and can no longer reach its witness has LOST assurance it once had; a node that was never
  // witnessed never had any. Those are different sentences, and the exit code has to say which.
  const mine = frontierOf(repoRoot);
  const witnessedBefore = retainedCheckpoints(held, mine.repoId, mine.writerEpoch).length > 0;

  return {
    // Every part must hold. `ok` here is a stronger claim than any of the three alone, and it is the
    // only one that survives the sentence "a signed prefix is still a valid prefix".
    ok: chain.ok && anchors.ok && peer.ok && rewritten.length === 0,
    peerChecked: true,
    witnessedBefore,
    chain, anchors, peer,
    // Its own field rather than folded into `peer`, because this is a claim about OUR chain measured
    // against what a witness holds — a different question from whether the witness is current.
    rewritten,
    reason: rewritten.length
      ? `the chain grew, but ${rewritten.length} witnessed prefix(es) are no longer in it: ${rewritten[0].reason}`
      : (peer.ok ? null : peer.reason),
  };
}

export { PEER_STATES };

/**
 * ══ THERE IS NO `biographyFor` ADAPTER, AND THAT IS THE CORRECTION ══
 *
 * One was built here as "the single adapter", and it acquired ZERO production callers: `log.mjs` and
 * `core/aura/state.ts` both already hold a `verifyChain` result and read `.biography` off it. The
 * wrapper re-verified the chain in order to hand back fields its callers were already holding, so
 * using it would have cost a second full read to gain nothing.
 *
 * It also shipped with a test that asserted its own existence by counting `export function
 * biographyFor` in the source text — which proves a name is present, not that anything calls it. That
 * is the exact defect class this lane has corrected in three other files, committed here.
 *
 * So the field is read directly, and that is stated rather than left to be inferred:
 *
 *     verifyChain(root).biography   the five classes + uninspectableShellCalls, under BIOGRAPHY_SCHEMA
 *     verifyChain(root).receipts    coverage, deliberately beside and never inside
 *     verifyChain(root).trustworthy whether any of it is evidence at all
 *
 * One CALL, so there is still nothing to double-count: a consumer that wants the biography already has
 * the verdict and the coverage in the same object and never needs a second source.
 */

