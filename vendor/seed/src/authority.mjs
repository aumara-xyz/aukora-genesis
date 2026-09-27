// aukora · src/authority.mjs — sign the anchors, not every receipt
//
// ══ THE HOLE THIS CLOSES ══
//
// Until this file existed, the answer to "what stops the agent editing the law?"
// was "the law protects `aukora.law.json`, and the fence refuses writes to it."
// That is true for the fence's four tools and false for everything else. A
// `bash -c 'sed -i …'`, a hand edit, a stray script — the law changes, the guard
// reads the new law on the very next call, and obeys it. The fence was checking
// that nobody used the front door while the file sat unlocked.
//
// A hash makes edits *visible to someone holding an earlier copy*. A signature
// makes them *impossible to pass off as the owner's*. The law needs the second
// one, because the party being fenced is the same party that can rewrite it.
//
// ══ WHY NOT SIGN EVERY RECEIPT ══
//
// Receipts already carry a device signature — see aumlok.mjs — and that is the
// right amount. Signing is not free: an ML-DSA-65 signature is ~3.3 KB, so a
// thousand post-quantum-signed receipts would be ~3 MB of overhead buying a
// property the hash chain already provides. The chain gives order and integrity.
// Signatures are for the small number of statements the owner is *asserting*:
//
//   genesis      this repository was bound to this root, at this moment
//   law          this exact law file is the one I blessed
//   checkpoint   at this time, this device saw the chain head at this hash
//
// Three anchors. The chain hangs off them. That is the whole trade.
//
// ══ ED25519 ONLY — AND WHY, MEASURED, NOT ASSUMED ══
//
// The donor (`aukora-one/authority/hybrid-signer.mjs`) signs hybrid: Ed25519 for
// today plus ML-DSA-65 for the day a quantum computer retires Ed25519. That is
// the right shape and it is NOT what this file does, because it cannot be built
// here without a dependency, and this project has zero runtime dependencies.
//
// Measured on this machine rather than recalled:
//
//   node                      v22.23.0
//   node's linked OpenSSL     3.5.7        ← ML-DSA exists in the library
//   crypto.generateKeyPairSync('ml-dsa-65')
//                             TypeError: The argument 'type' must be a
//                             supported key type. Received 'ml-dsa-65'
//   crypto.webcrypto.subtle.generateKey({name:'ML-DSA-65'}, …)
//                             NotSupportedError: Unrecognized algorithm name
//
// So the primitive is present in the library Node links and absent from the
// binding Node exposes. Node 24 surfaces `ml-dsa-*` key types; Node 22 does not,
// and the donor reaches ML-DSA only through `@noble/post-quantum`, an npm
// dependency. The two dishonest moves available here are (a) add the dependency
// and (b) emit a `suite: 'hybrid'` field with one real signature in it. Neither
// is taken. The suite string says `ed25519` because that is what signed it.
//
// The migration path is left open on purpose: `alg` and `suite` are recorded in
// every anchor, `REQUIRED_SIGNER` is a table rather than an `if`, and
// `verifyAnchor` dispatches on the record's own declared suite. When this
// project's floor moves to Node 24, a second signature slots in beside the first
// and old anchors keep verifying under the suite they were made with.
//
// ══ TWO KEYS, TWO JOBS — AND THE LAW NEEDS THE PHRASE ══
//
// aumlok.mjs mints two keys: a ROOT key wrapped by the seven-word phrase, and a
// DEVICE key at rest on disk so the guard can sign receipts unattended. Which
// key signs which anchor is the load-bearing decision in this file:
//
//   genesis     ROOT     once, at bind, phrase in hand
//   law         ROOT     phrase required — every single time
//   checkpoint  DEVICE   unattended, periodic, no ceremony
//
// The consequence is the point. An agent that has fully compromised this machine
// can read `~/.aukora/keys/<root>.device.json` — it is a 0600 file, not a vault.
// With it, it can forge receipts. It STILL cannot bless a law, because a law
// anchor signed by the device key is refused by `verifyAnchor` on the
// `signedBy` check before its signature is even examined. Widening the fence
// requires something that has never been on this disk in the clear.
//
// (Note for whoever owns aumlok.mjs: its header says the root key "signs exactly
// one thing: a certificate naming a device key." As of this file that is three
// things. The sentence needs updating; it is not mine to edit.)

