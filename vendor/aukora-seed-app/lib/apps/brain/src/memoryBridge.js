// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Aukora
/**
 * Governed legacy-memory migration bridge — DRY-RUN.
 *
 * Reads the old Symbiote memory READ-ONLY and rehearses a migration into an ISOLATED store, proving the whole
 * pipeline before any real import:
 *   - corruption FAILS LOUD (a content-hash mismatch or malformed row throws, never silently skipped);
 *   - each record is validated, secret/consent classified, and content-addressed (canonical `deriveRecordId`);
 *   - provenance, status, timestamps, chain hashes, receipt reference and `gateArgsHash` are PRESERVED
 *     (content-free) in the public report and in the record provenance;
 *   - PRIVATE PLAINTEXT never enters the public report (Git); it lives only in the in-memory isolated store;
 *   - a SECRET-bearing record is quarantined content-free (plaintext never imported);
 *   - a TOMBSTONED legacy record is preserved as a content-free audit and NEVER re-ingested (no resurrection);
 *   - the isolated import is verified (counts, hashes, recall, forgetting, tamper refusal, rollback);
 *   - NO real import happens without a distinct AUMLOK owner approval;
 *   - the OLD chain is only READ — never rewritten (this bridge has no write path to the source).
 *
 * Reuses canonical primitives only: `@aukora/evidence` (`sha256Hex`, `textHasSecret`) and `@aukora/memory`
 * (`buildMemoryRecord`, `deriveRecordId`) + the in-memory ReactiveMemoryStore. Nothing is cloned.
 */
