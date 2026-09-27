/**
 * TwoColumnCommitLedger:
 * Enforces the Truth-in-Recovery Law: "Compensated is not Reverted."
 * Separates local byte inversions from external world compensations into two distinct audit columns.
 */
export class TwoColumnCommitLedger {
  constructor({ txId } = {}) {
    this.txId = txId || `tx_${Date.now()}`;
    this.revertedEntries = []; // Local file byte-exact restorations
    this.compensatedEntries = []; // External emission sagas, refunds, or notices
  }

  recordReverted({ path, originalHash, restoredHash, bytesRestored }) {
    this.revertedEntries.push({
      type: 'LOCAL_BYTE_INVERSION',
      path,
      originalHash,
      restoredHash,
      bytesRestored,
      exactMatch: originalHash === restoredHash,
      timestamp: Date.now()
    });
  }

  recordCompensated({ toolName, externalId, compensationAction, refundDigest, notes }) {
    this.compensatedEntries.push({
      type: 'EXTERNAL_COMPENSATION',
      toolName,
      externalId,
      compensationAction,
      refundDigest,
      notes,
      timestamp: Date.now()
    });
  }

  renderReviewSurface() {
    const byteExact = this.revertedEntries.filter(e => e.exactMatch).length;
    return {
      txId: this.txId,
      summary: {
        totalReverted: this.revertedEntries.length,
        totalCompensated: this.compensatedEntries.length,
        cleanReversion: this.compensatedEntries.length === 0
      },
      columns: {
        reverted: this.revertedEntries.map(e => ({
          path: e.path,
          status: e.exactMatch ? 'BYTE-EXACT INVERTED' : 'INVERSION MISMATCH',
          originalHash: e.originalHash,
          restoredHash: e.restoredHash,
          hash: e.restoredHash
        })),
        compensated: this.compensatedEntries.map(e => ({
          tool: e.toolName,
          target: e.externalId,
          status: 'APPROXIMATE COMPENSATION (EXTERNAL EMISSION OCCURRED)',
          compensation: e.compensationAction
        }))
      },
      truthStatement: this.compensatedEntries.length > 0
        ? '⚠️ WARNING: External emissions occurred. External effects were compensated, not byte-reverted.'
        : `NO_EXTERNAL_EMISSION_RECORDED — ${byteExact}/${this.revertedEntries.length} local inversions byte-exact`
    };
  }
}