import { createHash, sign as edSign, verify as edVerify } from 'node:crypto';
import {
  appendFileSync, mkdirSync, readFileSync, existsSync, openSync, readSync,
  fstatSync, closeSync,
} from 'node:fs';
import { join, dirname } from 'node:path';

import { canonicalJSON, CHAIN_DIR, GENESIS_PREV, readHead } from './chain.mjs';
import { LAW_FILE, readLawBytes } from './law.mjs';
import { readPub, pubFromB64, unwrapRoot, keysDir } from './aumlok.mjs';

export const ANCHOR_SCHEMA = 'aukora-anchor-v0';
export const ANCHOR_SUITE = 'aukora-anchor-ed25519-v0';
export const ANCHOR_DIR = join(CHAIN_DIR, 'anchors');
export const ANCHOR_KINDS = Object.freeze(['genesis', 'law', 'checkpoint']);

/**
 * Which key is allowed to have signed each kind. A table, not a conditional,
 * because this is the sentence the whole module exists to enforce and it should
 * be readable in one glance by someone who does not trust it.
 */
export const REQUIRED_SIGNER = Object.freeze({
  genesis: 'root',
  law: 'root',
  checkpoint: 'device',
});

/** How stale a checkpoint may get before the guard writes a fresh one. */
export const CHECKPOINT_INTERVAL_MS = 60 * 60 * 1000;

/**
 * The closed vocabulary for authority refusals. Lives here rather than in
 * guard.mjs so the strings and the checks that emit them cannot drift apart;
 * guard.mjs spreads these into `REASON` so `log` still sees one vocabulary.
 */
export const AUTHORITY_REASON = Object.freeze({
  LAW_UNSIGNED: 'authority:law-unsigned',
  LAW_MISMATCH: 'authority:law-mismatch',
  LAW_FORGED: 'authority:law-forged',
  LAW_UNREADABLE: 'authority:law-unreadable',
  CUSTODY_REMOVED: 'authority:custody-removed',
});

export function anchorPath(repoRoot, kind) {
  return join(repoRoot, ANCHOR_DIR, `${kind}.jsonl`);
}

// ── the signed bytes ────────────────────────────────────────────────────────

/** Everything an anchor asserts. Not the digest, not the signature. */
export function anchorBody(record) {
  const out = {};
  for (const [k, v] of Object.entries(record ?? {})) {
    if (k === 'digest' || k === 'sig') continue;
    if (k.startsWith('__')) continue;
    out[k] = v;
  }
  return out;
}

/**
 * The anchor digest, defined once, here, and nowhere else.
 *
 *     preimage = "aukora-anchor-v0:" ++ kind ++ canonical_json_of_body
 *     digest   = sha256(preimage) as lowercase hex
 *
 * The `kind` appears twice — once in the domain prefix and once inside the body
 * — and both are deliberate. Inside the body it is what `verifyAnchor` checks
 * `signedBy` against. In the prefix it puts anchor digests in a different space
 * from receipt hashes, which are `sha256(prev ++ body)` with no prefix at all.
 * Ed25519 in node:crypto takes no context argument, so domain separation has to
 * live in the message, and a signature over a receipt hash therefore cannot be
 * lifted into an anchor, or the reverse.
 *
 * What is signed is the digest's ASCII hex, not its raw bytes — the same
 * convention receipts use (`aumlok.mjs`, `loadSigner`), so there is exactly one
 * signing convention in this project and `openssl` reproduces both the same way.
 */
export function anchorMessage(record) {
  const body = anchorBody(record);
  return `${ANCHOR_SCHEMA}:${String(body.kind ?? '')}${canonicalJSON(body)}`;
}

export function anchorDigest(record) {
  return createHash('sha256').update(anchorMessage(record), 'utf8').digest('hex');
}

