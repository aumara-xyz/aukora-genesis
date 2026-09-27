// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Aukora
/**
 * AUMLOK owner-custody boundary + signing ASSISTANT — the "runtime verifies; the owner signs out-of-band" law.
 *
 * PROVENANCE (WAVE 2): the boundary is ported from the donor `core/src/aumlokSigningAssistant.ts` +
 * `aumlokApproveCeremony.ts` custody guards (aukora-symbiote, #81/#91/#105b). DOCUMENTED ADAPTATION: the donor was
 * Ed25519-only; the current authority is HYBRID (Ed25519 + ML-DSA-65 — see [[aumlokGate]]/[[ownerFixture]]), so
 * custody is over BOTH key halves. The strict-custody and existence-only disciplines are preserved.
 *
 * Hard boundaries this module holds (they are the whole point):
 *   - NO browser/app signing. This module imports NOTHING that can sign or apply — no signer, no candidate stage,
 *     no child_process, no network. It only inspects file PRESENCE and formats strings.
 *   - NO private-key read. Custody is checked by EXISTENCE ONLY (via an injected probe that `stat`s a path and
 *     never opens it). This module never reads key bytes. The probe surface cannot return content.
 *   - Observer/helper only. Every output is advisory. Signing is the owner's, in the owner's terminal.
 *
 * The terminal command is a DISPLAY string; this module never executes it. It answers only: "does the owner hold
 * custody on this device (so an approval gesture can actually be completed out-of-band)?" and "what command does the
 * owner run to sign?". The door consults `custodyStatus()` before it will mint/route an approval.
 */
import * as nodeFs from 'node:fs';
import * as nodePath from 'node:path';

/** Existence-only probe — returns whether a path is a regular file. NEVER returns or reads file CONTENT. */
export interface CustodyProbe {
  isFile(path: string): boolean;
}

/** Default probe over node fs — `statSync` only (existence + type), never `readFileSync`. */
export const nodeCustodyProbe: CustodyProbe = {
  isFile(path: string): boolean {
    try { return nodeFs.statSync(path).isFile(); } catch { return false; }
  },
};

export interface CustodyPaths {
  /** Owner key home; keys live under `<homeDir>/aumlok/`. Default: env AUKORA_SYMBIOTE_HOME or ~/.aukora-symbiote. */
  readonly homeDir?: string;
}

function keyDir(homeDir: string): string { return nodePath.join(homeDir, 'aumlok'); }
function resolveHome(paths: CustodyPaths): string {
  return paths.homeDir ?? process.env.AUKORA_SYMBIOTE_HOME ?? nodePath.join(process.env.HOME || '', '.aukora-symbiote');
}

// The hybrid custody layout: two public halves (the organism may pin these) + two private halves (owner-only).
export const CUSTODY_FILES = Object.freeze({
  edPub: 'authority-ed25519.pub',
  edKey: 'authority-ed25519.key',
  mlPub: 'authority-mldsa65.pub',
  mlKey: 'authority-mldsa65.key',
});

export interface CustodyStatus {
  readonly schema: 'aumlok-owner-custody-v2';
  /** Both public halves present (the organism can pin the root). */
  readonly publicPresent: boolean;
  /** Both private halves present under this home (the owner can sign out-of-band on THIS device). */
  readonly privatePresent: boolean;
  /** Custody is COMPLETE when the owner can both be pinned AND can sign here. */
  readonly custodyComplete: boolean;
  /** A stable reason class when custody is not complete (never leaks a path's contents). */
  readonly reasonClass: 'custody:ok' | 'custody:public-absent' | 'custody:private-absent' | 'custody:absent';
  readonly grantsAuthority: false;
}

/**
 * Existence-only custody status over the hybrid key layout. Pure w.r.t. content: it only asks the probe whether
 * each key FILE exists; it never opens a key. Total — a missing home degrades to `custody:absent`.
 */
export function custodyStatus(paths: CustodyPaths = {}, probe: CustodyProbe = nodeCustodyProbe): CustodyStatus {
  const dir = keyDir(resolveHome(paths));
  const edPub = probe.isFile(nodePath.join(dir, CUSTODY_FILES.edPub));
  const mlPub = probe.isFile(nodePath.join(dir, CUSTODY_FILES.mlPub));
  const edKey = probe.isFile(nodePath.join(dir, CUSTODY_FILES.edKey));
  const mlKey = probe.isFile(nodePath.join(dir, CUSTODY_FILES.mlKey));
  const publicPresent = edPub && mlPub;
  const privatePresent = edKey && mlKey;
  const custodyComplete = publicPresent && privatePresent;
  let reasonClass: CustodyStatus['reasonClass'] = 'custody:ok';
  if (!publicPresent && !privatePresent) reasonClass = 'custody:absent';
  else if (!publicPresent) reasonClass = 'custody:public-absent';
  else if (!privatePresent) reasonClass = 'custody:private-absent';
  return {
    schema: 'aumlok-owner-custody-v2',
    publicPresent, privatePresent, custodyComplete, reasonClass,
    grantsAuthority: false,
  };
}

/** POSIX-shell single-quote escaping so a path can be pasted verbatim into a terminal (donor `shellQuote`). */
export function shellQuote(s: string): string {
  return `'${String(s).replace(/'/g, `'\\''`)}'`;
}

export interface OwnerSigningGuidance {
  readonly schema: 'aumlok-owner-signing-guidance-v2';
  readonly custody: CustodyStatus;
  /** Whether an approval should even be OFFERED (custody must be complete first). */
  readonly canOffer: boolean;
  /** Existence-only keygen hint (null when custody already present). DISPLAY ONLY — never executed here. */
  readonly keygenCommand: string | null;
  /** The EXACT terminal command shape the owner runs to sign a given payload. DISPLAY ONLY. */
  readonly signCommand: string;
  readonly warnings: readonly string[];
  readonly grantsAuthority: false;
}

const WARNINGS: readonly string[] = [
  'Signing happens ONLY in your own terminal. This app never signs and cannot sign.',
  'Never paste your private key or passphrase into the browser. The app never reads your key — it only checks that the key files exist.',
  'A hybrid signature needs BOTH your Ed25519 and your ML-DSA-65 key. A downgraded (single-algorithm) signature fails closed.',
  'AUMLOK owner decides. Fusion only advises — a GREEN council verdict is NOT permission to apply.',
];

/**
 * Build the read-only signing guidance for a candidate payload hash. Pure w.r.t. authority — it describes what the
 * owner would do; it performs nothing. `payloadHash` is the 64-hex candidate payload the owner will sign.
 */
export function ownerSigningGuidance(payloadHash: string, paths: CustodyPaths = {}, probe: CustodyProbe = nodeCustodyProbe): OwnerSigningGuidance {
  const custody = custodyStatus(paths, probe);
  const hash12 = typeof payloadHash === 'string' ? payloadHash.slice(0, 12) : 'unknown';
  return {
    schema: 'aumlok-owner-signing-guidance-v2',
    custody,
    canOffer: custody.custodyComplete,
    keygenCommand: custody.privatePresent ? null : 'bash scripts/aumlok-authority.sh keygen-hybrid',
    signCommand: `bash scripts/aumlok-authority.sh sign-hybrid --payload ${shellQuote(payloadHash)} > ${shellQuote(`/tmp/signed-${hash12}.json`)}`,
    warnings: [...WARNINGS],
    grantsAuthority: false,
  };
}

/** The custody boundary grants no authority — constant, by construction. */
export function ownerCustodyGrantsAuthority(): false {
  return false;
}
