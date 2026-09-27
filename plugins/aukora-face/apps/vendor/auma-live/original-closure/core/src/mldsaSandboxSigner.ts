/**
 * 24Z.21 — Real ML-DSA / AUMLOK Sandbox Signer (cryptographically real, still SANDBOX-ONLY).
 *
 * Replaces the 24Z.18 `simulated_local` permit hash with a REAL post-quantum signature: ML-DSA-65 (Dilithium)
 * via @noble/post-quantum (the same primitive the kernel's aukoraPqcSigner uses — imported as a shared library,
 * NOT the kernel module). The key is a LOCAL/LAB key, so the honest mode is `lab_mldsa_sandbox` — the signature
 * is real cryptography; the key is NOT a production AUMLOK identity. A verified permit can authorize a TEMP-only
 * sandbox apply and nothing else:
 *   - scope is hard `sandbox_only`; `canApplyLive` is hard false; LIVE repo is never permitable.
 *   - sacred / Ring-0 paths are never permitable, even with a valid signature.
 *   - verification fails closed on tampered payload/signature, wrong key, wrong draft hash, expiry, bad scope.
 * The secret key is the caller's; it is NEVER stored in a receipt/manifest/telemetry. Only the public
 * key + fingerprint are surfaced.
 */
import * as crypto from 'crypto';
import { ml_dsa65 } from '@noble/post-quantum/ml-dsa.js';
import { bytesToHex, hexToBytes } from '@noble/hashes/utils.js';

export type SignerMode = 'lab_mldsa_sandbox' | 'real_mldsa_sandbox' | 'simulated_local';

// Domain separation — a signature over a sandbox permit can never be replayed as any other AUKORA signature.
const PERMIT_CONTEXT = new TextEncoder().encode('aukora-sandbox-permit-v1');

export interface SandboxPermitPayload {
  permitId: string;
  scope: 'sandbox_only';
  draftHash: string;
  actionClassification: 'write_gated';
  sandboxOnly: true;
  canApplyLive: false;
  expiresAt: string;
  nonce: string;
  permittedRelPaths: string[];     // [] = any safe non-sacred path; else the bound allowlist
  signerFingerprint: string;       // sha256(publicKey)[:32] — binds the payload to the key
}

export interface SignedSandboxPermit {
  payload: SandboxPermitPayload;
  alg: 'ml-dsa-65';
  mode: 'lab_mldsa_sandbox';       // honest: real ML-DSA signature, LOCAL/LAB key (not production AUMLOK)
  signerPublicKeyHex: string;
  signerFingerprint: string;
  signatureHex: string;
  advisoryOnly: true;
  grantsAuthority: false;          // never grants LIVE authority
}

export interface LabSandboxKey { publicKeyHex: string; secretKeyHex: string; fingerprint: string }

function sha256hex(s: string): string { return crypto.createHash('sha256').update(s).digest('hex'); }
export function keyFingerprint(publicKeyHex: string): string { return sha256hex(publicKeyHex).slice(0, 32); }

/** Canonical, deterministic serialization of the permit payload (sorted keys + sorted relPaths). */
export function canonicalPermitPayload(p: SandboxPermitPayload): string {
  const obj = {
    actionClassification: p.actionClassification, canApplyLive: p.canApplyLive, draftHash: p.draftHash,
    expiresAt: p.expiresAt, nonce: p.nonce, permitId: p.permitId,
    permittedRelPaths: [...p.permittedRelPaths].sort(), sandboxOnly: p.sandboxOnly, scope: p.scope,
    signerFingerprint: p.signerFingerprint,
  };
  return JSON.stringify(obj);
}

/** Generate a LAB ML-DSA-65 keypair. `seedHex` (32 bytes) makes it deterministic for tests; else random. */
export function generateLabSandboxKey(seedHex?: string): LabSandboxKey {
  const seed = seedHex ? hexToBytes(seedHex) : new Uint8Array(crypto.randomBytes(32));
  if (seed.length !== 32) throw new Error('seed must be 32 bytes');
  const kp = ml_dsa65.keygen(seed);
  const publicKeyHex = bytesToHex(kp.publicKey);
  return { publicKeyHex, secretKeyHex: bytesToHex(kp.secretKey), fingerprint: keyFingerprint(publicKeyHex) };
}

export interface IssueSignedPermitInput {
  draftHash: string;
  nonce: string;
  key: LabSandboxKey;
  issuedAt?: string;
  ttlMs?: number;
  permittedRelPaths?: string[];
  permitId?: string;
}