/** An unsigned anchor. Field set is closed; `subject` carries only facts. */
export function buildAnchor({ kind, rootId, signedBy, keyId, subject, at }) {
  return {
    schema: ANCHOR_SCHEMA,
    suite: ANCHOR_SUITE,
    alg: 'ed25519',
    kind,
    rootId: String(rootId ?? ''),
    signedBy,
    keyId: String(keyId ?? ''),
    subject: subject ?? {},
    at: String(at ?? ''),
  };
}

export function signAnchor(record, privateKey) {
  const digest = anchorDigest(record);
  const sig = edSign(null, Buffer.from(digest, 'utf8'), privateKey).toString('base64');
  return { ...record, digest, sig };
}

/**
 * Is this anchor what it says it is?
 *
 * Order matters and is the opposite of intuitive: the `signedBy` check runs
 * BEFORE the signature is examined. A device-signed law anchor is refused for
 * being device-signed, not for failing to verify — because it would verify
 * perfectly well against the device key, and "the signature is valid" is exactly
 * the wrong question to ask about a key that lives unencrypted on disk.
 */
export function verifyAnchor(record, { rootPub, devicePub } = {}) {
  if (!record || typeof record !== 'object') return { ok: false, reason: 'anchor is not an object' };
  if (record.schema !== ANCHOR_SCHEMA) return { ok: false, reason: `anchor schema is ${String(record.schema)}` };
  if (!ANCHOR_KINDS.includes(record.kind)) return { ok: false, reason: `unknown anchor kind ${String(record.kind)}` };
  if (record.suite !== ANCHOR_SUITE) return { ok: false, reason: `unknown anchor suite ${String(record.suite)}` };

  const required = REQUIRED_SIGNER[record.kind];
  if (record.signedBy !== required) {
    return { ok: false, reason: `a ${record.kind} anchor must be signed by the ${required} key, this one claims ${String(record.signedBy)}` };
  }

  const recomputed = anchorDigest(record);
  if (recomputed !== record.digest) {
    return { ok: false, reason: 'anchor digest does not match its own content', claimed: record.digest, recomputed };
  }

  const pubB64 = required === 'root' ? rootPub : devicePub;
  if (typeof pubB64 !== 'string' || pubB64.length === 0) {
    return { ok: false, reason: `no ${required} public key to check this anchor against` };
  }

  let ok = false;
  try {
    ok = edVerify(null, Buffer.from(recomputed, 'utf8'), pubFromB64(pubB64), Buffer.from(String(record.sig ?? ''), 'base64'));
  } catch {
    ok = false;
  }
  return ok ? { ok: true, reason: null } : { ok: false, reason: `signature does not verify against the ${required} key` };
}

// ── storage ─────────────────────────────────────────────────────────────────
//
// One file per kind, at `.aukora/anchors/<kind>.jsonl`, append-only, last line
// wins. Split by kind rather than one combined log because the guard reads the
// LAW anchor on every fenced tool call, and checkpoints accrue forever. Sharing
// one file would make the hot path's read grow without bound at an hour a line;
// `law.jsonl` gets a line only when the owner deliberately re-blesses the law,
// so it stays a handful of lines for the lifetime of a repository.
//
// The history is kept rather than overwritten. A law re-signed four times is a
// fact about how this repo was governed, and it costs four lines to keep.

export function appendAnchor(repoRoot, record) {
  const file = anchorPath(repoRoot, record.kind);
  mkdirSync(dirname(file), { recursive: true });
  appendFileSync(file, `${JSON.stringify(record)}\n`, { encoding: 'utf8', flag: 'a', mode: 0o644 });
  return record;
}

/** Every anchor of a kind, oldest first, with unparsable lines reported. */
export function readAnchors(repoRoot, kind) {
  const file = anchorPath(repoRoot, kind);
  if (!existsSync(file)) return { records: [], unparsable: [] };
  const records = [];
  const unparsable = [];
  const lines = readFileSync(file, 'utf8').split('\n').filter((l) => l.trim().length > 0);
  lines.forEach((line, i) => {
    try {
      const r = JSON.parse(line);
      if (!r || typeof r !== 'object') throw new Error('not an object');
      records.push({ ...r, __line: i + 1 });
    } catch (err) {
      unparsable.push({ line: i + 1, reason: err?.message ?? 'unparsable' });
    }
  });
  return { records, unparsable };
}

