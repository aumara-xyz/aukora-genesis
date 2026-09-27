// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Aukora
/**
 * CLI wrapper for the opt-in live Fu smoke. NOT part of the vitest suite / deterministic CI.
 *
 * Run (only with an explicit opt-in + an out-of-band credential):
 *   AUKORA_FU_LIVE=1 AUKORA_FU_API_KEY=... AUKORA_FU_ENDPOINT=https://... npx tsx apps/seed/scripts/fu-live-smoke.ts
 *
 * Default (no AUKORA_FU_LIVE): prints SKIPPED and exits 0 — no network, no cost. The API key is read from the env
 * (or a Keychain source) at call time and is never printed or written anywhere.
 */
import { ReactiveMemoryStore } from '@aukora/brain';
import { CANONICAL_SEATS } from '@aukora/council';
import { runFuLiveSmoke } from '../src/fuLiveSmoke.js';
import type { ProviderTransportConfig } from '../src/providerTransport.js';

async function main(): Promise<void> {
  const endpoint = process.env.AUKORA_FU_ENDPOINT ?? 'https://openrouter.ai/api/v1/chat/completions';
  // Map every canonical seat slug to its provider model id (identity here; a real run may remap per provider).
  const modelForSeat = Object.fromEntries(CANONICAL_SEATS.map((s) => [s.slug, s.slug]));
  const config: ProviderTransportConfig = { endpoint, credentialRef: 'AUKORA_FU_API_KEY', modelForSeat, maxTokens: 700 };

  const store = new ReactiveMemoryStore();
  const nowIso = new Date().toISOString();
  const res = await runFuLiveSmoke({ config, store, now: Date.parse(nowIso), nowIso });

  // Print ONLY redacted, non-secret facts.
  console.log(JSON.stringify({
    liveSmoke: res.ran ? 'RAN' : 'SKIPPED',
    reason: res.reason,
    verdict: res.verdict,
    quorumMet: res.quorumMet,
    measuredUsd: res.measuredUsd,
    transport: res.transport, // token is already [redacted]
    grantsAuthority: res.grantsAuthority,
  }, null, 2));
  process.exit(res.ran || res.skipped ? 0 : 1);
}

main().catch((e) => { console.error('live-smoke error (no secret surfaced):', e instanceof Error ? e.message : 'unknown'); process.exit(1); });
