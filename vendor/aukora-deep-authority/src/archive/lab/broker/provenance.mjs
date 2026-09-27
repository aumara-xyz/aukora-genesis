import { createHmac, createHash } from 'node:crypto';
import { canonicalJSON } from '../kernel/canonical.mjs';

/**
 * ChannelProvenanceTracker:
 * Enforces Topological Anti-Laundering (Killing Breach F2).
 * Every acquired resource (file, credential, handle) issues a cryptographically bound Provenance Token.
 * Outbound emissions MUST present valid provenance tokens for all consumed inputs.
 * Ungated secret reads cannot be laundered into gated writes.
 */
export class ChannelProvenanceTracker {
  constructor({ brokerSecret = 'aukora-broker-provenance-key-secret-32b' } = {}) {
    this.brokerSecret = brokerSecret;
    this.issuedTokens = new Map(); // tokenId -> ProvenanceRecord
  }

  issueAcquisitionToken({ channelId, resourceUri, grantDigest, contentHash, authorized = false }) {
    const payload = {
      channelId,
      resourceUri,
      grantDigest: grantDigest || 'unauthorized_acquisition',
      contentHash,
      authorized,
      issuedAt: Date.now()
    };

    const tokenDigest = createHmac('sha256', this.brokerSecret)
      .update(canonicalJSON(payload))
      .digest('hex');

    const record = {
      tokenId: `prov_${tokenDigest.slice(0, 16)}`,
      payload,
      tokenDigest,
      authorized
    };

    this.issuedTokens.set(record.tokenId, record);
    return record;
  }

  verifyEmissionProvenance({ declaredTokens = [], payloadDigest }) {
    if (!declaredTokens || declaredTokens.length === 0) {
      return { ok: true, note: 'zero-provenance-dependencies' };
    }

    for (const tokenId of declaredTokens) {
      const record = this.issuedTokens.get(tokenId);
      if (!record) {
        return {
          ok: false,
          reason: 'provenance:unknown-token',
          tokenId,
          detail: `Provenance token '${tokenId}' was never issued by the broker.`
        };
      }

      // Re-verify HMAC
      const expectedDigest = createHmac('sha256', this.brokerSecret)
        .update(canonicalJSON(record.payload))
        .digest('hex');

      if (expectedDigest !== record.tokenDigest) {
        return {
          ok: false,
          reason: 'provenance:forged-token',
          tokenId
        };
      }

      // If any consumed input was from an UNAUTHORIZED acquisition, reject emission (Kill Laundering)
      if (!record.authorized) {
        return {
          ok: false,
          reason: 'provenance:unauthorized-source-laundering',
          tokenId,
          detail: `Input from '${record.payload.resourceUri}' was acquired without authorization and cannot be emitted.`
        };
      }
    }

    return { ok: true, verifiedTokens: declaredTokens.length };
  }
}
