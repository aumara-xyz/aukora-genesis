// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Aukora
/**
 * Opt-in LIVE Fu smoke (R37) — the ONLY path in this lane that can make a paid provider call, and it is doubly
 * gated so deterministic CI can never trigger it:
 *   - it runs only when `AUKORA_FU_LIVE=1` is explicitly set (default: SKIPPED, exit 0, no call);
 *   - it still requires an out-of-band credential (env/Keychain); with no credential it refuses honestly.
 *
 * When opted in, it runs ONE real Fu pass through the structured adapter (so the frozen $2/pass + $10/day ceilings,
 * non-vote-on-failure law, and receipting all apply), and reports the verdict + MEASURED cost. The bearer token is
 * never printed, thrown, or receipted — only `redactedTransportInfo` (which carries `[redacted]`) is surfaced.
 *
 * The smoke is a FUNCTION (testable offline: the gate returns "skipped" with no transport), plus a thin CLI in
 * `scripts/fu-live-smoke.ts`. It is NOT part of the vitest suite — CI runs the deterministic offline tests only.
 */
import type { ReactiveMemoryStore } from '@aukora/brain';
import { CANONICAL_SEATS, type CouncilInput } from '@aukora/council';
import { envCredentialSource, makeProviderTransport, redactedTransportInfo, type CredentialSource, type ProviderTransportConfig } from './providerTransport.js';
import { runFuAdvisory } from './fuStructuredAdapter.js';
import { armedEgressTransport, envProviderArm, DurableSpendAccount, type ProviderArm } from './providerEgress.js';

export interface LiveSmokeResult {
  readonly ran: boolean;
  readonly skipped: boolean;
  readonly reason: string;
  readonly verdict: string | null;
  readonly quorumMet: boolean | null;
  /** MEASURED provider cost in USD (0 when skipped; the adapter's actualUsd when run). */
  readonly measuredUsd: number;
  /** Redacted transport descriptor — proves the token is never surfaced. */
  readonly transport: { endpoint: string; credentialRef: string; token: string; seats: number } | null;
  readonly grantsAuthority: false;
}

export interface LiveSmokeOptions {
  /** The opt-in flag value (default reads AUKORA_FU_LIVE). Must equal '1' to run. */
  readonly liveFlag?: string | undefined;
  readonly config: ProviderTransportConfig;
  readonly credentials?: CredentialSource;
  readonly store: ReactiveMemoryStore;
  readonly input?: CouncilInput;
  readonly now?: number;
  readonly nowIso?: string;
  /** Owner arming for egress (default env `AUKORA_FU_ARMED`); disarmed ⇒ every call is a non-vote. */
  readonly arm?: ProviderArm;
  /** Durable spend account persisting the day-to-date total across runs (ceilings enforced pre-call). */
  readonly spend?: DurableSpendAccount;
}

/**
 * Run (or skip) the live smoke. Total — never throws. Skips unless `liveFlag === '1'` AND a credential resolves.
 * The credential value is used only inside the transport; this function never returns or logs it.
 */
export async function runFuLiveSmoke(opts: LiveSmokeOptions): Promise<LiveSmokeResult> {
  const cred = opts.credentials ?? envCredentialSource;
  const transportInfo = redactedTransportInfo(opts.config);
  const skip = (reason: string): LiveSmokeResult =>
    ({ ran: false, skipped: true, reason, verdict: null, quorumMet: null, measuredUsd: 0, transport: transportInfo, grantsAuthority: false });

  const flag = opts.liveFlag ?? (typeof process !== 'undefined' && process.env ? process.env.AUKORA_FU_LIVE : undefined);
  if (flag !== '1') return skip('opt-out: set AUKORA_FU_LIVE=1 to run the live smoke (default is skipped)');
  if (cred.get(opts.config.credentialRef) === null) return skip(`no credential at ${opts.config.credentialRef} — supply it out-of-band (env/Keychain), never in repo`);

  // OWNER-ARMED egress + content-free egress receipts + durable spend accounting wrap the live transport.
  const spend = opts.spend ?? new DurableSpendAccount(0);
  spend.beginPass();
  const transport = armedEgressTransport(makeProviderTransport(opts.config, cred), {
    arm: opts.arm ?? envProviderArm, store: opts.store, spend, perCallEstimateUsd: 0.25, nowIso: opts.nowIso,
  });
  const input: CouncilInput = opts.input ?? { problem: 'Is the governed recursion gate safe against forged and replayed signatures?', claims: ['refuses forged signatures', 'blocks replayed nonces'] };
  const res = await runFuAdvisory(input, transport, opts.store, { seats: CANONICAL_SEATS, now: opts.now, nowIso: opts.nowIso });

  if (!res.ok || res.outcome === null) {
    return { ran: true, skipped: false, reason: `refused: ${res.text}`, verdict: null, quorumMet: null, measuredUsd: 0, transport: transportInfo, grantsAuthority: false };
  }
  return {
    ran: true,
    skipped: false,
    reason: 'live Fu pass complete (advisory only; receipted)',
    verdict: res.outcome.verdict,
    quorumMet: res.outcome.quorumMet,
    measuredUsd: res.outcome.actualUsd,
    transport: transportInfo,
    grantsAuthority: false,
  };
}

/** HARD: the smoke is advisory diagnostics — it mints no authority. Constant, by construction. */
export function fuLiveSmokeGrantsAuthority(): false {
  return false;
}