/** Issue + sign a sandbox-only permit with a real ML-DSA-65 signature (lab key). */
export function signSandboxPermit(input: IssueSignedPermitInput): SignedSandboxPermit {
  const issuedAt = input.issuedAt ?? new Date().toISOString();
  const expiresAt = new Date(new Date(issuedAt).getTime() + (input.ttlMs ?? 5 * 60 * 1000)).toISOString();
  const permitId = input.permitId ?? 'sbx_mldsa_' + sha256hex(`${input.draftHash}|${input.nonce}|${input.key.fingerprint}`).slice(0, 16);
  const payload: SandboxPermitPayload = {
    permitId, scope: 'sandbox_only', draftHash: input.draftHash, actionClassification: 'write_gated',
    sandboxOnly: true, canApplyLive: false, expiresAt, nonce: input.nonce,
    permittedRelPaths: [...(input.permittedRelPaths ?? [])].sort(), signerFingerprint: input.key.fingerprint,
  };
  const msg = new TextEncoder().encode(canonicalPermitPayload(payload));
  const sig = ml_dsa65.sign(msg, hexToBytes(input.key.secretKeyHex), { extraEntropy: false, context: PERMIT_CONTEXT });
  return {
    payload, alg: 'ml-dsa-65', mode: 'lab_mldsa_sandbox',
    signerPublicKeyHex: input.key.publicKeyHex, signerFingerprint: input.key.fingerprint,
    signatureHex: bytesToHex(sig), advisoryOnly: true, grantsAuthority: false,
  };
}

export interface VerifySignedOptions { draftHash: string; now?: string; expectedFingerprint?: string }

/**
 * Verify a signed sandbox permit. FAIL-CLOSED: structural scope/class checks, draft-hash bind, expiry,
 * key↔fingerprint bind, and the REAL ML-DSA signature verification over the canonical payload. Returns
 * {valid, violations, signatureVerified}. A `true` here is the only thing that may authorize a sandbox apply.
 */
export function verifySignedSandboxPermit(signed: SignedSandboxPermit, opts: VerifySignedOptions): { valid: boolean; violations: string[]; signatureVerified: boolean } {
  const v: string[] = [];
  let signatureVerified = false;
  if (!signed || typeof signed !== 'object' || !signed.payload) return { valid: false, violations: ['no signed permit'], signatureVerified: false };
  const p = signed.payload;

  if (signed.alg !== 'ml-dsa-65') v.push('alg must be ml-dsa-65');
  if (signed.mode !== 'lab_mldsa_sandbox') v.push('mode must be lab_mldsa_sandbox (this round)');
  if (signed.grantsAuthority !== false) v.push('grantsAuthority must be false');
  if (p.scope !== 'sandbox_only') v.push('scope must be sandbox_only');
  if (p.actionClassification !== 'write_gated') v.push('actionClassification must be write_gated');
  if (p.sandboxOnly !== true) v.push('sandboxOnly must be true');
  if (p.canApplyLive !== false) v.push('canApplyLive must be false');
  if (p.draftHash !== opts.draftHash) v.push('draftHash does not match the draft being applied');

  const now = opts.now ?? new Date().toISOString();
  if (!p.expiresAt || new Date(now).getTime() >= new Date(p.expiresAt).getTime()) v.push('permit expired');

  // key ↔ fingerprint binding (and optional pin): the payload fingerprint must equal the actual public key's.
  const actualFp = keyFingerprint(signed.signerPublicKeyHex);
  if (signed.signerFingerprint !== actualFp) v.push('signerFingerprint does not match the public key');
  if (p.signerFingerprint !== actualFp) v.push('payload.signerFingerprint does not match the public key');
  if (opts.expectedFingerprint && actualFp !== opts.expectedFingerprint) v.push('public key is not the expected/pinned signer');

  // REAL signature verification over the canonical payload (domain-separated).
  try {
    const msg = new TextEncoder().encode(canonicalPermitPayload(p));
    signatureVerified = ml_dsa65.verify(hexToBytes(signed.signatureHex), msg, hexToBytes(signed.signerPublicKeyHex), { context: PERMIT_CONTEXT });
  } catch (e) {
    v.push(`signature verification error: ${e instanceof Error ? e.message : String(e)}`);
  }
  if (!signatureVerified) v.push('ML-DSA signature did not verify (tampered/forged/wrong key)');

  // never carry secret key material in a permit object
  if (/secretKey/i.test(JSON.stringify(signed))) v.push('secret key material present in permit');

  return { valid: v.length === 0, violations: v, signatureVerified };
}

// ── 24Z.25: Lab ACTIVATION token (separate from the apply permit) ──
// A real ML-DSA-65 signature that gates whether OpenCode may SPAWN at all. Domain-separated from the apply
// permit (different context) so neither can be replayed as the other. LAB key only → never production authority.
const ACTIVATION_CONTEXT = new TextEncoder().encode('aukora-opencode-activation-v1');