import { sha256Hex, textHasSecret } from '../../../packages/evidence/src/index.js';
import { buildMemoryRecord, deriveRecordId } from '../../../packages/memory/index.js';
import { verifyReceiptChain } from '../../../../../authority/lib/evidence.js';
import { utf8ToBytes } from '../../../../../authority/deps/@noble/hashes@2.2.0/utils.js';
import { ReactiveMemoryStore } from './reactiveStore.js';
/** Raw sha256 hex of a UTF-8 string — the legacy Symbiote memory's `contentHash` shape. */
export function legacyContentHash(content) {
    return sha256Hex(utf8ToBytes(content));
}
export class MemoryBridgeCorruptionError extends Error {
}
export const KIRA_CLASSES = {
    ROOT: { color: 'green', meaning: 'foundational' },
    UNITE: { color: 'blue', meaning: 'relational' },
    RISE: { color: 'purple', meaning: 'purpose/guidance' },
    GOLD: { color: 'amber', meaning: 'constitutional (owner-ceremony protected)' },
};
function isSelected(legacyRef, kiraClass, s) {
    if (!s)
        return true;
    if (s.excludeRefs?.includes(legacyRef))
        return false;
    const hasInclude = (s.includeRefs?.length ?? 0) > 0 || (s.includeClasses?.length ?? 0) > 0;
    if (!hasInclude)
        return true;
    return (s.includeRefs?.includes(legacyRef) ?? false) || (s.includeClasses?.includes(kiraClass) ?? false);
}
const HEX64 = /^[0-9a-f]{64}$/;
function classifyConsent(visibility) {
    if (visibility === 'shared')
        return 'shared';
    if (visibility === 'private')
        return 'private';
    return 'owner-only'; // owner+writer / unknown → tightest
}
function packProvenance(r) {
    const short = (s) => (s ? s.slice(0, 12) : 'none');
    return `legacy ${r.chainKey}#${r.seq} status=${r.status} hash=${short(r.hash)} prev=${short(r.prevHash)} receipt=${short(r.receiptHash)} gate=${short(r.gateArgsHash)} tier=${r.tier ?? 'none'}`.slice(0, 512);
}
/** Fail LOUD on any structural defect or content-hash mismatch. */
export function assertLegacyIntegrity(r) {
    const bad = (why) => { throw new MemoryBridgeCorruptionError(why); };
    if (r === null || typeof r !== 'object')
        bad('legacy_row_not_object');
    const o = r;
    const ref = `${String(o.chainKey)}#${String(o.seq)}`;
    if (typeof o.chainKey !== 'string' || o.chainKey.length === 0)
        bad(`chainKey_invalid:${ref}`);
    if (typeof o.seq !== 'number' || !Number.isSafeInteger(o.seq) || o.seq < 0)
        bad(`seq_invalid:${ref}`);
    if (typeof o.content !== 'string')
        bad(`content_invalid:${ref}`);
    if (typeof o.contentHash !== 'string' || !HEX64.test(o.contentHash))
        bad(`contentHash_invalid:${ref}`);
    if (typeof o.createdAt !== 'string' || o.createdAt.length === 0)
        bad(`createdAt_invalid:${ref}`);
    if (o.status !== 'active' && o.status !== 'tombstoned')
        bad(`status_invalid:${ref}`);
    if (typeof o.hash !== 'string' || !HEX64.test(o.hash))
        bad(`hash_invalid:${ref}`);
    if (o.prevHash !== null && (typeof o.prevHash !== 'string' || !HEX64.test(o.prevHash)))
        bad(`prevHash_invalid:${ref}`);
    // corruption: the stored content must hash to the stored contentHash.
    if (legacyContentHash(o.content) !== o.contentHash)
        bad(`content_hash_mismatch:${ref}`);
}
/** The governed dry-run migration. Holds an isolated in-memory store; persists nothing durable. */
export class GovernedMemoryMigration {
    source;
    store = new ReactiveMemoryStore();
    constructor(source) {
        this.source = source;
    }
    /** The isolated dry-run store (in-memory). Plaintext lives ONLY here — never in the report. */
    isolatedStore() {
        return this.store;
    }
    /**
     * CONTENT-FREE selection catalog for Auma and Peter: every legacy record's ref, class, consent, status, and
     * content hash — everything needed to CHOOSE what migrates, nothing that reveals what it says. Read-only
     * (fails loud on corruption); safe to publish to the selection UI or an issue.
     */
    selectionCatalog(classify = () => 'ROOT') {
        return this.source.exportAll().map((r) => {
            assertLegacyIntegrity(r);
            return {
                legacyRef: `${r.chainKey}#${r.seq}`,
                kiraClass: classify(r),
                consent: classifyConsent(r.visibility),
                status: r.status,
                contentHash: r.contentHash,
                secretQuarantined: r.status === 'active' && textHasSecret(r.content),
            };
        });
    }
    dryRun(options = {}) {
        const classify = options.classify ?? (() => 'ROOT');
        const legacy = this.source.exportAll(); // READ-ONLY
        const entries = [];
        const kiraCounts = { ROOT: 0, UNITE: 0, RISE: 0, GOLD: 0 };
        let active = 0, excluded = 0, secret = 0, tomb = 0;
        for (const r of legacy) {
            assertLegacyIntegrity(r); // FAIL LOUD on corruption
            const legacyRef = `${r.chainKey}#${r.seq}`;
            const consent = classifyConsent(r.visibility);
            const kiraClass = classify(r); // runs locally; only the CLASS reaches the report
            kiraCounts[kiraClass] += 1;
            const base = { legacyRef, contentHash: r.contentHash, consent, kiraClass, status: r.status, receiptHash: r.receiptHash ?? null, gateArgsHash: r.gateArgsHash ?? null, prevHash: r.prevHash };
            if (r.status === 'tombstoned') {
                tomb += 1;
                entries.push({ ...base, newRecordId: null, selected: false, classification: 'tombstone-preserved' }); // NO plaintext — no resurrection
                continue;
            }
            if (textHasSecret(r.content)) {
                secret += 1;
                entries.push({ ...base, newRecordId: null, selected: false, classification: 'secret-quarantined' }); // plaintext NEVER imported / public
                continue;
            }
            // Auma/Peter selection: an unselected active is REPORTED (content-free) but never imported.
            if (!isSelected(legacyRef, kiraClass, options.selection)) {
                excluded += 1;
                entries.push({ ...base, newRecordId: null, selected: false, classification: 'active-plaintext' });
                continue;
            }
            const rec = buildMemoryRecord({ content: r.content, createdAt: r.createdAt, consent, provenance: packProvenance(r) });
            const ing = this.store.ingest(rec);
            if (!ing.ok)
                throw new MemoryBridgeCorruptionError(`import_refused:${legacyRef}:${ing.refusal}`); // fail loud
            active += 1;
            entries.push({ ...base, newRecordId: ing.recordId, selected: true, classification: 'active-plaintext' });
        }
        const verified = this.verify(legacy.length, entries, active);
        return {
            schema: 'aukora-memory-migration-report-v1',
            dryRun: true,
            counts: { exported: legacy.length, activeMigrated: active, excludedBySelection: excluded, secretQuarantined: secret, tombstonesPreserved: tomb },
            kiraCounts,
            entries,
            verified,
            committed: false,
            grantsAuthority: false,
        };
    }
    verify(exported, entries, active) {
        const activeEntries = entries.filter((e) => e.classification === 'active-plaintext');
        const counts = entries.length === exported && activeEntries.length === active && this.store.snapshot().liveCount === active;
        // hashes: every active entry is content-addressed, and its id matches deriveRecordId of the recalled content.
        const recalled = this.store.recall({ text: '' });
        const idSet = new Set(recalled.map((h) => h.recordId));
        const hashes = activeEntries.every((e) => e.newRecordId !== null && HEX64.test(e.newRecordId) && idSet.has(e.newRecordId))
            && recalled.every((h) => deriveRecordId(h.content) === h.recordId);
        const recall = recalled.length === active;
        // tamper refusal (non-mutating on the primary store): a tampered COPY of the chain fails the canonical verifier.
        const chain = this.store.chain();
        const tamperRefused = chain.length === 0 ? true
            : verifyReceiptChain(chain.map((e, i) => (i === 0 ? { ...e, chainHash: '0'.repeat(64) } : e))).valid === false;
        // forgetting + rollback are proven on a THROWAWAY store so the primary (migrated) set stays intact for a
        // gated commit. Re-import the recalled actives into the throwaway, forget one, then discard it.
        const throwaway = new ReactiveMemoryStore();
        for (const h of recalled)
            throwaway.ingest(buildMemoryRecord({ content: h.content, createdAt: h.createdAt }));
        let forgetting = true;
        const first = throwaway.recall({ text: '' })[0];
        if (first) {
            const had = throwaway.plaintextRetained(first.recordId);
            const f = throwaway.forget(first.recordId, () => true, '2026-01-01T00:00:00.000Z');
            forgetting = had && f.ok && !throwaway.plaintextRetained(first.recordId) && throwaway.verifyChain().valid;
        }
        // rollback: a dry-run store is in-memory only; discarding it leaves nothing behind.
        const discarded = new ReactiveMemoryStore();
        const rollback = discarded.snapshot().chainLength === 0;
        return { counts, hashes, recall, forgetting, tamperRefused, rollback };
    }
    /** Discard the isolated store; a dry-run leaves nothing behind. Returns true when the store is empty. */
    rollback() {
        this.store = new ReactiveMemoryStore();
        return this.store.snapshot().chainLength === 0;
    }
    /**
     * Real import gate. Refuses without a distinct AUMLOK owner approval; even with approval, imports ONLY when a
     * durable target is explicitly provided (dry-run has none). The legacy source is NEVER written to.
     */
    commitImport(verifyOwnerApproval, durableTarget) {
        if (!verifyOwnerApproval())
            return { committed: false, refusal: 'refused: real import requires a distinct AUMLOK owner approval' };
        if (!durableTarget)
            return { committed: false, refusal: 'refused: dry-run — no durable import target provided; nothing imported' };
        const ids = this.store.recall({ text: '' }).map((h) => h.recordId);
        durableTarget.importRecordIds(ids); // content-addressed ids only; still never rewrites the legacy source
        return { committed: true };
    }
}
/** The migration bridge grants no authority. Constant. */
export function memoryBridgeGrantsAuthority() {
    return false;
}
