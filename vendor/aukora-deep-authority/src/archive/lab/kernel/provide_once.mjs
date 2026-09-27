import { createHash } from 'node:crypto';
import { canonicalJSON } from './canonical.mjs';
import { verifySignature } from './verify.mjs';

/**
 * ProvideOnceRegistry:
 * Enforces the Opus Law: Authority keys are strictly provide-once per root.
 * A withdrawn authority key may NEVER be re-provided by any component.
 * Re-provisioning can only occur via an explicit, signed ROOT_CHANGE rotation ceremony.
 */
export class ProvideOnceRegistry {
  constructor({ rootPublicKey }) {
    this.rootPublicKey = rootPublicKey;
    this.activeAuthorities = new Map(); // keyName -> { providerId, registeredAt }
    this.retiredAuthorities = new Set(); // permanently sealed keys
    this.rotationEpoch = 0;
    this.rotationAuditLog = [];
  }

  provide(keyName, providerId) {
    if (this.retiredAuthorities.has(keyName)) {
      throw new Error(`authority:provide-once-violation: Key '${keyName}' was previously withdrawn and cannot be re-mounted`);
    }
    if (this.activeAuthorities.has(keyName)) {
      throw new Error(`authority:already-mounted: Key '${keyName}' is already provided by '${this.activeAuthorities.get(keyName).providerId}'`);
    }
    this.activeAuthorities.set(keyName, { providerId, registeredAt: Date.now() });
    return { ok: true, keyName, providerId };
  }

  withdraw(keyName, providerId) {
    if (!this.activeAuthorities.has(keyName)) {
      throw new Error(`authority:not-mounted: Key '${keyName}' is not currently active`);
    }
    const current = this.activeAuthorities.get(keyName);
    if (current.providerId !== providerId) {
      throw new Error(`authority:unauthorized-withdrawal: Only provider '${current.providerId}' can withdraw '${keyName}'`);
    }
    this.activeAuthorities.delete(keyName);
    this.retiredAuthorities.add(keyName); // Permanently seal the key
    return { ok: true, keyName, permanentlySealed: true };
  }

  isAuthorized(keyName) {
    return this.activeAuthorities.has(keyName);
  }

  executeRootRotationCeremony({ currentEpoch, nextEpoch, newRootPublicKey, rotationSignature, unsealKeys = [] }) {
    if (currentEpoch !== this.rotationEpoch) {
      throw new Error(`rotation:epoch-mismatch: Expected epoch ${this.rotationEpoch}, received ${currentEpoch}`);
    }
    if (nextEpoch !== this.rotationEpoch + 1) {
      throw new Error(`rotation:invalid-next-epoch: Expected epoch ${this.rotationEpoch + 1}`);
    }

    const preimage = canonicalJSON({
      action: 'ROOT_CHANGE_CEREMONY',
      currentEpoch,
      nextEpoch,
      newRootPublicKey,
      unsealKeys
    });

    const isValid = verifySignature(
      preimage,
      rotationSignature,
      this.rootPublicKey
    );

    if (!isValid) {
      throw new Error('rotation:invalid-signature: Ceremony rejected by root sovereign key');
    }

    // Unseal explicitly requested keys
    for (const k of unsealKeys) {
      this.retiredAuthorities.delete(k);
    }

    this.rootPublicKey = newRootPublicKey;
    this.rotationEpoch = nextEpoch;
    this.rotationAuditLog.push({
      epoch: nextEpoch,
      preimageHash: createHash('sha256').update(preimage).digest('hex'),
      timestamp: Date.now()
    });

    return { ok: true, epoch: this.rotationEpoch, newRootPublicKey };
  }
}
