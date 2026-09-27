import { CANONICAL_SEATS } from '../../../packages/council/index.js';
import { envCredentialSource, makeProviderTransport, redactedTransportInfo } from './providerTransport.js';
import { runFuAdvisory } from './fuStructuredAdapter.js';
import { armedEgressTransport, envProviderArm, DurableSpendAccount } from './providerEgress.js';
/**
 * Run (or skip) the live smoke. Total — never throws. Skips unless `liveFlag === '1'` AND a credential resolves.
 * The credential value is used only inside the transport; this function never returns or logs it.
 */
export async function runFuLiveSmoke(opts) {
    const cred = opts.credentials ?? envCredentialSource;
    const transportInfo = redactedTransportInfo(opts.config);
    const skip = (reason) => ({ ran: false, skipped: true, reason, verdict: null, quorumMet: null, measuredUsd: 0, transport: transportInfo, grantsAuthority: false });
    const flag = opts.liveFlag ?? (typeof process !== 'undefined' && process.env ? process.env.AUKORA_FU_LIVE : undefined);
    if (flag !== '1')
        return skip('opt-out: set AUKORA_FU_LIVE=1 to run the live smoke (default is skipped)');
    if (cred.get(opts.config.credentialRef) === null)
        return skip(`no credential at ${opts.config.credentialRef} — supply it out-of-band (env/Keychain), never in repo`);
    // OWNER-ARMED egress + content-free egress receipts + durable spend accounting wrap the live transport.
    const spend = opts.spend ?? new DurableSpendAccount(0);
    spend.beginPass();
    const transport = armedEgressTransport(makeProviderTransport(opts.config, cred), {
        arm: opts.arm ?? envProviderArm, store: opts.store, spend, perCallEstimateUsd: 0.25, nowIso: opts.nowIso,
    });
    const input = opts.input ?? { problem: 'Is the governed recursion gate safe against forged and replayed signatures?', claims: ['refuses forged signatures', 'blocks replayed nonces'] };
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
export function fuLiveSmokeGrantsAuthority() {
    return false;
}