/**
 * The newest anchor of a kind, read from the tail rather than by slurping.
 * The guard calls this on every fenced tool call; it does not get to read a
 * file that grows.
 *
 * ══ THE RECORD DOES NOT GET TO SAY WHAT IT IS ══
 *
 * This returned the last line whatever it claimed to be, and `verifyAnchor`
 * then looked up `REQUIRED_SIGNER[record.kind]` — from the field the attacker
 * wrote. The role check ran. It asked the attacker which role to require.
 *
 * `checkpoint` is device-signable by design, and the device key lives
 * unencrypted on disk precisely because the guard cannot prompt for a phrase.
 * So the key an attacker is ASSUMED to hold could append a `kind:"checkpoint"`
 * record into `law.jsonl` whose `subject.sha256` was the hash of any law it
 * liked, and every downstream check passed:
 *
 *   baseline, .env protected by the default law   → write .env  exit 2
 *   device key writes a permissive law, appends a
 *     device-signed kind:"checkpoint" to law.jsonl → write .env  exit 0
 *
 * THE RULE, and it is general: **a verifier must never read the role, the key,
 * or the suite it requires from the artifact it is verifying.** The caller
 * states the requirement; the artifact only matches it. This is JWT `alg`
 * confusion (RFC 7515 §4.1.1, and every 2015-era JWT library CVE), which sits
 * in this project's own prior-art table — in the very document where this
 * defect was written down as a strength.
 *
 * A wrong-kind record makes this return `null` rather than skipping past it to
 * find a right-kind one further back. Two reasons: an anchor file should
 * contain exactly one kind, so a foreign record there is corruption or an
 * attack and neither deserves a best-effort read; and scanning backwards would
 * let an attacker bury the record they want to be authoritative. `null` means
 * "no anchor", which the callers already treat as fail-closed.
 *
 * The cost, stated: appending one junk line to `law.jsonl` now refuses every
 * write until it is removed. That is a denial of service, it is available to
 * anyone who could already delete the file, and it fails in the safe direction.
 *
 * Found by `sakana/fugu-ultra` in council; reproduced before it was believed.
 */
export function latestAnchor(repoRoot, kind) {
  const file = anchorPath(repoRoot, kind);
  if (!existsSync(file)) return null;
  let fd;
  try {
    fd = openSync(file, 'r');
    const size = fstatSync(fd).size;
    if (size === 0) return null;
    const window = Math.min(size, 8192);
    const buf = Buffer.alloc(window);
    readSync(fd, buf, 0, window, size - window);
    const lines = buf.toString('utf8').split('\n').filter((l) => l.trim().length > 0);
    if (lines.length === 0) return null;
    // The window may have cut the first line in half; that half is never the
    // last line, and the last line is the only one this function promises.
    const record = JSON.parse(lines[lines.length - 1]);
    // The caller asked for a kind. Anything else is not an answer to that
    // question, however well it is signed. See the header.
    if (!record || record.kind !== kind) return null;
    return record;
  } catch {
    // A tail we cannot read is not an anchor we can honour. `null` here reaches
    // the caller as "unsigned", which refuses. Failing closed on an unreadable
    // anchor is the entire posture of this module.
    return null;
  } finally {
    if (fd !== undefined) { try { closeSync(fd); } catch { /* nothing to do */ } }
  }
}

// ── what each anchor asserts ────────────────────────────────────────────────

/**
 * The law's subject: a hash of the file's RAW BYTES.
 *
 * Not of the parsed object, and not of the effective law `loadLaw` computes
 * after merging the self-protection set in. Raw bytes, because they are the one
 * definition a skeptic can reproduce without running our code:
 *
 *     shasum -a 256 aukora.law.json
 *
 * The cost is real and accepted: reformatting the file, or an editor adding a
 * trailing newline, changes the hash and the guard refuses until the owner
 * re-blesses it. That is a whitespace change locking the repository, which is
 * annoying — and it is strictly better than a canonicalisation step where an
 * attacker and a verifier could disagree about which bytes counted. The
 * refusal message names the one command that fixes it.
 */
