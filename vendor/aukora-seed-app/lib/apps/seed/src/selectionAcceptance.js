// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Aukora
/**
 * Selection-packet ACCEPTANCE (R34, pure) — how a MemorySelectionPacketV1 is received and ROUTED, still with no import.
 *
 * Accepting a packet means: verify it (digest + privacy laws), then produce a ROUTING PLAN that names, for every
 * item, exactly which governed path its migration would take:
 *   - ROOT / UNITE / RISE migrate items → the NORMAL governed-proposal path (the standard recursion gate);
 *   - GOLD migrate items, and any MATERNAL-ANCHOR item → the HIGHER-FRICTION owner AUMLOK ceremony, with the full
 *     gold requirement checklist (reason, supersedes lineage or explicit genesis, PASSED-rehearsal receipt,
 *     prepared rollback draft) carried as an explicit unmet-requirements list;
 *   - `leave-behind` / `private-hold` items → `stays-behind` (no route, content-free by construction).
 *
 * Anchor-bearing items must also validate against the maternal-anchor schema — romance/exclusivity/dependency/
 * possession/impersonation/obedience framings refuse the ITEM (stable reason class), never silently pass.
 *
 * The plan is advisory and content-preserving: it performs NO import (`importPerformed()` stays false); the owner
 * approves and a future, separately-directed round executes routes through the real gates. Grants no authority.
 */
import { verifySelectionPacket } from './memorySelection.js';
import { requiredChangePath, evaluateGoldChange } from './memoryConstitution.js';
import { validateMaternalAnchor, FORBIDDEN_FRAMING_RE } from './maternalAnchor.js';
const GOLD_CHECKLIST = ['reason', 'supersedes-lineage-or-genesis', 'rehearsal-receipt', 'rollback-draft'];
function routeItem(item, opts) {
    const base = { rowId: item.citation.rowId, table: item.citation.table, classification: item.classification, proposedTier: item.proposedTier };
    if (item.classification !== 'migrate') {
        return { ...base, route: 'stays-behind', unmetGoldRequirements: [], reasonClass: 'accept:ok', text: `${item.classification}: stays behind, content-free — nothing to route` };
    }
    const isAnchor = opts.anchorRowIds?.has(item.citation.rowId) ?? false;
    if (isAnchor) {
        // An anchor item must be a valid maternal anchor (its content is the anchor JSON) and ALWAYS takes the ceremony.
        let parsed = null;
        try {
            parsed = JSON.parse(item.content ?? 'null');
        }
        catch {
            parsed = null;
        }
        const anchor = validateMaternalAnchor(parsed);
        if (!anchor.ok) {
            const framing = typeof item.content === 'string' && FORBIDDEN_FRAMING_RE.test(item.content);
            return {
                ...base, route: 'gold-ceremony', unmetGoldRequirements: [...GOLD_CHECKLIST],
                reasonClass: framing ? 'accept:anchor-framing' : 'accept:anchor-invalid',
                text: framing
                    ? 'refused: anchor carries a forbidden framing (romance/exclusivity/dependency/possession/impersonation/obedience)'
                    : `refused: anchor does not validate (${anchor.reason})`,
            };
        }
    }
    const path = requiredChangePath(item.proposedTier);
    if (path === 'governed-proposal' && !isAnchor) {
        return { ...base, route: 'governed-proposal', unmetGoldRequirements: [], reasonClass: 'accept:ok', text: `${item.proposedTier}: routes through the normal governed proposal gate` };
    }
    // GOLD tier or anchor → the higher-friction ceremony, with the evidence checklist made explicit.
    const evidence = opts.goldEvidence?.get(item.citation.rowId);
    if (evidence === undefined) {
        return { ...base, route: 'gold-ceremony', unmetGoldRequirements: [...GOLD_CHECKLIST], reasonClass: 'accept:ok', text: 'routes through the owner AUMLOK ceremony — gold evidence (reason/lineage/rehearsal/rollback) still required' };
    }
    const gold = evaluateGoldChange('gold', evidence);
    if (!gold.ok) {
        return { ...base, route: 'gold-ceremony', unmetGoldRequirements: [...GOLD_CHECKLIST], reasonClass: gold.reasonClass, text: gold.text };
    }
    return { ...base, route: 'gold-ceremony', unmetGoldRequirements: [], reasonClass: 'accept:ok', text: 'gold evidence complete — ready for the owner AUMLOK ceremony (rehearsal receipt + rollback pinned)' };
}
/** Accept a selection packet: verify, route every item, import nothing. Total; fail-closed on an invalid packet. */
export function acceptSelectionPacket(packet, opts = {}) {
    const v = verifySelectionPacket(packet);
    if (!v.valid)
        return { ok: false, reasonClass: 'accept:packet-invalid', text: `refused: selection packet failed verification (${v.reason})` };
    const items = packet.items.map((item) => routeItem(item, opts));
    const counts = {
        governedProposal: items.filter((i) => i.route === 'governed-proposal' && i.reasonClass === 'accept:ok').length,
        goldCeremony: items.filter((i) => i.route === 'gold-ceremony' && i.reasonClass === 'accept:ok').length,
        staysBehind: items.filter((i) => i.route === 'stays-behind').length,
        refused: items.filter((i) => i.reasonClass !== 'accept:ok').length,
    };
    return {
        ok: true,
        plan: {
            schema: 'aukora-selection-routing-plan-v1',
            packetDigest: packet.digest,
            items,
            counts,
            importPerformed: false,
            advisoryOnly: true,
            grantsAuthority: false,
        },
    };
}
/** HARD: acceptance routes, it never imports. Constant, by construction. */
export function acceptancePerformsImport() {
    return false;
}
