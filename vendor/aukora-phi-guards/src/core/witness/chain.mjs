// aukora · core/witness/chain.mjs — the receipt chain
//
// Append-only JSONL at `~/.aukora/chains/<identity>.jsonl` — see `chainPath` below. A directory that
// is not a git repository has no identity that survives a rename, and keeps an in-repo
// `.aukora/chain.jsonl` instead; `migrateIfNeeded` copies a legacy in-repo chain to the new home once
// and never overwrites. One line per tool call the guard
// saw. Paths, verdicts, hashes, times, signatures. **Never file contents, never
// diffs, never prompts, never command text.** Someone must be able to hand you
// their chain without handing you their code, and that property is not a
// preference — it is the reason the record is publishable at all.
//
// ══ THE APPEND IS ATOMIC, THE CHAIN LINK IS NOT ══
//
// Claude Code runs subagents with their own agentic loops, and their tool calls
// fire hooks too. So two guard processes CAN be in flight at once. That is the
// one genuinely concurrent thing in this design and it decides the shape here.
//
// A lock would serialise them. There is no lock, on purpose — a lock means a
// contended resource, a stale-lock recovery path, and a failure mode where the
// gate hangs. Instead:
//
//   · the WRITE is a single `appendFileSync` of one complete line, under the
//     4096-byte bound below, so O_APPEND makes it atomic against a concurrent
//     writer. No interleaved lines, ever.
//
//   · the LINK is `prev` = the hash of the last line this process saw. Two
//     concurrent guards can both see the same last line and both append with
//     the same `prev`. That is a FORK, and forks are legal here.
//
// `verify` reports forks by name and position instead of calling them
// corruption, because they are not corruption — they are two things that
// honestly happened at once. Every signature still verifies across a fork; what
// a fork costs you is a single total order, not integrity.
//
// The alternative — read-modify-write under a lock — would buy a clean total
// order and pay for it with a gate that can hang. Wrong trade for a thing that
// sits in front of every tool call.

import { appendFileSync, mkdirSync, openSync, readSync, fstatSync, closeSync, readFileSync, existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join, dirname } from 'node:path';
import { chainHome } from './identity.mjs';

export const CHAIN_DIR = '.aukora';
import { POLICY_VERSION } from './law.mjs';

/**
 * Re-exported so a reader of a receipt can reach the constant from the module that writes it.
 * Defined in `law.mjs` because the semantics it versions live there — see its note.
 */
export { POLICY_VERSION };

export const CHAIN_FILE = 'chain.jsonl';
export const RECEIPT_VERSION = 0;
export const GENESIS_PREV = '0'.repeat(64);

/**
 * The hard ceiling on one receipt line.
 *
 * POSIX guarantees an `O_APPEND` write is atomic when it does not exceed the
 * pipe buffer; 4096 is the conservative floor across platforms. Staying under
 * it is what makes "no lock" safe rather than merely convenient. A path long
 * enough to threaten the bound is shortened by spending a display budget in the order declared in
 * SHORTENABLE below; `v`, `ts`, `verdict`, `reasonClass` and `rule` are never shortened, and a line
 * that still does not fit throws rather than being written.
 *
 * This said "the fold-key ... is never truncated". No receipt has ever carried a fold-key — measured
 * across the whole live chain, the union of every key present is
 * {v, policyVersion, ts, tool, path, resolved, verdict, reasonClass, rule, session, agent, prev, hash,
 * sig}. The security point it was reaching for is true and is now stated as itself: shortening happens
 * in `append`, AFTER `judgePaths` has judged the real paths, so it can never change a verdict.
 */
export const MAX_LINE_BYTES = 4096;

/**
 * Where this repository's chain lives.
 *
 * It used to be `<repo>/.aukora/chain.jsonl` — inside the tree it governs, which made the cheapest
 * attack on the whole system a `rm -rf`: you need not forge a chain when you can remove one. It now
 * resolves to `~/.aukora/chains/<identity>.jsonl`, keyed by origin URL and root-commit SHA rather than
 * by path, so moving or renaming a checkout does not silently begin a fresh record.
 *
 * Directories that are not git repositories have no such identity and keep an in-repo chain — see
 * `identity.mjs` for why inventing one from the path would reintroduce the same hole.
 */
