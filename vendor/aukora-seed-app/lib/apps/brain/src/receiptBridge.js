/**
 * Bridge a single permitted door receipt into the durable Convex projection. The local receipt-chain append is
 * authoritative for the door's in-process snapshot; the durable leg is the projection the Spatial reads observe.
 */
export class DurableReceiptBridge {
    local;
    projection;
    constructor(local, projection) {
        this.local = local;
        this.projection = projection;
    }
    async ingest(record) {
        const local = this.local.ingest(record);
        // A record the local store refuses (malformed / authority-shaped / secret) is NEVER forwarded to the durable
        // projection — the seam only carries receipts the in-process KIRA already accepted.
        if (!local.ok)
            return { local, durable: { ok: false, refusal: 'local-refused' }, bridged: false };
        try {
            const durable = await this.projection.ingest(record);
            return { local, durable, bridged: durable.ok };
        }
        catch {
            // A backend outage fails HONESTLY: the local receipt stands, the durable leg is retryable, nothing lies green.
            return { local, durable: { ok: false, refusal: 'projection-unreachable' }, bridged: false };
        }
    }
}
/** HARD: the bridge forwards content-free receipts; it mints and grants no authority. Constant, by construction. */
export function durableReceiptBridgeGrantsAuthority() {
    return false;
}
