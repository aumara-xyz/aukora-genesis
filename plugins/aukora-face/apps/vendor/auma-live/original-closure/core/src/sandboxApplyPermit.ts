/**
 * 24Z.18 — AUMLOK-signed Sandbox Apply Permit V0 (the first "it can change something" authority — TEMP ONLY).
 *
 * An honest V0 LOCAL permit (mode `simulated_local`, built on createLocalAumlokRoot — NOT a production AUMLOK
 * signer). A valid permit authorizes a mutation in a THROWAWAY TEMP SANDBOX ONLY. It can NEVER authorize:
 *   - a live-repo write (`canApplyLive` is hard-false; scope is hard `sandbox_only`)
 *   - a Ring-0 / sacred change (only `write_gated` drafts may receive a permit; sacred/executable/read refused)
 *   - production Convex / memory writes / OpenCode live execution
 * Permits require an expiry, a nonce, and the exact draft hash, and the permit hash recomputes (tamper-evident).
 * `grantsAuthority` (for the live repo) is always false.
 */
import * as crypto from 'crypto';
import { createLocalAumlokRoot, type AumlokApprovalRoot } from './aumlokApprovalRoot';
import type { DraftActionClass } from './kernelActionClassifier';

export type PermitMode = 'simulated_local'; // honest V0 — NOT production AUMLOK; clearly labelled everywhere

export interface SandboxApplyPermit {
  permitId: string;
  scope: 'sandbox_only';        // hard — never live
  actionClass: 'write_gated';   // hard — only write_gated drafts get a permit (sacred/executable/read refused)
  draftHash: string;            // binds to one specific draft
  nonce: string;
  issuedAt: string;
  expiresAt: string;            // expiry required
  rootId: string;               // from createLocalAumlokRoot (local_stub)
  permitHash: string;           // sha256 over canonical fields — the "signature"; recomputes on verify
  canApplyLive: false;          // hard
  canApplySandbox: true;        // only meaningful AFTER verifySandboxApplyPermit passes
  mode: PermitMode;
  advisoryOnly: true;
  grantsAuthority: false;       // never grants LIVE-repo authority
}

export interface IssuePermitInput {
  draftHash: string;
  actionClass: DraftActionClass;  // MUST be 'write_gated'
  nonce: string;
  issuedAt?: string;              // ISO; defaults to now (tests pass a fixed value)
  ttlMs?: number;                 // default 5 min
  root?: AumlokApprovalRoot;      // defaults to a fresh local root
}

export type PermitResult =
  | { ok: true; permit: SandboxApplyPermit }
  | { ok: false; refused: true; reason: string };

function sha256(s: string): string { return crypto.createHash('sha256').update(s).digest('hex'); }

function canonicalPermitPayload(p: Omit<SandboxApplyPermit, 'permitHash'>): string {
  const fields: Record<string, string> = {
    actionClass: p.actionClass, canApplyLive: String(p.canApplyLive), canApplySandbox: String(p.canApplySandbox),
    draftHash: p.draftHash, expiresAt: p.expiresAt, issuedAt: p.issuedAt, mode: p.mode, nonce: p.nonce,
    permitId: p.permitId, rootId: p.rootId, scope: p.scope,
  };
  return Object.keys(fields).sort().map((k) => `${k}=${fields[k]}`).join('|');
}

/** Issue a sandbox-only permit. REFUSES anything that is not a write_gated draft (sacred/executable/read/unknown). */
export function issueSandboxApplyPermit(input: IssuePermitInput): PermitResult {
  if (input.actionClass === 'sacred') return { ok: false, refused: true, reason: 'sacred (Ring-0) is NEVER applyable — no permit' };
  if (input.actionClass !== 'write_gated') return { ok: false, refused: true, reason: `only write_gated drafts may receive a sandbox permit (got ${input.actionClass})` };
  if (!input.draftHash || !input.nonce) return { ok: false, refused: true, reason: 'draftHash and nonce are required' };

  const root = input.root ?? createLocalAumlokRoot();
  const issuedAt = input.issuedAt ?? new Date().toISOString();
  const expiresAt = new Date(new Date(issuedAt).getTime() + (input.ttlMs ?? 5 * 60 * 1000)).toISOString();
  const permitId = 'sbx_permit_' + sha256(`${input.draftHash}|${input.nonce}|${root.rootId}`).slice(0, 16);

  const core: Omit<SandboxApplyPermit, 'permitHash'> = {
    permitId, scope: 'sandbox_only', actionClass: 'write_gated', draftHash: input.draftHash, nonce: input.nonce,
    issuedAt, expiresAt, rootId: root.rootId, canApplyLive: false, canApplySandbox: true,
    mode: 'simulated_local', advisoryOnly: true, grantsAuthority: false,
  };
  return { ok: true, permit: { ...core, permitHash: sha256(canonicalPermitPayload(core)) } };
}

export interface VerifyOptions { draftHash: string; now?: string }

/** Verify a permit fails CLOSED: scope/class/hash/expiry/canApplyLive/tamper checks. */
export function verifySandboxApplyPermit(permit: SandboxApplyPermit, opts: VerifyOptions): { valid: boolean; violations: string[] } {
  const v: string[] = [];
  if (!permit || typeof permit !== 'object') return { valid: false, violations: ['no permit'] };
  if (permit.scope !== 'sandbox_only') v.push('scope must be sandbox_only');
  if (permit.actionClass !== 'write_gated') v.push('actionClass must be write_gated');
  if (permit.canApplyLive !== false) v.push('canApplyLive must be false');
  if (permit.canApplySandbox !== true) v.push('canApplySandbox must be true');
  if (permit.mode !== 'simulated_local') v.push('mode must be simulated_local (V0)');
  if (permit.grantsAuthority !== false) v.push('grantsAuthority must be false');
  if (permit.advisoryOnly !== true) v.push('advisoryOnly must be true');
  if (!permit.rootId || !permit.rootId.startsWith('aumlok_root_')) v.push('rootId must be a local aumlok root');
  if (permit.draftHash !== opts.draftHash) v.push('draftHash does not match the draft being applied');

  const now = opts.now ?? new Date().toISOString();
  if (!permit.expiresAt || new Date(now).getTime() >= new Date(permit.expiresAt).getTime()) v.push('permit expired');

  // tamper-evidence: the permit hash must recompute from the canonical fields
  const { permitHash, ...core } = permit;
  if (permitHash !== sha256(canonicalPermitPayload(core))) v.push('permitHash recomputation failed — permit tampered');

  // never carry secrets
  const json = JSON.stringify(permit);
  if (/sk-[a-zA-Z0-9_-]{16,}/.test(json)) v.push('secret-like material in permit');
  if (/-----BEGIN/.test(json)) v.push('key material in permit');

  return { valid: v.length === 0, violations: v };
}

/** Compact status for the manifest / the console. */
export function summarizeSandboxPermit(): string {
  return [
    'Sandbox apply permits: mode=simulated_local (LAB-signed, NOT production AUMLOK).',
    'Scope is sandbox_only; canApplyLive=false (hard); only write_gated drafts get a permit; sacred/Ring-0 refused.',
    'A valid permit authorizes a TEMP-copy mutation only — never the live repo, secrets, Convex, memory, or OpenCode.',
  ].join('\n');
}