export function chainPath(repoRoot) {
  // The carry from a legacy in-repo chain happens inside `chainHome` — see identity.mjs for why it
  // does not belong at call sites like this one.
  return chainHome(repoRoot).file;
}

/**
 * Canonical JSON: keys sorted lexicographically, no whitespace.
 *
 * Sorted rather than declaration-ordered so a skeptic can reproduce it with
 * `jq -cS`, which sorts. See `explain()` and README §Verify it yourself.
 */
export function canonicalJSON(value) {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJSON).join(',')}]`;
  const keys = Object.keys(value).sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${canonicalJSON(value[k])}`).join(',')}}`;
}

/**
 * The preimage, defined once, here, and nowhere else.
 *
 *     preimage = prev_hash_hex_ascii ++ canonical_json_of_body
 *     hash     = sha256(preimage) as lowercase hex
 *
 * Concatenation with no separator, because a separator is one more thing a
 * reader has to be told about and one more place an implementation can differ.
 */
export function preimage(prev, body) {
  return Buffer.from(`${prev}${canonicalJSON(body)}`, 'utf8');
}

export function hashOf(prev, body) {
  return createHash('sha256').update(preimage(prev, body)).digest('hex');
}

/**
 * The last line of the chain, read from the tail rather than by slurping the
 * file. The guard runs on every tool call; it does not get to read a megabyte.
 */
export function readHead(repoRoot) {
  const file = chainPath(repoRoot);
  if (!existsSync(file)) return { prev: GENESIS_PREV, count: 0 };
  let fd;
  try {
    fd = openSync(file, 'r');
    const size = fstatSync(fd).size;
    if (size === 0) return { prev: GENESIS_PREV, count: 0 };
    const window = Math.min(size, MAX_LINE_BYTES * 2);
    const buf = Buffer.alloc(window);
    readSync(fd, buf, 0, window, size - window);
    const lines = buf.toString('utf8').split('\n').filter((l) => l.trim().length > 0);
    const last = lines[lines.length - 1];
    const parsed = JSON.parse(last);
    if (typeof parsed?.hash !== 'string' || parsed.hash.length !== 64) {
      return { prev: GENESIS_PREV, count: 0, degraded: 'last line has no usable hash' };
    }
    return { prev: parsed.hash, count: -1 };
  } catch (err) {
    // A tail we cannot read is not a reason to refuse the tool call — the fence
    // decision is independent of the chain. But it IS a reason to say so, so
    // NOT RECORDED ANYWHERE. This comment used to claim "the receipt records
    // the degradation instead of quietly starting over". It does not: `append`
    // returns `degraded` to `runFence`, which discards it, and `buildBody` has
    // no field for it. So an unreadable tail silently re-roots the chain at
    // genesis and `verify` reports the result as a benign FORK. Stated here
    // because the comment claiming otherwise was worse than the gap.
    return { prev: GENESIS_PREV, count: 0, degraded: err?.message ?? 'unreadable tail' };
  } finally {
    if (fd !== undefined) { try { closeSync(fd); } catch { /* nothing to do */ } }
  }
}

/**
 * Build a receipt body. Closed field set — nothing here is free-form, and
 * nothing here comes from file contents.
 */
export function buildBody({ ts, tool, path: p, resolved, verdict, reasonClass, rule, session, agent, mode }) {
  const body = {
    v: RECEIPT_VERSION,
    // WHICH POLICY REACHED THIS VERDICT. In the hashed body, so a signature covers it and it cannot
    // be edited afterwards to claim a policy that never judged this write. `v` above versions the
    // LINE; this versions the MEANING of `verdict` and `reasonClass` — the two changed independently
    // when deny-by-default landed, which is exactly why one field could not answer for both.
    policyVersion: POLICY_VERSION,
    ts,
    tool: String(tool ?? ''),
    path: String(p ?? ''),
    resolved: String(resolved ?? ''),
    verdict,                                  // 'refused' | 'allowed' | 'unguarded'
    reasonClass: String(reasonClass ?? ''),   // a closed vocabulary, see guard.mjs
    rule: rule === null || rule === undefined ? null : String(rule),
    // WHICH SESSION. This turned out to carry more than it looks like: a subagent runs in its OWN
    // session, so parent and child are already distinguishable here — see LIMITS.md §6, where it
    // settled a question two machines thought needed another experiment to answer.
    session: String(session ?? ''),
    agent: agent === null || agent === undefined ? null : String(agent),
    // The permission posture the runtime was in when it asked. A write that landed while the agent ran
    // with permissions bypassed is a different fact from one that landed under review, and a record
    // that cannot tell them apart is missing the thing an auditor came for.
    mode: mode === null || mode === undefined ? null : String(mode),
  };
  return body;
}

/**
 * WHAT MAY BE SHORTENED TO MAKE A LINE FIT, in the order it is spent.
 *
 * Every field here is DISPLAY or ATTRIBUTION. None of them is the answer to "what did the gate decide
 * and why" — `v`, `ts`, `verdict`, `reasonClass` and `rule` are absent from this list on purpose and
 * must stay absent. A record that shortened its own verdict to fit a buffer would be worse than no
 * record, because it would still look complete.
 *
 * `resolved` goes first because it is the repo-relative restatement of `path` and the least lossy thing
 * to give up. `tool` is last because it is evidence, and a receipt that cannot say which tool was
 * called barely says anything.
 *
 * `keep: 'tail'` for paths — the filename is the informative half. `keep: 'head'` for identifiers,
 * where the prefix is what a reader recognises.
 */
const SHORTENABLE = Object.freeze([
  { field: 'resolved', keep: 'tail' },
  { field: 'path', keep: 'tail' },
  { field: 'session', keep: 'head' },
  { field: 'agent', keep: 'head' },
  { field: 'mode', keep: 'head' },
  { field: 'tool', keep: 'head' },
]);

/** The marker that says a value on disk is not the whole value. Never silent. */
const ELLIPSIS = '…';

/**
 * Shorten a string to a byte budget without splitting a code point, and say so in the value.
 *
 * Byte budget, not character count: `'…'.length` is 1 and its UTF-8 encoding is 3 bytes, and a path of
 * 1024 four-byte characters is 4096 bytes on its own. A cap measured in characters is not a cap.
 */
function clampBytes(s, maxBytes, keep) {
  if (typeof s !== 'string' || Buffer.byteLength(s, 'utf8') <= maxBytes) return s;
  let out = s;
  while (out.length > 0 && Buffer.byteLength(ELLIPSIS + out, 'utf8') > maxBytes) {
    out = keep === 'tail' ? out.slice(1) : out.slice(0, -1);
  }
  return keep === 'tail' ? ELLIPSIS + out : out + ELLIPSIS;
}

/**
 * Append one receipt. Signing is injected rather than imported so the chain
 * module has no opinion about custody and stays testable without a keyring.
 *
 * ══ THE BOUND IS ENFORCED HERE, NOT MERELY ARGUED ══
 *
 * `MAX_LINE_BYTES` is what makes the lockless design safe: a single `O_APPEND` write that does not
 * exceed the pipe buffer is atomic against a concurrent writer, and two guard processes CAN be in
 * flight at once because subagents fire hooks too. An over-long line is a torn line, which is a
 * corrupted chain, which is the one failure mode that looks exactly like tampering and is not.
 *
 * This used to shorten `body.path` once and hope. Any other envelope-supplied field carried the line
 * straight past the bound: measured, a 5000-character `session` id — which arrives from the hook
 * payload and was bounded by nothing — produced a 5346-byte line. The atomicity argument was resting
 * on a number nothing checked.
 *
 * Now it spends the display budget in a declared order until the line fits, and if it still does not
 * fit it THROWS rather than writing a line that breaks the guarantee. A throw here reaches the guard's
 * `NO RECEIPT, NO WRITE` path and the tool call is refused — which is the correct direction. A gate
 * that lets bytes reach disk with no usable record of having done so is producing an audit trail with
 * holes exactly where something went wrong.
 *
 * @param {(hashHex: string) => (string|null)} sign
 */
export function append(repoRoot, bodyInput, sign) {
  const file = chainPath(repoRoot);
  mkdirSync(dirname(file), { recursive: true });

  const head = readHead(repoRoot);
  let body = buildBody(bodyInput);
  let line = renderLine(head.prev, body, sign);

  for (const { field, keep } of SHORTENABLE) {
    if (Buffer.byteLength(line, 'utf8') <= MAX_LINE_BYTES) break;
    const value = body[field];
    if (typeof value !== 'string' || value.length === 0) continue;
    // Aim this field at what is left of the budget once everything else has been counted.
    const others = Buffer.byteLength(line, 'utf8') - Buffer.byteLength(value, 'utf8');
    const budget = MAX_LINE_BYTES - others;
    body = { ...body, [field]: budget > 8 ? clampBytes(value, budget, keep) : ELLIPSIS };
    line = renderLine(head.prev, body, sign);
  }

  if (Buffer.byteLength(line, 'utf8') > MAX_LINE_BYTES) {
    // Nothing shortenable is left and the line is still too long, so the overflow is in a field that
    // must not be touched. Refuse loudly rather than tear the chain.
    throw new Error(
      `receipt is ${Buffer.byteLength(line, 'utf8')} bytes and the atomic-append bound is ${MAX_LINE_BYTES}; `
      + 'the excess is in a field that may not be shortened',
    );
  }

  // Receipts name attempts on protected paths and the sessions that made them — metadata, not
  // broadcast material. 0600, and LIMITS §13 says why and what to chmod for files that predate it.
  appendFileSync(file, line, { encoding: 'utf8', flag: 'a', mode: 0o600 });
  const entry = JSON.parse(line);
  return { entry, degraded: head.degraded ?? null };
}

function renderLine(prev, body, sign) {
  const hash = hashOf(prev, body);
  let sig = null;
  try { sig = typeof sign === 'function' ? sign(hash) : null; } catch { sig = null; }
  // Field order on disk is cosmetic — `canonicalJSON` sorts before hashing — but
  // keeping body first and the cryptography last reads well in a terminal.
  return `${JSON.stringify({ ...body, prev, hash, sig })}\n`;
}

/**
 * Read every receipt. Returns raw lines too, because `verify` reports on them.
 *
 * ══ METADATA IS NOT MIXED INTO THE RECEIPT, AND THAT IS A SECURITY PROPERTY ══
 *
 * This used to return `{ ...entry, __line, __raw }` — the line number and the
 * original text merged into the same object as the receipt. Cheap to read, and
 * it put a hole straight through the one claim this file exists to support.
 *
 * Because the metadata rode along in the receipt, every hashing path had to
 * remove it again before recomputing, and both of them did it by NAME SHAPE:
 * skip any key beginning with `__`. That turned the exclusion into a property
 * of the DATA rather than of the reader. Anything on disk whose key started
 * with `__` was dropped from the preimage — so it could be added to, or removed
 * from, any receipt at rest and the chain still verified clean. An entire
 * private key fits in such a field. Measured, against the shipped binary.
 *
 * So the metadata travels BESIDE the entry and never inside it. `bodyOf()` then
 * has nothing to exclude and hashes every key it is given, which is what the
 * claim "this record has not been altered" actually requires.
 *
 * Returns `records`, each `{ entry, line, raw }`. Callers that want the receipt
 * take `.entry`; callers reporting a position take `.line`.
 */
export function readAll(repoRoot) {
  const file = chainPath(repoRoot);
  if (!existsSync(file)) return { lines: [], records: [], unparsable: [] };
  const text = readFileSync(file, 'utf8');
  const lines = text.split('\n').filter((l) => l.trim().length > 0);
  const records = [];
  const unparsable = [];
  lines.forEach((line, i) => {
    try {
      const e = JSON.parse(line);
      if (!e || typeof e !== 'object') throw new Error('not an object');
      records.push({ entry: e, line: i + 1, raw: line });
    } catch (err) {
      unparsable.push({ line: i + 1, raw: line, reason: err?.message ?? 'unparsable' });
    }
  });
  return { lines, records, unparsable };
}
