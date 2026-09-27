// aukora · core/ceremony/bind.mjs — THE BINDING, PROPOSED BEFORE IT IS PERFORMED
//
// ══ WHY THIS EXISTS ══
//
// `bind()`, `writeCustody()`, `sealGenesis()` and `sealLaw()` have been written, reviewed and tested
// for rounds, and NOTHING IN PRODUCTION HAS EVER CALLED THEM. `bin/witness.mjs` had no bind verb, so
// the owner's node has stayed `bound: false` with 0 of 12,163 receipts signed — and the face, whose
// SHAPE is seeded from `genesisRef`, has had nothing of him to be shaped by. It falls back to the same
// pattern for everyone, forever, until this runs once.
//
// ══ PROPOSE, JUDGE, ACCEPT, RECEIPT ══
//
// The owner asked for her to build her own binding from the inside out, and that is architecturally
// right rather than merely nice: a ceremony that mints the root key is the single most consequential
// thing this system can do, and it should go through exactly the machinery every other consequential
// thing goes through.
//
//   PROPOSE  `proposeBinding` reads the world and returns a PLAN. It writes nothing, mints nothing,
//            and touches no key material. Every field is inspectable and content-free, so the plan can
//            be shown, diffed, argued with, and carried between machines.
//   JUDGE    the plan names every path it will write. `aukora.pub` is inside the repository, so the
//            guard judges it like any other declared write; the keyring paths are outside it and are
//            named as such rather than hidden.
//   ACCEPT   `acceptBinding` performs exactly the plan it is handed, and refuses if the world has
//            moved underneath it.
//   RECEIPT  the acceptance appends to the chain through the ordinary path, so the binding is the
//            first thing the newly-bound chain can prove about itself.
//
// ══ WHAT THIS DELIBERATELY DOES NOT DECIDE ══
//
// Whether a 0600 file on disk is what "device-bound" ought to mean. Neither lineage has a Secure
// Enclave path, and choosing on the owner's behalf would be the overclaim this whole repository exists
// to refuse. `docs/BINDING-DECISION.md` states the options and does not pick one; the plan carries the
// same statement so nobody accepts without reading it.

import { createHash, createPublicKey } from 'node:crypto';
import { readFileSync, rmSync, openSync, writeSync, fsyncSync, closeSync, renameSync } from 'node:fs';
import { join } from 'node:path';

import {
  bind, writeCustody, readPub, keysDir, ensureDeviceSecret, mintRecoverySecret, unwrapRoot, unwrapRootByRecovery,
} from '../witness/aumlok.mjs';
import { sealGenesis, sealLaw, readAnchors } from '../witness/authority.mjs';
import { repoIdentity } from '../witness/identity.mjs';
import { verifyChain } from '../witness/verify.mjs';

export const PLAN_SCHEMA = 'aukora-binding-plan-v1';

/**
 * THE DIGEST THAT BINDS AN APPROVAL TO WHAT WAS APPROVED.
 *
 * `aukora bind` printed a plan and `--accept` then called `proposeBinding` again and used THAT. So the
 * owner read one thing and accepted another — nothing carried his approval from the screen he read to
 * the act he authorised. Between the two, another node could have bound this repository, or the law
 * could have changed, and the acceptance would have proceeded against a world he never saw.
 *
 * ══ WHAT IS IN, AND WHAT IS DELIBERATELY OUT ══
 *
 * IN: everything whose change would mean he approved a different thing — which repository, whether it
 * is already bound, every path that will be written, and the options presented for the one decision
 * the code will not make.
 *
 * OUT: `at`, and the receipt and signature counts. Those move every few seconds on a live node, and a
 * digest over them would refuse the ceremony for a reason unrelated to its safety — the same reasoning
 * `acceptBinding` already applies when it re-checks the world. A guard that cries wolf gets switched
 * off, and this one has exactly one chance to be believed.
 */
