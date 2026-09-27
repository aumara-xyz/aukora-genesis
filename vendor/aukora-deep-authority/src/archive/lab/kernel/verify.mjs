import { createHash, verify as edVerify, sign as edSign, createPublicKey, createPrivateKey, generateKeyPairSync, randomBytes } from 'node:crypto';
import { canonicalJSON } from './canonical.mjs';

export { canonicalJSON };

// ONE verifier. The frozen verifier in aukora/host-dsh/src/grant.mjs is the
// only verifyGrant; this module re-exports its surface so every src/ caller
// resolves to the exact bytes the verifier-bytes court freezes. The softer
// twin that once lived here is gone: it skipped the operation binding when
// the caller omitted a digest and accepted millisecond `exp` values the frozen
// verifier refuses. Key import/export and grant minting stay here because the
// frozen verifier mints nothing and this is the mint surface src/ needs.
import {
  GRANT_DOMAIN,
  MAX_TTL_SECONDS,
  REFUSE,
  GRANT_KEYS,
  payloadDigest,
  receiptKeyIdForPublicKey,
  grantPreimage,
  verifyGrant,
} from '../../../aukora/host-dsh/src/grant.mjs';

export {
  GRANT_DOMAIN,
  MAX_TTL_SECONDS,
  REFUSE,
  GRANT_KEYS,
  payloadDigest,
  receiptKeyIdForPublicKey,
  grantPreimage,
  verifyGrant,
};

const ED_SPKI = Buffer.from('302a300506032b6570032100', 'hex');
const ED_PKCS8 = Buffer.from('302e020100300506032b657004220420', 'hex');

export function importPublicKey(key) {
  if (!key) return null;
  if (typeof key === 'object' && key.type === 'public') return key;
  if (typeof key === 'string') {
    if (key.includes('BEGIN PUBLIC KEY')) return createPublicKey(key);
    const buf = Buffer.from(key, 'hex');
    if (buf.length === 32) return createPublicKey({ key: Buffer.concat([ED_SPKI, buf]), format: 'der', type: 'spki' });
    if (buf.length === 44) return createPublicKey({ key: buf, format: 'der', type: 'spki' });
  }
  if (Buffer.isBuffer(key)) {
    if (key.length === 32) return createPublicKey({ key: Buffer.concat([ED_SPKI, key]), format: 'der', type: 'spki' });
    return createPublicKey({ key, format: 'der', type: 'spki' });
  }
  return null;
}

export function importPrivateKey(key) {
  if (!key) return null;
  if (typeof key === 'object' && key.type === 'private') return key;
  if (typeof key === 'string') {
    if (key.includes('BEGIN PRIVATE KEY')) return createPrivateKey(key);
    const buf = Buffer.from(key, 'hex');
    if (buf.length === 32) return createPrivateKey({ key: Buffer.concat([ED_PKCS8, buf]), format: 'der', type: 'pkcs8' });
    if (buf.length === 48) return createPrivateKey({ key: buf, format: 'der', type: 'pkcs8' });
  }
  if (Buffer.isBuffer(key)) {
    if (key.length === 32) return createPrivateKey({ key: Buffer.concat([ED_PKCS8, key]), format: 'der', type: 'pkcs8' });
    return createPrivateKey({ key, format: 'der', type: 'pkcs8' });
  }
  return null;
}

export function exportPublicKeyHex(publicKey) {
  const der = importPublicKey(publicKey).export({ format: 'der', type: 'spki' });
  return der.subarray(der.length - 32).toString('hex');
}

export function exportPublicKeyPem(publicKey) {
  return importPublicKey(publicKey).export({ format: 'pem', type: 'spki' });
}

export function generateKeypair() {
  const { publicKey, privateKey } = generateKeyPairSync('ed25519');
  return { publicKey, privateKey, publicKeyHex: exportPublicKeyHex(publicKey), publicKeyPem: exportPublicKeyPem(publicKey) };
}

export function newNonce() {
  return randomBytes(16).toString('hex');
}

export function signedGrantKeys() {
  const read = new Set();
  grantPreimage(new Proxy({}, { get: (_t, k) => { if (typeof k === 'string') read.add(k); return undefined; } }));
  return [...read].sort();
}

export function grantKeysLink(declared = GRANT_KEYS) {
  const signed = new Set(signedGrantKeys());
  const closure = new Set(declared);
  const unsignedRiders = [...closure].filter(k => k !== 'signature' && !signed.has(k)).sort();
  const signedButUndeclared = [...signed].filter(k => !closure.has(k)).sort();
  return {
    ok: unsignedRiders.length === 0 && signedButUndeclared.length === 0 && closure.has('signature'),
    unsignedRiders,
    signedButUndeclared
  };
}

// Enforce link at load time
{
  const link = grantKeysLink();
  if (!link.ok) throw new Error(`verify.mjs: GRANT_KEYS and grantPreimage disagree — riders [${link.unsignedRiders}]`);
}

export function operationDigest(toolName, args, definitionId) {
  return createHash('sha256').update(canonicalJSON({ tool: toolName, arguments: args ?? null, definitionId }), 'utf8').digest('hex');
}

export function mintGrant({ toolName, args, definitionId, signer, receiptKeyId, nonce, exp, ttlSeconds = 300, operationDigest: operationDigestValue, now }) {
  if (typeof toolName !== 'string' || !toolName) throw new TypeError('mintGrant: toolName must be string');
  if (typeof definitionId !== 'string' || !definitionId) throw new TypeError('mintGrant: definitionId required');
  if (typeof receiptKeyId !== 'string' || !/^[0-9a-f]{64}$/.test(receiptKeyId)) throw new TypeError('mintGrant: receiptKeyId required');
  const privKey = importPrivateKey(signer);
  if (!privKey) throw new TypeError('mintGrant: valid signer private key required');
  const nowMs = typeof now === 'number' ? now : (typeof now === 'function' ? now() : null);
  if (nowMs === null || !Number.isFinite(nowMs)) throw new TypeError('mintGrant: explicit now required');

  const digest = payloadDigest(toolName, args);
  const spent = nonce ?? newNonce();
  const expires = exp ?? Math.floor(nowMs / 1000) + ttlSeconds;
  const nowSec = Math.floor(nowMs / 1000);
  if (!Number.isInteger(expires) || expires > nowSec + MAX_TTL_SECONDS) {
    throw new RangeError(`mintGrant: exp exceeds MAX_TTL_SECONDS (${MAX_TTL_SECONDS})`);
  }

  const claims = {
    toolName,
    digest,
    nonce: spent,
    exp: expires,
    definitionId,
    operationDigest: operationDigestValue ?? operationDigest(toolName, args, definitionId),
    receiptKeyId,
  };
  const sig = edSign(null, grantPreimage(claims), privKey);
  return { ...claims, signature: sig.toString('base64') };
}

export const signGrant = mintGrant;

export function signPreimage(preimage, privateKey) {
  const privKey = importPrivateKey(privateKey);
  const buf = Buffer.isBuffer(preimage) ? preimage : Buffer.from(preimage, 'utf8');
  return edSign(null, buf, privKey).toString('base64');
}

export function verifySignature(preimage, signature, rootPublicKey) {
  const pubKey = importPublicKey(rootPublicKey);
  if (!pubKey) return false;
  try {
    const sigBuf = Buffer.isBuffer(signature) ? signature : Buffer.from(signature, signature.length === 128 ? 'hex' : 'base64');
    const preBuf = Buffer.isBuffer(preimage) ? preimage : Buffer.from(preimage, 'utf8');
    return edVerify(null, preBuf, pubKey, sigBuf);
  } catch {
    return false;
  }
}
