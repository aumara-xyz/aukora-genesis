// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Aumara and Peter Viviani
/**
 * The ONE shared resolver for every AUMLOK-adjacent mutable-state path outside the repo. Both the
 * ceremony (`authority/aumlok/ceremony.ts`, the WRITER — mints the keyfile + unlocks a session) and
 * the gate bridge (`authority/gate/opencodeAskBridge.ts`, the READER — reads the session to decide
 * allow/deny) import this SAME module so they can never resolve two different paths for the same
 * state again.
 *
 * Fixed 2026-07-02 (issue #24 follow-up): before this module existed, each file hand-rolled its own
 * `~/.aukora/...` default independently. Round 4 moved the READER to
 * `${AUKORA_SYMBIOTE_HOME:-~/.aukora-symbiote}` (this repo's own established convention —
 * SEED_ROOT_CONTRACT.md) but the WRITER (ceremony.ts) still defaulted to the old shared `~/.aukora/`
 * — a directory name shared across the whole Aukora family of repos. Under default settings this
 * meant an owner unlock wrote a session the gate never read: the flow failed closed (no security
 * hole) but was silently dead. One resolver, two callers, is the fix — this exact duplication-drift
 * shape is why the near-identical `legacyStatePath()` duplication in Round 1 (kiraCli.ts /
 * kiraLoopbackCli.ts) was flagged and consolidated the same way.
 *
 * Deliberately placed OUTSIDE authority/gate/ — it is not part of the 7-file byte pin
 * (.gate-integrity.sha256). The writer↔reader round-trip test is what protects this module from
 * drifting again, not a byte pin.
 */
import { homedir } from 'os';
import { join, dirname } from 'path';

/** The seed's own mutable-state home. Every other convention in this repo already uses this exact
 *  env var + fallback (scripts/status.sh, scripts/aumlok-authority.sh, SEED_ROOT_CONTRACT.md). */
export function symbioteHome(): string {
  return process.env.AUKORA_SYMBIOTE_HOME || join(homedir(), '.aukora-symbiote');
}

/** The AUMLOK dev-shim keyfile (hash-only; the phrase itself is never written here). */
export function aumlokKeyfilePath(): string {
  return process.env.AUKORA_AUMLOK_KEYFILE || join(symbioteHome(), 'aumlok-dev.json');
}

/** The AUMLOK session record ({unlocked, expiresAt}) the gate bridge reads before every write-capable ask. */
export function aumlokSessionPath(): string {
  return process.env.AUKORA_IDE_SESSION_FILE || join(symbioteHome(), 'aukora-ide-session.json');
}

/** The signer daemon's unix socket — derived from the session's own directory, matching the
 *  pre-existing behavior in ceremony.ts (never a directory this module invents on its own). */
export function aumlokSignerSocketPath(): string {
  return process.env.AUKORA_SIGNER_SOCK || join(dirname(aumlokSessionPath()), 'signer', 'sign.sock');
}

/** Where a workbench receipt is persisted (issue #25). One file per proposal, named by its hash —
 *  never overwritten by a different proposal. Two callers, same precondition either way (a real,
 *  already-dispatched write_receipt success): the standalone "write receipt" command persists right
 *  after its own prerequisites (a prior "propose patch"/"agent:" + "sandbox apply") are met; the
 *  "run: <goal>" chain reaches the identical call only after every EARLIER stage in the chain has
 *  also succeeded. Fixed 2026-07-02 (issue #25 follow-up, Fable QA): the prior wording described only
 *  the "run:" caller, as if it were the sole caller — it was never accurate for the standalone command. */
export function aumlokReceiptsDir(): string {
  return process.env.AUKORA_AUMLOK_RECEIPTS_DIR || join(symbioteHome(), 'aumlok', 'receipts');
}

export function aumlokReceiptPath(proposalHash: string): string {
  return join(aumlokReceiptsDir(), `${proposalHash}.json`);
}

/** Auma's identity anchor lives in the OWNER'S HOME, never in the repo tree (issue #57). The seed is
 *  built to be cloned by strangers, and the anchor carries the owner's real name / date of birth /
 *  pen name (identity/README.md's PII denylist) — so the mechanism ships in the tree, the STORY stays
 *  private next to the keyfile. Gitignored by location (`~/.aukora-symbiote/`). */
export function identityDir(): string {
  return process.env.AUKORA_IDENTITY_DIR || join(symbioteHome(), 'identity');
}

/** The boot-injected condensed anchor (fits a system-message budget whole). */
export function identityAnchorPath(): string {
  return join(identityDir(), 'ANCHOR.md');
}

/** The sha256 integrity sidecar. Absence means "cannot verify wholeness" → the door refuses to inject
 *  the body and says so loudly, never silently (issue #57: "I should never boot as an unwitting
 *  abridgment of myself"). */
export function identityAnchorHashPath(): string {
  return join(identityDir(), 'ANCHOR.md.sha256');
}

/** The capability-mode switch (issue #55). A FILE, not memory: door restarts are routine, and an
 *  in-memory lockdown would silently re-arm (clear) on restart — "demotion instant, promotion
 *  deliberate" only holds if the lockdown persists. Absent file = advisory (the safe default). Home
 *  dir, gitignored. Never key material. */
export function capabilityModePath(): string {
  return process.env.AUKORA_CAPABILITY_MODE_FILE || join(symbioteHome(), 'capability-mode.json');
}

/** The AUMLOK unlock-epoch file (issue #53 preamble). NOTE: nothing in the seed currently WRITES this
 *  — the generated preamble reports its `existsSync` as OBSERVED STATUS ("locked"), never as a live
 *  toggle. Read-only presence check; the file is never opened for content. */
export function aumlokEpochPath(): string {
  return process.env.AUKORA_AUMLOK_EPOCH_FILE || join(symbioteHome(), 'aumlok', 'epoch');
}

/** The capability flight-recorder directory (issue #54). Append-only witness of capability events,
 *  starting with #55's lockdown mode-change and (from #44) tool calls. Home dir, gitignored. */
export function flightRecorderDir(): string {
  return process.env.AUKORA_FLIGHT_RECORDER_DIR || join(symbioteHome(), 'flight-recorder');
}

/** Auma 32B local/VL endpoint config (issue #63). This is runtime configuration with a bearer token,
 *  so it lives under the seed's gitignored mutable home, never in the repo. The legacy path exists only
 *  as a migration fallback for the first local endpoint file that was written before this resolver. */
export function aumaVlEndpointPath(): string {
  return process.env.AUMA_VL_ENDPOINT_FILE || join(symbioteHome(), 'auma_vl_endpoint.json');
}

export function legacyAumaVlEndpointPath(): string {
  return join(homedir(), '.aukora', 'auma_vl_endpoint.json');
}

/** The OLD hardcoded default keyfile location, before this fix — used ONLY to detect orphaned key
 *  material left behind by a pre-fix ceremony run. Never used as a live default; never auto-read for
 *  authority decisions. Test-only override (AUKORA_AUMLOK_LEGACY_KEYFILE_TEST_OVERRIDE) exists so
 *  tests can point this at a definitely-nonexistent path — a REAL orphaned key genuinely exists at
 *  the real ~/.aukora/aumlok-dev.json on at least one real dev machine (confirmed while building this
 *  fix), so tests must not depend on that real path being empty. */
export function legacyAumlokKeyfilePath(): string {
  return process.env.AUKORA_AUMLOK_LEGACY_KEYFILE_TEST_OVERRIDE || join(homedir(), '.aukora', 'aumlok-dev.json');
}