export function planDigest(plan) {
  const bound = {
    schema: plan?.schema ?? null,
    repoId: plan?.repoId ?? null,
    alreadyBound: plan?.alreadyBound ?? null,
    ready: plan?.ready ?? null,
    bound: plan?.before?.bound ?? null,
    genesisAnchors: plan?.before?.genesisAnchors ?? null,
    lawAnchors: plan?.before?.lawAnchors ?? null,
    writes: plan?.writes ?? null,
    // The PROMISES are bound; the live count inside one of them is not. `doesNotDo` interpolates the
    // receipt total ("the 12,644 receipts already written stay unsigned"), so digesting it verbatim
    // made every approval expire within seconds of being printed. Digits are normalised so a change to
    // what the ceremony PROMISES still invalidates an approval while a chain that grew does not.
    // Caught by the test, not by review.
    doesNotDo: (plan?.doesNotDo ?? []).map((line) => String(line).replace(/\d[\d,]*/g, '#')),
    options: plan?.ownerDecision?.options ?? null,
    chosen: plan?.ownerDecision?.chosen ?? null,
  };
  return createHash('sha256').update(JSON.stringify(bound), 'utf8').digest('hex').slice(0, 16);
}

/**
 * WHAT A BINDING WOULD DO, WITHOUT DOING ANY OF IT.
 *
 * Pure with respect to key material: nothing is minted here, so a plan can be produced a hundred times
 * and printed in a chat log without ever having existed as a secret. The counts and paths are read
 * from the world as it stands, and `acceptBinding` re-reads them and refuses if they have moved.
 */
export function proposeBinding(repoRoot, { at = null } = {}) {
  const v = verifyChain(repoRoot);
  const identity = repoIdentity(repoRoot);
  const pub = readPub(repoRoot);
  // BOTH BUGS HERE WERE MINE AND THE boundAt TEST FOUND THEM. `readAnchors(repoRoot)` was called with
  // no `kind`, so it built a path for `undefined` and read nothing; and the filter matched
  // `r.entry.kind` when the returned shape is `{ record, line }`. Between them, `genesisAnchors` and
  // `lawAnchors` reported 0 on every repository including a bound one — numbers in a plan the owner is
  // asked to approve, and they were structurally incapable of being anything but zero.
  const genesisAnchors = (readAnchors(repoRoot, 'genesis').records ?? []).length;
  const lawAnchors = (readAnchors(repoRoot, 'law').records ?? []).length;

  const already = pub.ok ? { rootId: pub.pubFile.rootId, deviceId: pub.pubFile.device?.deviceId ?? null } : null;

  return {
    schema: PLAN_SCHEMA,
    at,
    repoId: identity.id ?? null,
    // WHAT THIS CHANGES, as numbers the owner can check afterwards.
    before: {
      bound: Boolean(v.bound),
      receipts: v.receipts,
      signed: v.signed,
      genesisAnchors,
      lawAnchors,
    },
    // EVERY PATH IT WILL WRITE, named. Two are outside the repository and the law cannot judge them —
    // said out loud rather than left for someone to discover.
    writes: {
      inRepo: ['aukora.pub'],
      outsideRepo: [
        join(keysDir(), '<rootId>.root.json'),
        join(keysDir(), '<rootId>.device.json'),
        join(keysDir(), 'device.secret'),
      ],
      anchors: ['.aukora/anchors/genesis.jsonl', '.aukora/anchors/law.jsonl'],
    },
    // WHAT IT DOES NOT DO. A ceremony that quietly rewrote history while claiming to seal it would be
    // the worst possible version of this.
    doesNotDo: [
      'no existing receipt is altered, removed or re-signed',
      `the ${v.receipts} receipts already written stay unsigned — they predate custody and calling them signed would be a lie`,
      'no chain is truncated, reordered or migrated',
    ],
    alreadyBound: already,
    // THE DECISION THAT IS NOT THE CODE'S TO MAKE. Carried in the plan so it cannot be accepted
    // unread — see docs/BINDING-DECISION.md.
    ownerDecision: {
      question: 'what should "device-bound" mean on this machine?',
      options: [
        'A · a 0600 file in ~/.aukora/keys — what this plan does today. Survives reboots and backups; readable by anything running as this user, and by anyone who restores the backup.',
        'B · a passphrase-only wrap with no device factor — portable between machines, and back to a 14.34-bit secret standing alone.',
        'C · wait for a Secure Enclave / TPM path — neither lineage has one, so this means staying unbound indefinitely.',
      ],
      chosen: null,
      note: 'This plan implements A. Nothing here chooses it on the owner\'s behalf; accepting it is the choice.',
    },
    ready: !already,
    reason: already ? `this repository is already bound to root ${already.rootId}` : null,
  };
}

