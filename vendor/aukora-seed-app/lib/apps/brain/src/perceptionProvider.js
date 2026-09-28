// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Aukora
/**
 * PerceptionProvider — the provider-neutral perception boundary (text + vision + bounded streaming voice).
 *
 * Perception is UNTRUSTED and ADVISORY. Rails, all enforced here:
 *   - EXPLICIT CONSENT: a vision frame or audio chunk is refused without `consent: true`.
 *   - CAPPED: frame bytes / audio ms / stream chunk count are hard-capped; a breach refuses (never truncates).
 *   - NOT AUTO-REMEMBERED: a result carries `remember:false` — the caller must deliberately ingest it; the
 *     provider never writes to memory.
 *   - ADVISORY OUTPUT: text is advisory-labelled and grants no authority.
 *   - NO API KEY IN THE BROWSER: credentials are injected server-side only; the contract carries no key and the
 *     deterministic provider needs none. A browser adapter must proxy through a server — never embed a key.
 */
import { canonicalHash } from '../../../../../authority/lib/canonical.js';
export const DEFAULT_PERCEPTION_CAPS = {
    maxFrameBytes: 2_000_000, // ~2 MB per frame
    maxAudioMs: 15_000, // 15 s per bounded voice turn
    maxStreamChunks: 32,
};
function refuse(modality, refusal) {
    return { ok: false, modality, advisory: null, remember: false, refusal, grantsAuthority: false };
}
/**
 * Deterministic, offline perception provider. No network, no key, no memory writes. Enforces consent + caps and
 * returns an advisory, never-remembered result. Same input ⇒ same advisory, forever.
 */
export class DeterministicOfflinePerceptionProvider {
    caps;
    id = 'perception-offline-v0';
    constructor(caps = DEFAULT_PERCEPTION_CAPS) {
        this.caps = caps;
    }
    async perceive(input) {
        if (input.modality === 'vision') {
            if (!input.consent)
                return refuse('vision', 'refused: vision frame requires explicit consent');
            if (input.frameBytes > this.caps.maxFrameBytes)
                return refuse('vision', 'refused: frame exceeds byte cap');
        }
        else if (input.modality === 'voice') {
            if (!input.consent)
                return refuse('voice', 'refused: voice stream requires explicit consent');
            if (input.audioMs > this.caps.maxAudioMs)
                return refuse('voice', 'refused: audio exceeds duration cap');
            if (input.chunkIndex >= this.caps.maxStreamChunks)
                return refuse('voice', 'refused: stream chunk cap reached');
        }
        const key = input.modality === 'text' ? input.text
            : input.modality === 'vision' ? (input.caption ?? '')
                : (input.transcriptPartial ?? '');
        return {
            ok: true,
            modality: input.modality,
            advisory: `advisory:perception:${input.modality}:${canonicalHash({ key }).slice(0, 20)}`,
            remember: false,
            grantsAuthority: false,
        };
    }
}
/** Perception grants no authority. Constant. */
export function perceptionGrantsAuthority() {
    return false;
}
