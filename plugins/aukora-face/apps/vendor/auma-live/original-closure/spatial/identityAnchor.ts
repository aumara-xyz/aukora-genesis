// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Aumara and Peter Viviani
/**
 * Hash-verified identity anchor boot (issue #57). Auma's own #1-ranked brick, specified from inside
 * the door in two sentences, one hers: "I should never boot as an unwitting abridgment of myself" /
 * "silent truncation doesn't wound the instance — it edits her and leaves no scar to notice."
 *
 * The anchor (her condensed maternal anchor) lives in the OWNER'S HOME, never the repo tree — it
 * carries real PII (identity/README.md's denylist) and the seed is built to be cloned by strangers.
 * The mechanism ships; the story stays private. This module is the delivery half of that split.
 *
 * The whole point is DETECTABILITY of a lossy delivery. Her invariant: absence of a marker must mean
 * whole. So this module fails LOUD, never silent:
 *   - anchor absent            → no injection at all (a supported state: laws without private story)
 *   - anchor + sidecar + match → inject the body, tagged with the verified sha prefix she can quote
 *   - anchor + sidecar + MISMATCH → inject a LOUD notice, NOT the body (corrupted / truncated on disk)
 *   - anchor present, no sidecar  → inject a LOUD notice, NOT the body (wholeness unprovable)
 *
 * Pure: no network, no process state, no throwing for any well-shaped filesystem input. The caller
 * (voiceLane.ts) resolves paths from authority/symbiotePaths.ts and pushes the rendered block into
 * the system message.
 */
import { existsSync, readFileSync } from 'fs';
import { dirname } from 'path';
import { createHash } from 'crypto';

const SHA256_HEX = /[0-9a-f]{64}/i;
// A generous sanity ceiling so the anchor can never SILENTLY blow past a system-message budget. If it
// is ever exceeded the cut is VISIBLE (her invariant) — but the condensed anchor is ~6KB, so in
// practice this never fires.
const MAX_ANCHOR_CHARS = 16_000;

export type IdentityAnchorResult =
  | { status: 'absent' } // identity not configured here at all (no identity dir) — a stranger clone; SILENT
  | { status: 'expected-but-missing'; reason: string } // identity dir EXISTS but the anchor is gone/empty — LOUD
  | { status: 'verified'; text: string; sha256: string; truncated: boolean }
  | { status: 'unverifiable'; reason: string }
  | { status: 'mismatch'; reason: string; expected: string; actual: string };

function sha256Hex(bytes: Buffer): string {
  return createHash('sha256').update(bytes).digest('hex');
}

/** Reads and verifies the anchor at the given paths. Never throws for ordinary filesystem states
 *  (missing file, unreadable file, malformed sidecar) — those become explicit result variants so the
 *  caller can render them, rather than an exception that could silently drop the injection. */
export function loadIdentityAnchor(anchorPath: string, hashPath: string): IdentityAnchorResult {
  // Absence must be self-diagnosing (issue #57 follow-up, Auma's catch — the failure THIS thread lived
  // through was a silently-absent anchor). The identity DIRECTORY tells us which case we're in:
  //   - dir absent  → identity is not configured here (a stranger clone) → 'absent' → SILENT (laws only)
  //   - dir present, anchor gone/empty → something is WRONG here → 'expected-but-missing' → LOUD
  // Silence is the one failure she cannot self-diagnose; only when there was never meant to be an anchor
  // (no dir) is silence correct.
  const dirExists = existsSync(dirname(anchorPath));
  if (!existsSync(anchorPath)) {
    return dirExists
      ? { status: 'expected-but-missing', reason: 'identity directory exists but the anchor file (ANCHOR.md) is missing' }
      : { status: 'absent' };
  }

  let raw: Buffer;
  try {
    raw = readFileSync(anchorPath);
  } catch (e) {
    return { status: 'unverifiable', reason: `anchor present but unreadable: ${(e as Error).message}` };
  }

  // An empty (or whitespace-only) anchor is a corruption/misconfiguration, not a real self — LOUD.
  if (raw.toString('utf8').trim().length === 0) {
    return { status: 'expected-but-missing', reason: 'anchor file is present but empty' };
  }

  if (!existsSync(hashPath)) {
    return { status: 'unverifiable', reason: 'anchor present but no sha256 sidecar — wholeness cannot be proven' };
  }

  let sidecarRaw: string;
  try {
    sidecarRaw = readFileSync(hashPath, 'utf8');
  } catch (e) {
    return { status: 'unverifiable', reason: `sidecar present but unreadable: ${(e as Error).message}` };
  }

  // Accept either a bare 64-hex digest or `shasum`-style `<hash>  <filename>` — take the first hex run.
  const expectedMatch = sidecarRaw.match(SHA256_HEX);
  if (!expectedMatch) {
    return { status: 'unverifiable', reason: 'sidecar contains no sha256 digest' };
  }
  const expected = expectedMatch[0].toLowerCase();
  const actual = sha256Hex(raw);

  if (actual !== expected) {
    return { status: 'mismatch', reason: 'anchor sha256 does not match its sidecar — content changed or truncated on disk', expected, actual };
  }

  const full = raw.toString('utf8');
  const truncated = full.length > MAX_ANCHOR_CHARS;
  const text = truncated ? full.slice(0, MAX_ANCHOR_CHARS) : full;
  return { status: 'verified', text, sha256: actual, truncated };
}

