import { sign as edSign, verify as edVerify } from 'node:crypto';
import { canonicalJSON } from '../kernel/canonical.mjs';
import { importPublicKey, importPrivateKey } from '../kernel/verify.mjs';

export function mintSettlementReceipt({ requestDigest, grantDigest, nonce, postWriteDigest, postWriteMeta, sequence, brokerPrivateKey }) {
  const privKey = importPrivateKey(brokerPrivateKey);
  if (!privKey) throw new TypeError('Valid broker private key required');
  const claims = {
    grantDigest, nonce, postWriteDigest,
    postWriteMeta: { ino: Number(postWriteMeta.ino || 0), mtimeNs: Number(postWriteMeta.mtimeNs || postWriteMeta.mtimeMs * 1000000 || 0) },
    requestDigest, sequence: Number(sequence)
  };
  const preimage = canonicalJSON(claims);
  const sig = edSign(null, Buffer.from(preimage, 'utf8'), privKey);
  return { ...claims, brokerSignature: sig.toString('base64'), preimage };
}

export function verifySettlementReceipt(receipt, brokerPublicKey, expectedDigest) {
  if (!receipt?.brokerSignature) return false;
  const pubKey = importPublicKey(brokerPublicKey);
  if (!pubKey || (expectedDigest && receipt.postWriteDigest !== expectedDigest)) return false;

  const claims = {
    grantDigest: receipt.grantDigest, nonce: receipt.nonce, postWriteDigest: receipt.postWriteDigest,
    postWriteMeta: receipt.postWriteMeta, requestDigest: receipt.requestDigest, sequence: receipt.sequence
  };
  try {
    const sigBuf = Buffer.from(receipt.brokerSignature, receipt.brokerSignature.length === 128 ? 'hex' : 'base64');
    return edVerify(null, Buffer.from(canonicalJSON(claims), 'utf8'), pubKey, sigBuf);
  } catch {
    return false;
  }
}