export function lawSubject(repoRoot) {
  const bytes = readLawBytes(repoRoot);
  if (!bytes.ok) return { ok: false, reason: bytes.reason };
  return {
    ok: true,
    subject: {
      file: LAW_FILE,
      sha256: createHash('sha256').update(bytes.buffer).digest('hex'),
      bytes: bytes.buffer.length,
    },
  };
}

/** The binding fact, restated so it can be signed rather than merely written. */
export function genesisSubject(pubFile) {
  return {
    rootId: String(pubFile?.rootId ?? ''),
    deviceId: String(pubFile?.device?.deviceId ?? ''),
    devicePub: String(pubFile?.device?.devicePub ?? ''),
    boundAt: String(pubFile?.boundAt ?? ''),
    genesisRef: String(pubFile?.genesisRef ?? ''),
    chainPrev: GENESIS_PREV,
  };
}

// ── sealing ─────────────────────────────────────────────────────────────────

/** Seal the genesis anchor. Once, at bind, with the root key in hand. */
export function sealGenesis({ repoRoot, rootKey, pubFile, at }) {
  const record = buildAnchor({
    kind: 'genesis', rootId: pubFile.rootId, signedBy: 'root', keyId: pubFile.rootId,
    subject: genesisSubject(pubFile), at,
  });
  return appendAnchor(repoRoot, signAnchor(record, rootKey));
}

/** Seal the law as it stands on disk right now. Requires the root key. */
export function sealLaw({ repoRoot, rootKey, rootId, at }) {
  const s = lawSubject(repoRoot);
  if (!s.ok) return { ok: false, reason: s.reason };
  const record = buildAnchor({
    kind: 'law', rootId, signedBy: 'root', keyId: rootId, subject: s.subject, at,
  });
  return { ok: true, record: appendAnchor(repoRoot, signAnchor(record, rootKey)) };
}

/**
 * Seal the chain head. Device-signed, because the guard has no terminal and
 * cannot ask for seven words on a tool call.
 */
export function writeCheckpoint({ repoRoot, pubFile, signer, at }) {
  if (!signer || typeof signer.sign !== 'function') return { ok: false, reason: 'no device signer' };
  const head = readHead(repoRoot);
  const record = buildAnchor({
    kind: 'checkpoint', rootId: pubFile.rootId, signedBy: 'device',
    keyId: pubFile.device?.deviceId ?? '', at,
    subject: { head: head.prev, chainFile: join(CHAIN_DIR, 'chain.jsonl') },
  });
  const digest = anchorDigest(record);
  const sig = signer.sign(digest);
  if (typeof sig !== 'string' || sig.length === 0) return { ok: false, reason: 'device signer produced nothing' };
  return { ok: true, record: appendAnchor(repoRoot, { ...record, digest, sig }) };
}

/**
 * Write a checkpoint if the last one has gone stale. Called from the guard on
 * the successful path.
 *
 * NEVER throws and NEVER refuses. A checkpoint is a record improvement, not a
 * gate: an owner who cannot write one should lose an attestation, not a tool
 * call. This is the same reasoning that makes `loadSigner` return `null` instead
 * of throwing, pointed at the same conclusion.
 */
export function maybeCheckpoint(repoRoot, { pubFile, signer, now = () => new Date().toISOString(), interval = CHECKPOINT_INTERVAL_MS } = {}) {
  try {
    if (!pubFile || !signer) return { ok: false, reason: 'not bound' };
    const last = latestAnchor(repoRoot, 'checkpoint');
    const at = now();
    if (last) {
      const lastMs = Date.parse(String(last.at ?? ''));
      const nowMs = Date.parse(at);
      if (Number.isFinite(lastMs) && Number.isFinite(nowMs) && nowMs - lastMs < interval) {
        return { ok: false, reason: 'not due' };
      }
    }
    return writeCheckpoint({ repoRoot, pubFile, signer, at });
  } catch (err) {
    return { ok: false, reason: err?.message ?? 'checkpoint failed' };
  }
}

