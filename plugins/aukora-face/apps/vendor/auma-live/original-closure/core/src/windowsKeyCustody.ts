// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Aumara and Peter Viviani
/**
 * Windows-native key-file custody verification — the parity brick for the strict custody readers
 * (readAdminKeyStrict, readOwnerSeedStrict, the capture adapter's seed reads).
 *
 * WHY: on Windows, bun/node fabricate POSIX mode 0666 for every writable file (probed live,
 * 2026-07-07 — chmod 600 changes nothing stat reports), so the POSIX `(mode & 0o077) !== 0` law
 * refuses BY CONSTRUCTION and the governed write path could never run on a Windows node. The real
 * protection Windows offers is the ACL, so the ACL is what this module verifies — natively, via
 * `icacls.exe` invoked with an ARGUMENT ARRAY (execFileSync, no shell, no string interpolation).
 *
 * LAW (fail-closed in every direction; POSIX behavior on Mac/Linux is untouched by this module):
 *   - ALLOWLIST, not denylist: every GRANT ace on the key file must belong to an identity in the
 *     small allowed set — the current user (`%USERDOMAIN%\%USERNAME%`), `NT AUTHORITY\SYSTEM`,
 *     and `BUILTIN\Administrators`. A grant to ANYTHING else — `Everyone`, `BUILTIN\Users`,
 *     `NT AUTHORITY\Authenticated Users`, another user, an unresolved SID — REFUSES. A denylist
 *     of "broad groups" would fail OPEN on localized Windows (German "Jeder" is not "Everyone");
 *     the allowlist fails CLOSED there instead, which is the only acceptable failure direction
 *     for key custody. (Localized SYSTEM/Administrators names therefore refuse too — stated
 *     honestly; the remedy text tells the owner how to re-grant canonical identities.)
 *   - DENY aces are protective (they only ever remove access) — they are skipped, not counted as
 *     grants.
 *   - icacls missing, erroring, or emitting anything this parser cannot positively recognize →
 *     typed refusal. Unparseable custody is unverified custody.
 *
 * Injectable seams (runner, platform identity) keep every branch hermetically testable on any OS;
 * the default path runs the real icacls.exe.
 */
import { execFileSync } from 'child_process';

export class WindowsCustodyError extends Error {
  constructor(public readonly code: string, message: string) {
    super(`${code}: ${message}`);
    this.name = 'WindowsCustodyError';
  }
}

const fail = (code: string, message: string): never => {
  throw new WindowsCustodyError(code, message);
};

/** Runs `icacls.exe <path>` and returns raw stdout. Injectable for hermetic tests. */
export type IcaclsRunner = (filePath: string) => string;

const realIcacls: IcaclsRunner = (filePath) =>
  execFileSync('icacls.exe', [filePath], { stdio: 'pipe', timeout: 15_000 }).toString();

export interface WindowsCustodyOptions {
  runIcacls?: IcaclsRunner;
  /** Identity override for tests; defaults to %USERDOMAIN% / %USERNAME%. */
  userDomain?: string;
  userName?: string;
}

/** The always-allowed machine identities (canonical English names; localized names refuse —
 *  fail-closed by design, see header). */
const ALLOWED_MACHINE_IDENTITIES = ['nt authority\\system', 'builtin\\administrators'];

/** One parsed ACE line: `identity:(flag)(flag)…`. */
const ACE_RE = /^(.+?):((?:\([^()]*\))+)$/;

/**
 * Verify that `filePath`'s ACL grants access ONLY to the current user, SYSTEM, and Administrators.
 * Returns void on pass; throws WindowsCustodyError (typed, loud, key-material-free) otherwise.
 */
export function verifyWindowsKeyFileCustody(filePath: string, opts: WindowsCustodyOptions = {}): void {
  const runIcacls = opts.runIcacls ?? realIcacls;
  const userDomain = (opts.userDomain ?? process.env.USERDOMAIN ?? '').toLowerCase();
  const userName = (opts.userName ?? process.env.USERNAME ?? '').toLowerCase();
  if (!userName) {
    fail('windows_custody_identity_unknown', 'cannot resolve the current user (%USERNAME% unset) — refusing to certify custody');
  }

  let raw: string;
  try {
    raw = runIcacls(filePath);
  } catch (e) {
    return fail('windows_custody_icacls_unavailable', `icacls.exe could not inspect ${filePath}: ${e instanceof Error ? e.message : String(e)}`);
  }

  // icacls output: first line is `<path> <first ACE>`, continuation lines are indented ACEs,
  // then a blank line and a "Successfully processed …" summary (localized on non-English
  // Windows — treated as an ACE-candidate and refused by the parser below, which is the
  // fail-closed direction).
  const lines = raw.split(/\r?\n/);
  const aces: Array<{ identity: string; flags: string }> = [];
  let sawSummary = false;
  for (let i = 0; i < lines.length; i++) {
    let line = lines[i];
    if (i === 0) {
      if (!line.toLowerCase().startsWith(filePath.toLowerCase())) {
        return fail('windows_custody_unparseable', `icacls output did not start with the queried path for ${filePath}`);
      }
      line = line.slice(filePath.length);
    }
    const t = line.trim();
    if (t === '') continue;
    if (/^successfully processed .*files/i.test(t)) { sawSummary = true; continue; }
    const m = ACE_RE.exec(t);
    if (!m) return fail('windows_custody_unparseable', `unrecognized icacls line for ${filePath}: "${t.slice(0, 80)}"`);
    aces.push({ identity: m[1].trim().toLowerCase(), flags: m[2].toLowerCase() });
  }
  if (!sawSummary) {
    // No recognizable summary — either a localized icacls or a truncated read. Unverified = refused.
    return fail('windows_custody_unparseable', `icacls output for ${filePath} carried no recognizable success summary — cannot certify custody`);
  }
  if (aces.length === 0) {
    return fail('windows_custody_unparseable', `icacls reported no ACL entries for ${filePath} — cannot certify custody`);
  }

  for (const ace of aces) {
    if (ace.flags.includes('(deny)')) continue; // protective — removes access, never adds it
    const id = ace.identity;
    const isMachineAllowed = ALLOWED_MACHINE_IDENTITIES.includes(id);
    // exact DOMAIN\user when the domain is known; with no %USERDOMAIN% accept <any-domain>\user
    // (the username still must match exactly — never a bare or partial match).
    const parts = id.split('\\');
    const isCurrentUser = userDomain
      ? id === `${userDomain}\\${userName}`
      : parts.length === 2 && parts[1] === userName;
    if (!isMachineAllowed && !isCurrentUser) {
      return fail(
        'windows_custody_open',
        `${filePath} grants access to "${ace.identity}" — key files may only grant the owning user, SYSTEM, and Administrators. ` +
        `Fix: icacls "${filePath}" /inheritance:r /grant:r "%USERDOMAIN%\\%USERNAME%:F" "SYSTEM:F" "Administrators:F"`,
      );
    }
  }
}
