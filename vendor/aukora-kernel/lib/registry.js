// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Peter Viviani
export const KERNEL_SCHEMAS = Object.freeze({
    request: "aukora-kernel-request-v1",
    state: "aukora-trusted-state-v1",
    policy: "aukora-policy-v1",
    result: "aukora-kernel-result-v1",
    receiptDraft: "aukora-receipt-draft-v1",
});
export const AUTHORITY_PROFILES = Object.freeze({
    receiptHead: "aukora-receipt-head-ml-dsa-65-v4",
    aumlokPromotion: "aumlok-ed25519-ml-dsa-65-v1",
});
export const CRYPTO_SUITES = Object.freeze({
    mlDsa65: "ml-dsa-65",
    aumlokHybrid: "aumlok-ed25519-ml-dsa-65-v1",
});
export const PURPOSE_DOMAINS = Object.freeze({
    receiptHead: "aukora-chainhead-v3",
    aumlokPromotion: "aumlok-promotion-v2",
    aumlokLifecycle: "aumlok-lifecycle-v2",
    aumlokMigration: "aumlok-migration-v1",
});
export const RINGS = Object.freeze(["observe", "local-write", "external", "self-modify"]);
export function ringRank(ring) {
    return RINGS.indexOf(ring);
}
export function ringCovers(granted, requested) {
    return ringRank(granted) >= ringRank(requested);
}