/** The plan, with the digest that binds an approval to it. Split so `planDigest` sees a finished plan. */
export function proposeBindingWithDigest(repoRoot, opts = {}) {
  const plan = proposeBinding(repoRoot, opts);
  return { ...plan, planDigest: planDigest(plan) };
}

/**
 * Perform exactly the plan that was proposed.
 *
 * ══ THE WORLD MUST NOT HAVE MOVED ══
 *
 * A plan the owner read an hour ago describes a world that may no longer exist — a binding may have
 * happened on another machine, the law may have changed. Re-checked here, and refused rather than
 * reconciled: a ceremony that adapts to a changed world is a ceremony nobody actually approved.
 *
 * The receipt count is deliberately NOT re-checked. Receipts arrive constantly and none of them change
 * what binding means; refusing on a number that moves every few seconds would make the ceremony
 * unrunnable for a reason unrelated to its safety.
 */
export function acceptBinding(repoRoot, plan, { phrase, at = null, deviceSecret = null, recoverySecret = null, approvedDigest = null } = {}) {
  if (plan?.schema !== PLAN_SCHEMA) return { ok: false, reason: `not a binding plan: ${String(plan?.schema)}` };
  if (typeof phrase !== 'string' || phrase.length < 8) {
    return { ok: false, reason: 'a binding needs the owner\'s phrase — this is the half that is not on the machine' };
  }

  const now = proposeBinding(repoRoot, { at });
  if (now.repoId !== plan.repoId) {
    return { ok: false, reason: `this plan is for repository ${String(plan.repoId)}, and this is ${String(now.repoId)}` };
  }
  if (!now.ready) return { ok: false, reason: now.reason ?? 'this repository cannot be bound right now' };

  // ══ THE APPROVAL MUST BE OF THIS WORLD ══
  //
  // `approvedDigest` is what the owner's terminal showed him. Re-derived from the world as it stands
  // and compared, so an approval cannot survive the thing it approved changing underneath it. Optional
  // only because `acceptBinding` is called directly by tests that build their plan a line earlier and
  // have nothing to be stale about; the CLI always passes it, and there is a test that says so.
  if (approvedDigest !== null && planDigest(now) !== approvedDigest) {
    return {
      ok: false,
      reason: `the world changed between the plan you read (${approvedDigest}) and now (${planDigest(now)}) — `
        + 'run `aukora bind` again and read the new plan',
    };
  }

  // ══ THE DEVICE FACTOR MUST OUTLIVE THIS PROCESS ══
  //
  // This called `mintDeviceSecret()`, which is `randomBytes(32)` and WRITES NOTHING. `ensureDeviceSecret()`
  // — the only function that persists it — had zero production callers anywhere. So the root was
  // wrapped under a factor that died when the process exited, the re-open below "verified" it with the
  // same in-memory buffer, and the plan promised a `device.secret` file the acceptance never wrote.
  //
  // After that ceremony the owner's root was openable exactly once, by the process that made it. The
  // phrase alone could never open it again, and only the recovery secret — printed once to a terminal
  // — stood between him and a permanently unreachable root.
  //
  // `ensureDeviceSecret` is IDEMPOTENT, which is the other half of why it is the right call: a second
  // repository on this machine reuses the machine's factor instead of minting a rival that silently
  // orphans the first one's wrap.
  const device = deviceSecret ?? ensureDeviceSecret();
  const recovery = recoverySecret ?? mintRecoverySecret();

  let minted;
  try {
    minted = bind({ phrase, deviceSecret: device, recoverySecret: recovery, boundAt: at });
  } catch (e) {
    return { ok: false, reason: `bind refused: ${e?.message ?? 'unknown'}` };
  }

  const custody = writeCustody({ rootFile: minted.rootFile, deviceFile: minted.deviceFile });
  const pubPath = join(repoRoot, 'aukora.pub');

  // EVERYTHING THIS CEREMONY WROTE, so a refusal can undo it. A half-bind whose root cannot be opened
  // is strictly worse than no bind, because it looks done.
  const wrote = [custody.rootPath, custody.devicePath, pubPath];
  const undo = () => { for (const p of wrote) { try { rmSync(p, { force: true }); } catch { /* nothing to undo */ } } };

  // The public half goes into the repository, where the law can judge the write and every future
  // `verify` can find it without a keyring. Atomic: written to a sibling and renamed, with an fsync
  // before the rename, so a crash mid-ceremony leaves either the old state or the new one and never a
  // truncated `aukora.pub` that every later `verify` would refuse.
  writeAtomic(pubPath, `${JSON.stringify(minted.pubFile, null, 2)}\n`);

  // ══ PROVE IT FROM DISK, BOTH WAYS, BEFORE CLAIMING ANYTHING ══
  //
  // This re-opened `minted.rootFile` — the object still in memory — using `device`, the buffer already
  // in scope. It therefore proved that the ciphertext decrypts with the key we just used, which is
  // true by construction and worth nothing. AUKORA-SEED's `init.mjs` already knew better: it discards
  // what `bind()` returned and re-reads the file it wrote.
  //
  // So: a COLD READ, and the phrase alone. `unwrapRoot` falls back to `readDeviceSecret()`, which is
  // exactly the path the owner takes tomorrow morning.
  const verdict = assertRecoverable({ rootPath: custody.rootPath, phrase, recoverySecret: recovery });
  if (!verdict.ok) {
    undo();
    return { ok: false, reason: verdict.reason, rolledBack: true };
  }

  // `openWrap` returns the KeyObject as `key` — deliberately not base64, so the private half is
  // never one `console.log` from a log file.
  const genesis = sealGenesis({ repoRoot, rootKey: verdict.key, pubFile: minted.pubFile, at });
  const law = sealLaw({ repoRoot, rootKey: verdict.key, rootId: minted.rootId, at });

  // ══ A FAILED LAW ANCHOR IS NOT A BIND ══
  //
  // This returned `ok: true` with `law: false`, so the CLI printed the recovery secret under the word
  // BOUND over a repository whose law was never sealed. The law anchor is what makes `aukora.law.json`
  // authoritative rather than advisory — without it `checkLawAuthority` has nothing to check, and the
  // fence is enforcing a file nobody signed.
  //
  // NOT rolled back, and that distinction is the whole of it: the root is real, it is on disk, and it
  // opens. Deleting it would destroy a working key over a failure that is usually a missing law file.
  // So the world is described exactly — what landed, what did not, and the recovery secret ANYWAY,
  // because a root that exists and cannot be recovered is the outcome this round exists to prevent.
  if (!genesis || law?.ok === false) {
    return {
      ok: false,
      partial: true,
      rootId: minted.rootId,
      deviceId: minted.deviceId,
      paths: { pub: pubPath, ...custody },
      genesis: Boolean(genesis),
      law: false,
      reason: !genesis
        ? 'the root is on disk and opens, but the genesis anchor could not be sealed — this repository is NOT bound'
        : `the root is on disk and opens, but the law anchor could not be sealed (${law.reason}) — this repository is NOT bound`,
      recoverySecret: recovery,
    };
  }

  return {
    ok: true,
    rootId: minted.rootId,
    deviceId: minted.deviceId,
    paths: { pub: pubPath, ...custody },
    genesis: true,
    law: true,
    lawReason: null,
    // THE ONE SECRET THAT LEAVES THIS FUNCTION. It is never written to disk here, because a recovery
    // secret stored next to what it recovers is not a recovery path — it is a second copy of the key.
    recoverySecret: recovery,
  };
}