// ── the question the guard asks ─────────────────────────────────────────────

/**
 * May this repository's law be obeyed?
 *
 * ══ THE FAILURE DIRECTION, STATED ONCE ══
 *
 * Every path out of here that is not `verified` refuses, with ONE exception:
 * `unbound`. A repository with no `aukora.pub` has no key, and there is no
 * honest way to check a signature against a key that does not exist. Refusing
 * there would mean the guard could never run before `aukora init` — the fence
 * would be dead on arrival in exactly the repositories that have not adopted it
 * yet, which is every repository at the moment someone tries it.
 *
 * That exception is a door, so it has a lock on it. If a genesis anchor exists,
 * this repo WAS bound, and a missing or renamed `aukora.pub` is not an unbound
 * repo — it is a downgrade, and it refuses. `aukora.pub` and `.aukora/**` are
 * both in `DEFAULT_PROTECTED`, so removing either through the fence's tools is
 * already refused; this catches the removal that came in through a shell.
 *
 * RESIDUAL, stated rather than hidden: deleting `aukora.pub` AND the whole
 * `.aukora` tree returns this repo to `unbound`, and the guard runs unanchored.
 * That is not a silent bypass — every signed receipt is gone with it, so
 * `aukora verify` reports a repository with no history rather than a healthy
 * one — but it is a bypass, and it is the honest edge of what a file-based
 * anchor can do without a second machine to hold the head.
 */
export function checkLawAuthority(repoRoot) {
  const pub = readPub(repoRoot);
  const genesis = latestAnchor(repoRoot, 'genesis');

  if (!pub.ok) {
    if (genesis) {
      return {
        ok: false,
        state: 'downgraded',
        reasonClass: AUTHORITY_REASON.CUSTODY_REMOVED,
        reason: `this repository has a signed genesis anchor naming root ${String(genesis.rootId).slice(0, 12)}…, but ${pub.reason}`,
        hint: 'restore aukora.pub from version control. It is the public half — losing it is not a key loss, it is a missing file.',
      };
    }
    return {
      ok: true, state: 'unbound', reasonClass: null,
      reason: `${pub.reason} — no custody, so no law signature to check`,
      hint: 'run `aukora init` to bind this repository and sign its law.',
    };
  }

  if (genesis) {
    const g = verifyAnchor(genesis, { rootPub: pub.pubFile.rootPub });
    if (!g.ok) {
      return {
        ok: false, state: 'downgraded', reasonClass: AUTHORITY_REASON.CUSTODY_REMOVED,
        reason: `the genesis anchor does not hold: ${g.reason}`,
        hint: 'the binding record and the committed public key disagree. Restore one of them from version control before trusting anything this repository says.',
      };
    }
    if (genesis.rootId !== pub.pubFile.rootId) {
      return {
        ok: false, state: 'downgraded', reasonClass: AUTHORITY_REASON.CUSTODY_REMOVED,
        reason: `aukora.pub names root ${pub.pubFile.rootId.slice(0, 12)}… but the genesis anchor names ${String(genesis.rootId).slice(0, 12)}…`,
        hint: 'aukora.pub was replaced with a different binding. Restore the original from version control.',
      };
    }
  }

  const anchor = latestAnchor(repoRoot, 'law');
  if (!anchor) {
    return {
      ok: false, state: 'law-unsigned', reasonClass: AUTHORITY_REASON.LAW_UNSIGNED,
      reason: `this repository is bound to root ${pub.pubFile.rootId.slice(0, 12)}… but no signed law anchor exists`,
      hint: 'run `aukora init --resign-law` and enter your seven-word phrase.',
    };
  }

  const v = verifyAnchor(anchor, { rootPub: pub.pubFile.rootPub, devicePub: pub.pubFile.device?.devicePub });
  if (!v.ok) {
    return {
      ok: false, state: 'law-forged', reasonClass: AUTHORITY_REASON.LAW_FORGED,
      reason: `the law anchor does not hold: ${v.reason}`,
      hint: 'the anchor was not produced by the root key this repository is bound to. Run `aukora init --resign-law` if you wrote this law; investigate if you did not.',
    };
  }

  const s = lawSubject(repoRoot);
  if (!s.ok) {
    return {
      ok: false, state: 'law-unreadable', reasonClass: AUTHORITY_REASON.LAW_UNREADABLE,
      reason: `${LAW_FILE} is signed for but could not be read: ${s.reason}`,
      hint: `restore ${LAW_FILE} from version control, or run \`aukora init --resign-law\` after writing a new one.`,
      expected: anchor.subject?.sha256 ?? null,
    };
  }

  if (s.subject.sha256 !== anchor.subject?.sha256) {
    return {
      ok: false, state: 'law-mismatch', reasonClass: AUTHORITY_REASON.LAW_MISMATCH,
      reason: `${LAW_FILE} has changed since it was signed`,
      hint: 'if you made this change, run `aukora init --resign-law` and enter your seven-word phrase. If you did not, someone edited the fence.',
      expected: anchor.subject?.sha256 ?? null,
      actual: s.subject.sha256,
      signedAt: anchor.at ?? null,
    };
  }

  return {
    ok: true, state: 'verified', reasonClass: null, reason: null, hint: null,
    rootId: pub.pubFile.rootId, sha256: s.subject.sha256, signedAt: anchor.at ?? null,
  };
}