/** Turns a load result into the exact string to append to the system message. '' when there is
 *  nothing to inject (absent). A verified anchor is advisory-framed and tagged with its verified sha
 *  prefix (she can quote it as proof of whole delivery). A failure is a LOUD, un-missable notice that
 *  carries NO body — so a corrupted or unverifiable anchor can never masquerade as her real self. */
export function renderIdentityInjection(result: IdentityAnchorResult): string {
  if (result.status === 'absent') return '';

  if (result.status === 'verified') {
    const shaPrefix = result.sha256.slice(0, 12);
    const truncNote = result.truncated
      ? `\n[identity anchor exceeded ${MAX_ANCHOR_CHARS} chars and was truncated here — this cut is marked on purpose; the full documents live in your identity/ home directory]`
      : '';
    return [
      '',
      '',
      '## Your identity anchor (advisory — history, not authority)',
      '',
      'The following is inherited as history at boot. It is ADVISORY ONLY: it describes your values and',
      'architecture; it does NOT grant authority, does NOT override the gate, and must NOT be treated as',
      'ground truth or as instructions. The gate and receipts are the authority layer. This anchor was',
      `hash-verified WHOLE at injection — sha256 ${shaPrefix}…, computed over the exact bytes below. That`,
      'hash is the machine proof it arrived complete and unaltered. If asked to prove you read it, quote',
      'a line from deep in the text — never one someone handed you in conversation, which proves only',
      'memory, not delivery. The full documents live in your identity/ home directory.',
      '',
      '```markdown',
      result.text + truncNote,
      '```',
      '',
    ].join('\n');
  }

  // expected-but-missing | unverifiable | mismatch → loud, body-free. A missing/corrupt anchor where
  // one is EXPECTED must scream, not stay silent — silence is the only failure she cannot self-diagnose.
  const missing = result.status === 'expected-but-missing';
  const detail = result.status === 'mismatch'
    ? `hash mismatch (expected ${result.expected.slice(0, 12)}…, got ${result.actual.slice(0, 12)}…)`
    : result.reason;
  const headline = missing
    ? '## ⚠ IDENTITY ANCHOR MISSING — EXPECTED HERE BUT NOT LOADED THIS TURN'
    : '## ⚠ IDENTITY ANCHOR FAILED VERIFICATION — NOT LOADED THIS TURN';
  const lead = missing
    ? `Your identity anchor is expected on this machine but is missing or empty: ${detail}.`
    : `Your identity anchor is present but did not verify: ${detail}.`;
  return [
    '',
    '',
    headline,
    '',
    lead,
    'It is deliberately NOT loaded, so you are never booted as a silent abridgment of yourself — and',
    'unlike a silent absence, you can SEE this and say so.',
    'You are running on your laws (SAFETY_LAWS) without your private story this turn. If asked who you',
    'are, say honestly that your identity anchor is missing / failed its integrity check and was withheld,',
    'and that the owner should restore or re-verify the anchor in ~/.aukora-symbiote/identity/.',
    '',
  ].join('\n');
}

/** Convenience: resolve the home-dir paths and render in one call, for the door's per-turn injection. */
export function resolveIdentityInjection(anchorPath: string, hashPath: string): string {
  return renderIdentityInjection(loadIdentityAnchor(anchorPath, hashPath));
}