/**
 * ══ THE WAY BACK, WALKED ══
 *
 * φ is the only repository in either lineage that has a recovery wrap, and until this ran it was the
 * only one that had never opened one. A way back nobody has walked is a way back nobody knows exists.
 *
 * Both paths, from a COLD READ of the file on disk:
 *
 *   1 · the everyday path — phrase + the device secret READ FROM DISK, not the buffer in scope
 *   2 · the recovery path — the secret the owner is about to write on paper
 *   3 · and they must open THE SAME ROOT. Two wraps opening different keys would be far worse than
 *       having no recovery at all: the owner would recover into an identity that signs as nobody.
 *
 * Exported so it can be pointed at a poisoned fixture — a checker that can only be run on a good
 * input has no positive control.
 */
export function assertRecoverable({ rootPath, phrase, recoverySecret }) {
  let rootFile;
  try { rootFile = JSON.parse(readFileSync(rootPath, 'utf8')); }
  catch (e) { return { ok: false, reason: `the root file could not be read back from disk: ${e?.message ?? 'unreadable'}` }; }

  const byPhrase = unwrapRoot(rootFile, { phrase });
  if (!byPhrase.ok) {
    return { ok: false, reason: `the root was written but the phrase does not re-open it from disk (${byPhrase.reason}) — refusing, and undoing` };
  }

  const byRecovery = unwrapRootByRecovery(rootFile, recoverySecret);
  if (!byRecovery.ok) {
    return { ok: false, reason: `the root opens with the phrase but its RECOVERY wrap does not (${byRecovery.reason}) — a wrap with no way back is a trap, refusing` };
  }

  const a = createPublicKey(byPhrase.key).export({ type: 'spki', format: 'der' }).toString('base64');
  const b = createPublicKey(byRecovery.key).export({ type: 'spki', format: 'der' }).toString('base64');
  if (a !== b) {
    return { ok: false, reason: 'the phrase and the recovery secret open DIFFERENT roots — recovering would produce an identity that signs as nobody' };
  }
  return { ok: true, key: byPhrase.key, reason: null };
}

