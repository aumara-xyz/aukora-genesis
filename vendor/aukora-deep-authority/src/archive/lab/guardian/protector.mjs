import { sign as edSign } from 'node:crypto';
import { canonicalJSON } from '../kernel/canonical.mjs';
import {
  generateKeypair,
  importPrivateKey,
  importPublicKey,
  exportPublicKeyHex,
  verifySignature,
  mintGrant,
  newNonce
} from '../kernel/verify.mjs';

export const ENVELOPE_DOMAIN = 'aukora:envelope:v2';

export function signMasterEnvelope({ allowedTools = ['memory.put'], keyPrefix = 'user:*', maxOps = 50, ttlSeconds = 3600, exp, delegatePubkey, definitionId = 'def-memory-v1', signer, now = Date.now() }) {
  const privKey = importPrivateKey(signer);
  if (!privKey) throw new TypeError('Valid root private key required');
  const nowSec = Math.floor(now / 1000);
  const claims = {
    allowedTools, definitionId, delegatePubkey: exportPublicKeyHex(delegatePubkey), domain: ENVELOPE_DOMAIN,
    exp: exp || (nowSec + ttlSeconds), keyPrefix, maxOps
  };
  const preimage = canonicalJSON(claims);
  const sig = edSign(null, Buffer.from(preimage, 'utf8'), privKey);
  return { ...claims, signature: sig.toString('base64'), preimage };
}

export function verifyMasterEnvelope(envelope, rootPublicKey, nowMs = Date.now()) {
  if (!envelope || !envelope.signature) return { ok: false, reason: 'envelope:malformed' };
  const pubKey = importPublicKey(rootPublicKey);
  if (!pubKey) return { ok: false, reason: 'envelope:no-root' };
  if (envelope.exp <= Math.floor(nowMs / 1000)) return { ok: false, reason: 'envelope:expired' };

  const claims = {
    allowedTools: envelope.allowedTools, definitionId: envelope.definitionId, delegatePubkey: envelope.delegatePubkey,
    domain: envelope.domain, exp: envelope.exp, keyPrefix: envelope.keyPrefix, maxOps: envelope.maxOps
  };
  return verifySignature(canonicalJSON(claims), envelope.signature, pubKey)
    ? { ok: true, claims }
    : { ok: false, reason: 'envelope:bad-signature' };
}

export class ProtectorGuardian {
  constructor({ envelope, delegateKeyPair, rootPublicKey, directRootSigner } = {}) {
    this.envelope = envelope || null;
    this.delegateKeyPair = delegateKeyPair || generateKeypair();
    this.rootPublicKey = rootPublicKey ? importPublicKey(rootPublicKey) : null;
    this.directRootSigner = directRootSigner ? importPrivateKey(directRootSigner) : null;
    this.opsCount = 0;
  }

  evaluate({ toolName, args, now = Date.now() }) {
    if (this.envelope) {
      if (this.envelope.exp <= Math.floor(now / 1000)) return { ok: false, reason: 'policy:envelope-expired', escalate: true };
      if (!this.envelope.allowedTools.includes(toolName)) return { ok: false, reason: `policy:unauthorized-tool:${toolName}`, escalate: true };
      if (this.opsCount >= this.envelope.maxOps) return { ok: false, reason: 'policy:max-ops-exceeded', escalate: true };
      const prefix = this.envelope.keyPrefix.endsWith('*') ? this.envelope.keyPrefix.slice(0, -1) : this.envelope.keyPrefix;
      if (args?.key && !args.key.startsWith(prefix)) return { ok: false, reason: `policy:prefix-mismatch:${args.key}`, escalate: true };
    }
    return { ok: true };
  }

  requestMicroGrant({ toolName, args, receiptKeyId, now = Date.now(), exp, nonce }) {
    const check = this.evaluate({ toolName, args, now });
    if (!check.ok) return { ok: false, reason: check.reason, escalate: check.escalate };
    this.opsCount++;
    const grant = mintGrant({
      toolName, args, definitionId: this.envelope?.definitionId || 'def-memory-v1',
      signer: this.directRootSigner || this.delegateKeyPair.privateKey,
      receiptKeyId, nonce: nonce || newNonce(), exp, ttlSeconds: 60, now
    });
    return { ok: true, grant };
  }
}