export interface LabActivationPayload {
  scope: 'opencode_sandbox_spawn';
  nonce: string;
  expiresAt: string;
  signerFingerprint: string;
}
export interface LabActivationToken {
  payload: LabActivationPayload;
  alg: 'ml-dsa-65';
  mode: 'lab_mldsa_sandbox';
  signerPublicKeyHex: string;
  signerFingerprint: string;
  signatureHex: string;
  grantsAuthority: false;
}

function canonicalActivation(p: LabActivationPayload): string {
  return JSON.stringify({ expiresAt: p.expiresAt, nonce: p.nonce, scope: p.scope, signerFingerprint: p.signerFingerprint });
}

/** Sign a lab activation token (real ML-DSA, lab key). Authorizes ONLY the spawn gate, nothing live. */
export function signLabActivation(input: { key: LabSandboxKey; nonce: string; issuedAt?: string; ttlMs?: number }): LabActivationToken {
  const issuedAt = input.issuedAt ?? new Date().toISOString();
  const expiresAt = new Date(new Date(issuedAt).getTime() + (input.ttlMs ?? 5 * 60 * 1000)).toISOString();
  const payload: LabActivationPayload = { scope: 'opencode_sandbox_spawn', nonce: input.nonce, expiresAt, signerFingerprint: input.key.fingerprint };
  const sig = ml_dsa65.sign(new TextEncoder().encode(canonicalActivation(payload)), hexToBytes(input.key.secretKeyHex), { extraEntropy: false, context: ACTIVATION_CONTEXT });
  return { payload, alg: 'ml-dsa-65', mode: 'lab_mldsa_sandbox', signerPublicKeyHex: input.key.publicKeyHex, signerFingerprint: input.key.fingerprint, signatureHex: bytesToHex(sig), grantsAuthority: false };
}

/** Verify a lab activation token. FAIL-CLOSED: structure, lab-mode, expiry, key↔fingerprint bind, real ML-DSA. */
export function verifyLabActivation(token: LabActivationToken | undefined, opts: { now?: string; expectedFingerprint?: string } = {}): { valid: boolean; violations: string[] } {
  const v: string[] = [];
  if (!token || typeof token !== 'object' || !token.payload) return { valid: false, violations: ['no activation token'] };
  const p = token.payload;
  if (token.alg !== 'ml-dsa-65') v.push('alg must be ml-dsa-65');
  if (token.mode !== 'lab_mldsa_sandbox') v.push('mode must be lab_mldsa_sandbox');
  if (token.grantsAuthority !== false) v.push('grantsAuthority must be false');
  if (p.scope !== 'opencode_sandbox_spawn') v.push('scope must be opencode_sandbox_spawn');
  const now = opts.now ?? new Date().toISOString();
  if (!p.expiresAt || new Date(now).getTime() >= new Date(p.expiresAt).getTime()) v.push('activation expired');
  const actualFp = keyFingerprint(token.signerPublicKeyHex);
  if (token.signerFingerprint !== actualFp) v.push('signerFingerprint does not match the public key');
  if (p.signerFingerprint !== actualFp) v.push('payload.signerFingerprint does not match the public key');
  if (opts.expectedFingerprint && actualFp !== opts.expectedFingerprint) v.push('public key is not the expected/pinned signer');
  let sigOk = false;
  try {
    sigOk = ml_dsa65.verify(hexToBytes(token.signatureHex), new TextEncoder().encode(canonicalActivation(p)), hexToBytes(token.signerPublicKeyHex), { context: ACTIVATION_CONTEXT });
  } catch (e) { v.push(`activation signature error: ${e instanceof Error ? e.message : String(e)}`); }
  if (!sigOk) v.push('ML-DSA activation signature did not verify (tampered/forged/wrong key)');
  if (/secretKey/i.test(JSON.stringify(token))) v.push('secret key material present in activation token');
  return { valid: v.length === 0, violations: v };
}

export function signerStatus(): { mode: SignerMode; alg: string; isRealSignature: true; productionSigner: false } {
  return { mode: 'lab_mldsa_sandbox', alg: 'ml-dsa-65', isRealSignature: true, productionSigner: false };
}

export function summarizeSigner(): string {
  return [
    'Sandbox permit signer: REAL ML-DSA-65 (post-quantum) signature, mode=lab_mldsa_sandbox (LOCAL/LAB key — NOT production AUMLOK).',
    'A verified signature authorizes a TEMP-only sandbox apply; scope=sandbox_only, canApplyLive=false; sacred/Ring-0 never permitable.',
    'Verification is real + fail-closed (tamper/forge/wrong-key/expiry/draft-hash). The secret key is never stored. Live apply NOT built.',
  ].join('\n');
}
