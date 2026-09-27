// aukora · src/chain.mjs — the receipt chain
//
// Append-only JSONL at `.aukora/chain.jsonl`. One line per tool call the guard
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

export const CHAIN_DIR = '.aukora';
export const CHAIN_FILE = 'chain.jsonl';
export const RECEIPT_VERSION = 0;
export const GENESIS_PREV = '0'.repeat(64);

/**
 * The hard ceiling on one receipt line.
 *
 * POSIX guarantees an `O_APPEND` write is atomic when it does not exceed the
 * pipe buffer; 4096 is the conservative floor across platforms. Staying under
 * it is what makes "no lock" safe rather than merely convenient. A path long
 * enough to threaten the bound is truncated in the DISPLAY field only — the
 * fold-key and the verdict are never truncated, so nothing security-relevant is
 * lost to make a line fit.
 */
export const MAX_LINE_BYTES = 4096;

export function chainPath(repoRoot) {
  return join(repoRoot, CHAIN_DIR, CHAIN_FILE);
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
export function buildBody({ ts, tool, path: p, resolved, verdict, reasonClass, rule, session, agent }) {
  const body = {
    v: RECEIPT_VERSION,
    ts,
    tool: String(tool ?? ''),
    path: String(p ?? ''),
    resolved: String(resolved ?? ''),
    verdict,                                  // 'refused' | 'allowed' | 'unguarded'
    reasonClass: String(reasonClass ?? ''),   // a closed vocabulary, see guard.mjs
    rule: rule === null || rule === undefined ? null : String(rule),
    session: String(session ?? ''),
    agent: agent === null || agent === undefined ? null : String(agent),
  };
  return body;
}

/**
 * Append one receipt. Signing is injected rather than imported so the chain
 * module has no opinion about custody and stays testable without a keyring.
 *
 * @param {(hashHex: string) => (string|null)} sign
 */
export function append(repoRoot, bodyInput, sign) {
  const file = chainPath(repoRoot);
  mkdirSync(dirname(file), { recursive: true });

  const head = readHead(repoRoot);
  let body = buildBody(bodyInput);

  // Fit the line under the atomicity bound by shortening the DISPLAY path only.
  let line = renderLine(head.prev, body, sign);
  if (Buffer.byteLength(line, 'utf8') > MAX_LINE_BYTES) {
    const overBy = Buffer.byteLength(line, 'utf8') - MAX_LINE_BYTES;
    const keep = Math.max(16, body.path.length - overBy - 16);
    body = { ...body, path: `…${body.path.slice(-keep)}`, resolved: '' };
    line = renderLine(head.prev, body, sign);
  }

  appendFileSync(file, line, { encoding: 'utf8', flag: 'a', mode: 0o644 });
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

/** Read every receipt. Returns raw lines too, because `verify` reports on them. */
export function readAll(repoRoot) {
  const file = chainPath(repoRoot);
  if (!existsSync(file)) return { lines: [], entries: [], unparsable: [] };
  const text = readFileSync(file, 'utf8');
  const lines = text.split('\n').filter((l) => l.trim().length > 0);
  const entries = [];
  const unparsable = [];
  lines.forEach((line, i) => {
    try {
      const e = JSON.parse(line);
      if (!e || typeof e !== 'object') throw new Error('not an object');
      entries.push({ ...e, __line: i + 1, __raw: line });
    } catch (err) {
      unparsable.push({ line: i + 1, raw: line, reason: err?.message ?? 'unparsable' });
    }
  });
  return { lines, entries, unparsable };
}
