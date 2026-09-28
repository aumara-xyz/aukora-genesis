// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Aukora
/**
 * Reactive memory store — the organism brain adapter.
 *
 * Persists KIRA memory records into an append-only, receipt-chained log (reusing the canonical
 * @aukora/kernel receipt chain + Merkle root — no second hash implementation), and maintains a REACTIVE
 * snapshot (live count, chain length, head hash, Merkle root) that recomputes on every ingest/forget so the
 * brain's view always reflects its memory. Growth is provable: live memory count strictly rises across ingests.
 *
 * CONTENT-FREE CHAIN (R29): the chain commits to each memory by its content-ADDRESSED id + metadata
 * (`memoryCommitment`, reused from @aukora/memory), never by embedding plaintext. The content is still
 * cryptographically bound — `recordId = sha256({content})` — but the separately-held plaintext can be forgotten
 * later without rewriting or invalidating one chain link.
 *
 * Governed forgetting: an owner-authorized tombstone REMOVES the plaintext from the recall store (it is never
 * returned again and no longer resides here), and appends a CONTENT-FREE tombstone to the chain — the historical
 * chain is never rewritten, so the audit that a memory existed and was forgotten is preserved and still verifies.
 *
 * Ingest is fail-closed: malformed / authority-shaped records are refused, and — reusing the canonical
 * @aukora/evidence secret scanner (no clone) — a record whose content carries a live secret is refused so a
 * plaintext credential never enters the chain or the store.
 *
 * This is an APP ADAPTER (Node). It holds in-memory state; the Convex-backed variant in ./convex mirrors the
 * same contracts. Owner verification for forgetting is INJECTED — the store never holds a key or signs.
 */
import { receiptChainHash, verifyReceiptChain } from '../../../../../authority/lib/evidence.js';
import { merkleRoot } from '../../../../../authority/lib/merkle.js';
import { bytesToHex, hexToBytes } from '../../../../../authority/deps/@noble/hashes@2.2.0/utils.js';
import { textHasSecret } from '../../../packages/evidence/src/index.js';
import { validateMemoryRecord, recall, recallScoped, liveMemoryCount, memoryCommitment, tombstoneCommitment, } from '../../../packages/memory/index.js';
export class ReactiveMemoryStore {
    entries = [];
    /** The recall PLAINTEXT store — governed forgetting deletes from here. Metadata lives (content-free) in the chain. */
    records = [];
    forgotten = new Set();
    lastEventAt = null;
    snap;
    constructor() {
        this.snap = this.recompute();
    }
    appendEntry(payload) {
        const prevHash = this.entries.length ? this.entries[this.entries.length - 1].chainHash : null;
        const chainHash = receiptChainHash(payload, prevHash);
        this.entries.push({ payload: payload, prevHash, chainHash });
        return chainHash;
    }
    /**
     * Ingest a memory. Fail-closed: malformed / authority-shaped input is REFUSED, and a record whose content
     * carries a live secret (canonical @aukora/evidence scan) is REFUSED — neither ever enters the chain.
     * Only the CONTENT-FREE commitment is chained; the plaintext is held apart in the recall store.
     */
    ingest(record) {
        const r = validateMemoryRecord(record);
        if (r === null)
            return { ok: false, refusal: 'refused: malformed or authority-shaped memory' };
        // NO RESURRECTION (R44): a governedly forgotten content id may not be re-admitted — re-ingesting the same
        // plaintext would physically retain what the owner erased (the read rail would hide it, but RTBF demands the
        // plaintext be GONE). Re-admission would be a distinct owner ceremony, which does not exist here.
        if (this.forgotten.has(r.recordId))
            return { ok: false, refusal: 'refused: recordId was governedly forgotten — re-ingest would resurrect erased plaintext (no resurrection)' };
        if (textHasSecret(r.content))
            return { ok: false, refusal: 'refused: memory content carries a secret; not persisted in plaintext' };
        if (this.entries.length > 0 && !this.verifyChain().valid)
            return { ok: false, refusal: 'refused: corrupt store — chain verification failed (fail-closed)' };
        const chainHash = this.appendEntry(memoryCommitment(r)); // content-free commitment
        this.records.push(r);
        this.lastEventAt = r.createdAt;
        this.snap = this.recompute();
        return { ok: true, recordId: r.recordId, chainHash, snapshot: this.snap };
    }
    /** Deterministic recall (contract v1); forgotten records are invisible and their content is never surfaced. */
    recall(query) {
        return recall(this.records, query, this.forgotten);
    }
    /** OPT-IN scope-aware recall (#62). The default `recall` above stays byte-exact; scope lives ONLY on this path. */
    recallScoped(query) {
        return recallScoped(this.records, query, this.forgotten);
    }
    /**
     * Governed forgetting. `verifyOwner` is the injected AUMLOK owner authorization check (the seed provides a
     * real Ed25519 verification over the forget request). Fail-closed: no valid owner authorization ⇒ refused.
     * On success the plaintext is DELETED from the recall store, a read-time forgotten mark is set, and a
     * content-free tombstone is appended — the chain is never rewritten and still verifies.
     */
    forget(recordId, verifyOwner, at) {
        if (!this.records.some((r) => r.recordId === recordId))
            return { ok: false, refusal: 'refused: unknown record' };
        if (!verifyOwner())
            return { ok: false, refusal: 'refused: forgetting requires owner authorization' };
        if (this.entries.length > 0 && !this.verifyChain().valid)
            return { ok: false, refusal: 'refused: corrupt store — chain verification failed (fail-closed)' };
        this.forgotten.add(recordId); // read-time invisibility
        // REMOVE the plaintext: drop every live record carrying this content-addressed id from the recall store.
        for (let i = this.records.length - 1; i >= 0; i--)
            if (this.records[i].recordId === recordId)
                this.records.splice(i, 1);
        this.appendEntry(tombstoneCommitment({ recordId, at })); // content-free audit; chain not rewritten
        this.lastEventAt = at;
        this.snap = this.recompute();
        return { ok: true, recordId, snapshot: this.snap };
    }
    snapshot() {
        return this.snap;
    }
    /** The canonical receipt-chain verifier — tamper of any link is detected. */
    verifyChain() {
        return verifyReceiptChain(this.entries);
    }
    /** Fail-closed health gate: `ok` is the canonical chain verdict. A corrupt store blocks further ingest/forget. */
    health() {
        return this.verifyChain();
    }
    chain() {
        return this.entries;
    }
    /**
     * Audit primitive: is the plaintext for `recordId` still retained in the recall store? After a governed
     * forget this is false — the plaintext is gone while the content-free chain entry and tombstone remain.
     */
    plaintextRetained(recordId) {
        return this.records.some((r) => r.recordId === recordId);
    }
    recompute() {
        const headHash = this.entries.length ? this.entries[this.entries.length - 1].chainHash : null;
        const merkleRootHex = this.entries.length
            ? bytesToHex(merkleRoot(this.entries.map((e) => hexToBytes(e.chainHash))))
            : null;
        return {
            liveCount: liveMemoryCount(this.records, this.forgotten),
            chainLength: this.entries.length,
            forgottenCount: this.forgotten.size,
            headHash,
            merkleRootHex,
            lastEventAt: this.lastEventAt,
        };
    }
}