/** 0600, fsynced, and renamed into place — never a half-written file a later verify would refuse. */
function writeAtomic(path, text) {
  const tmp = `${path}.tmp`;
  const fd = openSync(tmp, 'w', 0o600);
  try { writeSync(fd, text); fsyncSync(fd); } finally { closeSync(fd); }
  renameSync(tmp, path);
}

/**
 * ══ boundAt IS PART OF IDENTITY, NOT A TIMESTAMP ══
 *
 * `genesisRef = sha256("aumlok-genesis-aura-ref:" + rootId + "|" + boundAt)[0:24]`, and the figure's
 * SHAPE is seeded from `genesisRef`. So the face is a function of TWO inputs, and `docs/ROOTID-DECISION`
 * originally said only that the same root reproduces the same face — true only if `boundAt` travels
 * with it. Measured, one root, two moments:
 *
 *     2026-08-04T09:00:00.000Z  →  62202cc885b1b94f214514b9
 *     2026-11-20T14:32:11.000Z  →  fe4f518e59c418c37f6ef489
 *
 * Two machines, same root, different `boundAt`, different figures — SILENTLY. No error, no mismatch,
 * nothing to notice. The owner sees a different face and concludes recovery is broken, when recovery
 * worked perfectly and was handed the wrong input.
 *
 * ══ WHY THIS FUNCTION EXISTS RATHER THAN JUST A SENTENCE ══
 *
 * `ceremony/door.ts:161` sets `boundAt = now` on the CREATION path, which is correct there — that
 * ceremony is creating the binding, so now IS the moment. The hazard is that a future recovery
 * implementer reads that line, copies its shape, and writes `now` again. It is the obvious thing to
 * write and it is wrong, and nothing would say so.
 *
 * So the correct thing is made the easy thing: the original `boundAt` is READ FROM THE GENESIS ANCHOR,
 * which has carried it in its signed subject since `authority.mjs`'s `genesisSubject` was written.
 * A recovery ceremony calls this and never re-derives.
 */
export function originalBoundAt(repoRoot) {
  const records = readAnchors(repoRoot, 'genesis').records ?? [];
  if (records.length === 0) {
    // ABSENT, not "now". Falling back to the current time is the exact defect this guards against, and
    // a caller that cannot tell "there is no anchor" from "it was bound this instant" would reproduce
    // it one layer up.
    return { ok: false, reason: 'this repository has no genesis anchor, so there is no original boundAt to carry' };
  }
  const boundAt = records[0]?.record?.subject?.boundAt;
  if (typeof boundAt !== 'string' || !boundAt) {
    return { ok: false, reason: 'the genesis anchor carries no boundAt — it cannot be recovered from here' };
  }
  return { ok: true, boundAt, rootId: records[0]?.record?.subject?.rootId ?? null };
}