// ── the owner's way back in ─────────────────────────────────────────────────

/**
 * Re-bless the law as it now stands.
 *
 * The failure mode this exists for: an owner legitimately widens their law,
 * every write starts being refused, and there is no obvious way forward. That
 * is a fence that has eaten its owner. So the fix is one command, it is named in
 * the refusal message itself, and it costs exactly what it should — the phrase.
 *
 * `keys` is injectable so tests can run against a temporary keyring instead of
 * the operator's real `~/.aukora/keys`. Nothing here writes a private half, and
 * a wrong phrase produces one content-free message with no oracle: `unwrapRoot`
 * fails on the AES-GCM tag, which is indistinguishable from any other failure.
 */
export function resignLaw({ repoRoot, phrase, keys = keysDir(), now = () => new Date().toISOString() }) {
  const pub = readPub(repoRoot);
  if (!pub.ok) return { ok: false, reason: `this repository is not bound: ${pub.reason}` };

  const rootPath = join(keys, `${pub.pubFile.rootId}.root.json`);
  if (!existsSync(rootPath)) {
    return { ok: false, reason: `no root key for ${pub.pubFile.rootId.slice(0, 12)}… at ${rootPath}` };
  }

  let rootFile;
  try {
    rootFile = JSON.parse(readFileSync(rootPath, 'utf8'));
  } catch (err) {
    return { ok: false, reason: `the root key file could not be read: ${err?.message ?? 'unknown'}` };
  }

  const opened = unwrapRoot(rootFile, phrase);
  if (!opened.ok) return { ok: false, reason: opened.reason };

  const at = now();
  const sealed = sealLaw({ repoRoot, rootKey: opened.key, rootId: pub.pubFile.rootId, at });
  if (!sealed.ok) return { ok: false, reason: sealed.reason };

  return {
    ok: true,
    at,
    rootId: pub.pubFile.rootId,
    sha256: sealed.record.subject.sha256,
    path: anchorPath(repoRoot, 'law'),
  };
}

/**
 * Hand a skeptic the literal bytes for one anchor, the same way `verify
 * --explain` does for a receipt. If this cannot be reproduced with `shasum` and
 * `openssl`, the anchor is decoration.
 */
export function explainAnchor(record) {
  // Both of these come from `anchorMessage`/`anchorDigest` rather than being
  // recomputed here. An earlier draft inlined the preimage a second time, and a
  // mutation run caught it: breaking `anchorDigest` alone made this function
  // disagree with it, which is the exact defect `explain()` exists to rule out —
  // a skeptic's recipe that reproduces something other than what we verify.
  const message = anchorMessage(record);
  const digest = anchorDigest(record);
  return {
    message,
    digest,
    claimed: record?.digest ?? null,
    matches: digest === record?.digest,
    recipe: `printf '%s' ${JSON.stringify(message)} | shasum -a 256`,
  };
}
